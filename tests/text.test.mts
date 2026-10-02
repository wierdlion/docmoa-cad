import { test } from "node:test";
import assert from "node:assert/strict";
import { mtext, plain, roughWidth, unmangle } from "@/lib/text";

test("TEXT 제어 코드", () => {
  assert.equal(plain("%%c50 %%d %%p0.1 %%%"), "Ø50 ° ±0.1 %");
  assert.equal(plain("%%uUNDER%%u \\U+00B0"), "UNDER °");
});

test("MTEXT 서식을 걷어내고 줄을 나눈다", () => {
  const m = mtext("\\pxqc;{\\fGulim|b0|i0|c129|p50;RINSING\\PWATER\\P\\pq*;탱크\\P(30㎥)}");
  assert.deepEqual(m.lines, ["RINSING", "WATER", "탱크", "(30㎥)"]);
  assert.equal(m.align, 1);
  assert.deepEqual(mtext("{\\C0;NaoH\\P원액탱크}").lines, ["NaoH", "원액탱크"]);
  assert.deepEqual(mtext("\\W0.8;A\\S1^2;B %%d \\{x\\}").lines, ["A1/2B ° {x}"]);
  assert.equal(mtext("\\W0.8;x").width, 0.8);
});

test("UTF-16으로 잘못 읽힌 1바이트 글자를 되돌린다", () => {
  assert.equal(unmangle("硸停灜瑸㬱硸"), "xx\\P\\pxt1;xx");
  assert.equal(unmangle("한글"), "한글");
  assert.equal(unmangle("abc"), "abc");
});

test("어림 폭: 한중일은 전각", () => {
  assert.ok(roughWidth("가나") > roughWidth("ab") * 1.5);
});
