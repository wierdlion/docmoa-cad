import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readCad } from "@/lib/dwg";
import { decodeDxf, patchR12 } from "@/lib/dxf";
import { F_CLOSED, F_FILL, ITEM, type Scene } from "@/lib/scene";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const item = (s: Scene, i: number) => ({ n: s.items[i * ITEM + 1], style: s.styles[s.items[i * ITEM + 2]], layer: s.items[i * ITEM + 3], flags: s.items[i * ITEM + 4], ent: s.ents[s.items[i * ITEM + 5]] });
const items = (s: Scene) => [...Array(s.items.length / ITEM).keys()].map((i) => item(s, i));
const pts = (s: Scene, i: number) => [...s.verts.subarray(s.items[i * ITEM] * 2, (s.items[i * ITEM] + s.items[i * ITEM + 1]) * 2)];

async function open(name: string) {
  const b = await readFile(new URL(`./fixtures/${name}`, import.meta.url));
  return readCad(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, name, "unused");
}

// ezdxf로 만든 R2018 DXF: 선·원·호·글자·폴리라인·MTEXT·해치·속성 블록·치수·배치 뷰포트
test("DXF(R2018): 엔티티·블록 속성·배치가 DWG와 같은 모양으로 들어온다", async () => {
  const { drawing } = await open("ezdxf_2018.dxf");
  const s = drawing.sheets[0].scene;
  assert.equal(drawing.unit, "mm");
  assert.deepEqual(drawing.skipped, { POINT: 3 }, JSON.stringify(drawing.skipped)); // 치수 블록의 정의점뿐
  const strs = s.texts.map((t) => t.str);
  assert.ok(strs.includes("DXF TEST Ø20 한글"), "%%c와 \\U+ 표기가 풀려야 한다");
  assert.ok(strs.includes("MTEXT line1") && strs.includes("line2"), "MTEXT 줄 나눔");
  assert.ok(strs.includes("10000"), "치수 글자(블록 *D1의 MTEXT)");
  const tag = s.ents.find((e) => e.type === "INSERT" && e.name === "TAG")!;
  assert.deepEqual(tag.attrs, [["NAME", "PUMP-1"]], "INSERT 뒤에 따로 오는 ATTRIB을 거둔다");
  assert.ok(strs.includes("PUMP-1"));
  // 레이어 색·선종류: WALLS는 빨강, HIDDEN은 DASHED 점선
  const walls = items(s).find((it) => drawing.layers[it.layer].name === "WALLS")!;
  assert.equal(s.colors[walls.style.color], "#ff0000");
  const hidden = items(s).find((it) => drawing.layers[it.layer].name === "HIDDEN")!;
  assert.ok(hidden.style.dash && hidden.style.dash.length >= 2, "점선");
  assert.ok(hidden.flags & F_CLOSED, "닫힌 LWPOLYLINE(DXF flag 1 → 512)");
  // 호 각도는 도(°)로 적혀 있다: 0°→180° 상반원이면 모든 점이 중심(50,25)보다 위(장면 y는 아래 방향)
  const arc = items(s).findIndex((it) => it.ent.type === "ARC");
  const a = pts(s, arc);
  for (let i = 0; i < a.length; i += 2) { near(Math.hypot(a[i] - 50, a[i + 1] + 25), 15, 1e-6); assert.ok(a[i + 1] <= -25 + 1e-9); }
  assert.ok(items(s).some((it) => it.ent.type === "HATCH" && it.flags & F_FILL), "SOLID 해치는 면");
  // 치수 화살촉 블록(_ARCHTICK, 폭 0.15 폴리라인)이 180° 돌아서도 들어온다
  const ticks = items(s).filter((it) => it.ent.type === "DIMENSION" && it.style.ww > 0);
  assert.equal(ticks.length, 2);
  // 배치: Layout1은 비어 있어 빠지고 Sheet1은 뷰포트 하나(축척 170/120)와 글자
  assert.deepEqual(drawing.sheets.map((x) => x.name), ["Model", "Sheet1"]);
  const sheet = drawing.sheets[1];
  assert.equal(sheet.viewports.length, 1);
  near(sheet.viewports[0].s, 170 / 120);
  assert.ok(sheet.scene.texts.some((t) => t.str === "PAPER SPACE"));
});

// 같은 도면의 R12 판: 블록 끝 표식(100 AcDbBlockEnd)이 없고 POLYLINE+VERTEX, $Model_Space 이름을 쓴다
test("DXF(R12): 블록 끝 표식이 없어도 엔티티를 읽고, 옛 폴리라인과 모델 공간 이름을 맞춘다", async () => {
  const { drawing } = await open("ezdxf_r12.dxf");
  const s = drawing.sheets[0].scene;
  assert.ok(s.items.length / ITEM >= 9, `items ${s.items.length / ITEM}`);
  assert.ok(s.texts.some((t) => t.str === "DXF TEST Ø20 한글"));
  const poly = items(s).find((it) => it.ent.type === "POLYLINE2D")!;
  assert.ok(poly && poly.flags & F_CLOSED && drawing.layers[poly.layer].name === "HIDDEN");
  const tag = s.ents.find((e) => e.type === "INSERT" && e.name === "TAG")!;
  assert.deepEqual(tag.attrs, [["NAME", "PUMP-1"]]);
  assert.equal(drawing.sheets.length, 1, "R12 배치는 뷰포트 정보가 XDATA에만 있어 열지 않는다");
});

// CP949로 적힌 R12 파일. 바이트가 UTF-8이 아니라 파일로 두지 않고 여기서 만든다("한글 치수" = C7D1 B1DB 20 C4A1 BCF6).
const CP949_R12 = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009", "9", "$DWGCODEPAGE", "3", "ANSI_949", "0", "ENDSEC",
  "0", "SECTION", "2", "ENTITIES", "0", "LINE", "8", "0", "10", "0", "20", "0", "30", "0", "11", "50", "21", "0", "31", "0",
  "0", "TEXT", "8", "0", "10", "0", "20", "10", "30", "0", "40", "5", "1", "\xc7\xd1\xb1\xdb \xc4\xa1\xbc\xf6 %%c20", "0", "ENDSEC", "0", "EOF"].join("\n");

test("DXF(R12, CP949): $DWGCODEPAGE대로 한글을 푼다", async () => {
  const b = Buffer.from(CP949_R12, "latin1");
  const { drawing } = await readCad(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, "ko.dxf", "unused");
  assert.ok(drawing.sheets[0].scene.texts.some((t) => t.str === "한글 치수 Ø20"), drawing.sheets[0].scene.texts.map((t) => t.str).join("|"));
});

// 한글 주석·꺾쇠 치수 `<53>`·%%D(°)·%%C(Ø)·점선 레이어·한글 속성이 든 자작 도면(ezdxf). 실제 회사 도면 대신 쓴다.
test("한글 도면: 기호와 꺾쇠 표기가 글자로 살아 있고 점선·속성이 들어온다", async () => {
  const { drawing } = await open("ko_notes_2018.dxf");
  const s = drawing.sheets[0].scene;
  const strs = new Set(s.texts.map((t) => t.str));
  assert.ok([...strs].some((v) => v.includes("치수")), "한글 텍스트");
  assert.ok(strs.has("<53>"), "꺾쇠 치수 표기");
  assert.ok(strs.has("5°") && strs.has("Ø20"), "%%D는 도, %%C는 지름 기호로");
  assert.ok(strs.has("재질: SM45C") && strs.has("열처리: 노멀라이징"), "MTEXT 줄 나눔");
  const thin = items(s).find((it) => drawing.layers[it.layer].name === "THIN")!;
  assert.ok(thin.style.dash, "THIN 레이어는 DASHED 점선");
  assert.deepEqual(s.ents.find((e) => e.name === "TITLE")!.attrs, [["PART", "품명: 베이스"]]);
  for (let i = 0; i < s.verts.length; i++) assert.ok(Number.isFinite(s.verts[i]), "NaN 좌표");
});

test("decodeDxf: 2007 이후는 UTF-8, 그 전은 코드페이지", () => {
  const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
  assert.equal(decodeDxf(enc("  9\n$ACADVER\n  1\nAC1032\n  9\n$DWGCODEPAGE\n  3\nANSI_949\n한글")).slice(-2), "한글");
  const cp949 = new Uint8Array([...new TextEncoder().encode("  9\n$ACADVER\n  1\nAC1009\n  9\n$DWGCODEPAGE\n  3\nANSI_949\n"), 0xc7, 0xd1]);
  assert.equal(decodeDxf(cp949.buffer as ArrayBuffer).slice(-1), "한");
});

test("patchR12: ENDBLK 뒤에만 표식을 끼우고, 이미 있으면 손대지 않는다", () => {
  assert.equal(patchR12("  0\nBLOCK\n  2\nA\n  0\nLINE\n  0\nENDBLK\n  5\n19\n  0\nBLOCK\n"), "  0\nBLOCK\n  2\nA\n  0\nLINE\n  0\nENDBLK\n100\nAcDbBlockEnd\n  5\n19\n  0\nBLOCK\n");
  const r2000 = "  0\nENDBLK\n100\nAcDbBlockEnd\n";
  assert.equal(patchR12(r2000), r2000);
});

test("DXF가 아닌 파일은 read 오류", async () => {
  await assert.rejects(readCad(new TextEncoder().encode("hello").buffer as ArrayBuffer, "x.dxf", "unused"), /read/);
});
