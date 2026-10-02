/** 도면 글자에 섞여 있는 AutoCAD 제어 코드를 화면에 보일 글자로 바꾼다. */

const SYMBOL: Record<string, string> = { d: "°", p: "±", c: "Ø", "%": "%" };

/** TEXT·ATTRIB의 %% 코드와 유니코드 표기. %%c는 PDF 폰트에 없는 ⌀ 대신 Ø로 쓴다. */
export function plain(s: string): string {
  return s
    .replace(/%%(\d{3})/g, (_, n: string) => String.fromCharCode(+n))
    .replace(/%%([dpcDPC%])/g, (_, c: string) => SYMBOL[c.toLowerCase()])
    .replace(/%%[uokUOK]/g, "") // 밑줄·윗줄·취소선 토글
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\^I/g, " ");
}

export type MText = {
  lines: string[];
  /** 문단 정렬(\pq…)이 있으면 그 값. 0 왼쪽, 1 가운데, 2 오른쪽 */
  align: 0 | 1 | 2 | null;
  /** 첫 \W 폭 비율. 없으면 1 */
  width: number;
};

/**
 * MTEXT 서식 코드를 걷어내고 줄 단위로 나눈다. 줄 안에서 글꼴·크기·색이 바뀌는 것은 따르지 않는다.
 * ponytail: 글자 상자 폭에 맞춘 자동 줄바꿈은 하지 않는다(글꼴 폭을 워커에서 잴 수 없다). 긴 문단이 넘치면 그때 넣는다.
 */
export function mtext(s: string): MText {
  const q = /\\p[^;]*?q([lcrjd])/i.exec(s)?.[1].toLowerCase();
  const w = /\\W(\d*\.?\d+)/.exec(s);
  const text = s
    .replace(/\\\\/g, "\u0001")
    .replace(/\\([{}])/g, (_, b: string) => (b === "{" ? "\u0002" : "\u0003"))
    .replace(/\\[PXN]|\^J/g, "\n")
    .replace(/\\~/g, " ")
    // 분수·공차 쌓기: \S위^아래; \S1/2; \S1#2;
    .replace(/\\S([^;]*);/g, (_, body: string) => body.replace(/\^\s?|#/, "/").replace(/^\/|\/$/, ""))
    .replace(/\\[fFHhWwCcTtQqAap][^;\\]*;/g, "")
    .replace(/\\[LlOoKk]/g, "")
    .replace(/[{}]/g, "")
    .replace(/\u0001/g, "\\").replace(/\u0002/g, "{").replace(/\u0003/g, "}");
  return {
    lines: plain(text).split("\n").map((l) => l.trim()),
    align: q === "c" ? 1 : q === "r" ? 2 : q === "l" ? 0 : null,
    width: w ? +w[1] || 1 : 1,
  };
}

/**
 * 구형 파일의 MLEADER 글자는 라이브러리가 1바이트 문자열을 UTF-16으로 잘못 읽어 한자처럼 나온다
 * ("xx…" → "硸…"). 두 바이트로 쪼갰을 때 전부 인쇄 가능한 ASCII면 그렇게 되돌린다.
 */
export function unmangle(s: string): string {
  if (!s || [...s].some((c) => c.charCodeAt(0) < 0x2000)) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i), lo = c & 255, hi = c >> 8;
    for (const b of [lo, hi]) {
      if (b === 0 && i === s.length - 1) continue;
      if (b < 32 || b > 126) return s;
      out += String.fromCharCode(b);
    }
  }
  return out;
}

/** 화면에 그리기 전 폭 어림: 한중일 글자는 전각, 나머지는 반각보다 조금 넓게 잡는다. em 단위. */
export function roughWidth(s: string): number {
  let w = 0;
  for (let i = 0; i < s.length; i++) w += s.charCodeAt(i) >= 0x2e80 ? 1 : 0.58;
  return w;
}
