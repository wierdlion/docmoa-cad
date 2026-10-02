import { LibreDwg, Dwg_File_Type } from "@mlightcad/libredwg-web";
import { buildDrawing, type BuildOpts, type Db } from "./build";
import { satToLines, type SatResult } from "./sat";
import type { Drawing } from "./scene";
import { extract3d, type Model3 } from "./three-d";

const WASM_DIR = "/cad/wasm";

export type Cad = {
  drawing: Drawing;
  /** 도면에 3차원 형상이 있으면 그 내용. 없으면 null. */
  model3: Model3 | null;
};

/**
 * wasmDir은 테스트에서 로컬 경로를 넣기 위한 것. 브라우저에서는 기본값을 쓴다.
 * step은 진행 단계(1 읽기, 2 풀기, 3 장면 만들기)를 알린다.
 */
export async function readCad(buf: ArrayBuffer, filename: string, wasmDir = WASM_DIR, step: (n: number) => void = () => {}, measure?: BuildOpts["measure"]): Promise<Cad> {
  // 파싱이 실패하면 emscripten 모듈이 abort되고 되살아나지 않는다. 그래서 파일마다 새로 만든다.
  const lib = await LibreDwg.create(wasmDir);
  step(1);
  const type = /\.dxf$/i.test(filename) ? Dwg_File_Type.DXF : Dwg_File_Type.DWG;
  const dwg = lib.dwg_read_data(buf, type);
  if (dwg == null) throw new Error("read");
  step(2);
  const db = lib.convert(dwg);
  // 입체의 ACIS 데이터는 WASM 메모리를 가리키는 주소라서, 해제 전에 읽어야 한다. 블록 안의 것까지 전부.
  // R2004부터는 이진(SAB)이라 문자열로 읽으면 머리말에서 끊겨 모서리가 안 나온다. 글자 SAT(R14·2000)만 된다.
  const solids = new Map<string, SatResult>();
  for (const r of db.tables?.BLOCK_RECORD?.entries ?? []) for (const e of r.entities ?? []) {
    const d = (e as { data?: unknown }).data;
    if (e.type === "3DSOLID" && typeof d === "number" && d) solids.set(e.handle, satToLines(lib.UTF8ToString(d)));
  }
  const model3 = extract3d(db.entities ?? [], (e) => solids.get((e as { handle?: string }).handle ?? "") ?? null);
  lib.dwg_free(dwg);
  step(3);
  return { drawing: buildDrawing(db as unknown as Db, { solids, measure }), model3 };
}
