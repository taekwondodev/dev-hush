// dev-hush - animated working presentation.
//
// Widget lifecycle adapted from the Firstmate project's Calm implementation.
// Copyright (c) 2026 Kun Chen. MIT License - see the LICENSE file in this directory.
//
// Hush replaces Pi's stock working row with a four-row Kitty-graphics scene (see
// ./scene/backlit.ts) while one logical agent run is active. This module owns the
// deterministic tick clock, the session-scoped freeze/resume state, the band lines
// Pi renders, the in-place frame updates, and the temporary TUI widget. ../index.ts
// owns when the presentation is installed and removed, and stays the sole caller of
// setWorkingVisible().
//
// Transport: Pi's alternate-screen renderer retransmits an image and re-places every
// visible image whenever an image row changes. To keep the renderer out of the
// per-frame path, render(width) returns the same lines for a given size and background:
// one Kitty transmit of the first frame under a stable image id, then empty rows, as
// Pi's own Image component does. Every tick then edits that image's root frame in place
// (Kitty animation `a=f`, verified in Rex), written straight to the terminal, so no row
// changes and nothing else is redrawn.
//
// Background: the scene is painted over the terminal's own background so the band has
// no visible edge. Each new widget asks the terminal for it through Pi's public
// TUI.queryTerminalColors() and keeps the answer for later working periods; until the
// first answer arrives the band is four empty rows. A changed answer requests one Pi
// render, the only render the widget ever requests.
//
// Continuity: one extension-owned animation instance survives hide/show within the
// same Pi process and Hush extension lifetime. Disposing the widget drops ticks that
// were never shown and forgets the placement, so the next working period transmits
// the frozen frame afresh and resumes from it. A fresh session calls reset(). Time is
// tick-driven, never wall-clock, so tests can seek it exactly. A resize or a new cell
// size simply re-renders the current tick at the new size: positions are proportional
// to the canvas, so no clamp step exists.
//
// Verified against Pi 1.5.0: ExtensionUIContext.setWidget() with a component factory,
// per-widget dispose(), TUI.terminal.write(), TUI.queryTerminalColors(), and renderImage() producing exactly
// `width` columns by HUSH_WORKING_SCENE_ROWS rows for a canvas sized from the cell
// dimensions Pi learned from the terminal.
import {
  type Component,
  type TUI,
  type TerminalColors,
  allocateImageId,
  getCapabilities,
  getCellDimensions,
  renderImage,
} from "@earendil-works/pi-tui";
import { paintBacklitBackdrop, renderBacklit } from "./scene/backlit.ts";
import { Canvas, type Rgb } from "./scene/paint.ts";

export const HUSH_WORKING_SCENE_WIDGET_KEY = "dev-hush-working-scene";
/** Band height in terminal rows. */
export const HUSH_WORKING_SCENE_ROWS = 4;
/** Scheduler period: 12 frames per second. Scene time derives from ticks, so this only changes smoothness. */
export const HUSH_WORKING_SCENE_TICK_MS = 83;

const KITTY_CHUNK = 4096;
/** How long a new widget waits for the terminal's colours before painting over FALLBACK_BACKGROUND. */
const BACKGROUND_QUERY_MS = 300;
/** For a terminal that does not report its background (OSC 11). */
const FALLBACK_BACKGROUND: Rgb = [0, 0, 0];

export type HushWorkingSceneAnimation = {
  /** The band's lines for `width`, stable while the size and background are unchanged. [] when nothing can be drawn. */
  render(width: number): string[];
  /**
   * Record the terminal background to paint over; undefined when the terminal did not report
   * one, which keeps an earlier answer or falls back to black. True when the band must be
   * rendered again.
   */
  setBackground(reported: Rgb | undefined): boolean;
  /** Advance one scheduler tick. */
  tick(): void;
  /** Kitty command that updates the placed image to the current tick, or undefined when there is nothing to update. */
  frameEdit(): string | undefined;
  /** Freeze: drop ticks never shown and forget the placement so the next render transmits afresh. */
  restoreLastRendered(): void;
  /** Restore t = 0 for a new session. */
  reset(): void;
  /** Current tick count, exposed for deterministic assertions. */
  ticks(): number;
};

type Geometry = { widthPx: number; heightPx: number };
type Placement = Geometry & { width: number; lines: string[] };

/** True when Pi detected a Kitty-graphics terminal. Hush has no text fallback for the scene. */
export function hushWorkingSceneSupported(): boolean {
  return getCapabilities().images === "kitty";
}

/** Retina terminals usually report logical points, so render at 2x below 24 px cells. */
function geometry(width: number): Geometry {
  const cell = getCellDimensions();
  const k = cell.heightPx < 24 ? 2 : 1;
  return {
    widthPx: width * cell.widthPx * k,
    heightPx: HUSH_WORKING_SCENE_ROWS * cell.heightPx * k,
  };
}

/**
 * One Kitty animation-frame command carrying `base64`, chunked as the protocol requires:
 * continuation chunks of frame data must repeat `a=f`.
 */
function kittyFrameCommand(controls: string, base64: string): string {
  let sequence = "";
  for (let offset = 0; offset < base64.length; offset += KITTY_CHUNK) {
    const more = offset + KITTY_CHUNK < base64.length ? 1 : 0;
    const head = offset === 0 ? `a=f,${controls},m=${more}` : `a=f,m=${more}`;
    sequence += `\u001b_G${head};${base64.slice(offset, offset + KITTY_CHUNK)}\u001b\\`;
  }
  return sequence;
}

export function createHushWorkingSceneAnimation(): HushWorkingSceneAnimation {
  const imageId = allocateImageId();
  let ticks = 0;
  let shownTicks = 0;
  let placement: Placement | undefined;
  let background: Rgb | undefined;
  let backdrop: Canvas | undefined;
  let frame: Canvas | undefined;

  const seconds = (): number => (ticks * HUSH_WORKING_SCENE_TICK_MS) / 1000;

  const paintFrame = ({ widthPx, heightPx }: Geometry, bg: Rgb): string => {
    if (!backdrop || !frame || backdrop.width !== widthPx || backdrop.height !== heightPx) {
      backdrop = new Canvas(widthPx, heightPx);
      paintBacklitBackdrop(backdrop, bg);
      frame = new Canvas(widthPx, heightPx);
    }
    renderBacklit(frame, seconds(), backdrop);
    return frame.toPNG(1).toString("base64");
  };

  return {
    ticks: () => ticks,

    tick(): void {
      ticks += 1;
    },

    setBackground(reported: Rgb | undefined): boolean {
      const next = reported ?? background ?? FALLBACK_BACKGROUND;
      if (background && background.every((v, i) => v === next[i])) return false;
      background = next;
      // Both the cached backdrop and the transmitted image carry the old background.
      backdrop = undefined;
      placement = undefined;
      return true;
    },

    reset(): void {
      ticks = 0;
      shownTicks = 0;
      placement = undefined;
    },

    restoreLastRendered(): void {
      ticks = shownTicks;
      placement = undefined;
    },

    render(width: number): string[] {
      if (width < 2) return [];
      // Hold the band's place until the terminal reports its background.
      if (!background) return Array.from({ length: HUSH_WORKING_SCENE_ROWS }, () => "");
      const size = geometry(width);
      const current =
        placement &&
        placement.width === width &&
        placement.widthPx === size.widthPx &&
        placement.heightPx === size.heightPx;
      if (!current) {
        const image = renderImage(paintFrame(size, background), { widthPx: size.widthPx, heightPx: size.heightPx }, {
          maxWidthCells: width,
          maxHeightCells: HUSH_WORKING_SCENE_ROWS,
          imageId,
          moveCursor: false,
        });
        if (!image) return [];
        const lines = [image.sequence];
        for (let row = 1; row < HUSH_WORKING_SCENE_ROWS; row += 1) lines.push("");
        placement = { ...size, width, lines };
        shownTicks = ticks;
      }
      return placement!.lines;
    },

    frameEdit(): string | undefined {
      if (!placement || !background || shownTicks === ticks) return undefined;
      const png = paintFrame(placement, background);
      shownTicks = ticks;
      // Replace the root frame's pixels; the terminal repaints the placement in place.
      return kittyFrameCommand(`i=${imageId},r=1,X=1,f=100,q=2`, png);
    },
  };
}

/**
 * Build the temporary Hush working widget bound to one caller-owned animation.
 * Pi disposes the previous component before installing a replacement under the same
 * key and when it clears extension widgets, so the scheduler cannot outlive the widget
 * or duplicate. Ticks never request a Pi render: they write the frame edit directly,
 * and the band lines stay unchanged until a resize or a new terminal background.
 */
export function createHushWorkingSceneWidget(
  tui: TUI,
  animation: HushWorkingSceneAnimation = createHushWorkingSceneAnimation(),
): Component & { dispose(): void } {
  let disposed = false;
  const timer = setInterval(() => {
    if (disposed) return;
    animation.tick();
    const edit = animation.frameEdit();
    if (edit) tui.terminal.write(edit);
  }, HUSH_WORKING_SCENE_TICK_MS);
  // The animation must never keep Pi's process alive on its own.
  timer.unref?.();
  // Ask on every new widget so a changed terminal theme is picked up at the next working period.
  // A retired widget's answer must not touch the animation its replacement now draws from.
  const applyColors = ({ background }: TerminalColors): void => {
    if (disposed) return;
    if (animation.setBackground(background && [background.r, background.g, background.b])) tui.requestRender();
  };
  void tui.queryTerminalColors({ timeoutMs: BACKGROUND_QUERY_MS, onLateReply: applyColors }).then(applyColors);

  return {
    render: (width) => (disposed ? [] : animation.render(width)),
    // The lines depend only on size and the terminal background, never on Pi's theme.
    invalidate: () => {},
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      animation.restoreLastRendered();
    },
  };
}
