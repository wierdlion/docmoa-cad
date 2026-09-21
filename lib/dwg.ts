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

  sanitize(db);

  const layerOf: Record<string, string> = {};
  const drop: string[] = [];
  for (const e of db.entities ?? []) {
    if (e.handle) layerOf[e.handle] = e.layer ?? "0";
    if (INFINITE.has(e.type) && e.handle) drop.push(e.handle);
  }
  const layers = [...new Set(Object.values(layerOf))].sort();
  return { svg: repairXml(lib.dwg_to_svg(db)), layerOf, drop, layers, model3 };
}

/**
 * R14/2000 파일의 표는 "20행 9열"이라고 써놓고 셀은 하나도 없는 경우가 있다. 변환기가 없는
 * 셀을 읽다 죽으면 도면 전체가 안 열리므로, 셀 수가 모자란 표는 그리지 않게 만든다.
 * ponytail: libredwg-web 0.7.14의 셀 인덱싱에 가드가 없어서 넣은 우회다. 상류가 고치면 지운다.
 */
function sanitize(db: { entities?: { type: string; rowCount?: number; columnCount?: number; cells?: unknown[] }[] }) {
  for (const e of db.entities ?? []) {
    if (e.type !== "ACAD_TABLE") continue;
    if ((e.cells?.length ?? 0) < (e.rowCount ?? 0) * (e.columnCount ?? 0)) {
      e.rowCount = 0;
      e.columnCount = 0;
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
