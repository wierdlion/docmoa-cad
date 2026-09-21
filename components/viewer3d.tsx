"use client";

import { useEffect, useRef } from "react";
import type { Model3 } from "@/lib/three-d";

export default function Viewer3d({ model }: { model: Model3 }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let stop = false;
    let dispose = () => {};

    (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (stop || !host.current) return;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x000000);
      const group = new THREE.Group();
      scene.add(group);

      if (model.tris.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(model.tris, 3));
        g.computeVertexNormals();
        group.add(new THREE.Mesh(g, new THREE.MeshNormalMaterial({ side: THREE.DoubleSide, flatShading: true })));
      }
      if (model.lines.length) {
        // 이어진 점들을 선분 쌍으로 펴서 한 덩어리로 그린다. 선이 많아도 드로우콜 하나.
        const seg: number[] = [];
        for (const line of model.lines) {
          for (let i = 0; i + 5 < line.length; i += 3) seg.push(...line.slice(i, i + 6));
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
        group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x67e8f9 })));
      }

      // 형상을 원점으로 옮기고, 화면에 꽉 차도록 카메라를 물린다.
      const box = new THREE.Box3().setFromObject(group);
      const size = box.getSize(new THREE.Vector3());
      const mid = box.getCenter(new THREE.Vector3());
      group.position.sub(mid);
      const span = Math.max(size.x, size.y, size.z) || 1;

      const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, span / 1000, span * 100);
      camera.position.set(span, -span, span * 0.8);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(el.clientWidth, el.clientHeight);
      el.replaceChildren(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;

      let raf = 0;
      const tick = () => {
        controls.update();
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      };
      tick();

      const ro = new ResizeObserver(() => {
        if (!el.clientWidth || !el.clientHeight) return;
        camera.aspect = el.clientWidth / el.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(el.clientWidth, el.clientHeight);
      });
      ro.observe(el);

      dispose = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        renderer.dispose();
        el.replaceChildren();
      };
    })();

    return () => { stop = true; dispose(); };
  }, [model]);

  return <div ref={host} className="h-full w-full bg-black" />;
}
