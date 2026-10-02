import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDrawing } from "@/lib/build";
import { measureEnt, measurePoints, pick, search, snap } from "@/lib/pick";

const P = (x: number, y: number) => ({ x, y, z: 0 });
const d = buildDrawing({
  tables: { LAYER: { entries: [{ name: "0", colorIndex: 7 }] }, BLOCK_RECORD: { entries: [{ name: "*Model_Space", handle: "1F", entities: [
    { type: "LINE", layer: "0", startPoint: P(0, 0), endPoint: P(10, 0) },
    { type: "LWPOLYLINE", layer: "0", flag: 0x200, vertices: [{ x: 20, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 3 }, { x: 20, y: 3 }] },
    { type: "TEXT", layer: "0", text: "Pump P-101", textHeight: 1, startPoint: P(50, 50), endPoint: P(0, 0) },
  ] }] } },
});
const s = d.sheets[0].scene;
const none: boolean[] = [];

test("클릭한 자리에서 가장 가까운 엔티티를 고른다", () => {
  assert.equal(s.ents[pick(s, 5, 0.5, 1, none)].type, "LINE");
  assert.equal(s.ents[pick(s, 22, -0.5, 1, none)].type, "LWPOLYLINE");
  assert.equal(pick(s, 5, 5, 1, none), -1);
  assert.equal(pick(s, 5, 0.5, 1, [true]), -1, "숨긴 레이어는 고르지 않는다");
  assert.equal(s.ents[pick(s, 52, -50.3, 0.5, none)].type, "TEXT", "글자 상자 안쪽");
});

test("끝점에 붙는다", () => {
  const p = snap(s, 9.6, 0.2, 1, none)!; assert.deepEqual([p.x, p.y + 0], [10, 0]);
  assert.equal(snap(s, 5, 0, 1, none), null);
});

test("글자 검색과 길이·면적", () => {
  assert.deepEqual(search(s, "p-101"), [0]);
  assert.deepEqual(search(s, "  "), []);
  assert.deepEqual(measureEnt(s, 0), { length: 10, area: 0 });
  assert.deepEqual(measureEnt(s, 1), { length: 14, area: 12 });
  assert.deepEqual(measurePoints([{ x: 0, y: 0 }, { x: 3, y: 4 }]), { length: 5, area: 0 });
  assert.deepEqual(measurePoints([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }]), { length: 7, area: 6 });
});

test("검색은 숨긴 레이어의 글자를 빼놓는다", () => {
  assert.deepEqual(search(s, "pump", [true]), []);
});
