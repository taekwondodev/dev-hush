// dev-hush - animated working presentation.
//
// Adapted from the Firstmate project's Calm implementation.
// Copyright (c) 2026 Kun Chen. MIT License - see the LICENSE file in this directory.
//
// Hush replaces Pi's stock working row with a tiny three-row ASCII boat while one
// logical agent run is active. This module owns only the sprite geometry, the
// bounce track, the two animation cadences, the session-scoped freeze/resume
// state, and the temporary TUI widget; ../index.ts owns when the presentation
// is installed and removed, and stays the sole caller of setWorkingVisible().
//
// Cadence: one scheduler drives two logically independent clocks. The water
// drifts every HUSH_WORKING_SHIP_TICKS_PER_WATER_SHIFT-th tick and the boat
// moves every HUSH_WORKING_SHIP_TICKS_PER_MOVE-th tick, so the water visibly
// ripples between boat steps and the boat itself reads as calm. Both clocks stop
// together when the widget is disposed. Ticks, not wall-clock timestamps, drive every state
// change, so tests can seek time exactly.
//
// Continuity: one extension-owned animation instance survives hide/show within
// the same Pi process and Hush extension lifetime. Disposing the widget freezes
// column, direction, water phase, and tick cadence without advancing them for
// hidden wall time. The next working period resumes from that exact logical
// state. A fresh session or new extension lifetime calls reset() and starts at
// the normal initial position. State is never a module-level or process-global
// singleton.
//
// Verified against Pi 0.82.0, which exposes ExtensionUIContext.setWidget() with
// a component factory, per-widget dispose(), and TUI.requestRender(). Pi renders
// a widget through Component.render(width), so this module recomputes its track
// from that width on every frame instead of caching a terminal size that a
// resize would invalidate. A resize while the boat is hidden is applied on the
// first resumed frame through the same clamp path.
import type { Component, TUI } from "@earendil-works/pi-tui";

// The hull is symmetric and replaces waves on its row; the sail adds two rows above it.
const HULL = "\\____/";
const HULL_WIDTH = HULL.length;

type Sail = { rows: readonly [string, string]; offset: number };
// A mainsail extends aft of the mast, so it trails behind the bow relative to travel.
// Only `/`, `\`, `|`, and spaces: no pair that common coding fonts turn into a ligature
// (the old `<|` / `|>` rendered as a play triangle and lost its mast).
const SAIL_RIGHT: Sail = { rows: [" /|", "/ |"], offset: 1 };
const SAIL_LEFT: Sail = { rows: ["|\\", "| \\"], offset: 2 };

// Sparse deterministic water: mostly calm surface with scattered crests. Every entry is
// exactly one column, so drifting the phase never changes visible width or row count.
// The long irregular period keeps the drift from reading as a marching pattern.
const WATER = "~  ~~   ~ ~    ~~  ~   ~ ";
// Churned water directly aft of the hull, nearest cell first, fading back into the sea.
const WAKE = ["=", "~", "-"] as const;

// Standard ANSI foreground codes only: no theme lookup, bright variant, or 256/RGB.
const BLUE = "\u001b[34m";
const CYAN = "\u001b[36m";
const YELLOW = "\u001b[33m";
// Restores the default foreground so color never bleeds into padding or later frames.
const RESET = "\u001b[39m";

export const HUSH_WORKING_SHIP_WIDGET_KEY = "dev-hush-working-ship";
/** Scheduler period shared by every animation clock. */
export const HUSH_WORKING_SHIP_TICK_MS = 220;
/** Water drifts one column every Nth tick: 220 * 2 = 440ms per shift. */
export const HUSH_WORKING_SHIP_TICKS_PER_WATER_SHIFT = 2;
/** Boat moves one column every Nth tick, so it travels at 220 * 4 = 880ms per column. */
export const HUSH_WORKING_SHIP_TICKS_PER_MOVE = 4;

export type HushWorkingShipAnimation = {
  /** Render one frame that exactly fits `width`, clamping the track to it first. */
  render(width: number): string[];
  /** Advance one scheduler tick: water and boat each on their own cadence. */
  tick(): void;
  restoreLastRendered(): void;
  /** Restore the normal initial column, direction, water phase, and cadence. */
  reset(): void;
  /**
   * Clamp the frozen column and direction to `width` without advancing time.
   * Used when a terminal resize lands while the working presentation is hidden.
   */
  clampToWidth(width: number): void;
  /** Current hull column, exposed for deterministic motion assertions. */
  position(): number;
  /** Current travel direction: 1 travelling right, -1 travelling left. */
  direction(): number;
  /** Current water phase, exposed for deterministic ripple assertions. */
  waterPhase(): number;
};

/** Longest hull start column that still fits the sprite in `width` usable cells. */
function trackSpan(width: number): number {
  return width >= HULL_WIDTH ? width - HULL_WIDTH : 0;
}

export function createHushWorkingShipAnimation(): HushWorkingShipAnimation {
  let position = 0;
  let direction = 1;
  let span = 0;
  let phase = 0;
  let ticks = 0;
  let renderedPosition = position;
  let renderedDirection = direction;
  let renderedSpan = span;
  let renderedPhase = phase;
  let renderedTicks = ticks;

  // Reversing the moment the boat lands on an endpoint means the endpoint frame itself
  // already shows the new heading, so no frame at or after a bounce shows the old sail.
  const settleDirectionAtEdges = (): void => {
    if (span <= 0) return;
    if (position >= span) direction = -1;
    else if (position <= 0) direction = 1;
  };

  const applyWidth = (width: number): void => {
    if (width <= 0) {
      span = 0;
      position = 0;
      return;
    }
    span = trackSpan(width);
    position = Math.min(position, span);
    settleDirectionAtEdges();
  };

  const commitRenderedState = (): void => {
    renderedPosition = position;
    renderedDirection = direction;
    renderedSpan = span;
    renderedPhase = phase;
    renderedTicks = ticks;
  };

  const restoreLastRenderedState = (): void => {
    position = renderedPosition;
    direction = renderedDirection;
    span = renderedSpan;
    phase = renderedPhase;
    ticks = renderedTicks;
  };

  const waterCell = (column: number): string => WATER[(column + phase) % WATER.length]!;

  /** One frame row of `width` cells, grouping adjacent cells of the same color. */
  const surface = (width: number, withBoat: boolean): string => {
    const cells: Array<[color: string, text: string]> = [];
    for (let column = 0; column < width; column += 1) {
      cells.push([BLUE, waterCell(column)]);
    }
    if (withBoat) {
      for (let i = 0; i < HULL_WIDTH; i += 1) cells[position + i] = [YELLOW, HULL[i]!];
      WAKE.forEach((text, i) => {
        const column = direction >= 0 ? position - 1 - i : position + HULL_WIDTH + i;
        if (column >= 0 && column < width) cells[column] = [CYAN, text];
      });
    }
    let row = "";
    let open: string | undefined;
    for (const [color, text] of cells) {
      if (color !== open) {
        if (open !== undefined) row += RESET;
        row += color;
        open = color;
      }
      row += text;
    }
    return open === undefined ? row : row + RESET;
  };

  const sailRows = (): string[] => {
    const sail = direction >= 0 ? SAIL_RIGHT : SAIL_LEFT;
    const column = position + sail.offset;
    return sail.rows.map((text) => " ".repeat(column) + `${YELLOW}${text}${RESET}`);
  };

  return {
    position: () => position,
    direction: () => direction,
    waterPhase: () => phase,

    restoreLastRendered: restoreLastRenderedState,

    reset(): void {
      position = 0;
      direction = 1;
      span = 0;
      phase = 0;
      ticks = 0;
      commitRenderedState();
    },

    clampToWidth(width: number): void {
      applyWidth(width);
    },

    tick(): void {
      ticks += 1;
      if (ticks % HUSH_WORKING_SHIP_TICKS_PER_WATER_SHIFT === 0) {
        phase = (phase + 1) % WATER.length;
      }
      if (ticks % HUSH_WORKING_SHIP_TICKS_PER_MOVE !== 0) return;
      if (span <= 0) {
        position = 0;
        return;
      }
      position = Math.min(span, Math.max(0, position + direction));
      settleDirectionAtEdges();
    },

    render(width: number): string[] {
      if (width <= 0) return [];

      // A resize lands here before the next frame, so recompute and clamp the track
      // immediately rather than trusting a position measured against the old width.
      applyWidth(width);

      // Too narrow for the hull: a deterministic single row of water.
      const frame =
        width < HULL_WIDTH
          ? [surface(width, false)]
          : [...sailRows(), surface(width, true)];

      commitRenderedState();
      return frame;
    },
  };
}

/**
 * Build the temporary Hush working widget bound to one caller-owned animation.
 * Pi disposes the previous component before installing a replacement under the same
 * key and when it clears extension widgets, so the single scheduler driving both
 * cadences cannot outlive the widget or duplicate. Disposing freezes the shared
 * animation in place; the next widget bound to the same animation resumes without
 * applying hidden wall time.
 */
export function createHushWorkingShipWidget(
  tui: TUI,
  animation: HushWorkingShipAnimation = createHushWorkingShipAnimation(),
): Component & { dispose(): void } {
  let disposed = false;
  const timer = setInterval(() => {
    if (disposed) return;
    animation.tick();
    tui.requestRender();
  }, HUSH_WORKING_SHIP_TICK_MS);
  // The animation must never keep Pi's process alive on its own.
  timer.unref?.();

  return {
    render: (width) => (disposed ? [] : animation.render(width)),
    // Every frame is rebuilt from fixed standard ANSI codes, so there is no cache.
    invalidate: () => {},
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      animation.restoreLastRendered();
    },
  };
}
