"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { draw, toWorld, viewTransform } from "@/lib/canvas";
import type { Box, Scene } from "@/lib/scene";
import type { WorkerIn, WorkerOut } from "@/lib/dwg.worker";
import { materializeSvg, toPdf, toPng } from "@/lib/export";
import { isEmpty, type Model3 } from "@/lib/three-d";
import { fill, type Dict, type Locale } from "@/lib/i18n";
import { AdRail } from "@/components/ad-rail";
import dynamic from "next/dynamic";

// three.js는 3D를 실제로 볼 때만 받는다.
const Viewer3d = dynamic(() => import("@/components/viewer3d"), { ssr: false });

/** 한 번 그리는 데 이보다 오래 걸리면, 끌거나 확대하는 동안은 마지막 그림을 옮겨 보여주고 손을 떼면 다시 그린다. */
const LIVE_MS = 24;
const IDLE_MS = 120;

type Loaded = { scene: Scene; layerOf: Record<string, string>; drop: string[] };

export default function Viewer({ locale, t }: { locale: Locale; t: Dict }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  /** 마지막 완전 렌더의 복사본과 그때의 뷰. 끄는 동안 이걸 옮겨 그린다. */
  const cache = useRef<{ bitmap: HTMLCanvasElement; view: Box } | null>(null);
  const viewRef = useRef<Box | null>(null);
  const loaded = useRef<Loaded | null>(null);
  const hiddenRef = useRef<boolean[]>([]);
  const worker = useRef<Worker | null>(null);
  const lastMs = useRef(0);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [model3, setModel3] = useState<Model3 | null>(null);
  const [in3d, setIn3d] = useState(false);
  const [saving, setSaving] = useState("");
  const [layers, setLayers] = useState<string[]>([]);
  const [off, setOff] = useState<Set<string>>(new Set());

  const message = (code: string, fallback: keyof Dict["err"]) => t.err[code as keyof Dict["err"]] ?? t.err[fallback];

  /** 캔버스 CSS 크기 */
  const size = () => { const el = host.current!; return { cw: el.clientWidth, ch: el.clientHeight }; };

  /** 장면 전체를 다시 그리고 결과를 캐시한다. */
  const render = useCallback(() => {
    const c = canvas.current, l = loaded.current, view = viewRef.current;
    if (!c || !l || !view) return;
    const { cw, ch } = size();
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
    lastMs.current = draw(c.getContext("2d")!, l.scene, view, cw, ch, dpr, hiddenRef.current);
    let bmp = cache.current?.bitmap;
    if (!bmp || bmp.width !== c.width || bmp.height !== c.height) bmp = Object.assign(document.createElement("canvas"), { width: c.width, height: c.height });
    bmp.getContext("2d")!.drawImage(c, 0, 0);
    cache.current = { bitmap: bmp, view: { ...view } };
  }, []);

  /** 뷰를 바꾼다. 가벼운 도면은 바로 그리고, 무거운 도면은 캐시를 옮겨 보여준 뒤 멈추면 그린다. */
  const apply = useCallback((view: Box) => {
    viewRef.current = view;
    const c = canvas.current, k = cache.current;
    if (!c) return;
    if (lastMs.current <= LIVE_MS || !k) { render(); return; }
    const { cw, ch } = size();
    const dpr = window.devicePixelRatio || 1;
    const a = viewTransform(k.view, cw, ch), b = viewTransform(view, cw, ch);
    const z = b.s / a.s;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(k.bitmap, 0, 0, k.bitmap.width, k.bitmap.height, b.ox - a.ox * z, b.oy - a.oy * z, cw * z, ch * z);
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(render, IDLE_MS);
  }, [render]);

  const fitAll = useCallback(() => { const f = loaded.current?.scene.fit; if (f) { viewRef.current = { ...f }; render(); } }, [render]);

  const open = useCallback((file: File) => {
    setBusy(true); setError(""); setName(file.name); setOff(new Set()); setReady(false); setIn3d(false); setModel3(null); setLayers([]);
    loaded.current = null; cache.current = null; hiddenRef.current = []; lastMs.current = 0;
    worker.current?.terminate();
    // 파일마다 새 워커: 파싱이 실패하면 wasm 모듈이 되살아나지 않고, 워커를 버리면 그 메모리도 같이 간다.
    const w = new Worker(new URL("../lib/dwg.worker.ts", import.meta.url));
    worker.current = w;
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data;
      if (msg.type === "error") { setError(message(msg.code, "open")); setBusy(false); return; }
      if (msg.type !== "scene") return;
      loaded.current = { scene: msg.scene, layerOf: msg.layerOf, drop: msg.drop };
      hiddenRef.current = msg.scene.layers.map(() => false);
      setLayers([...msg.scene.layers].sort());
      setModel3(msg.model3);
      setReady(true);
      setBusy(false);
      if (!msg.scene.fit) { setError(message("draw", "draw")); return; }
      viewRef.current = { ...msg.scene.fit };
      // 레이어 패널이 그려진 뒤 캔버스 크기를 재야 한다.
      requestAnimationFrame(render);
    };
    w.onerror = () => { setError(message("open", "open")); setBusy(false); };
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
      const b = viewRef.current;
      if (!b) return;
      e.preventDefault();
      const r = target.getBoundingClientRect();
      const { cw, ch } = size();
      // 커서가 가리키던 도면 좌표가 제자리에 남도록 확대한다.
      const p = toWorld(b, cw, ch, e.clientX - r.left, e.clientY - r.top);
      const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      apply({ x: p.x - (p.x - b.x) * k, y: p.y - (p.y - b.y) * k, w: b.w * k, h: b.h * k });
    };
    target.addEventListener("wheel", zoom, { passive: false });
    return () => target.removeEventListener("wheel", zoom);
  }, [apply]);

  // 손가락 하나면 이동, 둘이면 확대. 마우스 드래그도 같은 경로를 탄다.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ box: Box; cx: number; cy: number; span: number } | null>(null);

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

  const onDown = (e: React.PointerEvent) => {
    if (!viewRef.current) return;
    // 캡처가 안 되면 손가락이 캔버스를 벗어날 때 끊길 뿐, 동작 자체는 유지된다.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 이미 놓친 포인터 */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    rebase();
  };

  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
  };

  const download = async (kind: "png" | "pdf") => {
    const l = loaded.current, box = viewRef.current, w = worker.current;
    if (!l || !box) return;
    setSaving(kind); setError("");
    try {
      if (kind === "png") await toPng(l.scene, box, hiddenRef.current, name);
      else {
        if (!w) throw new Error("save");
        const svgText = await new Promise<string>((ok, fail) => {
          const prev = w.onmessage;
          w.onmessage = (e: MessageEvent<WorkerOut>) => { w.onmessage = prev; e.data.type === "svg" ? ok(e.data.svg) : fail(new Error("save")); };
          w.postMessage({ type: "svg" } satisfies WorkerIn);
        });
        await toPdf(materializeSvg(svgText, box, l.layerOf, l.drop, off), box, name, locale);
      }
    } catch (e) {
      setError(message(e instanceof Error ? e.message : "", "save"));
    } finally {
      setSaving("");
    }
  };

  const toggle = (layer: string) => {
    const next = new Set(off);
    next.has(layer) ? next.delete(layer) : next.add(layer);
    setOff(next);
    const l = loaded.current;
    if (l) { hiddenRef.current = l.scene.layers.map((n) => next.has(n)); render(); }
  };

  return (
    // max-h-dvh: 외부 스크립트(광고)가 height를 auto로 덮어써도 뷰어가 화면 밖으로 자라지 않게 한다.
    <div className="flex h-dvh max-h-dvh flex-col bg-slate-900 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-700 px-4 py-3">
        <label className="cursor-pointer rounded bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500">
          {t.open}
          <input type="file" accept=".dwg,.dxf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) open(f); e.target.value = ""; }} />
        </label>
        {name && <span className="text-sm text-slate-400">{name}</span>}
        {busy && <span className="text-sm text-amber-400">{t.opening}</span>}
        {/* GPL-3 배포 의무: 라이선스와 소스 위치를 화면에 알린다. */}
        <a href="https://github.com/wierdlion/docmoa-cad" target="_blank" rel="noopener" className="ms-auto text-xs text-slate-500 hover:text-slate-300">GPL-3.0 · Source (LibreDWG)</a>
        {error && <span className="text-sm text-red-400">{error}</span>}
        {ready && (
          <div className="ml-auto flex flex-wrap gap-2">
            {layers.length > 0 && (
              <button onClick={() => setShowLayers((v) => !v)}
                className="rounded border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800 sm:hidden">{t.layers}</button>
            )}
            {model3 && !isEmpty(model3) && (
              <button onClick={() => setIn3d((v) => !v)}
                className={`rounded px-3 py-1.5 text-sm ${in3d ? "bg-indigo-600 hover:bg-indigo-500" : "border border-slate-600 hover:bg-slate-800"}`}>
                {in3d ? t.view2d : t.view3d}</button>
            )}
            <button onClick={fitAll}
              className="rounded border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800">{t.fit}</button>
            <button onClick={() => download("png")} disabled={!!saving}
              className="rounded border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-50">
              {saving === "png" ? t.saving : t.png}</button>
            <button onClick={() => download("pdf")} disabled={!!saving}
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm hover:bg-emerald-600 disabled:opacity-50">
              {saving === "pdf" ? t.making : t.pdf}</button>
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {layers.length > 0 && (
          <aside className={`${showLayers ? "block" : "hidden"} w-44 shrink-0 overflow-y-auto border-r border-slate-700 p-3 text-sm sm:block sm:w-52`}>
            <p className="mb-2 font-medium text-slate-300">{t.layers}</p>
            {layers.map((l) => (
              <label key={l} className="flex items-center gap-2 py-1 text-slate-400">
                <input type="checkbox" checked={!off.has(l)} onChange={() => toggle(l)} />
                <span className="truncate" title={l}>{l}</span>
              </label>
            ))}
          </aside>
        )}
        <div className="relative min-w-0 flex-1">
          <div ref={host} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            className={`h-full w-full touch-none bg-black ${in3d ? "invisible" : ""}`}>
            <canvas ref={canvas} className="block h-full w-full" />
          </div>
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
