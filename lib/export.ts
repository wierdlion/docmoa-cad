import type { jsPDF } from "jspdf";
import { drawSheet, FONT_PX, LIGHT, type Ctx, type DrawOpts, type Theme } from "./canvas";
import type { Box, Scene, Sheet } from "./scene";

const save = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
};

const base = (name: string) => name.replace(/\.[^.]+$/, "");

/** 화면에서 가는 선은 1px, 선굵기가 지정된 것만 그에 비례해 굵게. */
export const SCREEN: Pick<DrawOpts, "px" | "pen"> = { px: 1, pen: (mm) => Math.max(1, mm / 0.3) };

/** 화면에 보이는 범위를 그대로 그림으로 저장한다. 화면과 같은 렌더러로 그리므로 보이는 것과 같다. */
export async function toPng(sheet: Sheet, model: Scene, box: Box, hidden: boolean[], filename: string, theme: Theme, longest: number) {
  const scale = longest / Math.max(box.w, box.h);
  const w = Math.round(box.w * scale), h = Math.round(box.h * scale);
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  drawSheet(canvas.getContext("2d")!, sheet, model, box, { cw: w, ch: h, dpr: 1, hidden, theme, ...SCREEN });
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("png");
  save(blob, `${base(filename)}.png`);
}

/**
 * jsPDF 기본 폰트는 Latin-1만 담아서 한글·일본어·태국어가 전부 깨진다. 도면에 실제로 쓰인 글자를
 * 보고 맞는 폰트 하나를 심는다. 큰 건 10MB라 PDF를 누를 때만 받는다(전부 OFL, public/fonts/).
 * jsPDF가 쓰인 글자만 추려 담으므로 결과 PDF는 수백 KB에서 끝난다.
 * ponytail: 한 도면에 여러 문자를 섞어 쓰면 폰트는 그중 하나만 고른다. 섞인 도면이 문제가 되면 그때 나눈다.
 */
const SCRIPTS: { font: string; re: RegExp }[] = [
  { font: "NotoSansJP-Regular", re: /[぀-ヿ]/ },        // 가나가 있으면 일본어
  { font: "NanumGothic-Regular", re: /[가-힣]/ },       // 한글
  { font: "NotoSansThai-Regular", re: /[฀-๿]/ },
  { font: "NotoSansArabic-Regular", re: /[؀-ۿ]/ },
  { font: "NotoSansDevanagari-Regular", re: /[ऀ-ॿ]/ },
];
/** 한자는 글자만 봐서는 어느 쪽인지 못 가른다. 화면 언어를 힌트로 쓴다. */
const HAN: Record<string, string> = { ja: "NotoSansJP-Regular", ko: "NanumGothic-Regular", "zh-tw": "NotoSansTC-Regular" };

export function pickFont(text: string, locale: string) {
  for (const s of SCRIPTS) if (s.re.test(text)) return s.font;
  if (/[㐀-鿿豈-﫿]/.test(text)) return HAN[locale] ?? "NotoSansSC-Regular";
  return "NotoSans-Regular"; // 라틴·키릴·그리스·베트남어
}

const fonts = new Map<string, Promise<string>>();
const loadFont = (name: string) => {
  const cached = fonts.get(name);
  if (cached) return cached;
  const p = fetch(`/cad/fonts/${name}.ttf`)
    .then((r) => {
      if (!r.ok) throw new Error("font");
      return r.arrayBuffer();
    })
    .then((b) => {
      const u = new Uint8Array(b);
      let bin = "";
      // 한 번에 넘기면 인자 수 제한에 걸린다.
      for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(bin);
    })
    .catch((e) => { fonts.delete(name); throw e; });
  fonts.set(name, p);
  return p;
};

export const PAPERS: Record<string, [number, number]> = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189] };

/**
 * 캔버스 2D API 흉내. 화면을 그리는 drawSheet를 그대로 돌려 PDF 명령으로 바꾼다. 좌표는 mm.
 * 경로 좌표는 현재 변환을 거쳐 바로 쓰고, 선 굵기·점선은 그 변환의 배율만큼 키운다.
 */
class PdfCtx implements Ctx {
  private m = [1, 0, 0, 1, 0, 0];
  private n = 0;
  private dash: number[] = [];
  private box = [0, 0, 0, 0];
  lineWidth = 1;
  strokeStyle: Ctx["strokeStyle"] = "#000000";
  fillStyle: Ctx["fillStyle"] = "#000000";
  font = "";
  lineJoin: CanvasLineJoin = "round";
  textBaseline: CanvasTextBaseline = "alphabetic";
  textAlign: CanvasTextAlign = "left";
  constructor(private pdf: jsPDF, private mx: number, private my: number) {}
  private pt(x: number, y: number): [number, number] { const m = this.m; return [m[0] * x + m[2] * y + m[4] + this.mx, m[1] * x + m[3] * y + m[5] + this.my]; }
  private k() { return Math.sqrt(Math.abs(this.m[0] * this.m[3] - this.m[1] * this.m[2])); }
  private rgb(c: Ctx["strokeStyle"]): [number, number, number] { const v = parseInt(String(c).slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { this.m = [a, b, c, d, e, f]; }
  beginPath() { this.n = 0; }
  moveTo(x: number, y: number) { this.pdf.moveTo(...this.pt(x, y)); this.n++; }
  lineTo(x: number, y: number) { this.pdf.lineTo(...this.pt(x, y)); this.n++; }
  closePath() { if (this.n) this.pdf.close(); }
  stroke() {
    if (!this.n) return;
    const k = this.k();
    this.pdf.setDrawColor(...this.rgb(this.strokeStyle));
    this.pdf.setLineWidth(this.lineWidth * k);
    this.pdf.setLineDashPattern(this.dash.map((d) => d * k), 0);
    this.pdf.stroke();
    this.n = 0;
  }
  fill(rule?: CanvasFillRule | Path2D) {
    if (!this.n) return;
    this.pdf.setFillColor(...this.rgb(this.fillStyle));
    if (rule === "evenodd") this.pdf.fillEvenOdd(); else this.pdf.fill();
    this.n = 0;
  }
  fillRect() { /* 종이는 흰색 그대로 */ }
  rect(x: number, y: number, w: number, h: number) { const [px, py] = this.pt(x, y); this.box = [px, py, w * this.k(), h * this.k()]; }
  clip() { const [x, y, w, h] = this.box; this.pdf.rect(x, y, w, h, null); this.pdf.clip(); this.pdf.discardPath(); }
  save() { this.pdf.saveGraphicsState(); }
  restore() { this.pdf.restoreGraphicsState(); }
  setLineDash(d: number[]) { this.dash = d; }
  measureText(str: string) { return { width: this.pdf.getStringUnitWidth(str) * FONT_PX } as TextMetrics; }
  fillText(str: string, x: number, y: number) {
    const m = this.m, sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
    if (!sx || !sy) return;
    this.pdf.setTextColor(...this.rgb(this.fillStyle));
    this.pdf.setFontSize(sy * FONT_PX * (72 / 25.4));
    // 캔버스 각은 화면(y 아래)에서 시계 방향이 +, jsPDF는 반시계가 +.
    this.pdf.text(str, ...this.pt(x, y), { angle: (-Math.atan2(m[1], m[0]) * 180) / Math.PI, horizontalScale: sx / sy });
  }
}

/** 벡터 PDF. 화면과 같은 코드로 그리므로 보이는 것과 같고, 확대해도 선이 뭉개지지 않는다. */
export async function toPdf(sheet: Sheet, model: Scene, box: Box, hidden: boolean[], filename: string, locale: string, paper: string, color: boolean) {
  const text = [sheet.scene, ...(sheet.viewports.length ? [model] : [])].flatMap((s) => s.texts.map((t) => t.str)).join("");
  const name = pickFont(text, locale);
  const [{ jsPDF }, font] = await Promise.all([import("jspdf"), loadFont(name)]);
  const landscape = box.w >= box.h;
  const [short, long] = PAPERS[paper] ?? PAPERS.A4;
  // compress: 벡터 스트림은 압축이 잘 된다. 끄면 큰 도면의 PDF가 100MB를 넘는다.
  const pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: [short, long], compress: true });
  pdf.addFileToVFS(`${name}.ttf`, font);
  pdf.addFont(`${name}.ttf`, name, "normal");
  pdf.setFont(name);
  const pw = landscape ? long : short, ph = landscape ? short : long, margin = 10;
  const ctx = new PdfCtx(pdf, margin, margin);
  // 종이는 흰색: 흰 선은 검게. 색을 살리면 ACI 7만 검게 되고 나머지는 그대로다.
  drawSheet(ctx, sheet, model, box, { cw: pw - margin * 2, ch: ph - margin * 2, dpr: 1, hidden, theme: LIGHT, mono: !color, px: 0.1, pen: (mm) => Math.max(0.1, mm * 0.5) });
  pdf.save(`${base(filename)}.pdf`);
}
