// dev-hush - animated working presentation.
//
// Widget lifecycle adapted from the Firstmate project's Calm implementation.
// Copyright (c) 2026 Kun Chen. MIT License - see the LICENSE file in this directory.
//
// Hush replaces Pi's stock working row with a four-row Kitty-graphics scene (see
// ./scene/backlit.ts) while one logical agent run is active. This module owns the
// deterministic tick clock, the session-scoped freeze/resume state, the band lines Pi
// renders, the commands that animate the band, and the temporary TUI widget. ../index.ts
// owns when the presentation is installed and removed, and stays the sole caller of
// setWorkingVisible().
//
// Transport: the terminal holds the scene and Hush only names what to show, as dev's
// ADR 0008 does for a settled loop. The whole band cannot be that loop: a terminal stores
// every animation frame as a full bitmap (Rex refuses more than 128 MiB per image), and
// the loop is twenty seconds of a band as wide as the terminal. So the band is layers:
// - The backdrop is one opaque image in the band's first line, which Pi places. The lines
//   depend only on the size and the background, so Pi's renderer stays out of the
//   per-frame path.
// - Each actor is a small transparent image whose frames are its poses, twelve per second
//   of the loop. A pose is painted and sent the first time it is shown, as a new frame
//   holding only the pixels the actor covers; after one loop nothing is painted any more.
// - Every tick names each actor's frame when the pose changes (`a=a`) and puts the actor
//   at its x relative to the backdrop (`a=p` with `P`, `H`, `X`), written straight to the
//   terminal. A relative placement needs no cursor, and the terminal moves the image
//   without Pi redrawing anything.
//
// What the terminal holds is never taken for granted across a redraw by Pi:
// - Pi may repeat the backdrop line at any time, so the line always carries the image. It
//   is built here rather than with renderImage(), whose images Pi places again by id
//   alone after a redraw of the whole screen. That redraw erases the display, and Rex
//   frees every image with it, so the id alone would place nothing.
// - The same redraw frees the actors. The widget watches TUI.fullRedraws and sends them
//   again. A lesser redraw only removes the placements, which the next tick restores.
//
// Background: the backdrop is painted over the terminal's own background so the band has
// no visible edge. Each new widget asks the terminal for it through Pi's public
// TUI.queryTerminalColors() and keeps the answer for later working periods; until the
// first answer arrives the band is four empty rows. A changed answer requests one Pi
// render, the only render the widget ever requests.
//
// Continuity: one extension-owned animation instance survives hide/show within the same
// Pi process and Hush extension lifetime. Disposing the widget deletes the images, so a
// hidden scene leaves nothing in the terminal, and the next working period resumes from
// the tick it froze at. A fresh session calls reset(). Time is tick-driven, never
// wall-clock, so tests can seek it exactly, and it stands still while no band is placed.
// A resize or a new cell size re-renders the current tick at the new size: positions are
// proportional to the canvas.
//
// Verified against Pi 1.5.2 and Rex 0.1.0-preview.20: ExtensionUIContext.setWidget() with a
// component factory, per-widget dispose(), TUI.terminal.write(), TUI.fullRedraws,
// TUI.queryTerminalColors(), encodeKitty(), and in Rex relative placements, frames added
// to an image that was transmitted without a placement, and the frame limit above.
import { deflateSync } from "node:zlib";
import {
  type Component,
  type TUI,
  type TerminalColors,
  allocateImageId,
  encodeKitty,
  getCapabilities,
  getCellDimensions,
} from "@earendil-works/pi-tui";
import {
  BACKLIT_ACTORS,
  BACKLIT_PERIOD_S,
  type BacklitActor,
  backlitActorX,
  backlitSpriteWidth,
  paintBacklitActor,
  paintBacklitBackdrop,
} from "./scene/backlit.ts";
import { Canvas, type Rgb } from "./scene/paint.ts";

export const HUSH_WORKING_SCENE_WIDGET_KEY = "dev-hush-working-scene";
/** Band height in terminal rows. */
export const HUSH_WORKING_SCENE_ROWS = 4;
/** Positions shown per second. Scene time derives from ticks, so this only changes smoothness. */
const TICKS_PER_SECOND = 60;
/** Scheduler period. */
export const HUSH_WORKING_SCENE_TICK_MS = Math.round(1000 / TICKS_PER_SECOND);
/** Ticks after which the scene repeats. */
export const HUSH_WORKING_SCENE_LOOP_TICKS = BACKLIT_PERIOD_S * TICKS_PER_SECOND;
/** Ticks an actor holds one pose: twelve poses per second. */
const TICKS_PER_POSE = TICKS_PER_SECOND / 12;
/**
 * Most bytes of frames one actor may ask the terminal to hold, a frame counted as the
 * terminal stores it: the whole sprite at four bytes per pixel. Rex refuses frames beyond
 * 128 MiB per image and then shows a stale pose, so a sprite too large for a loop of
 * poses holds each pose longer instead.
 */
const FRAME_STORAGE_BUDGET = 96 * 1024 * 1024;

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
  /**
   * Advance one scheduler tick and return the Kitty commands that show it: poses not sent
   * yet, the frame each actor shows and where each stands. Undefined while no band is
   * rendered, and time then stands still.
   */
  tick(): string | undefined;
  /** The terminal freed every image and the backdrop was sent again: send the actors again too. */
  forgetActors(): void;
  /** Freeze: the Kitty commands that delete the scene's images. The next render sends the band afresh. */
  release(): string;
  /** Restore t = 0 for a new session. */
  reset(): void;
  /** Current tick count, exposed for deterministic assertions. */
  ticks(): number;
};

/** The backdrop as rendered: its size in columns and in canvas pixels, and the lines Pi places it with. */
type Band = { width: number; widthPx: number; heightPx: number; pxPerPoint: number; lines: string[] };
/** One actor's image: `frames` maps each pose the terminal holds to its frame number, `shown` is the frame it displays. */
type Sprite = {
  actor: BacklitActor;
  id: number;
  canvas: Canvas;
  ticksPerPose: number;
  frames: Map<number, number>;
  shown: number | undefined;
};

/** True when Pi detected a Kitty-graphics terminal. Hush has no text fallback for the scene. */
export function hushWorkingSceneSupported(): boolean {
  return getCapabilities().images === "kitty";
}

const kitty = (controls: string): string => `\u001b_G${controls}\u001b\\`;

/**
 * One Kitty command carrying `pixels` as compressed RGBA, chunked as the protocol requires.
 * `continuation` opens every chunk after the first: frame data must repeat `a=f,` there.
 */
function kittyPixels(controls: string, continuation: string, pixels: Buffer): string {
  const base64 = deflateSync(pixels, { level: 1 }).toString("base64");
  let sequence = "";
  for (let offset = 0; offset < base64.length; offset += KITTY_CHUNK) {
    const more = offset + KITTY_CHUNK < base64.length ? 1 : 0;
    const head = offset === 0 ? `${controls},f=32,o=z,q=2,m=${more}` : `${continuation}m=${more}`;
    sequence += `\u001b_G${head};${base64.slice(offset, offset + KITTY_CHUNK)}\u001b\\`;
  }
  return sequence;
}

/** How long each pose is held so that a loop of poses of `sprite` fits FRAME_STORAGE_BUDGET. */
function ticksPerPose(sprite: Canvas): number {
  const frameBytes = sprite.width * sprite.height * 4;
  let ticks = TICKS_PER_POSE;
  while (Math.ceil(HUSH_WORKING_SCENE_LOOP_TICKS / ticks) * frameBytes > FRAME_STORAGE_BUDGET) ticks *= 2;
  return ticks;
}

export function createHushWorkingSceneAnimation(): HushWorkingSceneAnimation {
  const backdropId = allocateImageId();
  const actorIds = BACKLIT_ACTORS.map(() => allocateImageId());
  let ticks = 0;
  let background: Rgb | undefined;
  let band: Band | undefined;
  let sprites: Sprite[] = [];

  /** Retina terminals usually report logical points, so render at 2x below 24 px cells. */
  const renderBand = (width: number, bg: Rgb): Band => {
    const cell = getCellDimensions();
    const pxPerPoint = cell.heightPx < 24 ? 2 : 1;
    const widthPx = width * cell.widthPx * pxPerPoint;
    const heightPx = HUSH_WORKING_SCENE_ROWS * cell.heightPx * pxPerPoint;
    if (band && band.width === width && band.widthPx === widthPx && band.heightPx === heightPx) return band;
    const backdrop = new Canvas(widthPx, heightPx);
    paintBacklitBackdrop(backdrop, bg);
    const image = encodeKitty(backdrop.toPNG(6).toString("base64"), {
      columns: width,
      rows: HUSH_WORKING_SCENE_ROWS,
      imageId: backdropId,
      moveCursor: false,
    });
    const lines = [image];
    for (let row = 1; row < HUSH_WORKING_SCENE_ROWS; row += 1) lines.push("");
    // A new backdrop replaces the image the actors were placed on, and their poses belong to the old size.
    sprites = BACKLIT_ACTORS.map((actor, index) => {
      const canvas = new Canvas(backlitSpriteWidth(actor, heightPx), heightPx, true);
      return { actor, id: actorIds[index]!, canvas, ticksPerPose: ticksPerPose(canvas), frames: new Map(), shown: undefined };
    });
    return { width, widthPx, heightPx, pxPerPoint, lines };
  };

  /** The commands that make `sprite` show the loop's `tick` on `on`. */
  const show = (sprite: Sprite, tick: number, on: Band, layer: number): string => {
    const { actor, id, canvas, frames } = sprite;
    const pose = Math.floor(tick / sprite.ticksPerPose);
    let commands = "";
    let frame = frames.get(pose);
    if (frame === undefined) {
      canvas.clear();
      paintBacklitActor(canvas, actor, (pose * sprite.ticksPerPose) / TICKS_PER_SECOND, on.widthPx, on.heightPx);
      frame = frames.size + 1;
      frames.set(pose, frame);
      if (frame === 1) {
        // The image itself is the first frame, and the one a new image shows.
        const whole = { x: 0, y: 0, width: canvas.width, height: canvas.height };
        commands += kittyPixels(`a=t,i=${id},s=${canvas.width},v=${canvas.height}`, "", canvas.toRGBA(whole));
        sprite.shown = 1;
      } else {
        // A new frame starts transparent, so only the pixels the actor covers are sent.
        const covered = canvas.coveredRect() ?? { x: 0, y: 0, width: 1, height: 1 };
        commands += kittyPixels(
          `a=f,i=${id},x=${covered.x},y=${covered.y},s=${covered.width},v=${covered.height}`,
          "a=f,",
          canvas.toRGBA(covered),
        );
      }
    }
    if (sprite.shown !== frame) {
      commands += kitty(`a=a,i=${id},c=${frame},q=2`);
      sprite.shown = frame;
    }
    // Where the sprite's left edge stands, as whole cells from the backdrop's and pixels into the next.
    const left = Math.round(backlitActorX(actor, tick / TICKS_PER_SECOND, on.widthPx, on.heightPx) - canvas.width / 2);
    const cellPx = on.widthPx / on.width;
    const column = Math.floor(left / cellPx);
    const offset = Math.floor((left - column * cellPx) / on.pxPerPoint);
    return `${commands}${kitty(`a=p,i=${id},p=1,P=${backdropId},H=${column},X=${offset},r=${HUSH_WORKING_SCENE_ROWS},z=${layer},C=1,q=2`)}`;
  };

  return {
    ticks: () => ticks,

    tick(): string | undefined {
      const on = band;
      if (!on) return undefined;
      ticks += 1;
      const tick = ticks % HUSH_WORKING_SCENE_LOOP_TICKS;
      return sprites.map((sprite, index) => show(sprite, tick, on, index + 1)).join("");
    },

    setBackground(reported: Rgb | undefined): boolean {
      const next = reported ?? background ?? FALLBACK_BACKGROUND;
      if (background && background.every((v, i) => v === next[i])) return false;
      background = next;
      // The rendered backdrop carries the old background.
      band = undefined;
      return true;
    },

    forgetActors(): void {
      for (const sprite of sprites) {
        sprite.frames.clear();
        sprite.shown = undefined;
      }
    },

    release(): string {
      band = undefined;
      sprites = [];
      return [backdropId, ...actorIds].map((id) => kitty(`a=d,d=I,i=${id},q=2`)).join("");
    },

    reset(): void {
      ticks = 0;
    },

    render(width: number): string[] {
      if (width < 2 || !hushWorkingSceneSupported()) return [];
      // Hold the band's place until the terminal reports its background.
      if (!background) return Array.from({ length: HUSH_WORKING_SCENE_ROWS }, () => "");
      band = renderBand(width, background);
      return band.lines;
    },
  };
}

/**
 * Build the temporary Hush working widget bound to one caller-owned animation.
 * Pi disposes the previous component before installing a replacement under the same
 * key and when it clears extension widgets, so the scheduler cannot outlive the widget
 * or duplicate. Ticks never request a Pi render: they write their commands directly,
 * and the band lines stay unchanged until a resize or a new terminal background.
 */
export function createHushWorkingSceneWidget(
  tui: TUI,
  animation: HushWorkingSceneAnimation = createHushWorkingSceneAnimation(),
): Component & { dispose(): void } {
  let disposed = false;
  let fullRedraws = tui.fullRedraws;
  const timer = setInterval(() => {
    if (disposed) return;
    if (tui.fullRedraws !== fullRedraws) {
      fullRedraws = tui.fullRedraws;
      animation.forgetActors();
    }
    const commands = animation.tick();
    if (commands) tui.terminal.write(commands);
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
      tui.terminal.write(animation.release());
    },
  };
}
