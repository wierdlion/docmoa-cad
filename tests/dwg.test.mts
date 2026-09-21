import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readCad } from "@/lib/dwg";

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
