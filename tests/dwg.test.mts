import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compactSvgNumbers, pruneUnusedBlocks, readCad, sanitizeDatabase } from "@/lib/dwg";

const WASM = "./node_modules/@mlightcad/libredwg-web/wasm/";

async function open(name: string) {
  const b = await readFile(new URL(`./fixtures/${name}`, import.meta.url));
  return readCad(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, name, WASM);
}

test("도면을 읽어 SVG와 레이어를 낸다", async () => {
  const cad = await open("sample_2018.dwg");
  assert.match(cad.svg, /^<\?xml/);
  assert.ok(cad.layers.length > 0, "레이어가 있어야 한다");
  assert.ok(Object.keys(cad.layerOf).length > 0, "엔티티-레이어 매핑이 있어야 한다");
});

// R14/2000 파일의 빈 표에서 변환기가 죽던 버그. sanitize가 빠지면 여기서 throw 한다.
test("셀이 비어 있는 표가 있어도 도면이 열린다", async () => {
  const cad = await open("example_r14.dwg");
  assert.ok(cad.svg.length > 1000, "SVG가 비어 있으면 안 된다");
  assert.ok(cad.drop.length > 0, "무한 보조선(XLINE/RAY)을 골라내야 한다");
});

// 실전 한국 도면. 치수 표기 `<53>`이 이스케이프되지 않아 SVG 전체가 깨지던 버그.
test("각괄호 치수가 있는 실전 도면도 XML로 파싱된다", async () => {
  const cad = await open("real_ko.dwg");
  const doc = new (await import("@xmldom/xmldom")).DOMParser({ onError: () => { throw new Error("XML 깨짐"); } })
    .parseFromString(cad.svg, "image/svg+xml");
  assert.equal(doc.documentElement?.nodeName, "svg");
  assert.ok(cad.svg.includes("치수"), "한글 텍스트가 살아 있어야 한다");
});

test("SVG 변환기가 지원하지 않는 스플라인은 도면 전체를 막지 않는다", () => {
  const fitPoints = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }];
  const controlPoints = [{ x: 2, y: 2, z: 0 }, { x: 3, y: 3, z: 0 }];
  const fitSpline = { type: "SPLINE", flag: 9, degree: 3, knots: [], controlPoints: [], fitPoints };
  const malformedSpline = { type: "SPLINE", flag: 4, degree: 2, knots: [0, 1, 2], controlPoints, fitPoints: [] };
  const validSpline = { type: "SPLINE", flag: 0, degree: 1, knots: [0, 0, 1, 1], controlPoints, fitPoints: [] };
  const db = {
    entities: [fitSpline, malformedSpline, validSpline],
    tables: { BLOCK_RECORD: { entries: [{ entities: [fitSpline, malformedSpline, validSpline] }] } },
  };

  sanitizeDatabase(db);

  assert.equal(fitSpline.type, "LWPOLYLINE");
  assert.deepEqual((fitSpline as typeof fitSpline & { vertices: typeof fitPoints }).vertices, fitPoints);
  assert.equal(malformedSpline.type, "LWPOLYLINE");
  assert.deepEqual((malformedSpline as typeof malformedSpline & { vertices: typeof controlPoints }).vertices, controlPoints);
  assert.equal(validSpline.type, "SPLINE");
});

test("SVG 좌표 정밀도를 화면 렌더링에 충분한 범위로 줄인다", () => {
  const svg = '<svg viewBox="-18743.479871844313 0 56455.36441439369 10"><path id="2.9368534123384507" d="M2.9368534123384507,7.340002345008543L0.000000123456789,-0.000000001"/><g data-x="1.23456789123"><![CDATA[literal d="9.87654321987"]]><!-- x="1.23456789123" --></g><text x="1.234567891234">123.4567891234 literal x="123456789.123" and d="1.23456789123"</text></svg>';
  const compact = compactSvgNumbers(svg);

  assert.match(compact, /viewBox="-18743\.48 0 56455\.364 10"/);
  assert.match(compact, /d="M2\.9368534,7\.3400023L1\.2345679e-7,-1e-9"/);
  assert.match(compact, /x="1\.2345679"/);
  assert.match(compact, /id="2\.9368534123384507"/);
  assert.match(compact, /data-x="1\.23456789123"/);
  assert.match(compact, /<!\[CDATA\[literal d="9\.87654321987"\]\]>/);
  assert.match(compact, /<!-- x="1\.23456789123" -->/);
  assert.match(compact, />123\.4567891234 literal x="123456789\.123" and d="1\.23456789123"<\/text>/);
  assert.ok(compact.length < svg.length);
});

test("모델 공간에서 참조하지 않는 블록은 SVG 변환 전에 제외한다", () => {
  const entries = [
    { name: "B", entities: [] },
    { name: "A", entities: [{ type: "INSERT", name: "B" }] },
    { name: "UNUSED", entities: [{ type: "LINE" }] },
    { name: "*Model_Space", entities: [{ type: "INSERT", name: "A" }] },
  ];
  const db = { tables: { BLOCK_RECORD: { entries } } };

  assert.equal(pruneUnusedBlocks(db), 1);
  assert.deepEqual(db.tables.BLOCK_RECORD.entries.map((block) => block.name), ["B", "A", "*Model_Space"]);
});
