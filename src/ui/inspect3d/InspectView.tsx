import {tessellate} from "../../domain/patches/geometry";
import {defaultDisplay} from "../../domain/patches/model";
import { flatten, norm } from "../../domain/geometry/bezier";
import { controls as curveControls } from "../../domain/curves/geometry";
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
    const patchGeometry=new THREE.BufferGeometry();
    const patchMaterial=new THREE.MeshStandardMaterial({color:0xbecdcf,roughness:.85,side:THREE.DoubleSide,transparent:true,depthWrite:false});
    const patchMesh=new THREE.Mesh(patchGeometry,patchMaterial);scene.add(patchMesh);
    scene.add(new THREE.HemisphereLight(0xffffff,0x48545d,2));
    const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(2,4,5);scene.add(light);
    let patchTriangles:number[][]=[],patchCenters:THREE.Vector3[]=[];
    material.depthTest=false;selectedMaterial.depthTest=false;material.transparent=true;selectedMaterial.transparent=true;
    points.renderOrder=10;
    scene.children.filter(o=>o instanceof THREE.Points).forEach(o=>o.renderOrder=10);
    const update = () => {
      const s = useEditor.getState();
      const pv:number[]=[];patchTriangles=[];patchCenters=[];
      for(const p of s.project.patches??[]){const m=tessellate(s.project,p);const offset=pv.length/3;pv.push(...m.vertices.flat());for(const t of m.triangles){patchTriangles.push(t.map(i=>i+offset));patchCenters.push(new THREE.Vector3(...m.vertices[t[0]]).add(new THREE.Vector3(...m.vertices[t[1]])).add(new THREE.Vector3(...m.vertices[t[2]])).multiplyScalar(1/3));}}
      patchGeometry.setAttribute('position',new THREE.Float32BufferAttribute(pv,3));patchGeometry.setIndex(patchTriangles.flat());patchGeometry.deleteAttribute('normal');patchGeometry.computeVertexNormals();patchGeometry.computeBoundingSphere();
      patchMaterial.opacity=s.project.patchDisplay?.opacity3d??defaultDisplay.opacity3d;patchMesh.visible=patchMaterial.opacity>0;
      const vertices: number[] = [],
        colors: number[] = [];
      for (const c of s.project.curves) {
        const cp = curveControls(s.project, c),
          samples = flatten(
            cp,
            Math.max(
              ...cp.map((p) =>
                norm([p[0] - cp[0][0], p[1] - cp[0][1], p[2] - cp[0][2]]),
              ),
            ) * 1e-4 || 1e-6,
          ),
          color = new THREE.Color(
            c.id === s.selectedCurveId ? 0xf0d8ff : 0xab9fdd,
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
      camera.updateMatrixWorld();
      const order=patchCenters.map((c,i)=>({i,z:c.clone().applyMatrix4(camera.matrixWorldInverse).z})).sort((a,b)=>a.z-b.z);
      patchGeometry.setIndex(order.flatMap(x=>patchTriangles[x.i]));
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      unsub();
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
      patchGeometry.dispose();patchMaterial.dispose();
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
