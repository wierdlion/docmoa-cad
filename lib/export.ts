import { draw } from "./canvas";
import type { Box, Scene } from "./scene";

const save = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
};

const base = (name: string) => name.replace(/\.[^.]+$/, "");

/** 화면에 보이는 범위를 그대로 그림으로 저장한다. 화면과 같은 렌더러로 그리므로 보이는 것과 같다. */
export async function toPng(scene: Scene, box: Box, hidden: boolean[], filename: string, longest = 2400) {
  const scale = longest / Math.max(box.w, box.h);
  const w = Math.round(box.w * scale), h = Math.round(box.h * scale);
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  draw(canvas.getContext("2d")!, scene, box, w, h, 1, hidden);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("png");
  save(blob, `${base(filename)}.png`);
}

/**
 * PDF는 벡터여야 하므로 변환기의 SVG를 그대로 쓴다(svg2pdf). 뷰어는 DOM을 만들지 않으니 저장할 때만
 * 문자열에서 SVG 요소를 만들고, 화면과 같은 뷰·레이어 상태를 입힌다. svg2pdf는 viewBox 밖 요소도 전부
 * 쓰므로(10MB 도면이면 PDF가 130MB) 화면 밖 엔티티와 숨긴 레이어는 요소째 뺀다.
 */
export function materializeSvg(svgText: string, box: Box, scene: Pick<Scene, "handleBounds">, layerOf: Record<string, string>, drop: string[], hiddenLayers: Set<string>): SVGSVGElement {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement as unknown as SVGSVGElement;
  if (svg.nodeName !== "svg") throw new Error("draw");
  for (const h of drop) doc.getElementById(h)?.remove();
  const pad = Math.max(box.w, box.h) * 0.01;
  const x0 = box.x - pad, y0 = box.y - pad, x1 = box.x + box.w + pad, y1 = box.y + box.h + pad;
  for (const h of Object.keys(layerOf)) {
    const b = scene.handleBounds[h];
    const outside = b && (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1);
    if (outside || hiddenLayers.has(layerOf[h])) doc.getElementById(h)?.remove();
  }
  svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.w} ${box.h}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  return svg;
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
  if (/[㐀-鿿豈-﫿]/.test(text)) return HAN[locale] ?? "NotoSansSC-Regular";
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

/** 벡터 PDF. 확대해도 선이 뭉개지지 않는 게 래스터 대비 유일한 이유다. */
export async function toPdf(svg: SVGSVGElement, box: Box, filename: string, locale = "en") {
  const name = pickFont([...svg.querySelectorAll("text")].map((t) => t.textContent ?? "").join(""), locale);
  const [{ jsPDF }, { svg2pdf }, font] = await Promise.all([import("jspdf"), import("svg2pdf.js"), loadFont(name)]);
  const landscape = box.w >= box.h;
  // compress: 벡터 스트림은 압축이 잘 된다. 끄면 큰 도면의 PDF가 100MB를 넘는다.
  const pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: "a4", compress: true });
  pdf.addFileToVFS(`${name}.ttf`, font);
  pdf.addFont(`${name}.ttf`, name, "normal");
  pdf.setFont(name);
  const pw = landscape ? 297 : 210, ph = landscape ? 210 : 297, margin = 10;
  const scale = Math.min((pw - margin * 2) / box.w, (ph - margin * 2) / box.h);
  const w = box.w * scale, h = box.h * scale;

  // PDF는 흰 종이다. 검은 배경용 밝은 선은 종이에서 안 보이므로 전부 검게 그린다.
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  for (const el of clone.querySelectorAll<SVGElement>("[stroke]")) el.setAttribute("stroke", "#000");
  for (const el of clone.querySelectorAll<SVGElement>("text")) {
    el.setAttribute("fill", "#000");
    el.setAttribute("font-family", name);
  }

  document.body.appendChild(clone);
  try {
    await svg2pdf(clone, pdf, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  } finally {
    clone.remove();
  }
  pdf.save(`${base(filename)}.pdf`);
}
