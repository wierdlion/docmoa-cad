/** 곡선을 선분으로 펴는 계산. 좌표는 전부 x,y가 번갈아 든 number[]이고 도면 방향(y 위)이다. */
export type P = { x: number; y: number };

/** 원 한 바퀴를 몇 개의 선분으로 그릴지. ponytail: 고정값. 확대해서 각이 보이면 뷰 배율에 따라 나눈다. */
export const SEGMENTS = 64;
const TAU = Math.PI * 2;

/** 중심 c에서 c + cos t·u + sin t·v 를 t0부터 dt만큼 돈다. 원·호·타원이 전부 이 꼴이다. */
export function sweep(cx: number, cy: number, ux: number, uy: number, vx: number, vy: number, t0: number, dt: number, closed = false): number[] {
  const n = Math.max(2, Math.ceil((Math.abs(dt) / TAU) * SEGMENTS));
  const pts: number[] = [];
  for (let i = 0; i < (closed ? n : n + 1); i++) {
    const t = t0 + (dt * i) / n, c = Math.cos(t), s = Math.sin(t);
    pts.push(cx + c * ux + s * vx, cy + c * uy + s * vy);
  }
  return pts;
}

/** 시작각에서 끝각까지 반시계로 도는 각. 같으면 한 바퀴다. */
export const ccw = (a0: number, a1: number) => { let d = (a1 - a0) % TAU; if (d <= 1e-12) d += TAU; return d; };

/** 폴리라인의 한 구간. bulge = tan(호각/4), 양수면 반시계. 양 끝점을 포함해 돌려준다. */
export function bulgeArc(x0: number, y0: number, x1: number, y1: number, bulge: number): number[] {
  if (!bulge || (x0 === x1 && y0 === y1)) return [x0, y0, x1, y1];
  const k = (1 / bulge - bulge) / 2, dx = x1 - x0, dy = y1 - y0;
  const cx = (x0 + x1) / 2 - (k * dy) / 2, cy = (y0 + y1) / 2 + (k * dx) / 2;
  const r = Math.hypot(x0 - cx, y0 - cy);
  const pts = sweep(cx, cy, r, 0, 0, r, Math.atan2(y0 - cy, x0 - cx), 4 * Math.atan(bulge));
  pts[pts.length - 2] = x1; pts[pts.length - 1] = y1; // 끝점은 계산 오차 없이 원래 좌표로
  return pts;
}

/** 폭이 있는 선을 면으로 만든다. 폭은 길이를 따라 w0에서 w1로 변한다(화살표 모양 폴리라인). */
export function ribbon(pts: number[], w0: number, w1: number): number[] {
  const n = pts.length / 2;
  const len = [0];
  for (let i = 1; i < n; i++) len.push(len[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]));
  const total = len[n - 1] || 1;
  const left: number[] = [], right: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dx = pts[b * 2] - pts[a * 2], dy = pts[b * 2 + 1] - pts[a * 2 + 1], d = Math.hypot(dx, dy) || 1;
    const h = (w0 + ((w1 - w0) * len[i]) / total) / 2, nx = (-dy / d) * h, ny = (dx / d) * h;
    left.push(pts[i * 2] + nx, pts[i * 2 + 1] + ny);
    right.unshift(pts[i * 2] - nx, pts[i * 2 + 1] - ny);
  }
  return left.concat(right);
}

/** B-스플라인(가중치 포함)을 매듭 구간마다 per개로 나눠 편다. 매듭 수가 안 맞으면 null. */
export function bspline(cp: (P & { weight?: number })[], degree: number, knots: number[], weights?: number[], per = 10): number[] | null {
  const n = cp.length;
  if (degree < 1 || n <= degree || knots.length !== n + degree + 1) return null;
  const at = (span: number, u: number) => {
    const d: number[][] = [];
    for (let j = 0; j <= degree; j++) {
      const i = j + span - degree, w = weights?.[i] ?? cp[i].weight ?? 1;
      d.push([cp[i].x * w, cp[i].y * w, w]);
    }
    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const i = j + span - degree, den = knots[i + degree - r + 1] - knots[i], a = den ? (u - knots[i]) / den : 0;
        for (let c = 0; c < 3; c++) d[j][c] = (1 - a) * d[j - 1][c] + a * d[j][c];
      }
    }
    return [d[degree][0] / d[degree][2], d[degree][1] / d[degree][2]];
  };
  const pts: number[] = [];
  let last = -1;
  for (let s = degree; s < n; s++) {
    if (!(knots[s + 1] > knots[s])) continue;
    last = s;
    for (let k = 0; k < per; k++) pts.push(...at(s, knots[s] + ((knots[s + 1] - knots[s]) * k) / per));
  }
  if (last < 0) return null;
  pts.push(...at(last, knots[last + 1]));
  return pts;
}

/** 지나는 점만 있는 스플라인: 점들을 부드럽게 잇는다(Catmull-Rom). */
export function smooth(p: P[], closed = false, per = 8): number[] {
  const n = p.length, pts: number[] = [];
  const at = (i: number) => (closed ? p[((i % n) + n) % n] : p[Math.max(0, Math.min(n - 1, i))]);
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = at(i - 1), b = at(i), c = at(i + 1), d = at(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      pts.push(
        0.5 * (2 * b.x + (c.x - a.x) * t + (2 * a.x - 5 * b.x + 4 * c.x - d.x) * t2 + (3 * b.x - a.x - 3 * c.x + d.x) * t3),
        0.5 * (2 * b.y + (c.y - a.y) * t + (2 * a.y - 5 * b.y + 4 * c.y - d.y) * t2 + (3 * b.y - a.y - 3 * c.y + d.y) * t3),
      );
    }
  }
  if (!closed) pts.push(p[n - 1].x, p[n - 1].y);
  return pts;
}

export type HatchLine = { angle: number; base: P; offset: P; dashLengths?: number[] };

/**
 * 무늬 해치: 정의선마다 평행선을 깔고 경계(짝홀 규칙) 안쪽 조각만 남긴다. 선분은 [x0,y0,x1,y1].
 * 조각이 cap을 넘으면 null — 화면에서는 어차피 면처럼 뭉개지는 촘촘한 무늬다.
 */
export function hatchLines(loops: number[][], defs: HatchLine[], cap = 20000): number[][] | null {
  const out: number[][] = [];
  for (const def of defs) {
    const dx = Math.cos(def.angle), dy = Math.sin(def.angle), nx = -dy, ny = dx;
    const step = def.offset.x * nx + def.offset.y * ny;
    if (Math.abs(step) < 1e-9) continue;
    let lo = Infinity, hi = -Infinity;
    for (const l of loops) for (let i = 0; i < l.length; i += 2) {
      const d = (l[i] - def.base.x) * nx + (l[i + 1] - def.base.y) * ny;
      if (d < lo) lo = d; if (d > hi) hi = d;
    }
    const k0 = Math.ceil(Math.min(lo / step, hi / step)), k1 = Math.floor(Math.max(lo / step, hi / step));
    if (k1 - k0 > cap) return null;
    const dashes = def.dashLengths ?? [], period = dashes.reduce((a, d) => a + Math.abs(d), 0);
    for (let k = k0; k <= k1; k++) {
      const ox = def.base.x + k * def.offset.x, oy = def.base.y + k * def.offset.y;
      const ts: number[] = [];
      for (const l of loops) for (let i = 0; i < l.length; i += 2) {
        const j = (i + 2) % l.length;
        const a = (l[i] - ox) * nx + (l[i + 1] - oy) * ny, b = (l[j] - ox) * nx + (l[j + 1] - oy) * ny;
        if (a > 0 === b > 0) continue;
        const f = a / (a - b);
        ts.push((l[i] + (l[j] - l[i]) * f - ox) * dx + (l[i + 1] + (l[j + 1] - l[i + 1]) * f - oy) * dy);
      }
      ts.sort((a, b) => a - b);
      const seg = (a: number, b: number) => out.push([ox + dx * a, oy + dy * a, ox + dx * b, oy + dy * b]);
      for (let j = 0; j + 1 < ts.length; j += 2) {
        if (!(period > 0)) { seg(ts[j], ts[j + 1]); continue; }
        for (let x = Math.floor(ts[j] / period) * period; x < ts[j + 1]; ) {
          for (const d of dashes) {
            const a = Math.max(x, ts[j]), b = Math.min(x + Math.abs(d), ts[j + 1]);
            if (d > 0 && b > a) seg(a, b);
            x += Math.abs(d);
          }
          if (out.length > cap) return null;
        }
      }
      if (out.length > cap) return null;
    }
  }
  return out;
}
