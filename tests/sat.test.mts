import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { satToLines } from "@/lib/sat";

// 원뿔 솔리드의 ACIS 데이터. 밑면 원 하나가 나와야 한다.
// transform이 (10,10,7.5)라서 중심 z=-7.5 인 원이 z=0 으로 옮겨진다.
test("입체에서 모서리를 뽑아 3D 선으로 만든다", () => {
  const sat = readFileSync(new URL("./fixtures/cone.sat", import.meta.url), "utf8");
  const { lines, skipped } = satToLines(sat);

  assert.equal(lines.length, 1, "밑면 원 하나");
  assert.deepEqual(skipped, {}, "못 그린 곡선이 없어야 한다");

  const pts = lines[0];
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < pts.length; i += 3) { xs.push(pts[i]); ys.push(pts[i + 1]); zs.push(pts[i + 2]); }
  // 중심 (10,10,0), 반지름 5
  assert.ok(Math.abs(Math.min(...xs) - 5) < 0.01 && Math.abs(Math.max(...xs) - 15) < 0.01, `x 범위가 5~15여야: ${Math.min(...xs)}~${Math.max(...xs)}`);
  assert.ok(Math.max(...zs) - Math.min(...zs) < 0.01, "밑면이므로 z가 일정해야");
});
