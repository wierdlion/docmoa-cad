"use client";

import { useCallback, useRef, useState } from "react";
import { readCad } from "@/lib/dwg";
import { fitViewBox, type Box } from "@/lib/fit";
import { toPdf, toPng } from "@/lib/export";
import { isEmpty, type Model3 } from "@/lib/three-d";
import { fill, type Dict, type Locale } from "@/lib/i18n";
import { AdRail } from "@/components/ad-rail";
import dynamic from "next/dynamic";

// three.js는 3D를 실제로 볼 때만 받는다.
const Viewer3d = dynamic(() => import("@/components/viewer3d"), { ssr: false });



export default function Viewer({ locale, t }: { locale: Locale; t: Dict }) {
  const host = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const boxRef = useRef<Box | null>(null);
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

  const message = (e: unknown, fallback: keyof Dict["err"]) => {
    const code = e instanceof Error ? e.message : "";
    return t.err[code as keyof Dict["err"]] ?? t.err[fallback];
  };

  const apply = (b: Box) => {
    boxRef.current = b;
    svgRef.current?.setAttribute("viewBox", `${b.x} ${b.y} ${b.w} ${b.h}`);
  };

  const open = useCallback(async (file: File) => {
    setBusy(true); setError(""); setName(file.name); setOff(new Set()); setReady(false); setIn3d(false); setModel3(null);
    try {
      const cad = await readCad(await file.arrayBuffer(), file.name);
      const doc = new DOMParser().parseFromString(cad.svg, "image/svg+xml");
      const svg = doc.documentElement as unknown as SVGSVGElement;
      if (svg.nodeName !== "svg") throw new Error("draw");

      for (const h of cad.drop) doc.getElementById(h)?.remove();
      for (const [h, layer] of Object.entries(cad.layerOf)) doc.getElementById(h)?.setAttribute("data-layer", layer);

      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      // 변환기 기본값은 좌상단 정렬이라 세로 화면에서 도면이 위로 쏠린다.
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      host.current!.replaceChildren(svg);
      svgRef.current = svg;

      const fitted = fitViewBox(svg);
      if (fitted) apply(fitted);
      setLayers(cad.layers);
      setModel3(cad.model3);
      setReady(true);
    } catch (e) {
      setError(message(e, "open"));
      host.current?.replaceChildren();
      svgRef.current = null;
      setLayers([]);
    } finally {
      setBusy(false);
    }
  }, []);

  const zoom = (e: React.WheelEvent) => {
    const b = boxRef.current, svg = svgRef.current;
    if (!b || !svg) return;
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    // 커서가 가리키던 도면 좌표가 제자리에 남도록 확대한다.
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    apply({ x: b.x + b.w * fx * (1 - k), y: b.y + b.h * fy * (1 - k), w: b.w * k, h: b.h * k });
  };

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
    gesture.current = pointers.current.size && boxRef.current ? { box: { ...boxRef.current }, ...center() } : null;
  };

  const onDown = (e: React.PointerEvent) => {
    if (!svgRef.current || !boxRef.current) return;
    // 캡처가 안 되면 손가락이 캔버스를 벗어날 때 끊길 뿐, 동작 자체는 유지된다.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 이미 놓친 포인터 */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    rebase();
  };

  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current, svg = svgRef.current;
    if (!g || !svg) return;
    const r = svg.getBoundingClientRect();
    const now = center();
    // 손가락을 벌리면 span이 커지고 viewBox는 작아진다 = 확대.
    const k = g.span && now.span ? g.span / now.span : 1;
    const w = g.box.w * k, h = g.box.h * k;
    // 처음 잡은 지점의 도면 좌표가 지금 손가락 중심에 오도록 맞춘다.
    const ax = g.box.x + g.box.w * ((g.cx - r.left) / r.width);
    const ay = g.box.y + g.box.h * ((g.cy - r.top) / r.height);
    apply({ x: ax - w * ((now.cx - r.left) / r.width), y: ay - h * ((now.cy - r.top) / r.height), w, h });
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    rebase();
  };

  const download = async (kind: "png" | "pdf") => {
    const svg = svgRef.current, box = boxRef.current;
    if (!svg || !box) return;
    setSaving(kind); setError("");
    try {
      await (kind === "png" ? toPng(svg, box, name) : toPdf(svg, box, name, locale));
    } catch (e) {
      setError(message(e, "save"));
    } finally {
      setSaving("");
    }
  };

  const toggle = (layer: string) => {
    const next = new Set(off);
    next.has(layer) ? next.delete(layer) : next.add(layer);
    setOff(next);
    for (const el of svgRef.current?.querySelectorAll<SVGElement>(`[data-layer="${CSS.escape(layer)}"]`) ?? [])
      el.style.display = next.has(layer) ? "none" : "";
  };

  return (
    <div className="flex h-dvh flex-col bg-slate-900 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-700 px-4 py-3">
        <label className="cursor-pointer rounded bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500">
          {t.open}
          <input type="file" accept=".dwg,.dxf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) open(f); e.target.value = ""; }} />
        </label>
        {name && <span className="text-sm text-slate-400">{name}</span>}
        {busy && <span className="text-sm text-amber-400">{t.opening}</span>}
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
            <button onClick={() => { const f = svgRef.current && fitViewBox(svgRef.current); if (f) apply(f); }}
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
          <div ref={host} onWheel={zoom} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            className={`h-full w-full touch-none bg-black [&>svg]:h-full [&>svg]:w-full ${in3d ? "invisible" : ""}`} />
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
