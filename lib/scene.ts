/**
 * libredwg의 SVG를 캔버스가 바로 그릴 수 있는 좌표 배열("장면")로 바꾼다. DOM 없이 문자열만 훑으므로
 * 워커에서 돌고, 결과는 TypedArray라 메인 스레드로 복사 없이 넘어간다.
 *
 * 변환기가 내는 SVG는 어휘가 좁다(2026-10 조사: g, line, path(M/L/Z/A), circle, ellipse, text, use, defs,
 * 빈 중첩 svg). 그 어휘만 다루고 모르는 것은 세어서 돌려준다.
 */
export type Box = { x: number; y: number; w: number; h: number };
/** SVG 행렬 [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f */
export type Mat = [number, number, number, number, number, number];

export type TextItem = {
  /** 글자 로컬 좌표 → 장면 좌표. 회전·반전·y축 뒤집기가 전부 들어 있다. */
  m: Mat;
  x: number;
  y: number;
  size: number;
  /** 0 start, 1 middle, 2 end */
  anchor: 0 | 1 | 2;
  str: string;
  color: number;
  layer: number;
};

/** items 한 칸: 시작 정점 index, 정점 수, 선 색, 채움 색, 레이어, 플래그. 색 -1은 없음. */
export const ITEM = 6;
export const F_CLOSED = 1;

export type Scene = {
  /** x,y 쌍. SVG 루트 좌표계(화면과 같은 y 아래 방향). */
  verts: Float64Array;
  items: Int32Array;
  /** item마다 minx, miny, maxx, maxy */
  bounds: Float64Array;
  texts: TextItem[];
  colors: string[];
  layers: string[];
  /** 본체를 감싸는 뷰 상자. 비어 있는 도면이면 null. */
  fit: Box | null;
  /** 모델 공간 엔티티(SVG <g id=handle>)마다 minx, miny, maxx, maxy. PDF 저장 때 화면 밖 엔티티를 빼는 데 쓴다. */
  handleBounds: Record<string, [number, number, number, number]>;
  skipped: Record<string, number>;
};

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const apply = (m: Mat, pts: number[]) => {
  const out = new Array<number>(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    out[i] = m[0] * pts[i] + m[2] * pts[i + 1] + m[4];
    out[i + 1] = m[1] * pts[i] + m[3] * pts[i + 1] + m[5];
  }
  return out;
};

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi;
const nums = (s: string) => (s.match(NUM) ?? []).map(Number);
const count = (bag: Record<string, number>, key: string) => { bag[key] = (bag[key] ?? 0) + 1; };

/** transform 속성. 왼쪽부터 차례로 곱한다. 모르는 함수(skewX 등)는 무시하고 센다. */
export function parseTransform(s: string, skipped: Record<string, number>): Mat {
  let m: Mat = IDENTITY;
  for (const [, fn, args] of s.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const v = nums(args);
    let t: Mat | null = null;
    if (fn === "translate") t = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
    else if (fn === "scale") t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
    else if (fn === "rotate") {
      const r = ((v[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), si = Math.sin(r);
      t = [c, si, -si, c, 0, 0];
      if (v.length > 2) t = mul(mul([1, 0, 0, 1, v[1], v[2]], t), [1, 0, 0, 1, -v[1], -v[2]]);
    } else if (fn === "matrix" && v.length === 6) t = v as Mat;
    else count(skipped, `transform:${fn}`);
    if (t) m = mul(m, t);
  }
  return m;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (all, e: string) =>
    e[0] === "#" ? String.fromCodePoint(parseInt(e[1] === "x" ? e.slice(2) : e.slice(1), e[1] === "x" ? 16 : 10)) : (ENTITIES[e] ?? all),
  );

/** 원 한 바퀴를 몇 개의 선분으로 그릴지. ponytail: 고정값. 확대해서 각이 보이면 뷰 배율에 따라 나눈다. */
const SEGMENTS = 64;

/** 색 -2 = 지정 안 됨(부모/use 문맥에서 상속), -1 = none */
const UNSET = -2, NONE = -1;

/** 블록 안에 쌓이는 원시 도형. 좌표는 블록 로컬. */
type Poly = { pts: number[]; stroke: number; fill: number; closed: boolean };
type Txt = { m: Mat; x: number; y: number; size: number; anchor: 0 | 1 | 2; str: string; stroke: number; fill: number };
type Use = { href: string; m: Mat; stroke: number; fill: number };
type Proto = { polys: Poly[]; texts: Txt[]; uses: Use[] };

/** 열려 있는 요소 하나. target이 있으면 블록 정의를 수집하는 중이다. handle은 감싸는 모델 공간 엔티티. */
type Frame = { m: Mat; stroke: number; fill: number; layer: number; target: Proto | null; handle: string | null };

export function parseScene(svg: string, layerOf: Record<string, string>, drop: Iterable<string> = []): Scene {
  const skipped: Record<string, number> = {};
  const colors: string[] = [];
  const colorIdx = new Map<string, number>();
  const color = (v: string | undefined, inherit: number): number => {
    if (v === undefined) return inherit;
    if (v === "none") return NONE;
    let i = colorIdx.get(v);
    if (i === undefined) { i = colors.length; colors.push(v); colorIdx.set(v, i); }
    return i;
  };
  const layers: string[] = [];
  const layerIdx = new Map<string, number>();
  const layer = (name: string) => {
    let i = layerIdx.get(name);
    if (i === undefined) { i = layers.length; layers.push(name); layerIdx.set(name, i); }
    return i;
  };
  const dropped = new Set(drop);
  // 그려지는 게 없는 레이어도 목록에는 나온다(이전 뷰어와 같은 목록). "0"이 늘 첫 칸이다.
  layer("0");
  for (const name of Object.values(layerOf)) layer(name);

  const verts: number[] = [];
  const items: number[] = [];
  const bounds: number[] = [];
  const texts: TextItem[] = [];
  const handleBounds: Record<string, [number, number, number, number]> = {};
  const grow = (handle: string | null, minx: number, miny: number, maxx: number, maxy: number) => {
    if (!handle) return;
    const b = handleBounds[handle];
    if (!b) handleBounds[handle] = [minx, miny, maxx, maxy];
    else { if (minx < b[0]) b[0] = minx; if (miny < b[1]) b[1] = miny; if (maxx > b[2]) b[2] = maxx; if (maxy > b[3]) b[3] = maxy; }
  };

  const emitPoly = (p: Poly, m: Mat, stroke: number, fill: number, lay: number, handle: string | null) => {
    const s = p.stroke === UNSET ? stroke : p.stroke, f = p.fill === UNSET ? fill : p.fill;
    if ((s < 0 && f < 0) || p.pts.length < 4) return;
    const start = verts.length / 2;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (let i = 0; i < p.pts.length; i += 2) {
      const x = m[0] * p.pts[i] + m[2] * p.pts[i + 1] + m[4];
      const y = m[1] * p.pts[i] + m[3] * p.pts[i + 1] + m[5];
      verts.push(x, y);
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
    items.push(start, p.pts.length / 2, Math.max(s, NONE), Math.max(f, NONE), lay, p.closed ? F_CLOSED : 0);
    bounds.push(minx, miny, maxx, maxy);
    grow(handle, minx, miny, maxx, maxy);
  };
  const emitText = (t: Txt, m: Mat, stroke: number, fill: number, lay: number, handle: string | null) => {
    const f = t.fill === UNSET ? fill : t.fill, s = t.stroke === UNSET ? stroke : t.stroke;
    const c = f >= 0 ? f : s;
    if (c < 0 || !t.str) return;
    const tm = mul(m, t.m);
    texts.push({ m: tm, x: t.x, y: t.y, size: t.size, anchor: t.anchor, str: t.str, color: c, layer: lay });
    // 글자 상자는 기준점 주위로 글자 높이 × 글자 수만큼 잡는다. 정확하진 않지만 PDF 자르기에는 충분하다.
    const px = tm[0] * t.x + tm[2] * t.y + tm[4], py = tm[1] * t.x + tm[3] * t.y + tm[5];
    const r = t.size * Math.hypot(tm[0], tm[1]) * (t.str.length + 1);
    grow(handle, px - r, py - r, px + r, py + r);
  };

  const blocks = new Map<string, Proto>();
  const instantiate = (name: string, m: Mat, stroke: number, fill: number, lay: number, handle: string | null, depth: number) => {
    const b = blocks.get(name);
    if (!b) { count(skipped, "use:missing"); return; }
    if (depth > 8) { count(skipped, "use:deep"); return; }
    for (const p of b.polys) emitPoly(p, m, stroke, fill, lay, handle);
    for (const t of b.texts) emitText(t, m, stroke, fill, lay, handle);
    for (const u of b.uses) instantiate(u.href, mul(m, u.m), u.stroke === UNSET ? stroke : u.stroke, u.fill === UNSET ? fill : u.fill, lay, handle, depth + 1);
  };

  const stack: Frame[] = [{ m: IDENTITY, stroke: UNSET, fill: UNSET, layer: layer("0"), target: null, handle: null }];
  const top = () => stack[stack.length - 1];
  let inDefs = false, skipSvg = 0, sawRoot = false;

  const addPoly = (f: Frame, pts: number[], closed: boolean) => {
    if (f.target) f.target.polys.push({ pts: apply(f.m, pts), stroke: f.stroke, fill: f.fill, closed });
    else emitPoly({ pts, stroke: f.stroke, fill: f.fill, closed }, f.m, f.stroke, f.fill, f.layer, f.handle);
  };

  const TAG = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(svg))) {
    const [, close, tag, attrText, selfClose] = m;
    if (skipSvg) {
      if (tag === "svg") skipSvg += close ? -1 : 1;
      continue;
    }
    if (close) {
      if (tag === "defs") inDefs = false;
      else if (stack.length > 1) stack.pop();
      continue;
    }
    if (tag === "svg") {
      if (sawRoot) { skipSvg = 1; continue; } // 도면 속 이미지 자리표시. 비어 있고 그릴 것도 없다.
      sawRoot = true;
      if (!selfClose) stack.push({ ...top() });
      continue;
    }
    if (tag === "defs") { inDefs = true; continue; }

    const attrs: Record<string, string> = {};
    for (const a of attrText.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const parent = top();
    const local = attrs.transform ? parseTransform(attrs.transform, skipped) : IDENTITY;

    // 블록 정의. 좌표는 블록 로컬에서 새로 시작하고, 색은 use 문맥에서 상속하므로 UNSET으로 둔다.
    if (tag === "g" && inDefs && !parent.target && attrs.id) {
      const target: Proto = { polys: [], texts: [], uses: [] };
      blocks.set(attrs.id, target);
      stack.push({ m: local, stroke: color(attrs.stroke, UNSET), fill: color(attrs.fill, UNSET), layer: parent.layer, target, handle: null });
      continue;
    }

    const frame: Frame = { m: mul(parent.m, local), stroke: color(attrs.stroke, parent.stroke), fill: color(attrs.fill, parent.fill), layer: parent.layer, target: parent.target, handle: parent.handle };
    if (tag === "g") {
      if (attrs.id && !parent.target) {
        if (dropped.has(attrs.id)) { frame.stroke = NONE; frame.fill = NONE; }
        const name = layerOf[attrs.id];
        if (name !== undefined) { frame.layer = layer(name); frame.handle = attrs.id; }
      }
      stack.push(frame);
      continue;
    }

    if (tag === "line") {
      addPoly(frame, [+attrs.x1, +attrs.y1, +attrs.x2, +attrs.y2], false);
    } else if (tag === "circle" || tag === "ellipse") {
      const cx = +attrs.cx, cy = +attrs.cy, rx = +(attrs.rx ?? attrs.r), ry = +(attrs.ry ?? attrs.r);
      const pts: number[] = [];
      for (let i = 0; i < SEGMENTS; i++) { const a = (i / SEGMENTS) * Math.PI * 2; pts.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a)); }
      addPoly(frame, pts, true);
    } else if (tag === "path") {
      for (const [pts, closed] of parsePath(attrs.d ?? "", skipped)) addPoly(frame, pts, closed);
    } else if (tag === "use") {
      const href = (attrs.href ?? attrs["xlink:href"] ?? "").replace(/^#/, "");
      if (parent.target) parent.target.uses.push({ href, m: mul(parent.m, local), stroke: color(attrs.stroke, UNSET), fill: color(attrs.fill, UNSET) });
      else instantiate(href, frame.m, frame.stroke, frame.fill, frame.layer, frame.handle, 0);
    } else if (tag === "text") {
      const end = svg.indexOf("<", TAG.lastIndex);
      const str = decode(svg.slice(TAG.lastIndex, end < 0 ? svg.length : end)).trim();
      const anchor = attrs["text-anchor"] === "middle" ? 1 : attrs["text-anchor"] === "end" ? 2 : 0;
      const t: Txt = { m: parent.target ? frame.m : local, x: +attrs.x || 0, y: +attrs.y || 0, size: +attrs["font-size"] || 1, anchor, str, stroke: color(attrs.stroke, UNSET), fill: color(attrs.fill, UNSET) };
      if (parent.target) parent.target.texts.push(t);
      else emitText(t, parent.m, frame.stroke, frame.fill, frame.layer, frame.handle);
    } else {
      count(skipped, `tag:${tag}`);
    }
    // 닫는 태그가 따로 오는 도형(text 등)은 그때 pop된다.
    if (!selfClose) stack.push(frame);
  }

  const scene: Scene = {
    verts: Float64Array.from(verts),
    items: Int32Array.from(items),
    bounds: Float64Array.from(bounds),
    texts, colors, layers, fit: null, handleBounds, skipped,
  };
  scene.fit = fitBox(scene);
  return scene;
}

/** 경로 d → 폴리라인들. 절대·상대 M L H V Z A C Q를 다룬다. 곡선은 선분으로 편다. */
export function parsePath(d: string, skipped: Record<string, number>): [number[], boolean][] {
  const out: [number[], boolean][] = [];
  let pts: number[] = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  const flush = (closed: boolean) => { if (pts.length >= 4) out.push([pts, closed]); pts = []; };
  let cmd = "", buf: number[] = [];
  const run = () => {
    if (!cmd) return;
    const rel = cmd === cmd.toLowerCase();
    const c = cmd.toUpperCase();
    if (c === "Z") { flush(true); x = sx; y = sy; buf = []; return; }
    const need = c === "M" || c === "L" ? 2 : c === "H" || c === "V" ? 1 : c === "A" ? 7 : c === "C" ? 6 : 4;
    while (buf.length >= need) {
      const v = buf.splice(0, need);
      if (c === "M") {
        flush(false);
        x = rel ? x + v[0] : v[0]; y = rel ? y + v[1] : v[1]; sx = x; sy = y; pts.push(x, y);
        cmd = rel ? "l" : "L"; // M 뒤에 좌표가 더 오면 선이다
      } else if (c === "L") { x = rel ? x + v[0] : v[0]; y = rel ? y + v[1] : v[1]; pts.push(x, y); }
      else if (c === "H") { x = rel ? x + v[0] : v[0]; pts.push(x, y); }
      else if (c === "V") { y = rel ? y + v[0] : v[0]; pts.push(x, y); }
      else if (c === "A") {
        const ex = rel ? x + v[5] : v[5], ey = rel ? y + v[6] : v[6];
        if (!pts.length) pts.push(x, y);
        arc(pts, x, y, v[0], v[1], v[2], v[3] !== 0, v[4] !== 0, ex, ey);
        x = ex; y = ey;
      } else if (c === "C") {
        const p = rel ? [x + v[0], y + v[1], x + v[2], y + v[3], x + v[4], y + v[5]] : v;
        if (!pts.length) pts.push(x, y);
        for (let i = 1; i <= 16; i++) {
          const u = i / 16, w = 1 - u;
          pts.push(w * w * w * x + 3 * w * w * u * p[0] + 3 * w * u * u * p[2] + u * u * u * p[4], w * w * w * y + 3 * w * w * u * p[1] + 3 * w * u * u * p[3] + u * u * u * p[5]);
        }
        x = p[4]; y = p[5];
      } else {
        const p = rel ? [x + v[0], y + v[1], x + v[2], y + v[3]] : v;
        if (!pts.length) pts.push(x, y);
        for (let i = 1; i <= 12; i++) {
          const u = i / 12, w = 1 - u;
          pts.push(w * w * x + 2 * w * u * p[0] + u * u * p[2], w * w * y + 2 * w * u * p[1] + u * u * p[3]);
        }
        x = p[2]; y = p[3];
      }
    }
  };
  const re = /([MmLlHhVvZzAaCcQq])|(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/g;
  let t: RegExpExecArray | null;
  while ((t = re.exec(d))) {
    if (t[1]) {
      run();
      if (buf.length) count(skipped, "path:args");
      buf = []; cmd = t[1];
      if (cmd === "Z" || cmd === "z") run();
    } else buf.push(Number(t[2]));
  }
  run();
  flush(false);
  return out;
}

/** SVG 끝점식 타원호 → 선분. 표준 변환(SVG 1.1 F.6.5) 그대로다. 시작점은 이미 pts에 있다. */
function arc(pts: number[], x1: number, y1: number, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, x2: number, y2: number) {
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry || (x1 === x2 && y1 === y2)) { pts.push(x2, y2); return; }
  const phi = (phiDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = den ? Math.sqrt(Math.max(0, num / den)) : 0;
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry, cyp = (-coef * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
  const th1 = ang(1, 0, ux, uy);
  let dth = ang(ux, uy, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dth > 0) dth -= Math.PI * 2;
  else if (sweep && dth < 0) dth += Math.PI * 2;
  const n = Math.max(2, Math.ceil((Math.abs(dth) / (Math.PI * 2)) * SEGMENTS));
  for (let i = 1; i <= n; i++) {
    const th = th1 + (dth * i) / n, ex = rx * Math.cos(th), ey = ry * Math.sin(th);
    pts.push(cp * ex - sp * ey + cx, sp * ex + cp * ey + cy);
  }
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/**
 * 변환기가 준 viewBox는 못 쓴다. 도면에서 한참 떨어진 엔티티 하나가 끼면 전체가 수백만 단위로 늘어나
 * 도면이 점이 된다. 엔티티 상자들의 중앙값에서 멀리 떨어진 것만 버리고 나머지를 감싼다(중앙값 절대편차).
 * 비율로 자르면 외곽 도면틀이 잘리므로 거리로만 판정한다.
 */
export function fitBox(scene: Scene): Box | null {
  const boxes: Box[] = [];
  for (let i = 0; i < scene.items.length / ITEM; i++) {
    const w = scene.bounds[i * 4 + 2] - scene.bounds[i * 4], h = scene.bounds[i * 4 + 3] - scene.bounds[i * 4 + 1];
    if (w || h) boxes.push({ x: scene.bounds[i * 4], y: scene.bounds[i * 4 + 1], w, h });
  }
  for (const t of scene.texts) {
    const px = t.m[0] * t.x + t.m[2] * t.y + t.m[4], py = t.m[1] * t.x + t.m[3] * t.y + t.m[5];
    const s = t.size * Math.hypot(t.m[0], t.m[1]);
    boxes.push({ x: px - s, y: py - s, w: s * 2, h: s * 2 });
  }
  if (!boxes.length) return null;
  const cx = median(boxes.map((b) => b.x + b.w / 2)), cy = median(boxes.map((b) => b.y + b.h / 2));
  const spread = median(boxes.map((b) => Math.abs(b.x + b.w / 2 - cx) + Math.abs(b.y + b.h / 2 - cy)));
  const typical = median(boxes.map((b) => Math.max(b.w, b.h)));
  const limit = Math.max(spread, typical) * 20;
  const keep = boxes.filter((b) => Math.abs(b.x + b.w / 2 - cx) + Math.abs(b.y + b.h / 2 - cy) <= limit);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of keep) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  const w = x1 - x0, h = y1 - y0;
  if (!(w > 0 && h > 0)) return null;
  const pad = Math.max(w, h) * 0.03;
  return { x: x0 - pad, y: y0 - pad, w: w + pad * 2, h: h + pad * 2 };
}
