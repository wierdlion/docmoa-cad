import { F_CLOSED, F_FILL, ITEM, textQuad, type Box, type Scene, type Sheet } from "./scene";

export type View = { s: number; ox: number; oy: number };

/** 뷰 상자 → 화면 변환. SVG의 xMidYMid meet와 같다: 짧은 쪽에 맞추고 가운데 둔다. */
export function viewTransform(view: Box, cw: number, ch: number): View {
  const s = Math.min(cw / view.w, ch / view.h);
  return { s, ox: (cw - view.w * s) / 2 - view.x * s, oy: (ch - view.h * s) / 2 - view.y * s };
}

/** 화면 px → 도면 좌표 */
export function toWorld(view: Box, cw: number, ch: number, px: number, py: number) {
  const { s, ox, oy } = viewTransform(view, cw, ch);
  return { x: (px - ox) / s, y: (py - oy) / s };
}

export type Theme = { bg: string; fg: string };
export const DARK: Theme = { bg: "#000000", fg: "#ffffff" };
export const LIGHT: Theme = { bg: "#ffffff", fg: "#000000" };

export type DrawOpts = {
  cw: number; ch: number; dpr: number;
  hidden: boolean[];
  theme: Theme;
  /** true면 전부 전경색 한 가지로(흰 종이 PDF) */
  mono?: boolean;
  /** 화면 1px에 해당하는 장치 단위. 캔버스는 1, PDF(mm)는 그보다 작다. 가는 선 굵기와 생략 기준이 여기서 나온다. */
  px: number;
  /** 선굵기 mm → 장치 단위 */
  pen: (mm: number) => number;
};

/**
 * 이 모듈이 그리기에 쓰는 캔버스 API. PDF 저장은 같은 메서드를 가진 가짜 컨텍스트(export.ts)로 같은 코드를 돌려,
 * 화면에 보이는 그대로가 종이에 나온다.
 */
export type Ctx = Pick<CanvasRenderingContext2D,
  "beginPath" | "moveTo" | "lineTo" | "closePath" | "stroke" | "fill" | "fillRect" | "rect" | "clip" | "save" | "restore" | "setLineDash" | "fillText" | "measureText"
  | "lineWidth" | "strokeStyle" | "fillStyle" | "font" | "lineJoin" | "textBaseline" | "textAlign"> & {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
};

/** 스타일마다 item index 목록. 한 스타일을 한 번의 stroke()로 그리기 위해서다. 장면당 한 번 만든다. */
const groupsOf = new WeakMap<Scene, { stroke: Int32Array[]; fill: Int32Array }>();
function groups(scene: Scene) {
  let g = groupsOf.get(scene);
  if (g) return g;
  const stroke: number[][] = scene.styles.map(() => []), fill: number[] = [];
  for (let i = 0; i < scene.items.length / ITEM; i++) {
    if (scene.items[i * ITEM + 4] & F_FILL) fill.push(i);
    else stroke[scene.items[i * ITEM + 2]].push(i);
  }
  g = { stroke: stroke.map((a) => Int32Array.from(a)), fill: Int32Array.from(fill) };
  groupsOf.set(scene, g);
  return g;
}

/** 글꼴은 큰 px로 지정하고 변환으로 줄인다. 작은 px 글꼴은 브라우저가 힌팅으로 뭉갠다. */
export const FONT_PX = 100;
export const FONT = `${FONT_PX}px sans-serif`;
/** 글자마다 글꼴 그대로의 폭(FONT_PX 기준). 한 번 재면 배율이 바뀌어도 그대로다. 컨텍스트마다 글꼴이 다르므로(캔버스 sans-serif, PDF 심은 폰트) 따로 잰다. */
const widthsOf = new WeakMap<object, WeakMap<Scene, Float32Array>>();

/** 시트(와 그 뷰포트에 비친 모델)를 그린다. 걸린 시간을 ms로 돌려준다. */
export function drawSheet(ctx: Ctx, sheet: Sheet, model: Scene, view: Box, o: DrawOpts): number {
  const t0 = performance.now();
  const { cw, ch, dpr } = o;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = o.theme.bg;
  ctx.fillRect(0, 0, cw, ch);
  const tf = viewTransform(view, cw, ch);
  drawScene(ctx, sheet.scene, tf, null, o);
  for (const vp of sheet.viewports) {
    const clip: Box = { x: tf.s * vp.clip.x + tf.ox, y: tf.s * vp.clip.y + tf.oy, w: tf.s * vp.clip.w, h: tf.s * vp.clip.h };
    if (clip.x > cw || clip.y > ch || clip.x + clip.w < 0 || clip.y + clip.h < 0) continue;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.rect(clip.x, clip.y, clip.w, clip.h);
    ctx.clip();
    drawScene(ctx, model, { s: tf.s * vp.s, ox: tf.ox + tf.s * vp.ox, oy: tf.oy + tf.s * vp.oy }, clip, o);
    ctx.restore();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return performance.now() - t0;
}

/** 화면 밖·반 픽셀 이하 도형과 2px 아래 글자는 그리지 않는다. */
export function drawScene(ctx: Ctx, scene: Scene, { s, ox, oy }: View, clip: Box | null, o: DrawOpts) {
  const { cw, ch, dpr, hidden, px } = o;
  const color = (i: number) => (o.mono || scene.colors[i] === "fg" ? o.theme.fg : scene.colors[i]);
  // 보이는 도면 범위
  const dx0 = clip ? Math.max(0, clip.x) : 0, dy0 = clip ? Math.max(0, clip.y) : 0;
  const dx1 = clip ? Math.min(cw, clip.x + clip.w) : cw, dy1 = clip ? Math.min(ch, clip.y + clip.h) : ch;
  const vx0 = (dx0 - ox) / s, vy0 = (dy0 - oy) / s, vx1 = (dx1 - ox) / s, vy1 = (dy1 - oy) / s;
  const minSize = (0.5 * px) / s;

  const { items, bounds, verts } = scene;
  const visible = (i: number) => {
    if (hidden[items[i * ITEM + 3]]) return false;
    const b = i * 4;
    if (bounds[b + 2] < vx0 || bounds[b] > vx1 || bounds[b + 3] < vy0 || bounds[b + 1] > vy1) return false;
    return bounds[b + 2] - bounds[b] >= minSize || bounds[b + 3] - bounds[b + 1] >= minSize;
  };
  const trace = (i: number) => {
    const start = items[i * ITEM] * 2, n = items[i * ITEM + 1];
    ctx.moveTo(verts[start], verts[start + 1]);
    for (let k = 1; k < n; k++) ctx.lineTo(verts[start + k * 2], verts[start + k * 2 + 1]);
    if (items[i * ITEM + 4] & F_CLOSED) ctx.closePath();
  };

  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
  ctx.lineJoin = "round";
  const g = groups(scene);
  // 면은 하나씩: 한 경로에 몰아 넣으면 겹치는 면끼리 짝홀 규칙으로 서로를 지운다.
  for (const i of g.fill) {
    if (!visible(i)) continue;
    ctx.beginPath();
    trace(i);
    ctx.fillStyle = color(scene.styles[items[i * ITEM + 2]].color);
    ctx.fill("evenodd");
  }
  for (let c = 0; c < scene.styles.length; c++) {
    const list = g.stroke[c];
    if (!list.length) continue;
    ctx.beginPath();
    let any = false;
    for (const i of list) if (visible(i)) { trace(i); any = true; }
    if (!any) continue;
    const st = scene.styles[c];
    ctx.strokeStyle = color(st.color);
    // 가는 선은 전부 1px. 선굵기가 지정된 것과 폭 있는 폴리라인만 더 굵다.
    ctx.lineWidth = Math.max(st.lw ? o.pen(st.lw) : px, st.ww * s) / s;
    // 점선은 무늬 한 주기가 4px은 돼야 보인다. 그보다 작으면 실선으로 그린다.
    ctx.setLineDash(st.dash && st.dash.reduce((a, b) => a + b, 0) * s >= 4 * px ? st.dash : []);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  let perCtx = widthsOf.get(ctx);
  if (!perCtx) { perCtx = new WeakMap(); widthsOf.set(ctx, perCtx); }
  let widths = perCtx.get(scene);
  if (!widths) { widths = new Float32Array(scene.texts.length); perCtx.set(scene, widths); }
  ctx.font = FONT;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  for (let n = 0; n < scene.texts.length; n++) {
    const t = scene.texts[n];
    if (hidden[t.layer]) continue;
    const k = Math.hypot(t.m[0], t.m[1]) * t.size; // 장면 단위 글자 높이
    if (k * s < 2 * px) continue; // 2px 아래는 어차피 안 읽힌다
    const q = textQuad(t);
    if (Math.max(q[0], q[2], q[4], q[6]) < vx0 || Math.min(q[0], q[2], q[4], q[6]) > vx1 || Math.max(q[1], q[3], q[5], q[7]) < vy0 || Math.min(q[1], q[3], q[5], q[7]) > vy1) continue;
    let w = widths[n];
    if (!w) { w = ctx.measureText(t.str).width || 1; widths[n] = w; }
    const f = t.size / FONT_PX;
    // 도면이 폭을 알려줬으면 글꼴이 달라도 그 폭에 맞춘다. 아니면 폭 비율만 적용한다.
    const fx = f * (t.w > 0 ? t.w / (w * f) : t.xs);
    // 화면 = 뷰 × 글자행렬 × 크기보정. 글자 로컬은 y 아래 방향이라 canvas와 같다.
    ctx.setTransform(dpr * s * t.m[0] * fx, dpr * s * t.m[1] * fx, dpr * s * t.m[2] * f, dpr * s * t.m[3] * f, dpr * (s * t.m[4] + ox), dpr * (s * t.m[5] + oy));
    ctx.fillStyle = color(t.color);
    ctx.fillText(t.str, t.anchor === 1 ? -w / 2 : t.anchor === 2 ? -w : 0, 0);
  }
}

/** 고른 엔티티를 덧그린다(겉선만). 검색 결과·선택 표시용. */
export function drawHighlight(ctx: CanvasRenderingContext2D, scene: Scene, ent: number, { s, ox, oy }: View, dpr: number, color: string) {
  const { items, verts } = scene;
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
  ctx.beginPath();
  for (let i = 0; i < items.length / ITEM; i++) {
    if (items[i * ITEM + 5] !== ent) continue;
    const start = items[i * ITEM] * 2, n = items[i * ITEM + 1];
    ctx.moveTo(verts[start], verts[start + 1]);
    for (let k = 1; k < n; k++) ctx.lineTo(verts[start + k * 2], verts[start + k * 2 + 1]);
    if (items[i * ITEM + 4] & F_CLOSED) ctx.closePath();
  }
  for (const t of scene.texts) {
    if (t.ent !== ent) continue;
    const q = textQuad(t);
    ctx.moveTo(q[0], q[1]); ctx.lineTo(q[2], q[3]); ctx.lineTo(q[4], q[5]); ctx.lineTo(q[6], q[7]); ctx.closePath();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 / s;
  ctx.stroke();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
