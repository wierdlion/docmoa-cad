import type { Box } from "./fit";

const save = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
};

const base = (name: string) => name.replace(/\.[^.]+$/, "");

/** 화면에 보이는 범위를 그대로 그림으로 저장한다. CAD 도면은 검은 배경이 기본이라 배경도 함께 굽는다. */
export async function toPng(svg: SVGSVGElement, box: Box, filename: string, longest = 2400) {
  const scale = longest / Math.max(box.w, box.h);
  const w = Math.round(box.w * scale), h = Math.round(box.h * scale);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));

  const img = new Image();
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error("png")); img.src = url; });
    const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (blob) save(blob, `${base(filename)}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * jsPDF 기본 폰트는 Latin-1만 담아서 한글·일본어·태국어가 전부 깨진다. 도면에 실제로 쓰인 글자를
 * 보고 맞는 폰트 하나를 심는다. 큰 건 10MB라 PDF를 누를 때만 받는다(전부 OFL, public/fonts/).
 * jsPDF가 쓰인 글자만 추려 담으므로 결과 PDF는 수백 KB에서 끝난다.
 * ponytail: 한 도면에 여러 문자를 섞어 쓰면 폰트는 그중 하나만 고른다. 섞인 도면이 문제가 되면 그때 나눈다.
 */
const SCRIPTS: { font: string; re: RegExp }[] = [
  { font: "NotoSansJP-Regular", re: /[\u3040-\u30ff]/ },        // 가나가 있으면 일본어
  { font: "NanumGothic-Regular", re: /[\uac00-\ud7a3]/ },       // 한글
  { font: "NotoSansThai-Regular", re: /[\u0e00-\u0e7f]/ },
  { font: "NotoSansArabic-Regular", re: /[\u0600-\u06ff]/ },
  { font: "NotoSansDevanagari-Regular", re: /[\u0900-\u097f]/ },
];
/** 한자는 글자만 봐서는 어느 쪽인지 못 가른다. 화면 언어를 힌트로 쓴다. */
const HAN: Record<string, string> = { ja: "NotoSansJP-Regular", ko: "NanumGothic-Regular", "zh-tw": "NotoSansTC-Regular" };

function pickFont(text: string, locale: string) {
  for (const s of SCRIPTS) if (s.re.test(text)) return s.font;
  if (/[\u3400-\u9fff\uf900-\ufaff]/.test(text)) return HAN[locale] ?? "NotoSansSC-Regular";
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
  const pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
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
