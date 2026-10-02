/**
 * 파싱 워커. DWG → SVG 문자열 → 장면 배열까지 여기서 끝내고, 메인 스레드에는 TypedArray만 넘긴다.
 * 큰 도면은 10초 넘게 걸리므로 메인에서 돌리면 화면이 얼고 브라우저가 "응답 없음"을 띄운다.
 * SVG 문자열은 PDF 저장(svg2pdf) 때만 필요하므로 여기 들고 있다가 요청이 오면 보낸다.
 */
import { readCad } from "./dwg";
import { parseScene } from "./scene";
import type { Model3 } from "./three-d";
import type { Scene } from "./scene";

export type WorkerIn = { type: "open"; buf: ArrayBuffer; name: string } | { type: "svg" };
export type WorkerOut =
  | { type: "scene"; scene: Scene; layerOf: Record<string, string>; drop: string[]; model3: Model3 | null }
  | { type: "svg"; svg: string }
  | { type: "error"; code: string };

const port = self as unknown as { postMessage(m: WorkerOut, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<WorkerIn>) => void) | null };
let svgText = "";

port.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "svg") { port.postMessage({ type: "svg", svg: svgText }); return; }
  try {
    const cad = await readCad(msg.buf, msg.name);
    svgText = cad.svg;
    const scene = parseScene(cad.svg, cad.layerOf, cad.drop);
    port.postMessage({ type: "scene", scene, layerOf: cad.layerOf, drop: cad.drop, model3: cad.model3 }, [scene.verts.buffer, scene.items.buffer, scene.bounds.buffer]);
  } catch (err) {
    port.postMessage({ type: "error", code: err instanceof Error ? err.message : "open" });
  }
};
