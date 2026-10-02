"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DARK, LIGHT, drawHighlight, drawSheet, toWorld, viewTransform } from "@/lib/canvas";
import type { Box, Drawing, Scene } from "@/lib/scene";
import { textQuad } from "@/lib/scene";
import type { WorkerIn, WorkerOut } from "@/lib/dwg.worker";
import { PAPERS, SCREEN, toPdf, toPng } from "@/lib/export";
import { fmt, measureEnt, measurePoints, pick, search, snap } from "@/lib/pick";
import { isEmpty, type Model3 } from "@/lib/three-d";
import { fill, type Dict, type Locale } from "@/lib/i18n";
import { AdRail } from "@/components/ad-rail";
import dynamic from "next/dynamic";

// three.js는 3D를 실제로 볼 때만 받는다.
const Viewer3d = dynamic(() => import("@/components/viewer3d"), { ssr: false });

/** 한 번 그리는 데 이보다 오래 걸리면, 끌거나 확대하는 동안은 마지막 그림을 옮겨 보여주고 손을 떼면 다시 그린다. */
const LIVE_MS = 24;
const IDLE_MS = 120;
/** 클릭과 끌기를 가르는 거리(px) */
const CLICK_PX = 4;
const PICK = "#38bdf8", HIT = "#fb923c", MEASURE = "#facc15";

type Pt = { x: number; y: number };

export default function Viewer({ locale, t }: { locale: Locale; t: Dict }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  /** 마지막 완전 렌더의 복사본과 그때의 뷰. 끄는 동안 이걸 옮겨 그린다. */
  const cache = useRef<{ bitmap: HTMLCanvasElement; view: Box } | null>(null);
  const viewRef = useRef<Box | null>(null);
  const drawing = useRef<Drawing | null>(null);
  const sheetRef = useRef(0);
  const hiddenRef = useRef<boolean[]>([]);
  const lightRef = useRef(false);
  const worker = useRef<Worker | null>(null);
  const lastMs = useRef(0);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 덧그리기 상태. 렌더와 무관하게 자주 바뀌므로 ref로 둔다. */
  const mark = useRef<{ picked: number; hit: number; points: Pt[]; snap: Pt | null }>({ picked: -1, hit: -1, points: [], snap: null });

  const [name, setName] = useState("");
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [model3, setModel3] = useState<Model3 | null>(null);
  const [in3d, setIn3d] = useState(false);
  const [saving, setSaving] = useState("");
  const [layers, setLayers] = useState<{ name: string; color: string; i: number }[]>([]);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState("");
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState(0);
  const [light, setLight] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [measure, setMeasure] = useState<{ length: number; area: number; n: number } | null>(null);
  const [picked, setPicked] = useState(-1);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<number[]>([]);
  const [hit, setHit] = useState(0);
  const [paper, setPaper] = useState("A4");
  const [color, setColor] = useState(false);
  const [pngSize, setPngSize] = useState(2400);
  const [unit, setUnit] = useState("");
  const [notDrawn, setNotDrawn] = useState("");

  const message = (code: string, fallback: keyof Dict["err"]) => t.err[code as keyof Dict["err"]] ?? t.err[fallback];
  const theme = () => (lightRef.current ? LIGHT : DARK);
  const current = () => { const d = drawing.current; return d ? { sheet: d.sheets[sheetRef.current], model: d.sheets[0].scene } : null; };
  /** 화면에 보이는 장면: 배치 탭에서는 종이 공간 */
  const scene = (): Scene | null => current()?.sheet.scene ?? null;

  /** 캔버스 CSS 크기 */
  const size = () => { const el = host.current!; return { cw: el.clientWidth, ch: el.clientHeight }; };
  const dpr = () => window.devicePixelRatio || 1;
  const fit = (c: HTMLCanvasElement) => { const { cw, ch } = size(); const w = Math.round(cw * dpr()), h = Math.round(ch * dpr()); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } };

  /** 선택·검색·측정 표시. 본 그림과 따로 그려서 마우스를 움직일 때마다 본 그림을 다시 그리지 않는다. */
  const drawMarks = useCallback(() => {
    const o = overlay.current, s = scene(), view = viewRef.current;
    if (!o) return;
    fit(o);
    const ctx = o.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, o.width, o.height);
    if (!s || !view) return;
    const { cw, ch } = size(), d = dpr(), tf = viewTransform(view, cw, ch), m = mark.current;
    if (m.picked >= 0) drawHighlight(ctx, s, m.picked, tf, d, PICK);
    if (m.hit >= 0 && s.texts[m.hit]) {
      const q = textQuad(s.texts[m.hit]);
      ctx.setTransform(d * tf.s, 0, 0, d * tf.s, d * tf.ox, d * tf.oy);
      ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(q[2], q[3]); ctx.lineTo(q[4], q[5]); ctx.lineTo(q[6], q[7]); ctx.closePath();
      ctx.strokeStyle = HIT; ctx.lineWidth = 2 / tf.s; ctx.stroke();
    }
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const px = (p: Pt) => [tf.s * p.x + tf.ox, tf.s * p.y + tf.oy];
    if (m.points.length) {
      ctx.strokeStyle = MEASURE; ctx.fillStyle = MEASURE; ctx.lineWidth = 1.5;
      ctx.beginPath();
      m.points.forEach((p, i) => { const [x, y] = px(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
      for (const p of m.points) { const [x, y] = px(p); ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
    }
    if (m.snap) { const [x, y] = px(m.snap); ctx.strokeStyle = MEASURE; ctx.lineWidth = 1.5; ctx.strokeRect(x - 5, y - 5, 10, 10); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** 장면 전체를 다시 그리고 결과를 캐시한다. */
  const render = useCallback(() => {
    const c = canvas.current, cur = current(), view = viewRef.current;
    if (!c || !cur || !view) return;
    fit(c);
    const { cw, ch } = size(), d = dpr();
    lastMs.current = drawSheet(c.getContext("2d")!, cur.sheet, cur.model, view, { cw, ch, dpr: d, hidden: hiddenRef.current, theme: theme(), ...SCREEN });
    let bmp = cache.current?.bitmap;
    if (!bmp || bmp.width !== c.width || bmp.height !== c.height) bmp = Object.assign(document.createElement("canvas"), { width: c.width, height: c.height });
    bmp.getContext("2d")!.drawImage(c, 0, 0);
    cache.current = { bitmap: bmp, view: { ...view } };
    drawMarks();
  }, [drawMarks]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 뷰를 바꾼다. 가벼운 도면은 바로 그리고, 무거운 도면은 캐시를 옮겨 보여준 뒤 멈추면 그린다. */
  const apply = useCallback((view: Box) => {
    viewRef.current = view;
    const c = canvas.current, k = cache.current;
    if (!c) return;
    if (lastMs.current <= LIVE_MS || !k) { render(); return; }
    const { cw, ch } = size(), d = dpr();
    const a = viewTransform(k.view, cw, ch), b = viewTransform(view, cw, ch);
    const z = b.s / a.s;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = theme().bg;
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(k.bitmap, 0, 0, k.bitmap.width, k.bitmap.height, b.ox - a.ox * z, b.oy - a.oy * z, cw * z, ch * z);
    drawMarks();
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(render, IDLE_MS);
  }, [render, drawMarks]);

  const fitAll = useCallback(() => { const f = scene()?.fit; if (f) { viewRef.current = { ...f }; render(); } }, [render]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 화면 가운데를 기준으로 k배 확대(1보다 작으면 축소) */
  const zoomBy = useCallback((k: number, px?: number, py?: number) => {
    const b = viewRef.current;
    if (!b) return;
    const { cw, ch } = size();
    const p = toWorld(b, cw, ch, px ?? cw / 2, py ?? ch / 2);
    apply({ x: p.x - (p.x - b.x) * k, y: p.y - (p.y - b.y) * k, w: b.w * k, h: b.h * k });
  }, [apply]);

  const clearMarks = useCallback(() => {
    mark.current = { picked: -1, hit: -1, points: [], snap: null };
    setPicked(-1); setMeasure(null); setHits([]); setHit(0); setQuery("");
    drawMarks();
  }, [drawMarks]);

  const open = useCallback((file: File) => {
    if (!/\.(dwg|dxf)$/i.test(file.name)) return;
    setStep(1); setError(""); setName(file.name); setOff(new Set()); setReady(false); setIn3d(false); setModel3(null); setLayers([]); setSheets([]); setSheet(0); setNotDrawn("");
    drawing.current = null; cache.current = null; hiddenRef.current = []; lastMs.current = 0; sheetRef.current = 0;
    mark.current = { picked: -1, hit: -1, points: [], snap: null };
    setPicked(-1); setMeasure(null); setHits([]); setHit(0); setQuery("");
    worker.current?.terminate();
    // 파일마다 새 워커: 파싱이 실패하면 wasm 모듈이 되살아나지 않고, 워커를 버리면 그 메모리도 같이 간다.
    const w = new Worker(new URL("../lib/dwg.worker.ts", import.meta.url));
    worker.current = w;
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data;
      if (msg.type === "step") { setStep(msg.n); return; }
      if (msg.type === "error") {
        setError(message(msg.code, "open")); setStep(0);
        // 이전 도면이 남아 있으면 열린 줄 안다. 지운다.
        for (const c of [canvas.current, overlay.current]) if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
        return;
      }
      const d = msg.drawing;
      drawing.current = d;
      hiddenRef.current = d.layers.map((l) => l.off);
      setOff(new Set(d.layers.flatMap((l, i) => (l.off ? [i] : []))));
      setLayers(d.layers.map((l, i) => ({ name: l.name, color: l.color, i })).filter((l) => d.layers[l.i].used).sort((a, b) => a.name.localeCompare(b.name)));
      setSheets(d.sheets.map((s) => s.name));
      setUnit(d.unit);
      setNotDrawn(Object.keys(d.skipped).length ? fill(t.notDrawn, { list: Object.entries(d.skipped).map(([k, n]) => `${k} ×${n}`).join(", ") }) : "");
      setModel3(msg.model3);
      setReady(true);
      setStep(0);
      const f = d.sheets[0].scene.fit;
      if (!f) { setError(message("draw", "draw")); return; }
      viewRef.current = { ...f };
      // 레이어 패널이 그려진 뒤 캔버스 크기를 재야 한다.
      requestAnimationFrame(render);
    };
    w.onerror = () => { setError(message("open", "open")); setStep(0); };
    file.arrayBuffer().then((buf) => w.postMessage({ type: "open", buf, name: file.name } satisfies WorkerIn, [buf]));
  }, [render]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => worker.current?.terminate(), []);

  // 창 크기가 바뀌면 다시 그린다.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (viewRef.current) render(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [render]);

  useEffect(() => {
    const target = host.current;
    if (!target) return;
    const zoom = (e: WheelEvent) => {
      if (!viewRef.current) return;
      e.preventDefault();
      const r = target.getBoundingClientRect();
      // 휠 한 칸(±100)이면 1.16배. 트랙패드는 작은 값이 연달아 오므로 그만큼만 움직인다. 핀치(ctrl)는 더 민감하게.
      const dy = Math.max(-100, Math.min(100, e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY));
      zoomBy(Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    };
    target.addEventListener("wheel", zoom, { passive: false });
    return () => target.removeEventListener("wheel", zoom);
  }, [zoomBy]);

  // 키보드: +/- 확대, 0 전체, 화살표 이동, Esc 표시 지우기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT" || !viewRef.current) return;
      const b = viewRef.current, { cw, ch } = size(), k = b.w / cw;
      const pan: Record<string, [number, number]> = { ArrowLeft: [-60, 0], ArrowRight: [60, 0], ArrowUp: [0, -60], ArrowDown: [0, 60] };
      if (e.key === "+" || e.key === "=") zoomBy(1 / 1.3);
      else if (e.key === "-") zoomBy(1.3);
      else if (e.key === "0" || e.key.toLowerCase() === "f") fitAll();
      else if (e.key === "Escape") clearMarks();
      else if (pan[e.key]) apply({ ...b, x: b.x + pan[e.key][0] * k, y: b.y + pan[e.key][1] * k });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomBy, fitAll, clearMarks, apply]);

  // 손가락 하나면 이동, 둘이면 확대. 마우스 드래그도 같은 경로를 탄다. 움직이지 않고 떼면 클릭이다.
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<{ box: Box; cx: number; cy: number; span: number } | null>(null);
  const down = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const center = () => {
    const pts = [...pointers.current.values()];
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const span = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    return { cx, cy, span };
  };

  // 손가락이 닿거나 떨어질 때마다 기준을 새로 잡는다. 안 그러면 두 번째 손가락을 뗀 순간 도면이 튄다.
  const rebase = () => {
    gesture.current = pointers.current.size && viewRef.current ? { box: { ...viewRef.current }, ...center() } : null;
  };

  const world = (e: React.PointerEvent) => {
    const r = host.current!.getBoundingClientRect(), { cw, ch } = size();
    return toWorld(viewRef.current!, cw, ch, e.clientX - r.left, e.clientY - r.top);
  };
  /** 화면 10px이 도면에서 얼마인지 */
  const tol = () => (viewRef.current!.w / size().cw) * 10;

  const onDown = (e: React.PointerEvent) => {
    if (!viewRef.current) return;
    // 캡처가 안 되면 손가락이 캔버스를 벗어날 때 끊길 뿐, 동작 자체는 유지된다.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 이미 놓친 포인터 */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    down.current = { x: e.clientX, y: e.clientY, moved: false };
    rebase();
  };

  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) {
      if (measuring && viewRef.current && scene()) { const p = world(e); mark.current.snap = snap(scene()!, p.x, p.y, tol(), hiddenRef.current); drawMarks(); }
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = down.current;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX) d.moved = true;
    const g = gesture.current;
    if (!g || !host.current) return;
    const r = host.current.getBoundingClientRect();
    const { cw, ch } = size();
    const now = center();
    // 손가락을 벌리면 span이 커지고 뷰는 작아진다 = 확대.
    const k = g.span && now.span ? g.span / now.span : 1;
    const w = g.box.w * k, h = g.box.h * k;
    // 처음 잡은 지점의 도면 좌표가 지금 손가락 중심에 오도록 맞춘다.
    const anchor = toWorld(g.box, cw, ch, g.cx - r.left, g.cy - r.top);
    const { s, ox, oy } = viewTransform({ x: 0, y: 0, w, h }, cw, ch);
    apply({ x: anchor.x - (now.cx - r.left - ox) / s, y: anchor.y - (now.cy - r.top - oy) / s, w, h });
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    rebase();
    const d = down.current;
    down.current = null;
    const s = scene();
    if (!d || d.moved || !s || !viewRef.current || pointers.current.size) return;
    const p = world(e);
    if (measuring) {
      const q = snap(s, p.x, p.y, tol(), hiddenRef.current) ?? p;
      mark.current.points.push(q);
      const m = measurePoints(mark.current.points);
      setMeasure({ ...m, n: mark.current.points.length });
    } else {
      const ent = pick(s, p.x, p.y, tol(), hiddenRef.current);
      mark.current.picked = ent;
      setPicked(ent);
    }
    drawMarks();
  };

  const download = async (kind: "png" | "pdf") => {
    const cur = current(), box = viewRef.current;
    if (!cur || !box) return;
    setSaving(kind); setError("");
    try {
      if (kind === "png") await toPng(cur.sheet, cur.model, box, hiddenRef.current, name, theme(), pngSize);
      else await toPdf(cur.sheet, cur.model, box, hiddenRef.current, name, locale, paper, color);
    } catch (e) {
      setError(message(e instanceof Error ? e.message : "", "save"));
    } finally {
      setSaving("");
    }
  };

  const setHidden = (next: Set<number>) => {
    setOff(next);
    const d = drawing.current;
    if (d) { hiddenRef.current = d.layers.map((_, i) => next.has(i)); render(); }
  };
  const toggle = (i: number) => { const next = new Set(off); next.has(i) ? next.delete(i) : next.add(i); setHidden(next); };
  const shown = layers.filter((l) => !filter || l.name.toLowerCase().includes(filter.toLowerCase()));
  const allTo = (on: boolean) => { const next = new Set(off); for (const l of shown) on ? next.delete(l.i) : next.add(l.i); setHidden(next); };

  const switchSheet = (i: number) => {
    sheetRef.current = i; setSheet(i); cache.current = null; lastMs.current = 0;
    clearMarks();
    const f = drawing.current?.sheets[i].scene.fit;
    if (f) { viewRef.current = { ...f }; render(); }
  };

  const goTo = (list: number[], i: number) => {
    const s = scene(), tx = s?.texts[list[i]];
    if (!s || !tx) return;
    setHit(i);
    mark.current.hit = list[i];
    const { cw, ch } = size(), k = Math.hypot(tx.m[0], tx.m[1]) * tx.size;
    const h = Math.max(k * 30, tx.aw * Math.hypot(tx.m[0], tx.m[1]) * 2 * (ch / cw)), w = h * (cw / ch);
    apply({ x: tx.m[4] - w / 2, y: tx.m[5] - h / 2, w, h });
  };
  const onQuery = (q: string) => {
    setQuery(q);
    const s = scene();
    const list = s ? search(s, q, hiddenRef.current) : [];
    setHits(list);
    mark.current.hit = -1;
    if (list.length) goTo(list, 0); else { setHit(0); drawMarks(); }
  };

  const toggleLight = () => { lightRef.current = !lightRef.current; setLight(lightRef.current); cache.current = null; render(); };
  const toggleMeasure = () => { setMeasuring((v) => !v); mark.current.points = []; mark.current.snap = null; setMeasure(null); drawMarks(); };

  const u = unit ? ` ${unit}` : "";
  const ent = picked >= 0 ? scene()?.ents[picked] : null;
  const entMeasure = ent && scene() ? measureEnt(scene()!, picked) : null;
  const btn = "rounded border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-50";
  const on = "rounded bg-indigo-600 px-3 py-1.5 text-sm hover:bg-indigo-500";

  return (
    // max-h-dvh: 외부 스크립트(광고)가 height를 auto로 덮어써도 뷰어가 화면 밖으로 자라지 않게 한다.
    <div className="flex h-dvh max-h-dvh flex-col bg-slate-900 text-slate-100"
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) open(f); }}>
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-700 px-4 py-2">
        <label className="cursor-pointer rounded bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500">
          {t.open}
          <input type="file" accept=".dwg,.dxf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) open(f); e.target.value = ""; }} />
        </label>
        {name && <span className="max-w-48 truncate text-sm text-slate-400" title={name}>{name}</span>}
        {step > 0 && <span className="text-sm text-amber-400">{t.opening} {step}/3 <span className="ml-1 inline-block h-1.5 w-16 animate-pulse rounded bg-amber-400/70 align-middle" /></span>}
        {/* GPL-3 배포 의무: 라이선스와 소스 위치를 화면에 알린다. */}
        <a href="https://github.com/wierdlion/docmoa-cad" target="_blank" rel="noopener" className="ms-auto text-xs text-slate-500 hover:text-slate-300">GPL-3.0 · Source (LibreDWG)</a>
        {error && <span className="text-sm text-red-400">{error}</span>}
        {ready && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="flex items-center rounded border border-slate-600">
              <input type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder={t.search} aria-label={t.search}
                onKeyDown={(e) => { if (e.key === "Enter" && hits.length) { goTo(hits, (hit + (e.shiftKey ? hits.length - 1 : 1)) % hits.length); e.preventDefault(); } }}
                className="w-36 bg-transparent px-2 py-1.5 text-sm outline-none" />
              {query && <span className="px-2 text-xs text-slate-400">{hits.length ? hit + 1 : 0}/{hits.length}</span>}
            </span>
            {layers.length > 0 && <button onClick={() => setShowLayers((v) => !v)} className={`${btn} sm:hidden`}>{t.layers}</button>}
            {model3 && !isEmpty(model3) && (
              <button onClick={() => setIn3d((v) => !v)} className={in3d ? on : btn}>{in3d ? t.view2d : t.view3d}</button>
            )}
            <button onClick={fitAll} className={btn}>{t.fit}</button>
            <button onClick={() => zoomBy(1 / 1.3)} className={btn} aria-label={t.zoomIn} title={t.zoomIn}>+</button>
            <button onClick={() => zoomBy(1.3)} className={btn} aria-label={t.zoomOut} title={t.zoomOut}>−</button>
            <button onClick={toggleMeasure} className={measuring ? on : btn} title={t.measureHint}>{t.measure}</button>
            <button onClick={toggleLight} className={btn} aria-label={t.bg} title={t.bg}>{light ? "◐" : "◑"}</button>
            <button onClick={() => download("png")} disabled={!!saving} className={btn}>{saving === "png" ? t.saving : t.png}</button>
            <button onClick={() => download("pdf")} disabled={!!saving}
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm hover:bg-emerald-600 disabled:opacity-50">
              {saving === "pdf" ? t.making : t.pdf}</button>
            <details className="relative">
              <summary className={`${btn} cursor-pointer list-none`} aria-label={t.options} title={t.options}>⚙</summary>
              <div className="absolute right-0 z-10 mt-1 flex w-56 flex-col gap-2 rounded border border-slate-600 bg-slate-800 p-3 text-sm shadow-lg">
                <label className="flex items-center justify-between gap-2">{t.paper}
                  <select value={paper} onChange={(e) => setPaper(e.target.value)} className="rounded bg-slate-700 px-2 py-1">
                    {Object.keys(PAPERS).map((p) => <option key={p}>{p}</option>)}
                  </select></label>
                <label className="flex items-center justify-between gap-2">{t.color}<input type="checkbox" checked={color} onChange={(e) => setColor(e.target.checked)} /></label>
                <label className="flex items-center justify-between gap-2">{t.size}
                  <select value={pngSize} onChange={(e) => setPngSize(+e.target.value)} className="rounded bg-slate-700 px-2 py-1">
                    {[2400, 4800, 8000].map((n) => <option key={n} value={n}>{n}px</option>)}
                  </select></label>
              </div>
            </details>
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {layers.length > 0 && (
          <aside className={`${showLayers ? "flex" : "hidden"} w-44 shrink-0 flex-col border-r border-slate-700 text-sm sm:flex sm:w-52`}>
            <div className="flex flex-col gap-1 border-b border-slate-700 p-2">
              <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t.filter} aria-label={t.filter}
                className="w-full rounded border border-slate-600 bg-transparent px-2 py-1 text-xs outline-none" />
              <div className="flex gap-1 text-xs">
                <button onClick={() => allTo(true)} className="flex-1 rounded border border-slate-600 py-0.5 hover:bg-slate-800">{t.allOn}</button>
                <button onClick={() => allTo(false)} className="flex-1 rounded border border-slate-600 py-0.5 hover:bg-slate-800">{t.allOff}</button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {shown.map((l) => (
                <label key={l.i} className="flex items-center gap-2 py-1 text-slate-400">
                  <input type="checkbox" checked={!off.has(l.i)} onChange={() => toggle(l.i)} />
                  <span className="inline-block h-3 w-3 shrink-0 rounded-sm border border-slate-600" style={{ background: l.color === "fg" ? theme().fg : l.color }} />
                  <span className="truncate" title={l.name}>{l.name}</span>
                </label>
              ))}
            </div>
          </aside>
        )}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div ref={host} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            className={`relative min-h-0 flex-1 touch-none ${light ? "bg-white" : "bg-black"} ${in3d ? "invisible" : ""} ${measuring ? "cursor-crosshair" : ""}`}>
            <canvas ref={canvas} className="block h-full w-full" />
            <canvas ref={overlay} className="pointer-events-none absolute inset-0 h-full w-full" />
            {!ready && !step && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-500">{t.drop}</p>}
            {ready && (measure || ent) && (
              <div className="absolute bottom-3 left-3 max-w-xs rounded bg-slate-900/90 px-3 py-2 text-xs text-slate-200">
                {measure ? (
                  <p>{t.dist}: {fmt(measure.length)}{u}{measure.n >= 3 && <> · {t.area}: {fmt(measure.area)}{u && `${u}²`}</>}</p>
                ) : ent && (
                  <>
                    <p>{t.type}: {ent.type}{ent.name && <> · {t.block}: {ent.name}</>}</p>
                    <p>{t.layer}: {drawing.current?.layers[ent.layer]?.name}</p>
                    {entMeasure && entMeasure.length > 0 && <p>{t.length}: {fmt(entMeasure.length)}{u}{entMeasure.area > 0 && <> · {t.area}: {fmt(entMeasure.area)}{u && `${u}²`}</>}</p>}
                    {ent.attrs?.map(([k, v]) => <p key={k}>{k}: {v}</p>)}
                  </>
                )}
              </div>
            )}
            {ready && notDrawn && !measure && !ent && <p className="pointer-events-none absolute bottom-3 right-3 hidden max-w-md truncate text-xs text-slate-500 sm:block" title={notDrawn}>{notDrawn}</p>}
          </div>
          {sheets.length > 1 && (
            <div className="flex gap-1 overflow-x-auto border-t border-slate-700 px-2 py-1 text-xs">
              {sheets.map((s, i) => <button key={i} onClick={() => switchSheet(i)} className={`rounded px-2 py-1 ${i === sheet ? "bg-slate-700 text-white" : "text-slate-400 hover:bg-slate-800"}`}>{s}</button>)}
            </div>
          )}
          {in3d && model3 && (
            <div className="absolute inset-0">
              <Viewer3d model={model3} />
              {(model3.wireSolids > 0 || model3.emptySolids > 0 || Object.keys(model3.skipped).length > 0) && (
                <p className="absolute bottom-3 left-3 right-3 rounded bg-slate-900/90 px-3 py-2 text-xs text-amber-300">
                  {model3.wireSolids > 0 && `${fill(t.wire, { n: model3.wireSolids })} `}
                  {model3.emptySolids > 0 && `${fill(t.empty, { n: model3.emptySolids })} `}
                  {Object.keys(model3.skipped).length > 0 && fill(t.skipped, { list: Object.keys(model3.skipped).join(", ") })}
                </p>
              )}
            </div>
          )}
        </div>
        <AdRail label={t.ad} />
      </div>
    </div>
  );
}
