import { bezier } from "../../domain/curves/geometry";
import { resolveNetwork } from "../../domain/junctions/resolve";
import { useUI } from "../session";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { centerlineGuide } from "../../domain/landmarks/model";
import { useEditor } from "../../app/store";
export default function InspectView() {
  const host = useRef<HTMLDivElement>(null),
    reset = useRef<() => void>(() => {});
  const [error, setError] = useState("");
  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      setError("无法启动 WebGL，二维编辑仍可使用。");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x1e2429, 1);
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(3, 1.25, 4.6);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 2.3;
    controls.maxDistance = 12;
    reset.current = () => {
      camera.position.set(3, 1.25, 4.6);
      controls.target.set(0, 0, 0);
      controls.update();
    };
    const grid = new THREE.GridHelper(6, 24, 0x394749, 0x293337);
    grid.position.y = -1.3;
    scene.add(grid);
    scene.add(new THREE.AxesHelper(0.45));
    const geometry = new THREE.BufferGeometry(),
      material = new THREE.PointsMaterial({
        size: 0.075,
        vertexColors: true,
        sizeAttenuation: true,
      });
    const points = new THREE.Points(geometry, material);
    scene.add(points);
    const selectedGeometry = new THREE.BufferGeometry(),
      selectedMaterial = new THREE.PointsMaterial({
        size: 0.115,
        color: 0xb9eb9f,
      });
    scene.add(new THREE.Points(selectedGeometry, selectedMaterial));
    for (const m of [material, selectedMaterial])
      m.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <clipping_planes_fragment>",
          "#include <clipping_planes_fragment>\nif (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;",
        );
      };
    const guideGeometry = new THREE.BufferGeometry();
    const guideMaterial = new THREE.LineDashedMaterial({
      color: 0xffc879,
      dashSize: 0.025,
      gapSize: 0.04,
      transparent: true,
      opacity: 0.65,
    });
    const guide = new THREE.Line(guideGeometry, guideMaterial);
    scene.add(guide);
    const curveGeometry = new THREE.BufferGeometry();
    const curveMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
    const curveLines = new THREE.LineSegments(curveGeometry, curveMaterial);
    scene.add(curveLines);
    const hoverGeometry = new THREE.BufferGeometry(),
      hoverMaterial = new THREE.PointsMaterial({ color: 0xffd17b, size: 0.1 });
    scene.add(new THREE.Points(hoverGeometry, hoverMaterial));
    const update = () => {
      const s = useEditor.getState();
      const vertices: number[] = [],
        colors: number[] = [];
      const network = resolveNetwork(s.project),
        hovered = useUI.getState().hoverJunctionId;
      const rows = network.junctions.filter((j) => j.sourceId === hovered),
        highlighted = new Set(
          rows.flatMap((j) => [j.sideA.curveId, j.sideB.curveId]),
        );
      hoverGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          rows
            .flatMap((j) => [
              s.project.landmarks.find((l) => l.id === j.landmarkId)!.position,
              ...(j.blendA && j.blendB ? [j.blendA[0], j.blendB[3]] : []),
            ])
            .flat(),
          3,
        ),
      );
      hoverGeometry.computeBoundingSphere();
      for (const span of network.spans) {
        const samples = Array.from({ length: 65 }, (_, i) =>
            bezier(span.controls, i / 64),
          ),
          color = new THREE.Color(
            highlighted.has(span.curveId)
              ? 0xffd17b
              : span.kind === "blend"
                ? 0xa4d6c2
                : span.curveId === s.selectedCurveId
                  ? 0xf0d8ff
                  : 0xab9fdd,
          ).toArray();
        for (let i = 1; i < samples.length; i++) {
          vertices.push(...samples[i - 1], ...samples[i]);
          colors.push(...color, ...color);
        }
      }
      curveGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(vertices, 3),
      );
      curveGeometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(colors, 3),
      );
      curveGeometry.computeBoundingSphere();
      guideGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(centerlineGuide(s.project).flat(), 3),
      );
      guideGeometry.computeBoundingSphere();
      guide.computeLineDistances();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          s.project.landmarks.flatMap((l) => l.position),
          3,
        ),
      );
      geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(
          s.project.landmarks.flatMap((l) =>
            new THREE.Color(
              l.type === "CENTERLINE"
                ? 0xffc879
                : l.type === "LEFT"
                  ? 0xb9eb9f
                  : 0x8fc6e1,
            ).toArray(),
          ),
          3,
        ),
      );
      geometry.computeBoundingSphere();
      selectedGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          s.selectedCurveId
            ? []
            : (s.project.landmarks.find((l) => l.id === s.selectedId)
                ?.position ?? []),
          3,
        ),
      );
      selectedGeometry.computeBoundingSphere();
    };
    update();
    const unsub = useEditor.subscribe(update);
    const unsubUI = useUI.subscribe(update);
    const resize = new ResizeObserver(() => {
      const w = element.clientWidth,
        h = element.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resize.observe(element);
    let frame = 0;
    const draw = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      unsub();
      unsubUI();
      hoverGeometry.dispose();
      hoverMaterial.dispose();
      resize.disconnect();
      controls.dispose();
      guideGeometry.dispose();
      guideMaterial.dispose();
      geometry.dispose();
      material.dispose();
      selectedGeometry.dispose();
      selectedMaterial.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          const m = o.material;
          Array.isArray(m) ? m.forEach((x) => x.dispose()) : m.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div className="point-inspect">
      <div ref={host} className="point-three" data-testid="point-inspect" />
      <span className="point-view-label">PERSPECTIVE · 语义点与结构线</span>
      <button className="point-reset" onClick={() => reset.current()}>
        居中视图 ↗
      </button>
      <div className="point-stage-hint">
        {error || "拖动旋转 · 右键平移 · 滚轮缩放"}
      </div>
    </div>
  );
}
