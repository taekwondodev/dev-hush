// dev-hush - raster painter for the working scene.
//
// An opaque RGB canvas, an affine painter that fills signed distance fields with
// analytic anti-aliasing, and a minimal PNG encoder for the Kitty graphics
// protocol. Node built-ins only (zlib), so the extension adds no dependency.
import { crc32, deflateSync } from "node:zlib";

export type Rgb = readonly [number, number, number];
export type Point = readonly [number, number];
export type FillOptions = {
  /** Coverage multiplier, 0..1. */
  alpha?: number;
  /** Glow falloff distance in local units; 0 means a hard anti-aliased edge. */
  soft?: number;
  /** Accent inks keep their colour while a silhouette style is active. */
  accent?: boolean;
};
type Matrix = [number, number, number, number, number, number];
type Sdf = (x: number, y: number) => number;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const mix = (c1: Rgb, c2: Rgb, t: number): Rgb => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
/** Deterministic hash in [0, 1). */
export const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export class Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 3);
  }

  /** Opaque vertical gradient over rows [y0, y1). Stops are [position 0..1, rgb]. */
  vgrad(y0: number, y1: number, stops: ReadonlyArray<readonly [number, Rgb]>): void {
    const top = clamp(Math.floor(y0), 0, this.height);
    const bottom = clamp(Math.ceil(y1), 0, this.height);
    for (let y = top; y < bottom; y += 1) {
      const t = (y - y0) / Math.max(1, y1 - y0);
      let i = 0;
      while (i < stops.length - 2 && t > stops[i + 1]![0]) i += 1;
      const [p0, c0] = stops[i]!;
      const [p1, c1] = stops[i + 1]!;
      const [r, g, b] = mix(c0, c1, clamp((t - p0) / (p1 - p0 || 1), 0, 1));
      let o = y * this.width * 3;
      for (let x = 0; x < this.width; x += 1, o += 3) {
        this.data[o] = r;
        this.data[o + 1] = g;
        this.data[o + 2] = b;
      }
    }
  }

  /** Replace every pixel with `source`, which must have the same size. */
  copyFrom(source: Canvas): void {
    this.data.set(source.data);
  }

  toPNG(level = 3): Buffer {
    const { width: w, height: h, data } = this;
    const stride = w * 3;
    const raw = Buffer.allocUnsafe((stride + 1) * h);
    for (let y = 0; y < h; y += 1) {
      const row = y * stride;
      const out = y * (stride + 1);
      raw[out] = 1; // Sub filter: gradients compress far better than unfiltered rows.
      for (let i = 0; i < stride; i += 1) {
        raw[out + 1 + i] = i < 3 ? data[row + i]! : (data[row + i]! - data[row + i - 3]!) & 255;
      }
    }
    const chunk = (type: string, body: Buffer): Buffer => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(body.length, 0);
      head.write(type, 4, "ascii");
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
      return Buffer.concat([head, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

// Signed distance functions in local units (negative inside).
export const sdCircle = (x: number, y: number, cx: number, cy: number, r: number): number => Math.hypot(x - cx, y - cy) - r;
export const sdEllipse = (x: number, y: number, rx: number, ry: number): number => {
  const k0 = Math.hypot(x / rx, y / ry);
  const k1 = Math.hypot(x / (rx * rx), y / (ry * ry));
  return k1 === 0 ? -Math.min(rx, ry) : (k0 * (k0 - 1)) / k1;
};
const sdRoundRect = (x: number, y: number, cx: number, cy: number, hw: number, hh: number, r: number): number => {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdSegment = (x: number, y: number, ax: number, ay: number, bx: number, by: number): number => {
  const px = x - ax;
  const py = y - ay;
  const ex = bx - ax;
  const ey = by - ay;
  const h = clamp((px * ex + py * ey) / (ex * ex + ey * ey || 1), 0, 1);
  return Math.hypot(px - ex * h, py - ey * h);
};
const sdPolygon = (x: number, y: number, v: ReadonlyArray<Point>): number => {
  let d = (x - v[0]![0]) ** 2 + (y - v[0]![1]) ** 2;
  let s = 1;
  for (let i = 0, j = v.length - 1; i < v.length; j = i, i += 1) {
    const ex = v[j]![0] - v[i]![0];
    const ey = v[j]![1] - v[i]![1];
    const wx = x - v[i]![0];
    const wy = y - v[i]![1];
    const h = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
    d = Math.min(d, (wx - ex * h) ** 2 + (wy - ey * h) ** 2);
    const c1 = y >= v[i]![1];
    const c2 = y < v[j]![1];
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
};

/**
 * Affine painter. While `style.silhouette` is set, every non-accent ink is replaced by
 * that colour, which is how the backlit characters are drawn.
 */
export class Painter {
  readonly c: Canvas;
  style: { silhouette: Rgb | null } = { silhouette: null };
  private m: Matrix = [1, 0, 0, 1, 0, 0];
  private readonly stack: Array<{ m: Matrix; style: { silhouette: Rgb | null } }> = [];

  constructor(canvas: Canvas) {
    this.c = canvas;
  }

  save(): void {
    this.stack.push({ m: [...this.m], style: { ...this.style } });
  }

  restore(): void {
    const saved = this.stack.pop();
    if (!saved) return;
    this.m = saved.m;
    this.style = saved.style;
  }

  translate(x: number, y: number): void {
    const [a, b, c, d, e, f] = this.m;
    this.m = [a, b, c, d, a * x + c * y + e, b * x + d * y + f];
  }

  scale(sx: number, sy = sx): void {
    const [a, b, c, d, e, f] = this.m;
    this.m = [a * sx, b * sx, c * sy, d * sy, e, f];
  }

  rotate(r: number): void {
    const cs = Math.cos(r);
    const sn = Math.sin(r);
    const [a, b, c, d, e, f] = this.m;
    this.m = [a * cs + c * sn, b * cs + d * sn, c * cs - a * sn, d * cs - b * sn, e, f];
  }

  private ink(color: Rgb, accent: boolean): Rgb {
    return this.style.silhouette && !accent ? this.style.silhouette : color;
  }

  /** Fill `sdf` over the local box [x0, y0, x1, y1]. */
  fill(sdf: Sdf, x0: number, y0: number, x1: number, y1: number, color: Rgb, { alpha = 1, soft = 0, accent = false }: FillOptions = {}): void {
    const [a, b, c, d, e, f] = this.m;
    const det = a * d - b * c;
    if (!det) return;
    const scale = Math.sqrt(Math.abs(det));
    const pad = soft * scale + 1.5;
    const xs = [a * x0 + c * y0 + e, a * x1 + c * y0 + e, a * x0 + c * y1 + e, a * x1 + c * y1 + e];
    const ys = [b * x0 + d * y0 + f, b * x1 + d * y0 + f, b * x0 + d * y1 + f, b * x1 + d * y1 + f];
    const { width, height, data } = this.c;
    const px0 = clamp(Math.floor(Math.min(...xs) - pad), 0, width);
    const px1 = clamp(Math.ceil(Math.max(...xs) + pad), 0, width);
    const py0 = clamp(Math.floor(Math.min(...ys) - pad), 0, height);
    const py1 = clamp(Math.ceil(Math.max(...ys) + pad), 0, height);
    if (px0 >= px1 || py0 >= py1) return;
    const [r, g, bl] = this.ink(color, accent);
    const softPx = soft * scale;
    for (let py = py0; py < py1; py += 1) {
      const Y = py + 0.5 - f;
      let o = (py * width + px0) * 3;
      for (let px = px0; px < px1; px += 1, o += 3) {
        const X = px + 0.5 - e;
        const dist = sdf((d * X - c * Y) / det, (a * Y - b * X) / det) * scale;
        let cover: number;
        if (softPx > 0) {
          cover = dist <= 0 ? 1 : 1 - dist / softPx;
          if (cover <= 0) continue;
          cover *= cover;
        } else {
          cover = 0.5 - dist;
          if (cover <= 0) continue;
          if (cover > 1) cover = 1;
        }
        const k = cover * alpha;
        data[o] = data[o]! + (r - data[o]!) * k;
        data[o + 1] = data[o + 1]! + (g - data[o + 1]!) * k;
        data[o + 2] = data[o + 2]! + (bl - data[o + 2]!) * k;
      }
    }
  }

  circle(cx: number, cy: number, r: number, color: Rgb, o: FillOptions = {}): void {
    this.fill((x, y) => sdCircle(x, y, cx, cy, r), cx - r, cy - r, cx + r, cy + r, color, o);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: Rgb, o: FillOptions = {}, rot = 0): void {
    this.save();
    this.translate(cx, cy);
    if (rot) this.rotate(rot);
    this.fill((x, y) => sdEllipse(x, y, rx, ry), -rx, -ry, rx, ry, color, o);
    this.restore();
  }

  rrect(x0: number, y0: number, x1: number, y1: number, r: number, color: Rgb, o: FillOptions = {}): void {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const hw = (x1 - x0) / 2;
    const hh = (y1 - y0) / 2;
    this.fill((x, y) => sdRoundRect(x, y, cx, cy, hw, hh, Math.min(r, hw, hh)), x0, y0, x1, y1, color, o);
  }

  capsule(ax: number, ay: number, bx: number, by: number, r: number, color: Rgb, o: FillOptions = {}): void {
    this.fill(
      (x, y) => sdSegment(x, y, ax, ay, bx, by) - r,
      Math.min(ax, bx) - r,
      Math.min(ay, by) - r,
      Math.max(ax, bx) + r,
      Math.max(ay, by) + r,
      color,
      o,
    );
  }

  poly(points: ReadonlyArray<Point>, color: Rgb, o: FillOptions = {}, round = 0): void {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    this.fill(
      (x, y) => sdPolygon(x, y, points) - round,
      Math.min(...xs) - round,
      Math.min(...ys) - round,
      Math.max(...xs) + round,
      Math.max(...ys) + round,
      color,
      o,
    );
  }
}
