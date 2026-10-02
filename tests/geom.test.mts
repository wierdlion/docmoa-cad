import { test } from "node:test";
import assert from "node:assert/strict";
import { bspline, bulgeArc, hatchLines, ribbon, smooth, sweep } from "@/lib/geom";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test("bulge 1은 반원: 모든 점이 현의 중점에서 반지름만큼 떨어진다", () => {
  const p = bulgeArc(0, 0, 10, 0, 1);
  for (let i = 0; i < p.length; i += 2) near(Math.hypot(p[i] - 5, p[i + 1]), 5);
  assert.ok(p[3] < 0, "양수 bulge는 반시계: 오른쪽으로 가면 현 아래로 처진다");
  near(p[p.length - 2], 10); near(p[p.length - 1], 0);
  assert.deepEqual(bulgeArc(0, 0, 1, 1, 0), [0, 0, 1, 1]);
});

test("sweep: 원 한 바퀴를 닫힌 점열로", () => {
  const p = sweep(0, 0, 2, 0, 0, 2, 0, Math.PI * 2, true);
  assert.equal(p.length / 2, 64);
  for (let i = 0; i < p.length; i += 2) near(Math.hypot(p[i], p[i + 1]), 2);
});

test("1차 B-스플라인은 조절점을 잇는 꺾은선이고, 매듭 수가 안 맞으면 null", () => {
  const cp = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }];
  const p = bspline(cp, 1, [0, 0, 1, 2, 2], undefined, 2)!;
  assert.deepEqual(p, [0, 0, 0.5, 0.5, 1, 1, 1.5, 0.5, 2, 0]);
  assert.equal(bspline(cp, 3, [0, 1, 2]), null);
});

test("Catmull-Rom은 주어진 점을 지난다", () => {
  const pts = [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 0 }];
  const p = smooth(pts, false, 4);
  near(p[0], 0); near(p[1], 0); near(p[8], 1); near(p[9], 2); near(p[p.length - 2], 2); near(p[p.length - 1], 0);
});

test("폭 있는 선은 양쪽으로 반씩 벌어진 면이 된다", () => {
  const r = ribbon([0, 0, 10, 0], 2, 0).map((v) => v + 0);
  assert.deepEqual(r, [0, 1, 10, 0, 10, 0, 0, -1]);
});

test("무늬 해치: 정사각형 안에 수평선, 점선 무늬면 조각이 난다", () => {
  const sq = [0, 0, 10, 0, 10, 10, 0, 10];
  const lines = hatchLines([sq], [{ angle: 0, base: { x: 0, y: 1 }, offset: { x: 0, y: 2 } }])!;
  assert.equal(lines.length, 5, "y = 1,3,…,9");
  for (const [x0, , x1] of lines) { near(Math.min(x0, x1), 0); near(Math.max(x0, x1), 10); }
  const dashed = hatchLines([sq], [{ angle: 0, base: { x: 0, y: 2.5 }, offset: { x: 0, y: 5 }, dashLengths: [1, -1] }])!;
  assert.equal(dashed.length, 2 * 5);
  assert.equal(hatchLines([sq], [{ angle: 0, base: { x: 0, y: 0 }, offset: { x: 0, y: 0.0001 } }], 100), null, "너무 촘촘하면 포기");
});
