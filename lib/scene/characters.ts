// dev-hush - the two characters of the working scene, drawn from primitives in local
// units, facing right (+x), y down. WALL-E stands about 92 units tall with his origin on
// the ground under the treads; EVE is about 86 units tall with her origin at the bottom
// of her hovering body. In the backlit scene both are painted as silhouettes, so only the
// accent inks (seedling, EVE's eyes, glints, thruster) keep their colour.
import { type Painter, type Rgb, sdEllipse } from "./paint.ts";

const TREAD: Rgb = [54, 49, 44];
const TREAD_FAR: Rgb = [40, 36, 33];
const TREAD_NOTCH: Rgb = [92, 85, 76];
const WHEEL: Rgb = [128, 121, 108];
const HUB: Rgb = [62, 58, 52];
const BODY: Rgb = [226, 170, 54];
const BODY_SHADE: Rgb = [178, 124, 38];
const BODY_EDGE: Rgb = [204, 146, 44];
const RUST: Rgb = [146, 88, 38];
const METAL: Rgb = [158, 156, 148];
const METAL_DARK: Rgb = [104, 102, 96];
const LENS: Rgb = [26, 30, 34];
const GLINT: Rgb = [245, 245, 235];
const BOOT: Rgb = [126, 82, 46];
const BOOT_DARK: Rgb = [84, 52, 30];
const SOIL: Rgb = [66, 44, 28];
const STEM: Rgb = [82, 156, 62];
const LEAF: Rgb = [128, 212, 80];
const SOLAR: Rgb = [70, 66, 58];

const EVE_WHITE: Rgb = [242, 244, 248];
const EVE_SHADE: Rgb = [190, 197, 208];
const VISOR: Rgb = [14, 16, 22];
const EVE_EYE: Rgb = [96, 214, 255];
const THRUSTER: Rgb = [130, 205, 255];
const THRUSTER_GLOW = 0.6;

const wrap = (v: number, span: number): number => ((v % span) + span) % span;

export type WallEPose = {
  x: number;
  y: number;
  /** Pixels per local unit. */
  s: number;
  /** 1 facing right, -1 facing left. */
  facing?: number;
  /** Horizontal scale (0..1] used while turning edge-on. */
  squash?: number;
  /** Distance covered in local units; drives treads, wheels and a slight body bob. */
  travel?: number;
};

/** WALL-E carrying the seedling in his boot. */
export function drawWallE(p: Painter, { x, y, s, facing = 1, squash = 1, travel = 0 }: WallEPose): void {
  p.save();
  p.translate(x, y);
  p.scale(s * facing * squash, s);

  // Far tread peeks out behind the near one.
  p.poly([[-25, -3], [25, -3], [21, -23], [-21, -23]], TREAD_FAR, {}, 2);
  // Near tread, wheels with turning spokes, and notches: bottom rests on the ground,
  // top runs forward at twice the body speed, exactly as a real track.
  p.poly([[-28, 0], [28, 0], [23, -21], [-23, -21]], TREAD, {}, 2);
  for (let k = 0; k < 9; k += 1) {
    const bottom = -26 + wrap(k * 6 - travel, 54);
    const top = -21 + wrap(k * 5 + travel, 44);
    p.rrect(bottom - 1.2, -2.6, bottom + 1.2, 0.4, 0.6, TREAD_NOTCH);
    p.rrect(top - 1.2, -22.6, top + 1.2, -20, 0.6, TREAD_NOTCH);
  }
  const spin = travel / 5.5;
  for (const wx of [-15, 0, 15]) {
    p.circle(wx, -9, 5.6, WHEEL);
    for (const a of [spin, spin + Math.PI / 2]) {
      p.capsule(wx - Math.cos(a) * 4, -9 - Math.sin(a) * 4, wx + Math.cos(a) * 4, -9 + Math.sin(a) * 4, 0.8, HUB);
    }
    p.circle(wx, -9, 1.8, HUB);
  }

  p.translate(0, Math.sin(travel * 0.45) * 0.7);

  // Back arm, behind the body and the boot.
  p.capsule(8, -46, 30, -50, 2.4, METAL_DARK);

  // Body box with rim, front edge, solar strip, and rust.
  p.rrect(-21, -61, 21, -23, 2.5, BODY);
  p.rrect(-21, -63, 21, -58, 1.5, BODY_SHADE);
  p.rrect(-21, -29, 21, -23, 2, BODY_SHADE);
  p.rrect(14, -58, 21, -29, 1.5, BODY_EDGE);
  p.rrect(-15, -55, 4, -51, 1, SOLAR);
  p.circle(-12, -38, 2.4, RUST, { alpha: 0.7 });
  p.circle(-4, -45, 1.4, RUST, { alpha: 0.6 });
  p.circle(9, -34, 1.8, RUST, { alpha: 0.5 });

  // Neck and binocular head, the far eye a step back and darker.
  p.capsule(5, -61, 8, -72, 2.6, METAL_DARK);
  p.rrect(-3, -88, 15, -72, 5.5, METAL_DARK);
  p.circle(10, -80, 4.4, LENS);
  p.rrect(7, -87, 27, -70.5, 6, METAL);
  p.circle(20, -78.6, 5.4, LENS);
  p.circle(22, -80.6, 1.5, GLINT, { accent: true });
  p.rrect(8, -89.5, 25, -86.5, 1.4, METAL_DARK);

  // The boot with the seedling, held forward toward EVE.
  p.rrect(29, -60, 39, -43, 1.8, BOOT);
  p.rrect(29, -49, 46, -43, 3, BOOT);
  p.rrect(29, -47, 46, -43, 2, BOOT_DARK);
  p.ellipse(34, -60, 5, 1.6, SOIL);
  p.capsule(34, -60, 34.6, -73, 1, STEM, { accent: true });
  p.ellipse(29.6, -72, 5.2, 2.3, LEAF, { accent: true }, -0.55);
  p.ellipse(39.4, -75, 5.6, 2.4, LEAF, { accent: true }, 0.5);

  // Near arm and claw wrap the boot.
  p.capsule(10, -43, 31, -47, 2.8, METAL);
  p.rrect(29, -51, 35, -44, 1.5, METAL);

  p.restore();
}

/** Egg body: an ellipse whose lower half narrows. */
function egg(p: Painter, cx: number, cy: number, rx: number, ry: number, color: Rgb): void {
  p.fill(
    (x, y) => {
      const dy = y - cy;
      const k = 1 - 0.42 * Math.max(0, dy / ry) ** 2;
      return sdEllipse((x - cx) / k, dy, rx, ry) * Math.min(1, k);
    },
    cx - rx,
    cy - ry,
    cx + rx,
    cy + ry,
    color,
  );
}

export type EvePose = {
  x: number;
  y: number;
  s: number;
  facing?: number;
  squash?: number;
  /** Forward tilt in radians. */
  lean?: number;
};

/** EVE in flight, arms swept back. */
export function drawEve(p: Painter, { x, y, s, facing = 1, squash = 1, lean = 0.12 }: EvePose): void {
  p.save();
  p.translate(x, y);
  p.scale(s * facing * squash, s);
  p.rotate(lean);

  p.circle(0, 2, 4, THRUSTER, { alpha: 0.45 * THRUSTER_GLOW, soft: 11, accent: true });

  p.ellipse(-8, -37, 4, 15, EVE_SHADE, {}, 0.38);

  egg(p, 0, -31, 15.5, 30, EVE_SHADE);
  egg(p, 2.6, -32, 12.8, 28, EVE_WHITE);

  p.ellipse(1.5, -72, 14, 10.5, EVE_SHADE);
  p.ellipse(3.2, -72.8, 12, 9.4, EVE_WHITE);
  p.ellipse(6.5, -71.5, 9.6, 6.8, VISOR);
  for (const [ex, ey, rot] of [[4.2, -71.6, 0.18], [10.4, -71.6, -0.18]] as const) {
    p.ellipse(ex, ey, 2.8, 1.7, EVE_EYE, { alpha: 0.5, soft: 2.5, accent: true }, rot);
    p.ellipse(ex, ey, 2.6, 1.6, EVE_EYE, { accent: true }, rot);
  }

  p.ellipse(-4, -36, 4.6, 16, EVE_SHADE, {}, 0.32);
  p.ellipse(-3.4, -37, 3.6, 14.6, EVE_WHITE, {}, 0.32);

  p.restore();
}
