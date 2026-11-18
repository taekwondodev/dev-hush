// dev-hush - the "Controluce" working scene.
//
// No sky: a sun sets on the terminal's own background behind a faint low skyline, and the
// horizon glows only near it. WALL-E chases EVE as dark silhouettes whose sun-facing edge
// catches a warm rim, brighter the closer they are to the sun; only the seedling and EVE's
// eyes keep their colour. They ping-pong across the band; at each end EVE turns first and
// hops over WALL-E.
//
// The scene comes in layers, so that the terminal can hold it (see ../working-scene.ts):
// one opaque backdrop painted over `bg`, the terminal background, so the band has no
// visible edge, and one transparent sprite per actor. An actor's sprite is its pose at a
// time, centred; where it stands at that time is a separate answer. Every motion repeats
// with BACKLIT_PERIOD_S, so a pose and a position depend only on the time within the loop.
import { WALL_E_BOB_LENGTH, drawEve, drawWallE } from "./characters.ts";
import { type Canvas, Painter, type Rgb, hash, lerp, mix } from "./paint.ts";

// rose-pine-moon accents, matching dev's footer.
const LOVE: Rgb = [235, 111, 146];
const GOLD: Rgb = [246, 193, 119];
const ROSE: Rgb = [234, 154, 151];
const SHADOW: Rgb = [20, 18, 32];
const RIM = mix(GOLD, ROSE, 0.3);
/** One full there-and-back cycle, in seconds. */
export const BACKLIT_PERIOD_S = 20;
const SUN_X = 0.68;
const HORIZON = 0.93;
/** How far WALL-E trails EVE, in seconds. */
const CHASE_GAP_S = 1.6;
/** EVE bobs this many times per cycle. A whole number, so the bob closes the loop. */
const EVE_BOBS = 7;

export type BacklitActor = "wall-e" | "eve";
/** The actors, back to front. */
export const BACKLIT_ACTORS: readonly BacklitActor[] = ["wall-e", "eve"];
/**
 * Half a sprite's width in local units. Everything an actor paints stays within it at any
 * time: the turn, the lean of the hop, the rim light and the thruster glow.
 */
const HALF_WIDTH: Record<BacklitActor, number> = { "wall-e": 49, eve: 29 };

/** Pixels per local unit for a full-size character in a band of height H. */
const nearScale = (H: number): number => (0.8 * H) / 92;

/** Width in pixels of an actor's sprite in a band of height H; the sprite is as high as the band. */
export const backlitSpriteWidth = (actor: BacklitActor, H: number): number => 2 * Math.ceil(HALF_WIDTH[actor] * nearScale(H));

type Towers = { W: number; base: number; spacing: number; minH: number; maxH: number; color: Rgb; seed: number };

/** A row of tower silhouettes with ragged tops along `base`, repeating every `spacing` px. */
function towers(p: Painter, { W, base, spacing, minH, maxH, color, seed }: Towers): void {
  const last = Math.ceil(W / spacing) + 1;
  for (let i = -1; i <= last; i += 1) {
    if (hash(seed + i * 3.1) < 0.12) continue;
    const width = spacing * lerp(0.45, 0.95, hash(seed + i * 5.7));
    const x = i * spacing + spacing * 0.3 * hash(seed + i * 1.3);
    const h = lerp(minH, maxH, hash(seed + i * 7.9));
    const tilt = (hash(seed + i * 2.2) - 0.5) * width * 0.25;
    p.poly(
      [[x, base + 2], [x + width, base + 2], [x + width, base - h + tilt], [x + width * 0.5, base - h - width * 0.06], [x, base - h - tilt]],
      color,
    );
  }
}

/** Static background, sun, skyline and horizon over `bg`. Painted once per size and background. */
export function paintBacklitBackdrop(canvas: Canvas, bg: Rgb): void {
  const p = new Painter(canvas);
  const { width: W, height: H, data } = canvas;
  const horizon = HORIZON * H;
  const sunX = W * SUN_X;
  canvas.vgrad(0, H, [[0, bg], [1, bg]]);
  // Low glow, then the disc, half sunk.
  p.circle(sunX, horizon, H * 0.5, mix(bg, LOVE, 0.5), { alpha: 0.35, soft: H * 1.1 });
  p.circle(sunX, horizon, H * 0.26, mix(GOLD, ROSE, 0.35));
  // A low skyline in barely-there ink, so the sun sets behind something.
  towers(p, { W, base: horizon, spacing: H * 0.75, minH: H * 0.08, maxH: H * 0.26, color: mix(bg, LOVE, 0.12), seed: 71 });
  // Everything below the horizon is the terminal again; the horizon glows only near the sun.
  canvas.vgrad(horizon, H, [[0, bg], [1, bg]]);
  const line = Math.max(1, Math.round(H / 120));
  const glow = mix(GOLD, ROSE, 0.4);
  for (let y = Math.round(horizon); y < Math.round(horizon) + line && y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const k = Math.exp(-(((x - sunX) / (W * 0.22)) ** 2));
      data.set(mix(bg, glow, 0.85 * k).map(Math.round), (y * W + x) * 3);
    }
  }
}

type Stance = { x: number; travel: number; facing: number; squash: number };

/** Both actors at time `t` seconds in a W by H band: where they stand and how high EVE hops. */
function stage(t: number, W: number, H: number): { "wall-e": Stance; eve: Stance; hop: number } {
  const sN = nearScale(H);
  const leg = BACKLIT_PERIOD_S / 2;
  // The widest sprite still fits inside the band where the actors turn.
  const margin = backlitSpriteWidth("wall-e", H) / 2;
  const run = Math.max(0, W - 2 * margin);
  // WALL-E's body bobs with the distance covered. Stretch that distance by a hair so that a
  // cycle covers a whole number of bobs and the last pose leads into the first.
  const lap = (2 * run) / sN;
  const stride = lap > 0 ? (Math.max(1, Math.round(lap / WALL_E_BOB_LENGTH)) * WALL_E_BOB_LENGTH) / lap : 1;
  const at = (time: number): Stance => {
    const tt = ((time % BACKLIT_PERIOD_S) + BACKLIT_PERIOD_S) % BACKLIT_PERIOD_S;
    const phase = (Math.PI * tt) / leg;
    const legs = Math.floor(tt / leg);
    const x = margin + run * (0.5 - 0.5 * Math.cos(phase));
    const legStart = legs % 2 === 0 ? margin : margin + run;
    const sin = Math.sin(phase);
    return {
      x,
      travel: ((legs * run + Math.abs(x - legStart)) / sN) * stride,
      facing: sin >= 0 ? 1 : -1,
      squash: 0.14 + 0.86 * Math.abs(sin) ** 0.6,
    };
  };
  const eve = at(t + leg * 0.15);
  const wall = at(t + leg * 0.15 - CHASE_GAP_S);
  const apart = (eve.x - wall.x) / (46 * sN);
  const meet = eve.facing !== wall.facing ? Math.exp(-apart * apart) : 0;
  return { "wall-e": wall, eve, hop: 34 * meet };
}

/** The x of an actor's centre at time `t` seconds, in pixels from the left of a W by H band. */
export function backlitActorX(actor: BacklitActor, t: number, W: number, H: number): number {
  return stage(t, W, H)[actor].x;
}

/**
 * Paint an actor's pose at time `t` seconds into `sprite`, a cleared transparent canvas
 * backlitSpriteWidth wide and H high, for a W by H band. The actor is centred, whatever its x.
 */
export function paintBacklitActor(sprite: Canvas, actor: BacklitActor, t: number, W: number, H: number): void {
  const p = new Painter(sprite);
  const sN = nearScale(H);
  const groundY = HORIZON * H;
  const sunX = W * SUN_X;
  const { [actor]: who, hop } = stage(t, W, H);
  const x = sprite.width / 2;
  const r = Math.max(1, H / 110);
  // Rim light first: the silhouette once in RIM, nudged toward the sun; then the body over it.
  for (const rim of [true, false]) {
    p.save();
    let dx = 0;
    let dy = 0;
    if (rim) {
      const near = Math.exp(-(((who.x - sunX) / (W * 0.45)) ** 2));
      p.style.flat = RIM;
      p.style.opacity = 0.35 + 0.65 * near;
      dx = (Math.sign(sunX - who.x) || 1) * r;
      dy = -r * 0.6;
    } else {
      p.style.silhouette = SHADOW;
    }
    if (actor === "wall-e") {
      drawWallE(p, { x: x + dx, y: groundY + dy, s: sN, facing: who.facing, squash: who.squash, travel: who.travel });
    } else {
      const bob = 3 * Math.sin((2 * Math.PI * EVE_BOBS * t) / BACKLIT_PERIOD_S);
      drawEve(p, {
        x: x + dx,
        y: groundY - (16 + bob + hop) * sN + dy,
        s: sN,
        facing: who.facing,
        squash: who.squash,
        lean: 0.14 * who.squash - hop * 0.004 * who.facing,
      });
    }
    p.restore();
  }
}
