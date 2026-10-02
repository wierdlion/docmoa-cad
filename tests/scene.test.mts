import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readCad } from "@/lib/dwg";
import { ITEM, parsePath, parseScene, parseTransform, type Scene } from "@/lib/scene";

const WASM = "./node_modules/@mlightcad/libredwg-web/wasm/";
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const item = (s: Scene, i: number) => ({ start: s.items[i * ITEM], n: s.items[i * ITEM + 1], stroke: s.items[i * ITEM + 2], fill: s.items[i * ITEM + 3], layer: s.items[i * ITEM + 4] });

test("transform: translate·scale·rotate·matrix를 왼쪽부터 곱한다", () => {
  const m = parseTransform("translate(10,20) scale(2) rotate(90)", {});
  // (1,0) → rotate → (0,1) → scale → (0,2) → translate → (10,22)
  near(m[0] * 1 + m[2] * 0 + m[4], 10); near(m[1] * 1 + m[3] * 0 + m[5], 22);
  const r = parseTransform("rotate(180 5, 5)", {});
  near(r[0] * 0 + r[2] * 0 + r[4], 10); near(r[1] * 0 + r[3] * 0 + r[5], 10);
});

test("path: M/L/Z와 A(반원)를 선분으로 편다", () => {
  const polys = parsePath("M0,0L10,0L10,10Z M20 20 L30 20", {});
  assert.equal(polys.length, 2);
  assert.deepEqual(polys[0], [[0, 0, 10, 0, 10, 10], true]);
  assert.equal(polys[1][1], false);
  const [[arcPts]] = parsePath("M 0 0 A 5 5 0 0 1 10 0", {});
  // 반지름 5, 중심 (5,0): 모든 점이 중심에서 5 떨어져 있어야 한다
  for (let i = 0; i < arcPts.length; i += 2) near(Math.hypot(arcPts[i] - 5, arcPts[i + 1]), 5, 1e-9);
  near(arcPts[arcPts.length - 2], 10); near(arcPts[arcPts.length - 1], 0);
});

test("scene: 블록(use)·중첩 변환·레이어·텍스트를 장면 좌표로 푼다", () => {
  const svg = `<svg viewBox="0 0 100 100"><defs><g id="B"><g id="1" stroke="rgb(0,255,0)"><line x1="0" y1="0" x2="1" y2="0" /></g></g></defs>
    <g stroke="#000000" fill="none" transform="matrix(1,0,0,-1,0,0)">
      <g id="*Model_Space">
        <g id="A1" stroke="rgb(255,0,0)" fill="none"><line x1="0" y1="0" x2="10" y2="0" /></g>
        <g id="A2" stroke="rgb(255,255,255)" fill="none"><use href="#B" transform="translate(5,5) rotate(90) scale(2,2)" /></g>
        <g id="A3" stroke="rgb(255,255,255)" fill="rgb(255,255,255)"><text x="3" y="4" font-size="2" text-anchor="middle" transform="translate(3,4) scale(1,-1) translate(-3,-4)">R&amp;D &lt;5&gt;</text></g>
        <g id="A4" stroke="rgb(1,1,1)" fill="none"><path d="M0,0L1,1" /></g>
        <g id="A5"><svg width="1" height="1"><line x1="9" y1="9" x2="9" y2="9" /></svg></g>
      </g>
    </g></svg>`;
  const s = parseScene(svg, { A1: "walls", A2: "symbols", A3: "notes", A4: "gone" }, ["A4"]);
  assert.deepEqual(s.layers, ["0", "walls", "symbols", "notes", "gone"]);
  assert.equal(s.items.length / ITEM, 2, "선 두 개(직접 하나, 블록 하나); 버린 A4와 중첩 svg는 없다");

  const a1 = item(s, 0);
  assert.equal(s.layers[a1.layer], "walls");
  assert.equal(s.colors[a1.stroke], "rgb(255,0,0)");
  near(s.verts[a1.start * 2 + 2], 10); near(s.verts[a1.start * 2 + 3], -0); // y축 뒤집힘

  // 블록 선 (0,0)-(1,0): rotate90·scale2 → (0,0)-(0,2), translate(5,5) → (5,5)-(5,7), 루트 y 뒤집기 → (5,-5)-(5,-7)
  const a2 = item(s, 1);
  assert.equal(s.layers[a2.layer], "symbols");
  assert.equal(s.colors[a2.stroke], "rgb(0,255,0)", "블록 안의 색이 use 문맥보다 우선한다");
  near(s.verts[a2.start * 2], 5); near(s.verts[a2.start * 2 + 1], -5); near(s.verts[a2.start * 2 + 2], 5); near(s.verts[a2.start * 2 + 3], -7);

  assert.equal(s.texts.length, 1);
  const t = s.texts[0];
  assert.equal(t.str, "R&D <5>");
  assert.equal(t.anchor, 1);
  assert.equal(s.layers[t.layer], "notes");
  // 루트 뒤집기 × 글자 뒤집기 = 똑바로 선 글자. 기준점 (3,4)는 (3,-4)로 간다.
  near(t.m[0], 1); near(t.m[3], 1); near(t.m[0] * t.x + t.m[2] * t.y + t.m[4], 3); near(t.m[1] * t.x + t.m[3] * t.y + t.m[5], -4);

  assert.ok(s.fit && s.fit.w > 0 && s.fit.h > 0);
  assert.deepEqual(s.skipped, {});
});

test("scene: 실제 도면의 SVG를 모두 소화한다", async () => {
  for (const name of ["sample_2018.dwg", "real_ko.dwg", "example_r14.dwg"]) {
    const b = await readFile(new URL(`./fixtures/${name}`, import.meta.url));
    const cad = await readCad(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, name, WASM);
    const s = parseScene(cad.svg, cad.layerOf, cad.drop);
    assert.ok(s.items.length / ITEM > 0, `${name}: 도형이 있어야 한다`);
    // 모델 공간에 직접 놓인 글자는 전부 나와야 한다. 블록 속 글자는 use 횟수만큼 늘거나(여러 번 삽입) 줄어든다(미사용 블록).
    const direct = cad.svg.slice(cad.svg.indexOf("</defs>")).match(/<text[^>]*>([^<]*)<\/text>/g) ?? [];
    assert.ok(s.texts.length >= direct.length, `${name}: 텍스트 ${s.texts.length} < 직접 ${direct.length}`);
    const strs = new Set(s.texts.map((t) => t.str));
    for (const d of direct.slice(0, 50)) { const str = d.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim(); if (str) assert.ok(strs.has(str), `${name}: 글자 "${str}" 누락`); }
    assert.ok(s.fit, `${name}: fit`);
    const unknown = Object.keys(s.skipped).filter((k) => !k.startsWith("tag:svg"));
    assert.deepEqual(unknown, [], `${name}: 모르는 문법 ${JSON.stringify(s.skipped)}`);
    for (let i = 0; i < s.verts.length; i++) assert.ok(Number.isFinite(s.verts[i]), `${name}: NaN 좌표`);
  }
});
