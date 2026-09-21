import { test } from "node:test";
import assert from "node:assert/strict";
import { pickFont } from "@/lib/export";

// 폰트는 화면 언어가 아니라 도면에 쓰인 글자로 고른다. 여기가 틀리면 PDF 글자가 통째로 깨진다.
test("도면 글자로 폰트를 고른다", () => {
  assert.equal(pickFont("SCALE 1:100", "ko"), "NotoSans-Regular");        // 한글 화면이어도 라틴 도면
  assert.equal(pickFont("축척 1:100", "en"), "NanumGothic-Regular");      // 영어 화면에서 연 한글 도면
  assert.equal(pickFont("スケール 1:100", "en"), "NotoSansJP-Regular");   // 가나가 있으면 일본어
  assert.equal(pickFont("Черт. 1:100", "en"), "NotoSans-Regular");        // 키릴도 Noto Sans가 담는다
  assert.equal(pickFont("มาตราส่วน", "en"), "NotoSansThai-Regular");
});

// 한자만 있으면 글자로는 못 가른다. 화면 언어가 힌트다.
test("한자는 화면 언어로 가른다", () => {
  assert.equal(pickFont("图纸比例", "zh"), "NotoSansSC-Regular");
  assert.equal(pickFont("圖面比例", "zh-tw"), "NotoSansTC-Regular");
  assert.equal(pickFont("図面比例", "ja"), "NotoSansJP-Regular");
  // 가나 없는 일본 도면을 영어 화면에서 열면 간체 폰트가 걸린다. 화면 언어 말고는 단서가 없다.
  assert.equal(pickFont("図面比例", "en"), "NotoSansSC-Regular");
});
