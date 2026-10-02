import type { SatResult } from "./sat";

/** 도면에서 건져낸 3차원 형상. 선은 이어진 점들, 면은 삼각형 꼭짓점 나열. */
export type Model3 = {
  lines: number[][];
  tris: number[];
  /** 솔리드 중 모서리를 하나도 못 뽑은 개수 (사용자에게 알린다) */
  emptySolids: number;
  /** 모서리만 그려진 입체의 개수. 0보다 크면 "면은 안 그려진다"고 알려야 한다. */
  wireSolids: number;
  /** 못 그린 곡선 종류별 개수 */
  skipped: Record<string, number>;
};

export const isEmpty = (m: Model3) => !m.lines.length && !m.tris.length;

type P3 = { x: number; y: number; z: number };
const push = (out: number[], p: P3) => out.push(p.x, p.y, p.z ?? 0);

type Ent = {
  type: string;
  corner1?: P3; corner2?: P3; corner3?: P3; corner4?: P3;
  vertices?: P3[];
  data?: unknown;
};

/** satOf는 입체 엔티티의 모서리(ACIS 데이터를 푼 것). `readCad`가 WASM 메모리를 해제하기 전에 읽어 둔다. */
export function extract3d(entities: Ent[], satOf: (e: Ent) => SatResult | null): Model3 {
  const m: Model3 = { lines: [], tris: [], emptySolids: 0, wireSolids: 0, skipped: {} };

  for (const e of entities) {
    if (e.type === "3DFACE" && e.corner1 && e.corner2 && e.corner3) {
      const [a, b, c] = [e.corner1, e.corner2, e.corner3];
      const d = e.corner4 ?? c;
      push(m.tris, a); push(m.tris, b); push(m.tris, c);
      // 네 번째 꼭짓점이 세 번째와 다르면 사각형이므로 삼각형 하나를 더 만든다.
      if (d.x !== c.x || d.y !== c.y || d.z !== c.z) {
        push(m.tris, a); push(m.tris, c); push(m.tris, d);
      }
    } else if (e.type === "POLYLINE3D" && e.vertices?.length) {
      const line: number[] = [];
      for (const v of e.vertices) push(line, v);
      if (line.length >= 6) m.lines.push(line);
    } else if (e.type === "3DSOLID") {
      const sat = satOf(e);
      if (!sat) { m.emptySolids++; continue; }
      const { lines, skipped } = sat;
      if (lines.length) m.wireSolids++;
      else m.emptySolids++;
      m.lines.push(...lines);
      for (const [k, n] of Object.entries(skipped)) m.skipped[k] = (m.skipped[k] ?? 0) + n;
    }
  }
  return m;
}
