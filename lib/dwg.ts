import { LibreDwg, Dwg_File_Type } from "@mlightcad/libredwg-web";
import { extract3d, type Model3 } from "./three-d";

const WASM_DIR = "/cad/wasm";

/** 무한 보조선. 변환기가 임의 길이로 그려서 도면 전체를 덮어버린다. */
const INFINITE = new Set(["XLINE", "RAY"]);

export type Cad = {
  /** 변환기가 뱉은 SVG 원문. viewBox와 선 굵기는 뷰어에서 다시 잡는다. */
  svg: string;
  /** 엔티티 handle -> 레이어 이름. SVG의 <g id>가 handle이라 이걸로 레이어를 켜고 끈다. */
  layerOf: Record<string, string>;
  /** 지워야 할 handle (무한선) */
  drop: string[];
  layers: string[];
  /** 도면에 3차원 형상이 있으면 그 내용. 없으면 null. */
  model3: Model3 | null;
};

/** wasmDir은 테스트에서 로컬 경로를 넣기 위한 것. 브라우저에서는 기본값을 쓴다. */
export async function readCad(buf: ArrayBuffer, filename: string, wasmDir = WASM_DIR): Promise<Cad> {
  // 파싱이 실패하면 emscripten 모듈이 abort되고 되살아나지 않는다. 그래서 파일마다 새로 만든다.
  const lib = await LibreDwg.create(wasmDir);
  const type = /\.dxf$/i.test(filename) ? Dwg_File_Type.DXF : Dwg_File_Type.DWG;
  const dwg = lib.dwg_read_data(buf, type);
  if (dwg == null) throw new Error("read");
  const db = lib.convert(dwg);
  // 3DSOLID의 ACIS 데이터는 WASM 메모리를 가리키는 주소라서, 해제 전에 읽어야 한다.
  const model3 = extract3d(db.entities ?? [], (ptr) => lib.UTF8ToString(ptr));
  lib.dwg_free(dwg);

  sanitizeDatabase(db);
  pruneUnusedBlocks(db);

  const layerOf: Record<string, string> = {};
  const drop: string[] = [];
  for (const e of db.entities ?? []) {
    if (e.handle) layerOf[e.handle] = e.layer ?? "0";
    if (INFINITE.has(e.type) && e.handle) drop.push(e.handle);
  }
  const layers = [...new Set(Object.values(layerOf))].sort();
  return { svg: compactSvgNumbers(repairXml(lib.dwg_to_svg(db))), layerOf, drop, layers, model3 };
}

const SVG_GEOMETRY_ATTRIBUTE = /(\s)(d|points|x1|y1|x2|y2|cx|cy|r|rx|ry|x|y|font-size|transform|viewBox|stroke-width)="([^"]*)"/g;
const SVG_NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi;
const SVG_TAG = /<[A-Za-z](?:[^>"']|"[^"]*"|'[^']*')*>/g;

/**
 * libredwg는 좌표를 JS 배정밀도 전체(대개 16~18자리)로 출력한다. 브라우저 화면에는 8자리
 * 유효숫자로도 충분하며, 큰 도면에서는 SVG 문자열과 DOM 속성 메모리를 크게 줄인다.
 * ID나 도면의 실제 텍스트는 바꾸지 않고 기하 속성 안의 숫자만 줄인다.
 */
export function compactSvgNumbers(svg: string): string {
  return svg.replace(SVG_TAG, (tag) =>
    tag.replace(SVG_GEOMETRY_ATTRIBUTE, (_attribute, space: string, name: string, value: string) => {
      const compact = value.replace(SVG_NUMBER, (raw) => {
        const number = Number(raw);
        if (!Number.isFinite(number)) return raw;
        const rounded = Number(number.toPrecision(8));
        return Object.is(rounded, -0) ? "0" : String(rounded);
      });
      return `${space}${name}="${compact}"`;
    }),
  );
}

/**
 * R14/2000 파일의 표는 "20행 9열"이라고 써놓고 셀은 하나도 없는 경우가 있다. 변환기가 없는
 * 셀을 읽다 죽으면 도면 전체가 안 열리므로, 셀 수가 모자란 표는 그리지 않게 만든다.
 * ponytail: libredwg-web 0.7.14의 셀 인덱싱에 가드가 없어서 넣은 우회다. 상류가 고치면 지운다.
 */
type Point3 = { x: number; y: number; z?: number };
type SanitizedEntity = {
  type: string;
  name?: string;
  flag?: number;
  degree?: number;
  knots?: number[];
  controlPoints?: Point3[];
  fitPoints?: Point3[];
  vertices?: Point3[];
  rowCount?: number;
  columnCount?: number;
  cells?: unknown[];
};
type CadDatabase = {
  entities?: SanitizedEntity[];
  tables?: { BLOCK_RECORD?: { entries?: { name?: string; entities?: SanitizedEntity[] }[] } };
};

/** 모델 공간에서 INSERT/DIMENSION으로 도달할 수 없는 블록은 <defs>에 넣지 않는다. */
export function pruneUnusedBlocks(db: CadDatabase): number {
  const entries = db.tables?.BLOCK_RECORD?.entries;
  if (!entries?.length) return 0;
  const modelSpaces = entries.filter((block) => block.name?.toUpperCase() === "*MODEL_SPACE");
  if (!modelSpaces.length) return 0;

  const byName = new Map(entries.filter((block) => block.name).map((block) => [block.name!, block]));
  const reachable = new Set<string>();
  const queue = [...modelSpaces];
  while (queue.length) {
    const block = queue.pop()!;
    if (!block.name || reachable.has(block.name)) continue;
    reachable.add(block.name);
    for (const entity of block.entities ?? []) {
      if ((entity.type === "INSERT" || entity.type === "DIMENSION") && entity.name) {
        const child = byName.get(entity.name);
        if (child && !reachable.has(entity.name)) queue.push(child);
      }
    }
  }

  const kept = entries.filter((block) => block.name && reachable.has(block.name));
  const removed = entries.length - kept.length;
  db.tables!.BLOCK_RECORD!.entries = kept;
  return removed;
}

/**
 * libredwg-web의 SVG 변환기는 모든 SPLINE에 제어점과 `점 수 + 차수 + 1`개의 매듭이 있다고
 * 가정한다. 실제 DWG에는 맞춤점(fit point)만 든 스플라인과 더 짧은 매듭 벡터도 있으므로,
 * 그런 엔티티 하나가 있으면 `bad knot vector length`로 도면 전체가 열리지 않는다. 변환기가
 * 처리하지 못하는 스플라인만 가진 점을 잇는 폴리라인으로 근사한다.
 *
 * 블록 안 엔티티도 SVG 변환 대상이므로 모델 공간뿐 아니라 BLOCK_RECORD 전체를 검사해야 한다.
 */
export function sanitizeDatabase(db: CadDatabase) {
  const lists = [
    db.entities,
    ...(db.tables?.BLOCK_RECORD?.entries ?? []).map((block) => block.entities),
  ];

  for (const entities of lists) {
    for (const e of entities ?? []) {
      if (e.type === "ACAD_TABLE" && (e.cells?.length ?? 0) < (e.rowCount ?? 0) * (e.columnCount ?? 0)) {
        e.rowCount = 0;
        e.columnCount = 0;
      }

      if (e.type !== "SPLINE") continue;
      const controlPoints = e.controlPoints ?? [];
      const degree = e.degree ?? 0;
      const knots = e.knots ?? [];
      const supported = controlPoints.length > degree && knots.length === controlPoints.length + degree + 1;
      if (supported) continue;

      const vertices = (e.fitPoints?.length ?? 0) >= 2 ? e.fitPoints! : controlPoints;
      if (vertices.length < 2) {
        e.type = "UNSUPPORTED_SPLINE";
        continue;
      }
      e.type = "LWPOLYLINE";
      e.flag = e.flag && (e.flag & 1) ? 512 : 0;
      e.vertices = vertices;
    }
  }
}

/**
 * 변환기가 도면 텍스트를 XML 이스케이프하지 않아서, 치수에 흔히 쓰는 `<53>` 같은 표기나 `&`가
 * 하나만 있어도 SVG 전체가 파싱되지 않는다. 진짜 태그(`<` 뒤에 이름이 오는 것)는 건드리지 않고
 * 나머지만 되살린다.
 * ponytail: libredwg-web 0.7.14 이스케이프 누락 우회. 상류가 고치면 지운다.
 */
function repairXml(svg: string): string {
  return svg
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;")
    .replace(/<(?![a-zA-Z/?!])/g, "&lt;");
}
