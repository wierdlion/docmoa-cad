import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDrawing, type Db } from "@/lib/build";
import { F_CLOSED, F_FILL, ITEM, type Scene } from "@/lib/scene";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const item = (s: Scene, i: number) => ({ start: s.items[i * ITEM], n: s.items[i * ITEM + 1], style: s.styles[s.items[i * ITEM + 2]], layer: s.items[i * ITEM + 3], flags: s.items[i * ITEM + 4], ent: s.items[i * ITEM + 5] });
const pts = (s: Scene, i: number) => [...s.verts.subarray(s.items[i * ITEM] * 2, (s.items[i * ITEM] + s.items[i * ITEM + 1]) * 2)].map((v) => v + 0); // -0 → 0
const P = (x: number, y: number) => ({ x, y, z: 0 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (model: any[], extra: Partial<Db> & { blocks?: any[] } = {}): Db => ({
  header: { INSUNITS: 4, LTSCALE: 2, ...extra.header },
  tables: {
    LAYER: { entries: [{ name: "0", colorIndex: 7 }, { name: "walls", colorIndex: 1, lineType: "DASHED" }, { name: "hidden", colorIndex: 3, frozen: true }, ...(extra.tables?.LAYER?.entries ?? [])] },
    LTYPE: { entries: [{ name: "DASHED", pattern: [{ elementLength: 0.5 }, { elementLength: -0.25 }] }, ...(extra.tables?.LTYPE?.entries ?? [])] },
    BLOCK_RECORD: { entries: [{ name: "*Model_Space", handle: "1F", entities: model }, ...(extra.blocks ?? [])] },
  },
  objects: { LAYOUT: [{ layoutName: "Model", tabOrder: 0, paperSpaceTableId: "1F" }, ...(extra.objects?.LAYOUT ?? [])] },
});

test("선: 레이어 색·선종류·굵기를 물려받고 y가 뒤집힌다", () => {
  const d = buildDrawing(db([{ type: "LINE", layer: "walls", colorIndex: 256, lineweight: 11, startPoint: P(0, 0), endPoint: P(10, 5) }]));
  const s = d.sheets[0].scene;
  assert.equal(s.items.length / ITEM, 1);
  assert.deepEqual(pts(s, 0), [0, 0, 10, -5]);
  const it = item(s, 0);
  assert.equal(s.colors[it.style.color], "#ff0000");
  assert.deepEqual(it.style.dash, [1, 0.5], "LTSCALE 2가 곱해진 점선");
  near(it.style.lw, 0.5);
  assert.equal(d.layers[it.layer].name, "walls");
  assert.equal(d.unit, "mm");
  assert.ok(s.fit && s.fit.w > 10);
});

test("동결 레이어는 꺼진 채 열리고 화면 맞춤에서 빠진다", () => {
  const d = buildDrawing(db([
    { type: "LINE", layer: "walls", startPoint: P(0, 0), endPoint: P(1, 1) },
    { type: "LINE", layer: "hidden", startPoint: P(1000, 1000), endPoint: P(1001, 1001) },
  ]));
  assert.ok(d.layers.find((l) => l.name === "hidden")!.off);
  assert.ok(d.sheets[0].scene.fit!.w < 100);
});

test("블록: 회전·축척·기준점, 레이어 0과 ByBlock 색은 삽입에서 물려받는다", () => {
  const blocks = [{ name: "B", basePoint: P(1, 0), entities: [
    { type: "LINE", layer: "0", colorIndex: 0, startPoint: P(1, 0), endPoint: P(2, 0) },
    { type: "LINE", layer: "walls", colorIndex: 256, startPoint: P(1, 0), endPoint: P(1, 1) },
  ] }];
  const d = buildDrawing(db([{ type: "INSERT", name: "B", layer: "hidden", colorIndex: 5, insertionPoint: P(10, 10), xScale: 2, yScale: 2, rotation: Math.PI / 2 }], { blocks }));
  const s = d.sheets[0].scene;
  assert.equal(s.items.length / ITEM, 2);
  // 기준점(1,0)이 삽입점(10,10)으로, (2,0)은 기준점에서 +x 1 → 2배 → 90° → +y 2 → (10,12) → y 뒤집기 → (10,-12)
  const a = pts(s, 0); near(a[0], 10); near(a[1], -10); near(a[2], 10); near(a[3], -12);
  const i0 = item(s, 0), i1 = item(s, 1);
  assert.equal(s.colors[i0.style.color], "#0000ff", "ByBlock은 삽입의 색");
  assert.equal(d.layers[i0.layer].name, "hidden", "레이어 0은 삽입의 레이어");
  assert.equal(s.colors[i1.style.color], "#ff0000", "자기 레이어의 ByLayer 색");
  assert.equal(d.layers[i1.layer].name, "hidden", "동결된 레이어에 삽입된 것은 통째로 그 레이어와 숨는다");
  assert.equal(i0.ent, i1.ent);
  assert.equal(s.ents[i0.ent].name, "B");
});

test("글자: 정렬점에서 실제 폭을 얻고 회전·기호를 반영한다", () => {
  const d = buildDrawing(db([
    { type: "TEXT", layer: "0", text: "ABCD", textHeight: 2, rotation: Math.PI / 2, xScale: 0.8, halign: 1, valign: 2, startPoint: P(5, 5), endPoint: P(4, 7) },
    { type: "TEXT", layer: "0", text: "%%c50 %%d%%p", textHeight: 2, startPoint: P(0, 0), endPoint: P(0, 0) },
  ]));
  const [a, b] = d.sheets[0].scene.texts;
  assert.equal(a.str, "ABCD");
  near(a.size, 2 / 0.72);
  near(a.w, 4, 1e-9); // 가운데 정렬: 정렬점까지 진행 방향으로 2 → 폭 4
  near(a.m[4], 5); near(a.m[5], -5); // 시작점이 기준선 왼쪽 끝
  near(a.m[0], 0, 1e-9); near(a.m[1], -1, 1e-9); // 90° 회전: 글자 진행 방향이 화면 위쪽
  assert.equal(b.str, "Ø50 °±");
  assert.equal(b.w, 0);
});

test("MTEXT: 줄을 나누고 부착점에 따라 쌓는다", () => {
  const d = buildDrawing(db([{ type: "MTEXT", layer: "0", text: "{\\fArial|b0;A\\PB\\PC}", textHeight: 1, insertionPoint: P(0, 10), attachmentPoint: 1, direction: P(1, 0), lineSpacing: 1 }]));
  const t = d.sheets[0].scene.texts;
  assert.deepEqual(t.map((x) => x.str), ["A", "B", "C"]);
  near(t[0].m[5], -(10 - 1)); // 위 부착: 첫 기준선은 삽입점에서 글자 높이만큼 아래
  near(t[1].m[5] - t[0].m[5], 5 / 3); // 줄 간격 5/3
  assert.equal(t[0].anchor, 0);
});

test("해치·SOLID·폭 있는 폴리라인은 면으로, 무늬 해치는 선으로", () => {
  const sq = (x: number, y: number, r: number) => [P(x - r, y - r), P(x + r, y - r), P(x + r, y + r), P(x - r, y + r)].map((p) => ({ ...p, bulge: 0 }));
  const d = buildDrawing(db([
    { type: "HATCH", layer: "0", solidFill: 1, boundaryPaths: [{ vertices: sq(0, 0, 10), isClosed: 1 }, { vertices: sq(0, 0, 2), isClosed: 1 }] },
    { type: "HATCH", layer: "0", solidFill: 0, boundaryPaths: [{ edges: [{ type: 1, start: P(0, 0), end: P(10, 0) }, { type: 1, start: P(10, 0), end: P(10, 10) }, { type: 1, start: P(10, 10), end: P(0, 10) }, { type: 1, start: P(0, 10), end: P(0, 0) }] }], definitionLines: [{ angle: 0, base: P(0, 0), offset: P(0, 1), dashLengths: [] }] },
    { type: "SOLID", layer: "0", corner1: P(0, 0), corner2: P(1, 0), corner3: P(0, 1), corner4: P(1, 1) },
    { type: "LWPOLYLINE", layer: "0", flag: 0, vertices: [{ x: 0, y: 0, bulge: 0, startWidth: 1, endWidth: 0 }, { x: 10, y: 0, bulge: 0 }] },
    { type: "LWPOLYLINE", layer: "0", flag: 0x200, constantWidth: 0.3, vertices: [{ x: 0, y: 0, bulge: 1 }, { x: 10, y: 0, bulge: 0 }] },
  ]));
  const s = d.sheets[0].scene;
  const hole = item(s, 0);
  assert.ok(hole.flags & F_FILL);
  assert.equal(hole.n, 4 + 4 + 1 + 1, "바깥 고리 + 안 고리 + 안 고리 첫 점 + 바깥 첫 점");
  const lines = s.ents.indexOf(s.ents[item(s, 1).ent]);
  let n = 0; for (let i = 0; i < s.items.length / ITEM; i++) if (item(s, i).ent === lines) n++;
  assert.ok(n >= 9 && n <= 11, `무늬선 ${n}`);
  const solid = [...Array(s.items.length / ITEM).keys()].find((i) => s.ents[item(s, i).ent].type === "SOLID")!;
  assert.deepEqual(pts(s, solid), [0, 0, 1, 0, 1, -1, 0, -1], "SOLID 꼭짓점 순서 1-2-4-3");
  const taper = [...Array(s.items.length / ITEM).keys()].find((i) => s.ents[item(s, i).ent].type === "LWPOLYLINE")!;
  assert.ok(item(s, taper).flags & F_FILL, "폭이 변하는 구간은 면");
  const wide = s.items.length / ITEM - 1;
  near(item(s, wide).style.ww, 0.3); assert.ok(item(s, wide).flags & F_CLOSED);
  // 반원 굴곡: 중심 (5,0) 반지름 5 위에 있어야 한다
  const w = pts(s, wide);
  for (let i = 0; i < w.length; i += 2) near(Math.hypot(w[i] - 5, w[i + 1]), 5, 1e-6);
});

test("법선이 뒤집힌 호는 x가 반대이고, 보이지 않는 엔티티는 빠진다", () => {
  const d = buildDrawing(db([
    { type: "ARC", layer: "0", center: P(10, 0), radius: 1, startAngle: 0, endAngle: Math.PI, extrusionDirection: { x: 0, y: 0, z: -1 } },
    { type: "LINE", layer: "0", isVisible: false, startPoint: P(0, 0), endPoint: P(1, 1) },
  ]));
  const s = d.sheets[0].scene;
  assert.equal(s.items.length / ITEM, 1);
  const a = pts(s, 0);
  near(a[0], -11); near(a[1], 0);
});

test("배치: 종이 공간 시트와 뷰포트 변환", () => {
  const d = buildDrawing(db([{ type: "LINE", layer: "0", startPoint: P(0, 0), endPoint: P(100, 0) }], {
    blocks: [{ name: "*Paper_Space", handle: "50", entities: [
      { type: "VIEWPORT", layer: "0", viewportId: 1, viewportCenter: P(100, 100), width: 300, height: 200, viewHeight: 200 },
      { type: "VIEWPORT", layer: "0", viewportId: 2, viewportCenter: P(50, 50), width: 50, height: 20, viewHeight: 200, targetPoint: P(0, 0), displayCenter: { x: 50, y: 0 } },
      { type: "LINE", layer: "0", startPoint: P(0, 0), endPoint: P(200, 0) },
    ] }],
    objects: { LAYOUT: [{ layoutName: "Sheet A", tabOrder: 1, paperSpaceTableId: "50" }] },
  }));
  assert.equal(d.sheets.length, 2);
  const [, sheet] = d.sheets;
  assert.equal(sheet.name, "Sheet A");
  assert.equal(sheet.viewports.length, 1, "첫 뷰포트는 종이 자체라 창이 아니다");
  const vp = sheet.viewports[0];
  near(vp.s, 0.1);
  // 모델 (50,0)(=표시 중심)이 종이의 뷰포트 중심 (50,50)에 와야 한다. 장면 좌표는 y가 뒤집혀 있다.
  near(vp.s * 50 + vp.ox, 50); near(vp.s * -0 + vp.oy, -50);
  assert.deepEqual(vp.clip, { x: 25, y: -60, w: 50, h: 20 });
  assert.equal(sheet.scene.items.length / ITEM, 2, "뷰포트 테두리와 종이의 선");
});

test("필드가 빠진 엔티티는 그 하나만 건너뛰고, 보조선은 못 그린 것으로 센다", () => {
  const d = buildDrawing(db([
    { type: "LINE", layer: "0", startPoint: P(0, 0) },
    { type: "CIRCLE", layer: "0", radius: 1 },
    { type: "XLINE", layer: "0", firstPoint: P(0, 0), unitDirection: P(1, 0) },
    { type: "LINE", layer: "0", startPoint: P(0, 0), endPoint: P(1, 1) },
  ]));
  assert.equal(d.sheets[0].scene.items.length / ITEM, 1);
  assert.deepEqual(d.skipped, { "LINE:bad": 1, "CIRCLE:bad": 1, XLINE: 1 });
});

test("시작점이 정렬점과 같은 가운데 글자는 정렬점에 가운데 앵커로 놓인다", () => {
  const d = buildDrawing(db([{ type: "TEXT", layer: "0", text: "AB", textHeight: 2, halign: 1, valign: 2, startPoint: P(5, 5), endPoint: P(5, 5) }]));
  const t = d.sheets[0].scene.texts[0];
  assert.equal(t.anchor, 1);
  near(t.m[5], -(5 - 1)); // 세로 가운데: 기준선은 정렬점보다 글자 높이의 절반 아래
});

test("입체는 2D에서 위에서 본 모서리로, MTEXT는 상자 폭에 맞춰 줄바꿈, 선종류 글자는 선을 따라 놓인다", () => {
  const solids = new Map([["S1", { lines: [[0, 0, 5, 10, 0, 5], [10, 0, 5, 10, 10, 9]], skipped: {} }]]);
  const d = buildDrawing(db([
    { type: "3DSOLID", layer: "0", handle: "S1", data: 1 },
    { type: "MTEXT", layer: "0", text: "AAAA BBBB CCCC", textHeight: 1, insertionPoint: P(0, 0), attachmentPoint: 1, rectWidth: 10, lineSpacing: 1 },
    { type: "LINE", layer: "0", lineType: "HW", startPoint: P(0, 0), endPoint: P(40, 0) },
  ], {
    tables: { LTYPE: { entries: [{ name: "HW", totalPatternLength: 20, pattern: [{ elementLength: 10 }, { elementLength: -5, elementTypeFlag: 2, text: "HW", scale: 2, offsetX: -1, offsetY: -0.5 }, { elementLength: -5 }] }] } },
  }), { solids, measure: (s) => s.length * 0.6 }); // 글자 하나 0.6em: "AAAA BBBB"는 5.4em, 폭 10em / (1/0.72) = 7.2em
  const s = d.sheets[0].scene;
  assert.equal(s.items.length / ITEM, 3, "입체 모서리 2 + 선 1");
  assert.deepEqual(pts(s, 0), [0, 0, 10, 0]);
  assert.deepEqual(s.texts.filter((t) => t.str !== "HW").map((t) => t.str), ["AAAA BBBB", "CCCC"]);
  const hw = s.texts.filter((t) => t.str === "HW");
  // 무늬 한 주기 20 × LTSCALE 2 = 40. 글자는 10×2 = 20 지점, 오프셋 (-1,-0.5)×2 → (18, -1). 선 길이 40이라 하나뿐.
  assert.equal(hw.length, 1);
  near(hw[0].m[4], 18); near(hw[0].m[5], 1); near(hw[0].size, 4 / 0.72);
});

test("줄바꿈: 줄 끝 공백은 안 세고, 긴 라틴 단어는 자르지 않고, 긴 한글은 글자 단위로 끊는다", () => {
  const m = (s: string) => s.length * 0.6;
  const lines = (text: string, w: number) => buildDrawing(db([{ type: "MTEXT", layer: "0", text, textHeight: 0.72, insertionPoint: P(0, 0), attachmentPoint: 1, rectWidth: w }]), { measure: m }).sheets[0].scene.texts.map((t) => t.str);
  assert.deepEqual(lines("AAAAAAA BBBBBBBB CC", 10), ["AAAAAAA BBBBBBBB", "CC"]);
  assert.deepEqual(lines("2,700,000kcal/hr", 6), ["2,700,000kcal/hr"]);
  assert.deepEqual(lines("가나다라마바사아자차", 3), ["가나다라마", "바사아자차"]);
});

test("선종류 글자: 오른쪽→왼쪽 선에서 U 요소는 바로 서고, 배율 반올림이 점선과 같다", () => {
  const lt = { tables: { LTYPE: { entries: [{ name: "HW", totalPatternLength: 20, pattern: [{ elementLength: 10 }, { elementLength: -10, elementTypeFlag: 10, text: "HW", scale: 2 }] }] } } };
  const d = buildDrawing(db([{ type: "LINE", layer: "0", lineType: "HW", lineTypeScale: 1.049, startPoint: P(2000, 0), endPoint: P(0, 0) }], lt));
  const s = d.sheets[0].scene, hw = s.texts.filter((t) => t.str === "HW");
  assert.ok(hw.length > 40);
  near(Math.atan2(hw[0].m[1], hw[0].m[0]), 0, 1e-9); // 왼쪽으로 가는 선인데 글자는 바로 선다(장면 y 아래라 각 0)
  const period = s.styles[s.items[2]].dash!.reduce((a, b) => a + b, 0);
  near(hw[1].m[4] - hw[0].m[4], -period, 1e-9); // 글자 간격 = 점선 주기(반올림된 배율)
});
