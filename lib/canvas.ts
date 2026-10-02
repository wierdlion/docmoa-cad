import { F_CLOSED, ITEM, type Box, type Scene } from "./scene";

/** 뷰 상자 → 화면 변환. SVG의 xMidYMid meet와 같다: 짧은 쪽에 맞추고 가운데 둔다. */
export function viewTransform(view: Box, cw: number, ch: number) {
  const s = Math.min(cw / view.w, ch / view.h);
  return { s, ox: (cw - view.w * s) / 2 - view.x * s, oy: (ch - view.h * s) / 2 - view.y * s };
}

/** 화면 px → 도면 좌표 */
export function toWorld(view: Box, cw: number, ch: number, px: number, py: number) {
  const { s, ox, oy } = viewTransform(view, cw, ch);
  return { x: (px - ox) / s, y: (py - oy) / s };
}

/** 색마다 item index 목록. 한 색을 한 번의 stroke()로 그리기 위해서다. 장면당 한 번 만든다. */
const byColor = new WeakMap<Scene, { stroke: Int32Array[]; fill: Int32Array[] }>();
function groups(scene: Scene) {
  let g = byColor.get(scene);
  if (g) return g;
  const n = scene.items.length / ITEM;
  const stroke: number[][] = scene.colors.map(() => []), fill: number[][] = scene.colors.map(() => []);
  for (let i = 0; i < n; i++) {
    const s = scene.items[i * ITEM + 2], f = scene.items[i * ITEM + 3];
    if (s >= 0) stroke[s].push(i);
    if (f >= 0) fill[f].push(i);
  }
  g = { stroke: stroke.map((a) => Int32Array.from(a)), fill: fill.map((a) => Int32Array.from(a)) };
  byColor.set(scene, g);
  return g;
}

/** 글꼴은 큰 px로 지정하고 변환으로 줄인다. 작은 px 글꼴은 브라우저가 힌팅으로 뭉갠다. */
const FONT_PX = 100;

/**
 * 장면을 캔버스에 그린다. cw/ch는 CSS px, dpr은 devicePixelRatio. hidden[layer]가 true면 건너뛴다.
 * 화면 밖·0.5px 이하 도형은 그리지 않는다. 걸린 시간을 ms로 돌려준다.
 */
export function draw(ctx: CanvasRenderingContext2D, scene: Scene, view: Box, cw: number, ch: number, dpr: number, hidden: boolean[]): number {
  const t0 = performance.now();
  const { s, ox, oy } = viewTransform(view, cw, ch);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cw, ch);
  // 보이는 도면 범위
  const vx0 = -ox / s, vy0 = -oy / s, vx1 = (cw - ox) / s, vy1 = (ch - oy) / s;
  const minSize = 0.5 / s;

  const { items, bounds, verts } = scene;
  const visible = (i: number) => {
    if (hidden[items[i * ITEM + 4]]) return false;
    const b = i * 4;
    if (bounds[b + 2] < vx0 || bounds[b] > vx1 || bounds[b + 3] < vy0 || bounds[b + 1] > vy1) return false;
    return bounds[b + 2] - bounds[b] >= minSize || bounds[b + 3] - bounds[b + 1] >= minSize;
  };
  const trace = (i: number) => {
    const start = items[i * ITEM] * 2, n = items[i * ITEM + 1];
    ctx.moveTo(verts[start], verts[start + 1]);
    for (let k = 1; k < n; k++) ctx.lineTo(verts[start + k * 2], verts[start + k * 2 + 1]);
    if (items[i * ITEM + 5] & F_CLOSED) ctx.closePath();
  };

  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
  ctx.lineWidth = 1 / s; // 확대해도 1 CSS px
  ctx.lineJoin = "round";
  const g = groups(scene);
  for (let c = 0; c < scene.colors.length; c++) {
    const list = g.fill[c];
    if (!list.length) continue;
    ctx.beginPath();
    let any = false;
    for (const i of list) if (visible(i)) { trace(i); any = true; }
    if (any) { ctx.fillStyle = scene.colors[c]; ctx.fill(); }
  }
  for (let c = 0; c < scene.colors.length; c++) {
    const list = g.stroke[c];
    if (!list.length) continue;
    ctx.beginPath();
    let any = false;
    for (const i of list) if (visible(i)) { trace(i); any = true; }
    if (any) { ctx.strokeStyle = scene.colors[c]; ctx.stroke(); }
  }

  ctx.font = `${FONT_PX}px sans-serif`;
  ctx.textBaseline = "alphabetic";
  for (const t of scene.texts) {
    if (hidden[t.layer]) continue;
    const k = Math.hypot(t.m[0], t.m[1]) * t.size; // 장면 단위 글자 높이
    if (k * s < 2) continue; // 2px 아래는 어차피 안 읽힌다
    const px = t.m[0] * t.x + t.m[2] * t.y + t.m[4], py = t.m[1] * t.x + t.m[3] * t.y + t.m[5];
    const reach = k * (t.str.length + 2);
    if (px + reach < vx0 || px - reach > vx1 || py + reach < vy0 || py - reach > vy1) continue;
    const f = t.size / FONT_PX;
    // 화면 = view × 글자행렬 × 크기보정. 글자 로컬은 y 아래 방향이라 canvas와 같다.
    const a = t.m[0] * f, b = t.m[1] * f, c = t.m[2] * f, d = t.m[3] * f;
    ctx.setTransform(dpr * s * a, dpr * s * b, dpr * s * c, dpr * s * d, dpr * (s * t.m[4] + ox), dpr * (s * t.m[5] + oy));
    ctx.textAlign = t.anchor === 1 ? "center" : t.anchor === 2 ? "right" : "left";
    ctx.fillStyle = scene.colors[t.color];
    ctx.fillText(t.str, t.x / f, t.y / f);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return performance.now() - t0;
}
