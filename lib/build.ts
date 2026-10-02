/**
 * 도면 데이터(libredwg-web의 `convert` 결과) → 장면. 라이브러리의 SVG 변환기는 글자 회전·폭, 블록 속성,
 * 해치·SOLID·지시선, 선종류, 꺼진 레이어를 다루지 않고 밖에서 고칠 길도 없어서, 엔티티를 직접 읽는다.
 * 블록은 한 번만 풀어 두고(Proto) 삽입될 때마다 행렬을 곱해 찍는다.
 */
import { ACI } from "./aci";
import { bspline, bulgeArc, ccw, hatchLines, ribbon, smooth, sweep, type P } from "./geom";
import { F_CLOSED, F_FILL, fitBox, mul, type Drawing, type Ent, type Mat, type Scene, type Sheet, type Style, type TextItem, type Viewport } from "./scene";
import type { SatResult } from "./sat";
import { mtext, plain, roughWidth, unmangle } from "./text";

// 라이브러리의 엔티티 타입은 종류마다 필드가 달라, 여기서는 느슨하게 읽고 쓰는 필드만 확인한다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type E = { type: string; [key: string]: any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Rec = { name?: string; handle?: string; basePoint?: P; entities?: E[] };
export type BuildOpts = {
  /** 입체(3DSOLID 등) handle → ACIS에서 뽑은 모서리. 2D에서는 위에서 본 모양으로 그린다. */
  solids?: Map<string, SatResult>;
  /** 글자 폭(em 단위). 있으면 MTEXT를 상자 폭에 맞춰 줄바꿈한다. */
  measure?: (s: string) => number;
};
export type Db = {
  header?: Record<string, unknown>;
  tables?: { BLOCK_RECORD?: { entries?: Rec[] }; LAYER?: { entries?: Row[] }; LTYPE?: { entries?: Row[] } };
  objects?: { LAYOUT?: Row[] };
};

/** 도면의 글자 높이는 대문자 높이다. 화면 글꼴의 em은 그보다 크다(Arial·Helvetica 기준 0.72). */
const CAP = 0.72;
/** DWG 선굵기 번호 → 1/100 mm */
const LW = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
const DEFAULT_LW = 0.25;
const UNITS: Record<number, string> = { 1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m", 7: "km" };
const BYLAYER = -1, BYBLOCK = -2;
const FLIP_Y: Mat = [1, 0, 0, -1, 0, 0], FLIP_X: Mat = [-1, 0, 0, 1, 0, 0];
/** 구조용 엔티티. 한없이 긴 보조선(RAY·XLINE)도 안 그리지만 그건 "그리지 못함"에 센다. */
const SILENT = new Set(["VERTEX", "SEQEND"]);

type Attr = { layer: number; color: number; lt: number; lw: number; lts: number };
type Poly = { pts: number[]; closed: boolean; fill: boolean; ww: number; a: Attr };
type Txt = Pick<TextItem, "m" | "size" | "xs" | "w" | "anchor" | "str"> & { a: Attr };
type Use = { name: string; m: Mat; a: Attr };
type Proto = { polys: Poly[]; texts: Txt[]; uses: Use[] };
/** 블록을 찍을 때 물려받는 것. frozen은 동결된 삽입 레이어(없으면 -1): 그 안의 것은 전부 그 레이어와 함께 숨는다. */
type Ctx = { layer: number; color: number; lt: number; lw: number; frozen: number };

const css = (rgb: number) => `#${(rgb & 0xffffff).toString(16).padStart(6, "0")}`;
const xy = (p: P) => [p.x, p.y];
const flipped = (e: E) => e.extrusionDirection?.z < 0;

export function buildDrawing(db: Db, opts: BuildOpts = {}): Drawing {
  const measure = opts.measure ?? roughWidth;
  const header = db.header ?? {};
  const num = (k: string, d: number) => (typeof header[k] === "number" && header[k] ? (header[k] as number) : d);
  const ltscale = num("LTSCALE", 1), arrowSize = num("DIMASZ", 2.5) * num("DIMSCALE", 1), dimText = num("DIMTXT", 2.5) * num("DIMSCALE", 1);
  const skipped: Record<string, number> = {};
  const skip = (k: string) => { skipped[k] = (skipped[k] ?? 0) + 1; };

  // "fg"가 0번: 배경에 따라 바뀌는 색(ACI 7)이고, 아무것도 지정되지 않았을 때의 색이기도 하다.
  const colors = ["fg"], colorIdx = new Map([["fg", 0]]);
  const color = (v: string) => { let i = colorIdx.get(v); if (i === undefined) { i = colors.length; colors.push(v); colorIdx.set(v, i); } return i; };
  const aci = (ci: number, rgb?: number) => (rgb != null && rgb !== ACI[ci] ? color(css(rgb)) : ci === 7 ? 0 : color(css(ACI[ci])));

  // 선종류: 0번이 실선. 무늬는 선·빈칸 길이가 번갈아 온다(0은 점). 글자 요소("HW" 같은 것)는 빈칸이고 따로 적어 둔다.
  type LtText = { str: string; h: number; at: number; dx: number; dy: number; rot: number; abs: boolean; upright: boolean };
  const dashes: (number[] | null)[] = [null], ltTexts: LtText[][] = [[]], dashIdx = new Map<string, number>();
  for (const l of db.tables?.LTYPE?.entries ?? []) {
    const p: number[] = [], texts: LtText[] = [];
    let at = 0;
    for (const x of (l.pattern ?? []) as Row[]) {
      const sym = !!(x.elementTypeFlag & 6); // 글자·도형 요소는 빈칸이고, 길이 0이면 정말 0이다(점이 아니다)
      const len = Math.abs(x.elementLength) || (sym ? 0 : (l.totalPatternLength || 1) * 0.02), gap = x.elementLength < 0 || sym;
      if (x.elementTypeFlag & 2 && x.text) texts.push({ str: plain(x.text), h: x.scale || 1, at, dx: x.offsetX || 0, dy: x.offsetY || 0, rot: x.rotation || 0, abs: !!(x.elementTypeFlag & 1), upright: !!(x.elementTypeFlag & 8) });
      if (p.length === 0 && gap) p.push(0);
      // 짝수 칸이 선, 홀수 칸이 빈칸. 같은 종류가 이어지면 하나로 합친다.
      const lastIsDash = p.length % 2 === 1, lastIsGap = p.length > 0 && !lastIsDash;
      if (gap ? lastIsGap : lastIsDash) p[p.length - 1] += len; else p.push(len);
      at += len;
    }
    if (p.length % 2) p.push(0);
    if (p.length >= 2 && at > 0) { dashIdx.set(String(l.name).toUpperCase(), dashes.length); dashes.push(p); ltTexts.push(texts); }
  }
  const ltOf = (name: unknown) => {
    const n = String(name ?? "").toUpperCase();
    return !n || n === "BYLAYER" ? BYLAYER : n === "BYBLOCK" ? BYBLOCK : (dashIdx.get(n) ?? 0);
  };
  const lwOf = (v: unknown, inherit: boolean) => (v === 29 && inherit ? BYLAYER : v === 30 && inherit ? BYBLOCK : typeof v === "number" && v >= 0 && v < LW.length ? LW[v] / 100 : DEFAULT_LW);

  type LayerRow = Drawing["layers"][number] & { ci: number; lt: number; lw: number; frozen: boolean };
  const layers: LayerRow[] = [], layerIdx = new Map<string, number>();
  const addLayer = (name: string, l?: Row) => {
    const ci = Math.abs(l?.colorIndex ?? 7);
    const c = ci >= 1 && ci <= 255 ? aci(ci) : l?.color != null ? color(css(l.color)) : 0;
    const lt = l ? ltOf(l.lineType) : 0;
    layerIdx.set(name, layers.length);
    layers.push({ name, color: colors[c], off: !!(l?.off || l?.frozen), used: false, ci: c, lt: lt < 0 ? 0 : lt, lw: lwOf(l?.lineweight, false), frozen: !!l?.frozen });
    return layers.length - 1;
  };
  for (const l of db.tables?.LAYER?.entries ?? []) if (!layerIdx.has(l.name)) addLayer(l.name, l);
  const layer = (name: string) => layerIdx.get(name) ?? addLayer(name);
  const L0 = layer("0");

  const attr = (e: E): Attr => {
    const ci = e.colorIndex;
    return {
      layer: layer(e.layer ?? "0"),
      color: ci === 0 ? BYBLOCK : ci >= 1 && ci <= 255 ? aci(ci, e.color) : ci == null && e.color != null ? color(css(e.color)) : BYLAYER,
      lt: ltOf(e.lineType),
      lw: lwOf(e.lineweight, true),
      lts: e.lineTypeScale || 1,
    };
  };

  const records = db.tables?.BLOCK_RECORD?.entries ?? [];
  const byName = new Map(records.filter((r) => r.name).map((r) => [r.name!, r]));

  // ── 엔티티 → 원시 도형 ───────────────────────────────────────────────

  /** 글자 로컬(x 오른쪽, y 아래) → 도면. p에서 rot만큼 돌리고, 로컬 (x, y)만큼 옮긴 자리가 원점이다. */
  const textMat = (p: P, rot: number, x = 0, y = 0): Mat => {
    const c = Math.cos(rot), s = Math.sin(rot);
    return [c, s, s, -c, p.x + c * x + s * y, p.y + s * x - c * y];
  };

  /** TEXT·ATTRIB·ATTDEF 공통. 정렬된 글자는 파일에 든 시작점(기준선 왼쪽 끝)과 정렬점에서 실제 폭을 알아낸다. */
  const textPrim = (t: E, str: string, a: Attr, out: Proto) => {
    const h = t.textHeight;
    str = plain(str ?? "").trim();
    if (!str || !(h > 0) || !t.startPoint) return;
    const s: P = t.startPoint, e: P | undefined = t.endPoint, ha = t.halign | 0, va = t.valign | 0;
    const xs = t.xScale > 0 ? t.xScale : 1;
    let rot = t.rotation || 0, w = 0, p = s, anchor: 0 | 1 | 2 = 0, down = 0;
    if ((ha || va) && e && (e.x || e.y)) {
      if (ha === 3 || ha === 5) { // 두 점 사이에 맞춘 글자: 두 점이 기준선의 양 끝이다
        rot = Math.atan2(e.y - s.y, e.x - s.x);
        w = Math.hypot(e.x - s.x, e.y - s.y);
      } else if (s.x !== e.x || s.y !== e.y) {
        const along = (e.x - s.x) * Math.cos(rot) + (e.y - s.y) * Math.sin(rot);
        const rough = (roughWidth(str) * h * xs) / CAP;
        w = ha === 1 || ha === 4 ? along * 2 : ha === 2 ? along : 0;
        if (w < rough * 0.3 || w > rough * 3) w = 0; // 말이 안 되는 폭이면 버리고 글꼴 폭대로 그린다
      } else { // 시작점이 정렬점과 같은(다른 프로그램이 쓴) 파일: 정렬점을 기준으로 놓는다
        p = e;
        anchor = ha === 2 ? 2 : ha === 0 ? 0 : 1;
        down = va === 3 ? h : va === 2 || ha === 4 ? h / 2 : va === 1 ? -0.2 * h : 0;
      }
    }
    const m = textMat(p, rot, 0, down);
    out.texts.push({ m: flipped(t) ? mul(FLIP_X, m) : m, size: h / CAP, xs, w, anchor, str, a });
  };

  /**
   * 상자 폭(em 단위)에 맞춰 줄을 나눈다. 띄어쓰기에서 끊되 줄 끝 공백은 폭에 안 센다. 한 단어가 폭보다 길면
   * 한중일 글자만 글자 단위로 끊고, 라틴 단어("2,700,000kcal/hr")는 넘치게 둔다 — 글꼴 폭 차이로 AutoCAD에선
   * 들어가는 단어를 우리가 중간에서 자르는 쪽이 더 보기 나쁘다.
   */
  const wrap = (line: string, maxEm: number): string[] => {
    if (!(maxEm > 0) || measure(line) <= maxEm * 1.02) return [line];
    const out: string[] = [];
    let cur = "";
    for (const word of line.split(/(?<= )/)) {
      if (cur && measure((cur + word).trimEnd()) > maxEm) { out.push(cur.trimEnd()); cur = ""; }
      if (measure(word.trimEnd()) > maxEm && /[\u2e80-\uffff]/.test(word)) { // 한중일 긴 단어: 글자 단위
        for (const ch of word) { if (cur && measure(cur + ch) > maxEm) { out.push(cur.trimEnd()); cur = ""; } cur += ch; }
      } else cur += word;
    }
    if (cur.trim()) out.push(cur.trimEnd());
    return out.length ? out : [line];
  };

  const mtextPrim = (raw: string, at: P, h: number, rot: number, attach: number, spacing: number, rectWidth: number, a: Attr, out: Proto) => {
    if (!(h > 0) || !at) return;
    const mt = mtext(raw ?? "");
    if (rectWidth > 0) mt.lines = mt.lines.flatMap((l) => wrap(l, (rectWidth / (h / CAP)) / (mt.width || 1)));
    while (mt.lines.length && !mt.lines[mt.lines.length - 1]) mt.lines.pop();
    const n = mt.lines.length;
    if (!n) return;
    const col = (((attach || 1) - 1) % 3) as 0 | 1 | 2, row = Math.floor(((attach || 1) - 1) / 3);
    const gap = (h * 5 / 3) * (spacing > 0 ? spacing : 1), height = h + (n - 1) * gap;
    // 첫 줄 기준선의 높이(부착점 기준, 위가 +)
    const first = row === 0 ? -h : row === 1 ? height / 2 - h : height - h;
    let anchor = col, x = 0;
    if (mt.align !== null && mt.align !== col && rectWidth > 0) { // 상자 안에서 문단만 따로 정렬된 경우
      anchor = mt.align;
      x = (col === 0 ? 0 : col === 1 ? -rectWidth / 2 : -rectWidth) + (mt.align * rectWidth) / 2;
    }
    mt.lines.forEach((str, i) => {
      if (str) out.texts.push({ m: textMat(at, rot, x, -(first - i * gap)), size: h / CAP, xs: mt.width, w: 0, anchor, str, a });
    });
  };

  /** from에서 tip으로 가는 선 끝의 화살촉 */
  const arrow = (tip: P, from: P, size: number, a: Attr, out: Proto) => {
    const d = Math.hypot(from.x - tip.x, from.y - tip.y);
    if (!(size > 0) || d < size * 2) return; // 선이 화살촉보다 짧으면 AutoCAD도 그리지 않는다
    const ux = (from.x - tip.x) / d, uy = (from.y - tip.y) / d, bx = tip.x + ux * size, by = tip.y + uy * size, n = size / 6;
    out.polys.push({ pts: [tip.x, tip.y, bx - uy * n, by + ux * n, bx + uy * n, by - ux * n], closed: true, fill: true, ww: 0, a });
  };

  /** 굴곡(bulge)과 폭이 있는 폴리라인. 폭이 일정하면 굵은 선 하나로, 변하면 구간마다 면으로 그린다. */
  const pline = (vs: E[], closed: boolean, constant: number, a: Attr, out: Proto, flip: boolean) => {
    const n = vs.length, segs = closed ? n : n - 1;
    if (n < 2) return;
    const fx = flip ? -1 : 1;
    const seg = (i: number) => { const p = vs[i], q = vs[(i + 1) % n]; return bulgeArc(p.x * fx, p.y, q.x * fx, q.y, (p.bulge || 0) * fx); };
    const w0 = (i: number) => constant || vs[i].startWidth || 0, w1 = (i: number) => constant || vs[i].endWidth || 0;
    let uniform = true;
    for (let i = 0; i < segs; i++) if (w0(i) !== w0(0) || w1(i) !== w0(0)) { uniform = false; break; }
    if (uniform) {
      const pts: number[] = [];
      for (let i = 0; i < segs; i++) { const s = seg(i); pts.push(...(i ? s.slice(2) : s)); }
      if (closed) pts.length -= 2;
      out.polys.push({ pts, closed, fill: false, ww: w0(0), a });
      return;
    }
    for (let i = 0; i < segs; i++) {
      if (w0(i) || w1(i)) out.polys.push({ pts: ribbon(seg(i), w0(i), w1(i)), closed: true, fill: true, ww: 0, a });
      else out.polys.push({ pts: seg(i), closed: false, fill: false, ww: 0, a });
    }
  };

  const hatchLoops = (e: E): number[][] => {
    const loops: number[][] = [];
    for (const path of e.boundaryPaths ?? []) {
      if (!path) continue;
      let pts: number[] = [];
      if (path.vertices) {
        const vs: E[] = path.vertices;
        for (let i = 0; i < vs.length; i++) { const q = vs[(i + 1) % vs.length]; pts.push(...bulgeArc(vs[i].x, vs[i].y, q.x, q.y, vs[i].bulge || 0).slice(0, -2)); }
      } else {
        for (const g of (path.edges ?? []) as E[]) {
          if (!g) continue;
          const kind = g.type as unknown as number; // 1 선, 2 호, 3 타원호, 4 스플라인
          if (kind === 1) pts.push(g.start.x, g.start.y, g.end.x, g.end.y);
          else if (kind === 2 || kind === 3) {
            // 시계 방향 호는 각도가 뒤집혀 저장된다
            const span = ccw(g.startAngle, g.endAngle), t0 = g.isCCW ? g.startAngle : -g.startAngle, dt = g.isCCW ? span : -span;
            if (kind === 2) pts.push(...sweep(g.center.x, g.center.y, g.radius, 0, 0, g.radius, t0, dt));
            else pts.push(...sweep(g.center.x, g.center.y, g.end.x, g.end.y, -g.end.y * g.lengthOfMinorAxis, g.end.x * g.lengthOfMinorAxis, t0, dt));
          } else if (kind === 4) {
            pts.push(...(bspline(g.controlPoints ?? [], g.degree, g.knots ?? []) ?? (g.fitDatum?.length >= 2 ? smooth(g.fitDatum) : [])));
          }
        }
      }
      if (flipped(e)) for (let i = 0; i < pts.length; i += 2) pts[i] = -pts[i];
      if (pts.length >= 6) loops.push(pts);
    }
    return loops;
  };

  /** 필드가 빠진 엔티티 하나가 도면 전체를 막지 않게, 한 엔티티씩 감싼다. */
  const convert = (e: E, out: Proto, inBlock: boolean) => {
    try { convertOne(e, out, inBlock); } catch { skip(`${e.type}:bad`); }
  };

  const convertOne = (e: E, out: Proto, inBlock: boolean) => {
    if (e.isVisible === false) return;
    const a = attr(e), fx = flipped(e) ? -1 : 1;
    const poly = (pts: number[], closed = false, fill = false, ww = 0) => { if (pts.length >= 4) out.polys.push({ pts, closed, fill, ww, a }); };
    switch (e.type) {
      case "LINE": poly([...xy(e.startPoint), ...xy(e.endPoint)]); break;
      case "CIRCLE": poly(sweep(e.center.x * fx, e.center.y, e.radius, 0, 0, e.radius, 0, Math.PI * 2, true), true); break;
      case "ARC": {
        const pts = sweep(e.center.x, e.center.y, e.radius, 0, 0, e.radius, e.startAngle, ccw(e.startAngle, e.endAngle));
        if (fx < 0) for (let i = 0; i < pts.length; i += 2) pts[i] = -pts[i];
        poly(pts);
        break;
      }
      case "ELLIPSE": { // 중심과 장축은 도면 좌표 그대로다. 법선이 뒤집혀 있으면 도는 방향만 반대다.
        const M: P = e.majorAxisEndPoint, r = e.axisRatio * fx, span = ccw(e.startAngle, e.endAngle), full = Math.abs(span - Math.PI * 2) < 1e-9;
        poly(sweep(e.center.x, e.center.y, M.x, M.y, -M.y * r, M.x * r, e.startAngle, span, full), full);
        break;
      }
      case "LWPOLYLINE": pline(e.vertices ?? [], !!(e.flag & 0x200), e.constantWidth || 0, a, out, fx < 0); break;
      case "POLYLINE2D": // 곡선 맞춤 폴리라인의 원래 조절점(16)은 그리지 않는다
        pline((e.vertices ?? []).filter((v: E) => !(v.flag & 16)), !!(e.flag & 1), 0, a, out, fx < 0);
        break;
      case "POLYLINE3D": poly((e.vertices ?? []).flatMap(xy), !!(e.flag & 1)); break;
      case "3DFACE": poly([e.corner1, e.corner2, e.corner3, e.corner4 ?? e.corner3].flatMap(xy), true); break;
      case "SPLINE": {
        const cp: P[] = e.controlPoints ?? [], fit: P[] = e.fitPoints ?? [], closed = !!(e.flag & 1);
        poly(bspline(cp, e.degree, e.knots ?? [], e.weights?.length === cp.length ? e.weights : undefined)
          ?? (fit.length >= 2 ? smooth(fit, closed) : cp.flatMap(xy)));
        break;
      }
      case "SOLID": case "TRACE": {
        const pts = [e.corner1, e.corner2, e.corner4 ?? e.corner3, e.corner3].flatMap(xy);
        if (fx < 0) for (let i = 0; i < pts.length; i += 2) pts[i] = -pts[i];
        poly(pts, true, true);
        break;
      }
      case "HATCH": {
        const loops = hatchLoops(e);
        if (!loops.length) break;
        if (e.solidFill || e.gradientFlag) {
          // 구멍 난 면을 한 도형으로: 각 고리를 돌고 첫 점으로 돌아오면 짝홀 규칙에서 오가는 길은 상쇄된다.
          const pts = [...loops[0]];
          for (const l of loops.slice(1)) pts.push(...l, l[0], l[1], loops[0][0], loops[0][1]);
          poly(pts, true, true);
        } else {
          // 법선이 뒤집힌 해치는 경계처럼 무늬도 거울상이다
          const defs = (e.definitionLines ?? []).map((d: E) => (fx < 0 ? { ...d, angle: Math.PI - d.angle, base: { x: -d.base.x, y: d.base.y }, offset: { x: -d.offset.x, y: d.offset.y } } : d));
          const lines = hatchLines(loops, defs);
          if (!lines) skip("HATCH:dense");
          for (const l of lines ?? []) poly(l);
        }
        break;
      }
      case "INSERT": {
        const rec = byName.get(e.name);
        if (!rec) { skip("INSERT:missing"); break; }
        const b = rec.basePoint ?? { x: 0, y: 0 }, c = Math.cos(e.rotation || 0), s = Math.sin(e.rotation || 0);
        const sx = e.xScale ?? 1, sy = e.yScale ?? 1, at: P = e.insertionPoint;
        for (let r = 0; r < (e.rowCount || 1); r++) for (let k = 0; k < (e.columnCount || 1); k++) {
          const ox = k * (e.columnSpacing || 0) - sx * b.x, oy = r * (e.rowSpacing || 0) - sy * b.y;
          const m: Mat = [c * sx, s * sx, -s * sy, c * sy, at.x + c * ox - s * oy, at.y + s * ox + c * oy];
          out.uses.push({ name: e.name, m: fx < 0 ? mul(FLIP_X, m) : m, a });
        }
        for (const t of (e.attribs ?? []) as E[]) if (!(t.flags & 1) && t.isVisible !== false && t.text) textPrim(t.text, t.text.text, attr(t), out);
        break;
      }
      case "DIMENSION": case "ACAD_TABLE": case "TABLE":
        // 치수와 표는 파일 안에 그림(익명 블록)이 같이 들어 있다.
        if (byName.has(e.name)) out.uses.push({ name: e.name, m: [1, 0, 0, 1, 0, 0], a });
        else if (e.type !== "DIMENSION" && e.cells?.length >= e.rowCount * e.columnCount) table(e, a, out);
        else skip(`${e.type}:noblock`);
        break;
      case "TEXT": textPrim(e, e.text, a, out); break;
      case "ATTRIB": if (!(e.flags & 1) && e.text) textPrim(e.text, e.text.text, a, out); break;
      case "ATTDEF": // 블록 밖에서는 태그 이름이 보이고, 블록 안에서는 고정값(2)만 그대로 찍힌다
        if (e.text && !(e.flags & 1) && (!inBlock || e.flags & 2)) textPrim(e.text, inBlock ? e.text.text : e.tag, a, out);
        break;
      case "MTEXT": {
        const d = e.direction, rot = d && (d.x || d.y) ? Math.atan2(d.y, d.x) : e.rotation || 0;
        mtextPrim(e.text, e.insertionPoint, e.textHeight, rot, e.attachmentPoint, e.lineSpacing, e.rectWidth, a, out);
        break;
      }
      case "LEADER": {
        const vs: P[] = e.vertices ?? [];
        if (vs.length < 2) break;
        poly(e.isSpline ? smooth(vs) : vs.flatMap(xy));
        if (e.isArrowheadEnabled) arrow(vs[0], vs[1], arrowSize, a, out);
        break;
      }
      case "MULTILEADER": {
        for (const sec of (e.leaderSections ?? []) as E[]) {
          const land: P | undefined = sec.lastLeaderLinePointSet ? sec.lastLeaderLinePoint : undefined;
          for (const line of (sec.leaderLines ?? []) as E[]) {
            const vs: P[] = [...(line.vertices ?? []), ...(land ? [land] : [])];
            poly(vs.flatMap(xy));
            if (vs.length >= 2) arrow(vs[0], vs[1], e.arrowheadSize, a, out);
          }
          if (land && e.doglegEnabled && sec.doglegVectorSet) poly([land.x, land.y, land.x + sec.doglegVector.x * sec.doglegLength, land.y + sec.doglegVector.y * sec.doglegLength]);
        }
        if (e.hasMText && e.textContent) {
          const d = e.textDirection, rot = d && (d.x || d.y) ? Math.atan2(d.y, d.x) : e.textRotation || 0;
          mtextPrim(unmangle(e.textContent), e.textAnchor, e.textHeight, rot, e.textAttachmentPoint, e.textLineSpacingFactor, e.textWidth, a, out);
        }
        break;
      }
      case "MLINE": {
        const vs: E[] = e.vertices ?? [];
        for (let i = 0; i < (e.numberOfLines || 0); i++) {
          poly(vs.flatMap((v) => { const d = v.lines?.[i]?.segmentParams?.[0] ?? 0; return [v.vertex.x + v.miterDirection.x * d, v.vertex.y + v.miterDirection.y * d]; }), !!(e.flags & 2));
        }
        break;
      }
      case "3DSOLID": { // 입체는 위에서 본 모서리만
        const sat = opts.solids?.get(e.handle);
        if (!sat || !sat.lines.length) { skip(e.type); break; }
        for (const l of sat.lines) { const pts: number[] = []; for (let i = 0; i < l.length; i += 3) pts.push(l[i], l[i + 1]); poly(pts); }
        break;
      }
      case "TOLERANCE": { // 기하공차 기호 글꼴(gdt)은 없으므로 칸 구분만 살려 글자로 보여준다
        const d = e.xAxisDirection, str = String(e.text ?? "").replace(/\{\\F[^;]*;([^}]*)\}/gi, "$1").replace(/%%v/gi, " | ").replace(/\n|\^J/g, "\\P");
        mtextPrim(str, e.insertionPoint, dimText, d ? Math.atan2(d.y, d.x) : 0, 4, 1, 0, a, out);
        break;
      }
      default:
        if (!SILENT.has(e.type) && e.type !== "VIEWPORT") skip(e.type);
    }
  };

  /** 그림 블록이 없는 표: 칸 테두리와 글자를 직접 그린다. 행은 시작점에서 아래로 내려간다. */
  const table = (e: E, a: Attr, out: Proto) => {
    let y = e.startPoint.y;
    for (let r = 0; r < e.rowCount; r++) {
      const h = e.rowHeightArr[r];
      let x = e.startPoint.x;
      for (let c = 0; c < e.columnCount; c++) {
        const w = e.columnWidthArr[c], cell = e.cells[r * e.columnCount + c];
        if (cell.topBorderVisibility) out.polys.push({ pts: [x, y, x + w, y], closed: false, fill: false, ww: 0, a });
        if (cell.bottomBorderVisibility) out.polys.push({ pts: [x, y - h, x + w, y - h], closed: false, fill: false, ww: 0, a });
        if (cell.leftBorderVisibility) out.polys.push({ pts: [x, y, x, y - h], closed: false, fill: false, ww: 0, a });
        if (cell.rightBorderVisibility) out.polys.push({ pts: [x + w, y, x + w, y - h], closed: false, fill: false, ww: 0, a });
        if (cell.text) mtextPrim(cell.text, { x: x + w / 2, y: y - h / 2 }, cell.textHeight, 0, 5, 1, 0, a, out);
        x += w;
      }
      y -= h;
    }
  };

  const protos = new Map<string, Proto | null>();
  const proto = (name: string) => {
    let p = protos.get(name);
    if (p === undefined) {
      const rec = byName.get(name);
      p = rec ? { polys: [], texts: [], uses: [] } : null;
      if (p) for (const e of rec!.entities ?? []) convert(e, p, true);
      protos.set(name, p);
    }
    return p;
  };

  // ── 원시 도형 → 장면 배열 ─────────────────────────────────────────────

  const styles: Style[] = [], styleIdx = new Map<string, number>();
  /** 점선 배율은 두 자리로 반올림해 스타일 수를 줄인다. 선 위 글자도 같은 값을 써야 빈칸에 맞는다. */
  const quant = (scale: number) => +scale.toPrecision(2);
  const style = (c: number, lt: number, scale: number, lw: number, ww: number) => {
    const k = lt > 0 ? quant(scale) : 0;
    ww = +ww.toPrecision(3);
    const key = `${c}|${lt}|${k}|${lw}|${ww}`;
    let i = styleIdx.get(key);
    if (i === undefined) { i = styles.length; styles.push({ color: c, dash: lt > 0 ? dashes[lt]!.map((d) => d * k) : null, lw, ww }); styleIdx.set(key, i); }
    return i;
  };

  /** 선종류의 글자 요소("HW")를 선을 따라 무늬 주기마다 놓는다. 장면 좌표(y 아래)를 받아 도면 방향으로 돌려 계산한다. */
  const alongLine = (verts: number[], start: number, n: number, closed: boolean, texts: LtText[], dash: number[], k: number) => {
    const out: Omit<TextItem, "color" | "layer" | "ent">[] = [];
    const period = dash.reduce((a, b) => a + b, 0) * k;
    if (!(period > 0)) return out;
    let total = 0;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) { const a = (start + i) * 2, b = (start + ((i + 1) % n)) * 2; total += Math.hypot(verts[b] - verts[a], verts[b + 1] - verts[a + 1]); }
    if (total / period > 2000) return out;
    let done = 0;
    for (let i = 0; i < segs; i++) {
      const a = (start + i) * 2, b = (start + ((i + 1) % n)) * 2;
      const dx = verts[b] - verts[a], dy = -(verts[b + 1] - verts[a + 1]), len = Math.hypot(dx, dy); // 도면 방향(y 위)
      if (!len) continue;
      const ux = dx / len, uy = dy / len, ang = Math.atan2(uy, ux);
      for (const t of texts) {
        for (let d = Math.ceil((done - t.at * k) / period) * period + t.at * k; d < done + len; d += period) {
          if (d < done) continue;
          const s = d - done, px = verts[a] + ux * s, py = -verts[a + 1] + uy * s; // 도면 좌표
          // U(바로 세움) 요소는 오른쪽에서 왼쪽으로 가는 선에서 거꾸로 서지 않게 180° 돌린다
          const flip = t.upright && !t.abs && Math.cos(ang) < -1e-9;
          const m = textMat({ x: px + ux * t.dx * k - uy * t.dy * k, y: py + uy * t.dx * k + ux * t.dy * k }, (t.abs ? 0 : flip ? ang + Math.PI : ang) + t.rot);
          out.push({ m: mul(FLIP_Y, m), size: (t.h * k) / CAP, xs: 1, w: 0, aw: roughWidth(t.str) * ((t.h * k) / CAP), anchor: 0, str: t.str });
        }
      }
      done += len;
    }
    return out;
  };

  const buildScene = (entities: E[], ports: Viewport[] | null): Scene => {
    const verts: number[] = [], items: number[] = [], bounds: number[] = [], texts: TextItem[] = [], ents: Ent[] = [];

    const resolve = (a: Attr, c: Ctx, depth: number) => {
      const own = depth > 0 && a.layer === L0 ? c.layer : a.layer, L = layers[own];
      return {
        own,
        layer: c.frozen >= 0 ? c.frozen : own,
        color: a.color === BYBLOCK ? c.color : a.color === BYLAYER ? L.ci : a.color,
        lt: a.lt === BYBLOCK ? c.lt : a.lt === BYLAYER ? L.lt : a.lt,
        lw: a.lw === BYBLOCK ? c.lw : a.lw === BYLAYER ? L.lw : a.lw,
      };
    };

    const emit = (p: Proto, m: Mat, c: Ctx, depth: number, ent: number) => {
      const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      for (const q of p.polys) {
        const r = resolve(q.a, c, depth), start = verts.length / 2, ww = q.ww * k;
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (let i = 0; i < q.pts.length; i += 2) {
          const x = m[0] * q.pts[i] + m[2] * q.pts[i + 1] + m[4], y = m[1] * q.pts[i] + m[3] * q.pts[i + 1] + m[5];
          verts.push(x, y);
          if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        }
        if (!Number.isFinite(minx + miny + maxx + maxy)) { verts.length = start * 2; skip("nan"); continue; }
        const st = q.fill ? style(r.color, 0, 1, 0, 0) : style(r.color, r.lt, ltscale * q.a.lts * k, r.lw, ww);
        items.push(start, q.pts.length / 2, st, r.layer, (q.closed ? F_CLOSED : 0) | (q.fill ? F_FILL : 0), ent);
        bounds.push(minx - ww / 2, miny - ww / 2, maxx + ww / 2, maxy + ww / 2);
        layers[r.layer].used = true;
        if (!q.fill && r.lt > 0 && ltTexts[r.lt].length) {
          for (const t of alongLine(verts, start, q.pts.length / 2, q.closed, ltTexts[r.lt], dashes[r.lt]!, quant(ltscale * q.a.lts * k))) texts.push({ ...t, color: r.color, layer: r.layer, ent });
        }
      }
      for (const t of p.texts) {
        const r = resolve(t.a, c, depth), tm = mul(m, t.m);
        if (!tm.every(Number.isFinite)) { skip("nan"); continue; }
        texts.push({ m: tm, size: t.size, xs: t.xs, w: t.w, aw: roughWidth(t.str) * t.size * t.xs, anchor: t.anchor, str: t.str, color: r.color, layer: r.layer, ent });
        layers[r.layer].used = true;
      }
      for (const u of p.uses) {
        const child = proto(u.name);
        if (!child) continue;
        if (depth >= 8) { skip("INSERT:deep"); continue; }
        const r = resolve(u.a, c, depth);
        emit(child, mul(m, u.m), { layer: r.own, color: r.color, lt: r.lt, lw: r.lw, frozen: c.frozen >= 0 ? c.frozen : layers[r.own].frozen ? r.own : -1 }, depth + 1, ent);
      }
    };

    const root: Ctx = { layer: L0, color: 0, lt: 0, lw: DEFAULT_LW, frozen: -1 };
    let first = true;
    for (const e of entities) {
      const one: Proto = { polys: [], texts: [], uses: [] };
      if (e.type === "VIEWPORT" && ports) {
        // 배치의 첫 뷰포트는 종이 전체를 가리키는 것이라 창이 아니다.
        const overall = first; first = false;
        if (overall || !(e.viewHeight > 0 && e.width > 0 && e.height > 0) || e.status & 0x20000) continue;
        const c: P = e.viewportCenter, s = e.height / e.viewHeight, t: P = e.targetPoint ?? { x: 0, y: 0 }, d: P = e.displayCenter ?? { x: 0, y: 0 };
        ports.push({ clip: { x: c.x - e.width / 2, y: -c.y - e.height / 2, w: e.width, h: e.height }, s, ox: c.x - s * (t.x + d.x), oy: -c.y + s * (t.y + d.y) });
        one.polys.push({ pts: [c.x - e.width / 2, c.y - e.height / 2, c.x + e.width / 2, c.y - e.height / 2, c.x + e.width / 2, c.y + e.height / 2, c.x - e.width / 2, c.y + e.height / 2], closed: true, fill: false, ww: 0, a: attr(e) });
      } else convert(e, one, false);
      if (!one.polys.length && !one.texts.length && !one.uses.length) continue;
      const ent: Ent = { type: e.type, layer: layer(e.layer ?? "0") };
      if (e.name && !String(e.name).startsWith("*")) ent.name = e.name;
      const tags = ((e.attribs ?? []) as E[]).filter((t) => t.text?.text).map((t): [string, string] => [t.tag, plain(t.text.text)]);
      if (tags.length) ent.attrs = tags;
      ents.push(ent);
      emit(one, FLIP_Y, root, 0, ents.length - 1);
    }

    const scene: Scene = { verts: Float64Array.from(verts), items: Int32Array.from(items), bounds: Float64Array.from(bounds), texts, colors, styles, ents, fit: null };
    scene.fit = fitBox(scene, layers.map((l) => l.off)) ?? fitBox(scene);
    return scene;
  };

  const model = records.find((r) => r.name?.toUpperCase() === "*MODEL_SPACE");
  const layouts = [...(db.objects?.LAYOUT ?? [])].sort((a, b) => a.tabOrder - b.tabOrder);
  const sheets: Sheet[] = [{ name: layouts.find((l) => l.paperSpaceTableId === model?.handle)?.layoutName ?? "Model", scene: buildScene(model?.entities ?? [], null), viewports: [] }];
  for (const l of layouts) {
    const rec = records.find((r) => r.handle === l.paperSpaceTableId);
    if (!rec || rec === model || (rec.entities?.length ?? 0) < 2) continue; // 엔티티가 종이 뷰포트 하나뿐이면 빈 배치다
    const viewports: Viewport[] = [];
    const scene = buildScene(rec.entities!, viewports);
    if (scene.fit) sheets.push({ name: l.layoutName, scene, viewports });
  }

  return {
    sheets,
    layers: layers.map(({ name, color: c, off, used }) => ({ name, color: c, off, used })),
    unit: UNITS[header.INSUNITS as number] ?? "",
    skipped,
  };
}
