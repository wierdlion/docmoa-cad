/**
 * 파싱 워커. DWG → 도면 데이터 → 장면 배열까지 여기서 끝내고, 메인 스레드에는 TypedArray만 넘긴다.
 * 큰 도면은 10초 넘게 걸리므로 메인에서 돌리면 화면이 얼고 브라우저가 "응답 없음"을 띄운다.
 */
import { readCad } from "./dwg";
import { FONT_PX } from "./canvas";
import type { Model3 } from "./three-d";
import type { Drawing } from "./scene";

export type WorkerIn = { type: "open"; buf: ArrayBuffer; name: string };
export type WorkerOut =
  | { type: "step"; n: number }
  | { type: "drawing"; drawing: Drawing; model3: Model3 | null }
  | { type: "error"; code: string };

const port = self as unknown as { postMessage(m: WorkerOut, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<WorkerIn>) => void) | null };

/** 글자 폭 재기(MTEXT 줄바꿈용). 화면과 같은 글꼴로 잰다. OffscreenCanvas가 없는 브라우저면 어림값을 쓴다. */
const ctx = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(1, 1).getContext("2d") : null;
if (ctx) ctx.font = `${FONT_PX}px sans-serif`;
const measure = ctx ? (s: string) => ctx.measureText(s).width / FONT_PX : undefined;

port.onmessage = async (e) => {
  try {
    const cad = await readCad(e.data.buf, e.data.name, undefined, (n) => port.postMessage({ type: "step", n }), measure);
    port.postMessage({ type: "drawing", ...cad }, cad.drawing.sheets.flatMap((s) => [s.scene.verts.buffer, s.scene.items.buffer, s.scene.bounds.buffer]));
  } catch (err) {
    port.postMessage({ type: "error", code: err instanceof Error ? err.message : "open" });
  }
};
