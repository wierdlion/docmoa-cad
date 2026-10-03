/**
 * DXF → 도면 데이터(`Db`). libredwg-web 0.7.14의 WASM에는 DXF 읽기가 빠져 있다(`dwg_read_data`의 DXF 분기가 주석
 * 처리돼 어떤 DXF든 null을 돌려준다). 그래서 DXF는 같은 저자의 JS 파서 @mlightcad/dxf-json(GPL-3)으로 읽고, 결과를
 * libredwg-web `convert`가 내는 모양으로 바꿔 `build.ts`에 넘긴다. 둘의 차이는 셋이다: 각도가 도(°) 단위, 선굵기가
 * 1/100mm 값 그대로, 블록 안 엔티티가 `blocks`에 따로 있고 ATTRIB이 INSERT 뒤에 따로 온다.
 * 이 모듈은 DXF를 열 때만 받는다(`dwg.ts`의 동적 import).
 */
import { DxfParser, decryptAcisData, isBinaryDxf, isEncryptedAcisData, normalizeAcisData } from "@mlightcad/dxf-json";
import { LW, type Db } from "./build";
import { satToLines, type SatResult } from "./sat";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ent = { type: string; [key: string]: any };
type Rec = { name: string; handle: string; basePoint?: { x: number; y: number }; entities: Ent[] };

const DEG = Math.PI / 180;
const rad = (v: unknown) => (typeof v === "number" ? v * DEG : v);

/** $DWGCODEPAGE → TextDecoder 라벨. R2007(AC1021)부터 DXF는 UTF-8이라 쓰지 않는다. */
const CODEPAGES: Record<string, string> = {
  ANSI_874: "windows-874", ANSI_932: "shift_jis", ANSI_936: "gbk", ANSI_949: "euc-kr", ANSI_950: "big5",
  ANSI_1250: "windows-1250", ANSI_1251: "windows-1251", ANSI_1252: "windows-1252", ANSI_1253: "windows-1253",
  ANSI_1254: "windows-1254", ANSI_1255: "windows-1255", ANSI_1256: "windows-1256", ANSI_1257: "windows-1257", ANSI_1258: "windows-1258",
};

/** DXF 바이트를 글자로. 구형 파일은 $DWGCODEPAGE(CP949 등)로 적혀 있어 머리말을 먼저 읽고 그 인코딩으로 푼다. */
export function decodeDxf(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1 << 16));
  const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/.exec(head)?.[1];
  const cp = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*([^\r\n]+)/i.exec(head)?.[1]?.trim().toUpperCase();
  const label = !ver || ver >= "AC1021" ? "utf-8" : (CODEPAGES[cp ?? ""] ?? "windows-1252");
  try { return new TextDecoder(label).decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

/**
 * R12(AC1009) 파일에는 `100 AcDbBlockEnd` 표식이 없는데, dxf-json은 ENDBLK 뒤에서 그 표식이 나올 때까지 읽어
 * 블록 하나가 파일 끝까지 삼킨다(엔티티 0개). ENDBLK 바로 뒤에 표식을 끼워 넣어 막는다.
 */
export function patchR12(text: string): string {
  if (/AcDbBlockEnd/.test(text) || !/\nENDBLK\r?\n/.test(text)) return text;
  return text.replace(/(^|\n)([ \t]*0\r?\n)ENDBLK(\r?\n)/g, "$1$2ENDBLK$3100$3AcDbBlockEnd$3");
}

/** DXF 선굵기(1/100mm, -1 ByLayer, -2 ByBlock, -3 기본) → libredwg 번호(LW 표의 index, 29 ByLayer, 30 ByBlock) */
const lwIndex = (v: unknown, byLayerIfMissing: boolean) => {
  if (typeof v !== "number") return byLayerIfMissing ? 29 : undefined;
  if (v === -1) return 29;
  if (v === -2) return 30;
  const i = LW.indexOf(v);
  return i >= 0 ? i : undefined;
};

const textBase = (e: Row): Row => ({
  text: e.text, textHeight: e.textHeight, startPoint: e.startPoint, endPoint: e.endPoint ?? e.alignmentPoint,
  halign: e.halign ?? e.horizontalJustification, valign: e.valign ?? e.verticalJustification,
  xScale: e.xScale ?? e.scale, rotation: rad(e.rotation), extrusionDirection: e.extrusionDirection,
});

/** 엔티티 하나를 libredwg-web 모양으로. 버릴 것(VERTEX·SEQEND)은 null. */
function conv(e: Ent): Ent | null {
  const o: Ent = { ...e, lineweight: lwIndex(e.lineweight, true) };
  switch (e.type) {
    case "VERTEX": case "SEQEND": return null;
    case "ARC": o.startAngle = rad(e.startAngle); o.endAngle = rad(e.endAngle); break;
    case "TEXT": o.rotation = rad(e.rotation); break;
    case "ATTDEF": return { ...o, flags: e.attributeFlag ?? 0, text: textBase(e) };
    case "ATTRIB": return { ...o, flags: e.attributeFlag ?? 0, text: textBase(e) };
    case "MTEXT": o.textHeight = e.height; o.rectWidth = e.width; o.rotation = rad(e.rotation); break;
    case "INSERT": o.rotation = rad(e.rotation); o.attribs = []; break;
    case "LWPOLYLINE": o.flag = e.flag & 1 ? 0x200 : 0; break; // libredwg는 닫힘을 512로 둔다
    case "POLYLINE": {
      const f = e.flag | 0;
      if (f & (16 | 64)) { o.type = f & 64 ? "POLYFACE_MESH" : "POLYGON_MESH"; break; } // 면 그물은 못 그린다
      o.type = f & 8 ? "POLYLINE3D" : "POLYLINE2D";
      o.vertices = ((e.vertices ?? []) as Row[]).map((v) => ({ ...v, startWidth: v.startWidth ?? e.startWidth, endWidth: v.endWidth ?? e.endWidth }));
      break;
    }
    case "SOLID": case "TRACE": [o.corner1, o.corner2, o.corner3, o.corner4] = e.points ?? []; break;
    case "3DFACE": [o.corner1, o.corner2, o.corner3, o.corner4] = e.vertices ?? []; break;
    case "HATCH":
      o.definitionLines = ((e.definitionLines ?? []) as Row[]).map((d) => ({ ...d, angle: rad(d.angle) }));
      o.boundaryPaths = ((e.boundaryPaths ?? []) as Row[]).map((p) =>
        p?.edges ? { ...p, edges: (p.edges as Row[]).map((g) => (g && (g.type === 2 || g.type === 3) ? { ...g, startAngle: rad(g.startAngle), endAngle: rad(g.endAngle) } : g)) } : p);
      break;
    case "MLINE":
      o.vertices = ((e.segments ?? []) as Row[]).map((s) => ({ vertex: s.position, miterDirection: s.miterDirection, lines: ((s.elements ?? []) as Row[]).map((el) => ({ segmentParams: el.parameters ?? [] })) }));
      o.numberOfLines = e.styleCount;
      break;
    case "TOLERANCE": o.insertionPoint = e.position; break;
  }
  return o;
}

/** 엔티티 목록을 바꾸면서 INSERT 뒤에 따로 오는 ATTRIB을 그 INSERT의 attribs로 거둔다. */
function convList(list: Ent[]): Ent[] {
  const out: Ent[] = [];
  let insert: Ent | null = null;
  for (const e of list) {
    if (!e) continue;
    if (e.type === "ATTRIB" && insert) { insert.attribs.push(conv(e)); continue; }
    if (e.type === "SEQEND") { insert = null; continue; }
    const c = conv(e);
    if (!c) continue;
    out.push(c);
    insert = c.type === "INSERT" ? c : null;
  }
  return out;
}

/** 입체의 ACIS 글자를 모서리로. R13~R2010 DXF는 글자를 간단히 뒤섞어 두므로 먼저 되돌린다. R2013+는 이진이라 없다. */
function solidEdges(data: unknown): SatResult | null {
  if (typeof data !== "string" || !data) return null;
  try {
    const sat = normalizeAcisData(isEncryptedAcisData(data) ? decryptAcisData(data) : data);
    return satToLines(sat);
  } catch { return null; }
}

export type ParsedDxf = { db: Db; solids: Map<string, SatResult>; /** 모델 공간 엔티티(변환된 것). 3D 추출용. */ model: Ent[] };

export function parseDxf(buf: ArrayBuffer): ParsedDxf {
  const bytes = new Uint8Array(buf);
  let d: Row;
  if (isBinaryDxf(bytes)) d = new DxfParser().parseBuffer(bytes);
  else {
    const text = decodeDxf(buf);
    if (!/\n\s*SECTION\s*\r?\n/.test(text.slice(0, 1 << 16))) throw new Error("read");
    d = new DxfParser().parseSync(patchR12(text));
  }

  const header: Record<string, unknown> = {};
  for (const [k, v] of Object.entries((d.header ?? {}) as Row)) header[k.replace(/^\$/, "")] = v;

  const layers = ((d.tables?.LAYER?.entries ?? []) as Row[]).map((l) => {
    const ci = typeof l.colorIndex === "number" ? l.colorIndex : 7;
    return { ...l, colorIndex: Math.abs(ci), off: ci < 0, frozen: !!(l.standardFlag & 1), lineweight: lwIndex(l.lineweight, false) };
  });
  const ltypes = ((d.tables?.LTYPE?.entries ?? []) as Row[]).map((l) => ({ ...l, pattern: ((l.pattern ?? []) as Row[]).map((p) => ({ ...p, rotation: rad(p.rotation) })) }));

  // 블록: dxf-json은 `blocks`에 엔티티를 두고 BLOCK_RECORD에는 이름만 있다. R12는 모델·종이 공간 이름이 `$`로 시작한다.
  const recs: Rec[] = Object.values((d.blocks ?? {}) as Record<string, Row>).map((b) => ({
    name: String(b.name ?? "").replace(/^\$/, "*"), handle: String(b.ownerHandle || b.handle || ""), basePoint: b.position, entities: convList(b.entities ?? []),
  }));
  const record = (name: string) => {
    let r = recs.find((x) => x.name.toUpperCase() === name.toUpperCase());
    if (!r) { r = { name, handle: `dxf:${name}`, entities: [] }; recs.push(r); }
    return r;
  };
  const model = record("*Model_Space"), paper = record("*Paper_Space");
  const top = (d.entities ?? []) as Ent[];
  model.entities.push(...convList(top.filter((e) => !e?.isInPaperSpace)));
  paper.entities.push(...convList(top.filter((e) => e?.isInPaperSpace)));

  let layouts = ((d.objects?.byName?.LAYOUT ?? []) as Row[]).map((l) => ({ layoutName: l.layoutName, tabOrder: l.tabOrder ?? 0, paperSpaceTableId: l.paperSpaceTableId }));
  if (!layouts.length) { // R12에는 LAYOUT 객체가 없다
    layouts = [{ layoutName: "Model", tabOrder: 0, paperSpaceTableId: model.handle }];
    if (paper.entities.length) layouts.push({ layoutName: "Layout1", tabOrder: 1, paperSpaceTableId: paper.handle });
  }

  const solids = new Map<string, SatResult>();
  for (const r of recs) for (const e of r.entities) {
    if (e.type !== "3DSOLID" || !e.handle) continue;
    const s = solidEdges(e.data);
    if (s) solids.set(String(e.handle), s);
  }

  const db: Db = {
    header,
    tables: { BLOCK_RECORD: { entries: recs }, LAYER: { entries: layers }, LTYPE: { entries: ltypes } },
    objects: { LAYOUT: layouts },
  };
  return { db, solids, model: model.entities };
}
