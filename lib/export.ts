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
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error("그림으로 바꾸지 못했습니다.")); img.src = url; });
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
 * jsPDF 기본 폰트는 Latin-1만 담아서 한글이 전부 깨진다. 한글 폰트를 통째로 심어야 하는데
 * 2MB라 PDF를 실제로 누를 때만 받는다. (OFL, public/fonts/)
 */
let korean: Promise<string> | null = null;
const koreanFont = () =>
  (korean ??= fetch("/cad/fonts/NanumGothic-Regular.ttf")
    .then((r) => {
      if (!r.ok) throw new Error("한글 폰트를 받지 못했습니다.");
      return r.arrayBuffer();
    })
    .then((b) => {
      const u = new Uint8Array(b);
      let bin = "";
      // 한 번에 넘기면 인자 수 제한에 걸린다.
      for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(bin);
    })
    .catch((e) => { korean = null; throw e; }));

/** 벡터 PDF. 확대해도 선이 뭉개지지 않는 게 래스터 대비 유일한 이유다. */
export async function toPdf(svg: SVGSVGElement, box: Box, filename: string) {
  const [{ jsPDF }, { svg2pdf }, font] = await Promise.all([import("jspdf"), import("svg2pdf.js"), koreanFont()]);
  const landscape = box.w >= box.h;
  const pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
  pdf.addFileToVFS("NanumGothic.ttf", font);
  pdf.addFont("NanumGothic.ttf", "NanumGothic", "normal");
  pdf.setFont("NanumGothic");
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
    el.setAttribute("font-family", "NanumGothic");
  }

  document.body.appendChild(clone);
  try {
    await svg2pdf(clone, pdf, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  } finally {
    clone.remove();
  }
  pdf.save(`${base(filename)}.pdf`);
}
