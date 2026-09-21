/**
 * 변환기가 준 viewBox는 못 쓴다. 도면에서 한참 떨어진 엔티티 하나가 끼면 전체가 수백만 단위로
 * 늘어나 도면이 점이 된다. 그래서 엔티티별 bbox를 브라우저에 재보게 하고(getBBox), 본체에서
 * 멀리 떨어진 것만 버린 뒤 나머지를 전부 감싼다.
 *
 * 외곽 도면틀을 자르면 안 되므로 비율로 잘라내지 않는다. 중앙값에서 얼마나 떨어져 있는지로만
 * 판정한다(중앙값 절대편차 기준). 도면틀은 본체 바로 옆이라 남고, 엉뚱한 곳의 엔티티는 빠진다.
 */
export type Box = { x: number; y: number; w: number; h: number };

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function fitViewBox(svg: SVGSVGElement): Box | null {
  const root = svg.getScreenCTM()?.inverse();
  if (!root) return null;

  const boxes: Box[] = [];
  for (const el of svg.querySelectorAll<SVGGraphicsElement>("[data-layer]")) {
    let b: DOMRect;
    try { b = el.getBBox(); } catch { continue; }
    if (!b.width && !b.height) continue;
    const m = el.getScreenCTM();
    if (!m) continue;
    // getBBox는 엘리먼트 로컬 좌표다. 조상의 Y축 반전까지 통과시켜 viewBox 좌표로 옮긴다.
    const toBox = root.multiply(m);
    const xs: number[] = [], ys: number[] = [];
    for (const [px, py] of [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]) {
      const p = new DOMPoint(px, py).matrixTransform(toBox);
      xs.push(p.x); ys.push(p.y);
    }
    const x = Math.min(...xs), y = Math.min(...ys);
    boxes.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
  }
  if (!boxes.length) return null;

  const cx = median(boxes.map((b) => b.x + b.w / 2));
  const cy = median(boxes.map((b) => b.y + b.h / 2));
  const spread = median(boxes.map((b) => Math.abs(b.x + b.w / 2 - cx) + Math.abs(b.y + b.h / 2 - cy)));
  // 흩어짐이 0인 도면(엔티티가 한 점에 몰린 경우)까지 버리지 않도록 최소값을 준다.
  // 최소값도 중앙값으로 잡는다. 최대 크기를 쓰면 쫓아내려는 그 엔티티가 기준을 키워버린다.
  const typical = median(boxes.map((b) => Math.max(b.w, b.h)));
  const limit = Math.max(spread, typical) * 20;
  const keep = boxes.filter((b) => Math.abs(b.x + b.w / 2 - cx) + Math.abs(b.y + b.h / 2 - cy) <= limit);

  const x0 = Math.min(...keep.map((b) => b.x)), y0 = Math.min(...keep.map((b) => b.y));
  const x1 = Math.max(...keep.map((b) => b.x + b.w)), y1 = Math.max(...keep.map((b) => b.y + b.h));
  const w = x1 - x0, h = y1 - y0;
  if (!(w > 0 && h > 0)) return null;
  const pad = Math.max(w, h) * 0.03;
  return { x: x0 - pad, y: y0 - pad, w: w + pad * 2, h: h + pad * 2 };
}
