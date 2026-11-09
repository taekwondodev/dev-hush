// dev-hush - the "Tramonto" working scene.
//
// A still camera on a sunset: layered skylines in aerial perspective, and WALL-E
// chasing EVE as backlit silhouettes where only the seedling and EVE's eyes keep
// their colour. They ping-pong across the band; at each end EVE turns first and hops
// over WALL-E. Foreground junk piles ("wings") crop both edges. Their outermost strip
// is one flat colour, WING, exactly one terminal cell wide, so the widget can paint
// the band's edge cells the same colour and a terminal that extends edge colours into
// its padding continues the piles seamlessly.
import { drawEve, drawWallE } from "./characters.ts";
import { type Canvas, Painter, type Rgb, hash, lerp, mix } from "./paint.ts";

/** Colour of the foreground piles and of the band's edge cells. */
export const WING: Rgb = [22, 10, 28];
const WING_SEAM: Rgb = [44, 24, 50];
const RIM: Rgb = [255, 168, 112];
/** One full there-and-back cycle, in seconds. */
export const SUNSET_PERIOD_S = 20;

/** Pixels per sprite unit for a full-size character in a band of height H. */
const nearScale = (H: number): number => (0.8 * H) / 92;

type Towers = {
  W: number;
  base: number;
  spacing: number;
  minH: number;
  maxH: number;
  color: Rgb;
  seed: number;
  seams?: number;
};

/** A row of tower silhouettes with ragged tops along `base`, repeating every `spacing` px. */
function towers(p: Painter, { W, base, spacing, minH, maxH, color, seed, seams = 0 }: Towers): void {
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
    if (seams) {
      for (let y = base - seams; y > base - h + seams * 0.6; y -= seams) {
        p.rrect(x + width * 0.08, y - 0.6, x + width * 0.92, y + 0.6, 0.5, mix(color, [0, 0, 0], 0.18), { alpha: 0.8 });
      }
    }
  }
}

type WingProfile = {
  size: number;
  solid: number;
  cubes: Array<{ top: number; bottom: number; reach: number }>;
  /** Furthest the piles reach into the frame from either edge, in px. */
  reach: number;
};

/** Stacked cubes cropped by the frame edge: wide at the ground, narrowing upward. */
function wingProfile(H: number, solid: number): WingProfile {
  const size = H * 0.25;
  const layers = Math.ceil(H / (size * 0.8)) + 1;
  const cubes: WingProfile["cubes"] = [];
  for (let k = 0, y = H + size * 0.08; k < layers; k += 1) {
    const h = size * lerp(0.78, 1.05, hash(k * 7.7));
    const taper = lerp(2.1, 0.35, k / (layers - 1));
    const reach = solid + size * Math.max(0.25, taper + 0.8 * (hash(k * 3.1) - 0.5));
    cubes.push({ top: y - h, bottom: y, reach });
    y -= h;
  }
  return { size, solid, cubes, reach: Math.max(...cubes.map((c) => c.reach)) };
}

/** Both piles share one profile, mirrored. Seams and a faint rim light keep them reading as cubes. */
function wings(p: Painter, W: number, H: number, { size, solid, cubes }: WingProfile): void {
  for (const side of [0, 1]) {
    p.save();
    if (side) {
      p.translate(W, 0);
      p.scale(-1, 1);
    }
    p.rrect(-2, -2, solid, H + 2, 0, WING);
    cubes.forEach(({ top, bottom, reach }, k) => {
      p.rrect(-2, top, reach, bottom + 0.5, size * 0.06, WING);
      const seam = reach - size * lerp(0.9, 1.1, hash(k));
      if (seam > solid + size * 0.2) p.rrect(seam - 0.8, top + size * 0.12, seam + 0.8, bottom - size * 0.12, 0.5, WING_SEAM);
      p.rrect(solid + size * 0.1, bottom - 1.2, reach - size * 0.1, bottom + 0.2, 0.5, WING_SEAM);
      p.rrect(reach - size * 0.035, top + size * 0.08, reach, bottom - size * 0.08, 1, RIM, { alpha: 0.32 });
      const above = cubes[k + 1]?.reach ?? solid;
      if (reach > above + size * 0.1) p.rrect(above + size * 0.06, top, reach - size * 0.06, top + size * 0.03, 1, RIM, { alpha: 0.22 });
    });
    p.restore();
  }
}

/** Static sky, sun, skylines and ground. Painted once per canvas size and copied per frame. */
export function paintSunsetBackdrop(canvas: Canvas): void {
  const p = new Painter(canvas);
  const { width: W, height: H } = canvas;
  const ground = 0.9 * H;
  canvas.vgrad(0, ground, [[0, [62, 40, 96]], [0.45, [192, 86, 112]], [0.8, [246, 158, 92]], [1, [255, 200, 124]]]);
  p.circle(W * 0.68, H * 0.8, H * 0.3, [255, 222, 150], { alpha: 0.55, soft: H * 0.6 });
  p.circle(W * 0.68, H * 0.8, H * 0.3, [255, 216, 146]);
  towers(p, { W, base: ground, spacing: H * 0.6, minH: H * 0.18, maxH: H * 0.48, color: [178, 86, 112], seed: 57 });
  towers(p, { W, base: ground, spacing: H * 0.9, minH: H * 0.1, maxH: H * 0.3, color: [108, 48, 86], seed: 71, seams: H * 0.07 });
  canvas.vgrad(ground, H, [[0, [40, 20, 44]], [1, [26, 12, 30]]]);
}

/**
 * Paint the frame at time `t` seconds into `canvas`, starting from `backdrop` (same size).
 * `edgePx` is one terminal cell width: the wings' flat outer strip is exactly that wide.
 */
export function renderSunset(canvas: Canvas, t: number, edgePx: number, backdrop: Canvas): void {
  canvas.copyFrom(backdrop);
  const p = new Painter(canvas);
  const { width: W, height: H } = canvas;
  const sN = nearScale(H);
  const groundY = 0.93 * H;
  const leg = SUNSET_PERIOD_S / 2;
  // Turn in open sky: same-coloured silhouettes overlapping a pile would merge into one blot.
  const profile = wingProfile(H, edgePx);
  const margin = profile.reach + 40 * sN;
  const run = W - 2 * margin;
  const at = (tt: number) => {
    const phase = (Math.PI * tt) / leg;
    const legs = Math.floor(tt / leg);
    const x = margin + run * (0.5 - 0.5 * Math.cos(phase));
    const legStart = legs % 2 === 0 ? margin : margin + run;
    const sin = Math.sin(phase);
    return {
      x,
      travel: (legs * run + Math.abs(x - legStart)) / sN,
      facing: sin >= 0 ? 1 : -1,
      squash: 0.14 + 0.86 * Math.abs(sin) ** 0.6,
    };
  };
  const eve = at(t + leg * 0.15);
  const wall = at(t + leg * 0.15 - 1.6);
  const apart = (eve.x - wall.x) / (46 * sN);
  const meet = eve.facing !== wall.facing ? Math.exp(-apart * apart) : 0;
  const hop = 34 * meet;

  // Drifting dust motes in the warm light.
  for (let i = 0; i < 18; i += 1) {
    const x = (hash(i * 3.7) * W + t * sN * (4 + 6 * hash(i))) % W;
    const y = H * (0.15 + 0.6 * hash(i * 9.2)) + Math.sin(t * 0.7 + i) * H * 0.03;
    p.circle(x, y, sN * (0.8 + hash(i * 4.4)), [255, 224, 186], { alpha: 0.35, soft: sN * 2 });
  }

  p.style.silhouette = WING;
  drawWallE(p, { x: wall.x, y: groundY, s: sN, facing: wall.facing, squash: wall.squash, travel: wall.travel });
  drawEve(p, {
    x: eve.x,
    y: groundY - (16 + 3 * Math.sin(t * 2.1) + hop) * sN,
    s: sN,
    facing: eve.facing,
    squash: eve.squash,
    lean: 0.14 * eve.squash - hop * 0.004 * eve.facing,
  });
  p.style.silhouette = null;
  wings(p, W, H, profile);
}
