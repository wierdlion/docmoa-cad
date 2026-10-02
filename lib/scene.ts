/**
 * 캔버스가 바로 그릴 수 있는 좌표 배열("장면"). `build.ts`가 도면 데이터에서 만들고, 대부분 TypedArray라
 * 워커에서 메인 스레드로 복사 없이 넘어간다. 좌표는 화면과 같은 y 아래 방향이다(도면 y를 뒤집은 것).
 */
export type Box = { x: number; y: number; w: number; h: number };
/** 행렬 [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f */
export type Mat = [number, number, number, number, number, number];

export type TextItem = {
  /** 글자 로컬 → 장면. 원점은 기준선의 왼쪽 끝(anchor에 따라 가운데·오른쪽 끝), x는 글자 진행 방향, y는 아래. */
  m: Mat;
  /** 글꼴 크기(em). 도면의 글자 높이는 대문자 높이라서 그보다 크다. */
  size: number;
  /** 폭 비율. w가 있으면 쓰지 않는다. */
  xs: number;
  /** 도면이 알려준 실제 글자 폭(로컬 단위). 0이면 모름. 있으면 글꼴이 달라도 이 폭에 맞춰 그린다. */
  w: number;
  /** 어림 폭(로컬 단위). 화면 밖 판정과 선택에만 쓴다. */
  aw: number;
  /** 0 start, 1 middle, 2 end */
  anchor: 0 | 1 | 2;
  str: string;
  color: number;
  layer: number;
  ent: number;
};

/** 선 모양 하나. 같은 모양끼리 한 번에 그린다. */
export type Style = {
  color: number;
  /** 점선 무늬(장면 단위, 선·빈칸 번갈아). 실선이면 null */
  dash: number[] | null;
  /** 선 굵기 mm. 화면에서는 가는 선은 전부 1px이고 굵은 선만 더 굵게 나온다. */
  lw: number;
  /** 폭 있는 폴리라인의 폭(장면 단위). 확대하면 같이 굵어진다. 0이면 없음 */
  ww: number;
};

/** items 한 칸: 시작 정점 index, 정점 수, 선 모양, 레이어, 플래그, 엔티티 */
export const ITEM = 6;
export const F_CLOSED = 1;
/** 선 대신 면으로 칠한다(짝홀 규칙). 해치·SOLID·화살촉. */
export const F_FILL = 2;

/** 그 시트 최상위 엔티티 하나. 클릭해서 고르는 단위다. */
export type Ent = { type: string; layer: number; name?: string; attrs?: [string, string][] };

export type Scene = {
  /** x,y 쌍 */
  verts: Float64Array;
  items: Int32Array;
  /** item마다 minx, miny, maxx, maxy */
  bounds: Float64Array;
  texts: TextItem[];
  /** CSS 색. "fg"는 배경에 따라 흰색/검은색으로 바뀌는 색(ACI 7)이다. */
  colors: string[];
  styles: Style[];
  ents: Ent[];
  /** 본체를 감싸는 뷰 상자. 비어 있는 도면이면 null. */
  fit: Box | null;
};

/** 배치(종이 공간)에 뚫린 창. 모델 장면을 s배 해서 (ox, oy)만큼 옮겨 clip 안에만 그린다. */
export type Viewport = { clip: Box; s: number; ox: number; oy: number };
/** 탭 하나. 첫 시트가 모델이고 viewports는 늘 그 모델 장면을 비춘다. */
export type Sheet = { name: string; scene: Scene; viewports: Viewport[] };
export type Layer = { name: string; color: string; off: boolean };
export type Drawing = {
  sheets: Sheet[];
  /** 장면의 layer 번호가 가리키는 표. used가 false면 그려지는 게 없는 레이어다. */
  layers: (Layer & { used: boolean })[];
  /** 길이 단위 표기("mm" 등). 도면에 단위가 없으면 "" */
  unit: string;
  /** 그리지 못한 엔티티 종류별 개수 */
  skipped: Record<string, number>;
};

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** 글자가 차지하는 상자의 네 꼭짓점(장면 좌표). 어림 폭 기준이다. */
export function textQuad(t: TextItem): number[] {
  const w = t.w || t.aw, x0 = t.anchor === 1 ? -w / 2 : t.anchor === 2 ? -w : 0;
  const out: number[] = [];
  for (const [x, y] of [[x0, 0.25 * t.size], [x0 + w, 0.25 * t.size], [x0 + w, -0.8 * t.size], [x0, -0.8 * t.size]]) {
    out.push(t.m[0] * x + t.m[2] * y + t.m[4], t.m[1] * x + t.m[3] * y + t.m[5]);
  }
  return out;
}

export function quadBox(q: number[]): [number, number, number, number] {
  return [Math.min(q[0], q[2], q[4], q[6]), Math.min(q[1], q[3], q[5], q[7]), Math.max(q[0], q[2], q[4], q[6]), Math.max(q[1], q[3], q[5], q[7])];
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/**
 * 도면 전체 범위는 그대로 못 쓴다. 도면에서 한참 떨어진 엔티티 하나가 끼면 전체가 수백만 단위로 늘어나
 * 도면이 점이 된다. 엔티티 상자들의 중앙값에서 멀리 떨어진 것만 버리고 나머지를 감싼다(중앙값 절대편차).
 * 비율로 자르면 외곽 도면틀이 잘리므로 거리로만 판정한다.
 */
export function fitBox(scene: Pick<Scene, "items" | "bounds" | "texts">, off: boolean[] = []): Box | null {
  const boxes: Box[] = [];
  for (let i = 0; i < scene.items.length / ITEM; i++) {
    if (off[scene.items[i * ITEM + 3]]) continue; // 꺼진 레이어는 화면 맞춤에서 뺀다
    const w = scene.bounds[i * 4 + 2] - scene.bounds[i * 4], h = scene.bounds[i * 4 + 3] - scene.bounds[i * 4 + 1];
    if (w || h) boxes.push({ x: scene.bounds[i * 4], y: scene.bounds[i * 4 + 1], w, h });
  }
  for (const t of scene.texts) {
    if (off[t.layer]) continue;
    const b = quadBox(textQuad(t));
    boxes.push({ x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] });
  }
  if (!boxes.length) return null;
  const cx = median(boxes.map((b) => b.x + b.w / 2)), cy = median(boxes.map((b) => b.y + b.h / 2));
  const spread = median(boxes.map((b) => Math.abs(b.x + b.w / 2 - cx) + Math.abs(b.y + b.h / 2 - cy)));
  const typical = median(boxes.map((b) => Math.max(b.w, b.h)));
  const limit = Math.max(spread, typical) * 20;
  const keep = boxes.filter((b) => Math.abs(b.x + b.w / 2 - cx) + Math.abs(b.y + b.h / 2 - cy) <= limit);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of keep) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  const w = x1 - x0, h = y1 - y0;
  if (!(w > 0 && h > 0)) return null;
  const pad = Math.max(w, h) * 0.03;
  return { x: x0 - pad, y: y0 - pad, w: w + pad * 2, h: h + pad * 2 };
}
