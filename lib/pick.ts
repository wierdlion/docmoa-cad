/** 장면 안에서 찾기: 클릭한 엔티티, 가까운 꼭짓점, 글자 검색, 엔티티 길이·면적. 좌표는 장면 좌표(y 아래). */
import { F_CLOSED, F_FILL, ITEM, textQuad, type Scene } from "./scene";

/** 점에서 선분까지의 거리 */
const segDist = (px: number, py: number, x0: number, y0: number, x1: number, y1: number) => {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2)) : 0;
  return Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
};

/** (x, y)에서 tol 안에 있는 가장 가까운 엔티티. 없으면 -1. */
export function pick(scene: Scene, x: number, y: number, tol: number, hidden: boolean[]): number {
  const { items, bounds, verts } = scene;
  let best = tol, ent = -1;
  for (let i = 0; i < items.length / ITEM; i++) {
    if (hidden[items[i * ITEM + 3]]) continue;
    const b = i * 4;
    if (x < bounds[b] - tol || x > bounds[b + 2] + tol || y < bounds[b + 1] - tol || y > bounds[b + 3] + tol) continue;
    const start = items[i * ITEM] * 2, n = items[i * ITEM + 1], closed = items[i * ITEM + 4] & (F_CLOSED | F_FILL);
    for (let k = 0; k < (closed ? n : n - 1); k++) {
      const a = start + k * 2, c = start + ((k + 1) % n) * 2;
      const d = segDist(x, y, verts[a], verts[a + 1], verts[c], verts[c + 1]);
      if (d < best) { best = d; ent = items[i * ITEM + 5]; }
    }
  }
  for (const t of scene.texts) {
    if (hidden[t.layer]) continue;
    const q = textQuad(t);
    // 글자 상자 안이면 거리 0으로 친다(두 삼각형으로 나눠 안팎 판정)
    const inside = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
      const s1 = (bx - ax) * (y - ay) - (by - ay) * (x - ax), s2 = (cx - bx) * (y - by) - (cy - by) * (x - bx), s3 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
      return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
    };
    if (inside(q[0], q[1], q[2], q[3], q[4], q[5]) || inside(q[0], q[1], q[4], q[5], q[6], q[7])) { if (best > 0) { best = 0; ent = t.ent; } }
  }
  return ent;
}

/** tol 안에서 가장 가까운 꼭짓점. 측정할 때 끝점에 붙이는 용도. */
export function snap(scene: Scene, x: number, y: number, tol: number, hidden: boolean[]): { x: number; y: number } | null {
  const { items, bounds, verts } = scene;
  let best = tol * tol, out: { x: number; y: number } | null = null;
  for (let i = 0; i < items.length / ITEM; i++) {
    if (hidden[items[i * ITEM + 3]]) continue;
    const b = i * 4;
    if (x < bounds[b] - tol || x > bounds[b + 2] + tol || y < bounds[b + 1] - tol || y > bounds[b + 3] + tol) continue;
    const start = items[i * ITEM] * 2, n = items[i * ITEM + 1];
    // 호·원은 점이 많다. 양 끝만 끝점이고 나머지는 지나는 점이라 붙지 않는다.
    const ks = n <= 8 ? [...Array(n).keys()] : items[i * ITEM + 4] & F_CLOSED ? [] : [0, n - 1];
    for (const k of ks) {
      const dx = verts[start + k * 2] - x, dy = verts[start + k * 2 + 1] - y, d = dx * dx + dy * dy;
      if (d < best) { best = d; out = { x: verts[start + k * 2], y: verts[start + k * 2 + 1] }; }
    }
  }
  return out;
}

/** 글자 검색: 대소문자 무시, 부분 일치, 숨긴 레이어 제외. 글자 index 목록. */
export function search(scene: Scene, q: string, hidden: boolean[] = []): number[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const out: number[] = [];
  scene.texts.forEach((t, i) => { if (!hidden[t.layer] && t.str.toLowerCase().includes(needle)) out.push(i); });
  return out;
}

/** 엔티티의 선 길이 합과, 닫힌 도형 하나면 그 면적. */
export function measureEnt(scene: Scene, ent: number): { length: number; area: number } {
  const { items, verts } = scene;
  let length = 0, area = 0, closedCount = 0;
  for (let i = 0; i < items.length / ITEM; i++) {
    if (items[i * ITEM + 5] !== ent) continue;
    const start = items[i * ITEM] * 2, n = items[i * ITEM + 1], closed = items[i * ITEM + 4] & F_CLOSED;
    let a = 0;
    for (let k = 0; k < (closed ? n : n - 1); k++) {
      const p = start + k * 2, q = start + ((k + 1) % n) * 2;
      length += Math.hypot(verts[q] - verts[p], verts[q + 1] - verts[p + 1]);
      a += verts[p] * verts[q + 1] - verts[q] * verts[p + 1];
    }
    if (closed) { closedCount++; area = Math.abs(a) / 2; }
  }
  return { length, area: closedCount === 1 ? area : 0 };
}

/** 찍은 점들의 누적 길이와, 셋 이상이면 그 다각형 면적 */
export function measurePoints(pts: { x: number; y: number }[]): { length: number; area: number } {
  let length = 0, a = 0;
  for (let i = 0; i + 1 < pts.length; i++) length += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  if (pts.length >= 3) for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  return { length, area: Math.abs(a) / 2 };
}

/** 123456.789 → "123,457" / 1.23456 → "1.235" 같은 사람 눈용 숫자 */
export const fmt = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toLocaleString(undefined, { maximumSignificantDigits: 4 }));
