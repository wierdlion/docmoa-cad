/**
 * 3DSOLID 안에 들어 있는 ACIS(SAT) 데이터에서 모서리만 뽑아 3D 선으로 만든다.
 *
 * 꽉 찬 입체를 음영까지 넣어 그리려면 곡면을 잘라내고 삼각형으로 쪼개야 하는데(트리밍·
 * 테셀레이션) 그건 CAD 커널 한 벌을 쓰는 일이다. 모서리만 그려도 형상은 알아볼 수 있으므로
 * 여기까지만 한다.
 * ponytail: 와이어프레임 전용. 음영 솔리드가 실제로 필요해지면 그때 커널을 붙인다.
 */

export type Polyline3 = number[]; // [x,y,z, x,y,z, ...]

export type SatResult = {
  lines: Polyline3[];
  /** 그리지 못한 곡선 종류와 개수. 사용자에게 "일부는 못 그렸다"고 알리는 근거. */
  skipped: Record<string, number>;
};

type Rec = { type: string; tok: string[] };

/**
 * SAT 본문은 `#`로 끝나는 레코드의 나열이고, 참조 `$n`은 레코드의 등장 순서를 가리킨다.
 * 헤더는 보통 3줄(버전·제품·단위)이지만 R14 파일은 1줄뿐이다. 글자로 시작하는 첫 줄부터가 레코드다.
 */
function records(sat: string): Rec[] {
  const lines = sat.split("\n");
  const start = lines.findIndex((l) => /^[A-Za-z]/.test(l.trim()));
  const body = start < 0 ? "" : lines.slice(start).join("\n");
  return body
    .split("#")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const tok = r.split(/\s+/);
      return { type: tok[0], tok: tok.slice(1) };
    });
}

const nums = (tok: string[], from: number, n: number) =>
  tok.slice(from, from + n).map(Number);

/** 레코드의 참조들 중, 가리키는 대상이 조건에 맞는 첫 번째를 돌려준다. */
function refTo(rec: Rec, all: Rec[], match: (r: Rec) => boolean): Rec | null {
  for (const t of rec.tok) {
    if (!t.startsWith("$")) continue;
    const i = Number(t.slice(1));
    const target = all[i];
    if (i >= 0 && target && match(target)) return target;
  }
  return null;
}

const isCurve = (r: Rec) => /(-|^)(curve|ellipse|straight|intcurve)/.test(r.type);
const isVertex = (r: Rec) => r.type === "vertex";

/** 4x3 행렬 + 축척. transform 레코드: 9개 회전성분, 3개 이동, 1개 축척. */
type Xform = { m: number[]; t: number[]; s: number };

function transformOf(all: Rec[]): Xform | null {
  const r = all.find((x) => x.type === "transform");
  if (!r) return null;
  const v = r.tok.filter((t) => !t.startsWith("$")).map(Number).filter((n) => !Number.isNaN(n));
  if (v.length < 13) return null;
  return { m: v.slice(0, 9), t: v.slice(9, 12), s: v[12] || 1 };
}

function applyX(x: Xform | null, p: number[]): number[] {
  if (!x) return p;
  const [a, b, c, d, e, f, g, h, i] = x.m;
  const [px, py, pz] = p;
  return [
    (a * px + d * py + g * pz) * x.s + x.t[0],
    (b * px + e * py + h * pz) * x.s + x.t[1],
    (c * px + f * py + i * pz) * x.s + x.t[2],
  ];
}

/** 원/타원을 선분으로 쪼갠다. 중심 + 법선 + 장축 벡터 + 단축비. */
function ellipse(center: number[], normal: number[], major: number[], ratio: number, segs = 64): number[][] {
  const len = Math.hypot(...normal) || 1;
  const n = normal.map((v) => v / len);
  const u = major;
  // 법선과 장축에 모두 수직인 방향 = 단축 방향
  const v = [
    n[1] * u[2] - n[2] * u[1],
    n[2] * u[0] - n[0] * u[2],
    n[0] * u[1] - n[1] * u[0],
  ].map((c) => c * ratio);
  const pts: number[][] = [];
  for (let i = 0; i <= segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    const cs = Math.cos(t), sn = Math.sin(t);
    pts.push([0, 1, 2].map((k) => center[k] + u[k] * cs + v[k] * sn));
  }
  return pts;
}

export function satToLines(sat: string): SatResult {
  const all = records(sat);
  const x = transformOf(all);
  const lines: Polyline3[] = [];
  const skipped: Record<string, number> = {};

  for (const rec of all) {
    if (rec.type !== "edge") continue;
    const curve = refTo(rec, all, isCurve);
    if (!curve) continue;

    if (curve.type === "straight-curve") {
      // straight-curve: 시작점 3개 + 방향 3개. 끝점은 vertex의 point에서 얻는다.
      const ends: number[][] = [];
      for (const t of rec.tok) {
        if (!t.startsWith("$")) continue;
        const target = all[Number(t.slice(1))];
        if (!target || !isVertex(target)) continue;
        const pt = refTo(target, all, (r) => r.type === "point");
        if (pt) ends.push(nums(pt.tok.filter((s) => !s.startsWith("$")), 0, 3));
      }
      if (ends.length >= 2) lines.push(ends.slice(0, 2).flatMap((p) => applyX(x, p)));
      else skipped["straight-curve(no endpoints)"] = (skipped["straight-curve(no endpoints)"] ?? 0) + 1;
    } else if (curve.type === "ellipse-curve") {
      const v = curve.tok.filter((t) => !t.startsWith("$"));
      const center = nums(v, 0, 3), normal = nums(v, 3, 3), major = nums(v, 6, 3);
      const ratio = Number(v[9]);
      if ([...center, ...normal, ...major, ratio].some(Number.isNaN)) {
        skipped["ellipse-curve(unparsed)"] = (skipped["ellipse-curve(unparsed)"] ?? 0) + 1;
      } else {
        lines.push(ellipse(center, normal, major, ratio).flatMap((p) => applyX(x, p)));
      }
    } else {
      // intcurve(스플라인 등)는 제어점 해석이 따로 필요하다.
      skipped[curve.type] = (skipped[curve.type] ?? 0) + 1;
    }
  }
  return { lines, skipped };
}
