import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readCad } from "@/lib/dwg";
import { ITEM } from "@/lib/scene";

const WASM = "./node_modules/@mlightcad/libredwg-web/wasm/";

async function open(name: string) {
  const b = await readFile(new URL(`./fixtures/${name}`, import.meta.url));
  return readCad(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, name, WASM);
}

test("도면을 읽어 장면과 레이어를 낸다", async () => {
  const { drawing } = await open("sample_2018.dwg");
  assert.equal(drawing.sheets.length, 1);
  assert.ok(drawing.sheets[0].scene.items.length / ITEM > 0);
  assert.ok(drawing.sheets[0].scene.fit, "화면 맞춤 상자가 있어야 한다");
  assert.ok(drawing.layers.some((l) => l.used), "그려진 레이어가 있어야 한다");
  assert.equal(drawing.unit, "mm");
});

// R14/2000 파일: 블록 속성, 해치, SOLID, 다중선, 동결 레이어가 든 샘플
test("블록 속성·해치·동결 레이어가 있는 R14 도면", async () => {
  const { drawing } = await open("example_r14.dwg");
  const s = drawing.sheets[0].scene;
  assert.ok(s.texts.some((t) => t.str === "valoro de la teksto en bloko"), "블록 속성값이 글자로 나와야 한다");
  let fills = 0; for (let i = 0; i < s.items.length; i += ITEM) if (s.items[i + 4] & 2) fills++;
  assert.ok(fills >= 10, `SOLID·해치 채움 ${fills}`);
  assert.ok(drawing.layers.find((l) => l.name === "ADSK_SYSTEM_LIGHTS")?.off, "동결 레이어는 꺼진 채로 열린다");
  assert.deepEqual(Object.keys(drawing.skipped).filter((k) => !/^(POINT|WIPEOUT|3DSOLID|ACAD_TABLE:noblock|XLINE|RAY)$/.test(k)), [], JSON.stringify(drawing.skipped));
});
