import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import {pickCurve, type CurveSegment} from "./picking";
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
    // WebGL native linewidth is often fixed at one pixel; use screen-space wide lines.
    let boundaryGeometry = new LineSegmentsGeometry();
    const boundaryMaterial = new LineMaterial({color:0xffcf70,linewidth:4,worldUnits:false,depthTest:false,depthWrite:false,transparent:true});
    const boundaryHighlight = new LineSegments2(boundaryGeometry,boundaryMaterial);
    boundaryHighlight.renderOrder=9;
    boundaryHighlight.visible=false;
    scene.add(boundaryHighlight);
    const patchGeometry=new THREE.BufferGeometry();
    const patchMaterial=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.85,side:THREE.DoubleSide,transparent:true,depthWrite:false,forceSinglePass:true,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
    const patchMesh=new THREE.Mesh(patchGeometry,patchMaterial);scene.add(patchMesh);
    scene.add(new THREE.HemisphereLight(0xffffff,0x48545d,2));
    const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(2,4,5);scene.add(light);
    let patchTriangles:number[][]=[],patchCenters:THREE.Vector3[]=[];
    let trianglePatchIds:string[]=[],sortedPatchIds:string[]=[],curveSegments:CurveSegment[]=[];
    const raycaster=new THREE.Raycaster();
    let press:{id:number;x:number;y:number;moved:boolean}|null=null;
    const onDown=(e:PointerEvent)=>{
      if(press){press.moved=true;return;}
      if(e.button===0&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey)press={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};
    };
    const onMove=(e:PointerEvent)=>{if(press&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>4)press.moved=true;};
    const onCancel=()=>{press=null;};
    const onUp=(e:PointerEvent)=>{
      const down=press;press=null;
      if(!down||down.id!==e.pointerId||down.moved||e.button!==0||Math.hypot(e.clientX-down.x,e.clientY-down.y)>4)return;
      const rect=renderer.domElement.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
      if(x<0||y<0||x>rect.width||y>rect.height)return;
      camera.updateMatrixWorld();
      const curve=pickCurve(curveSegments,camera,rect.width,rect.height,x,y);
      const s=useEditor.getState();
      // Wireframe remains editable even through a translucent patch.
      if(curve){s.selectCurve(curve);return;}
      if(s.patchCreation)return;
      raycaster.setFromCamera(new THREE.Vector2(x/rect.width*2-1,1-y/rect.height*2),camera);
      patchMesh.updateMatrixWorld();
      const hit=patchMesh.visible?raycaster.intersectObject(patchMesh,false)[0]:undefined;
      const id=hit?.faceIndex!=null?sortedPatchIds[hit.faceIndex]:undefined;
      if(id)s.selectPatch(id);
    };
    renderer.domElement.addEventListener('pointerdown',onDown);
    renderer.domElement.addEventListener('pointermove',onMove);
    renderer.domElement.addEventListener('pointerup',onUp);
    renderer.domElement.addEventListener('pointercancel',onCancel);
    renderer.domElement.addEventListener('lostpointercapture',onCancel);
    material.depthTest=false;selectedMaterial.depthTest=false;material.transparent=true;selectedMaterial.transparent=true;
    points.renderOrder=10;
    scene.children.filter(o=>o instanceof THREE.Points).forEach(o=>o.renderOrder=10);
    let lastRenderState: ReturnType<typeof useEditor.getState> | undefined;
    let sortDirty=true;
    const sortCamera=new THREE.Matrix4();
    const update = () => {
      const s = useEditor.getState();
      const opacity=s.project.patchDisplay?.opacity3d??defaultDisplay.opacity3d;
      const transparent=opacity<1;
      if(patchMaterial.transparent!==transparent){patchMaterial.transparent=transparent;patchMaterial.needsUpdate=true;sortDirty=true;}
      patchMaterial.opacity=opacity;
      patchMaterial.depthWrite=!transparent;
      patchMesh.visible=opacity>0;
      const old=lastRenderState;lastRenderState=s;
      // Display-only changes must not rebuild source samples or GPU geometry.
      if(old&&old.project.landmarks===s.project.landmarks&&old.project.curves===s.project.curves&&old.project.patches===s.project.patches&&old.project.centerlineOrder===s.project.centerlineOrder&&old.selectedId===s.selectedId&&old.selectedCurveId===s.selectedCurveId&&old.selectedPatchId===s.selectedPatchId&&old.patchCreation===s.patchCreation)return;
      sortDirty=true;
      const pv:number[]=[],pc:number[]=[];patchTriangles=[];patchCenters=[];trianglePatchIds=[];curveSegments=[];
      for(const p of s.project.patches??[]){const m=tessellate(s.project,p);const offset=pv.length/3;pv.push(...m.vertices.flat());const color=new THREE.Color(p.id===s.selectedPatchId?0xe3bcf4:0xbecdcf).toArray();m.vertices.forEach(()=>pc.push(...color));for(const t of m.triangles){trianglePatchIds.push(p.id);patchTriangles.push(t.map(i=>i+offset));patchCenters.push(new THREE.Vector3(...m.vertices[t[0]]).add(new THREE.Vector3(...m.vertices[t[1]])).add(new THREE.Vector3(...m.vertices[t[2]])).multiplyScalar(1/3));}}
      sortedPatchIds=[...trianglePatchIds];
      patchGeometry.setAttribute('color',new THREE.Float32BufferAttribute(pc,3));
      patchGeometry.setAttribute('position',new THREE.Float32BufferAttribute(pv,3));patchGeometry.setIndex(patchTriangles.flat());patchGeometry.deleteAttribute('normal');patchGeometry.computeVertexNormals();patchGeometry.computeBoundingSphere();
      patchMaterial.opacity=s.project.patchDisplay?.opacity3d??defaultDisplay.opacity3d;patchMesh.visible=patchMaterial.opacity>0;
      const boundaryVertices: number[] = [];
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
          curveSegments.push({id:c.id,a:new THREE.Vector3(...samples[i-1]),b:new THREE.Vector3(...samples[i])});
          if(s.patchCreation?.includes(c.id)) boundaryVertices.push(...samples[i-1],...samples[i]);
          vertices.push(...samples[i - 1], ...samples[i]);
          colors.push(...color, ...color);
        }
      }
      boundaryGeometry.dispose();
      boundaryGeometry=new LineSegmentsGeometry();
      boundaryHighlight.geometry=boundaryGeometry;
      boundaryHighlight.visible=boundaryVertices.length>0;
      if(boundaryVertices.length) boundaryGeometry.setPositions(boundaryVertices);
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
      boundaryMaterial.resolution.set(w,h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resize.observe(element);
    let frame = 0;
    const draw = () => {
      controls.update();
      camera.updateMatrixWorld();
      if(patchMaterial.transparent && (sortDirty || !sortCamera.equals(camera.matrixWorldInverse))){
      const order=patchCenters.map((c,i)=>({i,z:c.clone().applyMatrix4(camera.matrixWorldInverse).z})).sort((a,b)=>a.z-b.z);
      sortedPatchIds=order.map(x=>trianglePatchIds[x.i]);
      patchGeometry.setIndex(order.flatMap(x=>patchTriangles[x.i]));
      sortCamera.copy(camera.matrixWorldInverse);sortDirty=false;
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      unsub();
      resize.disconnect();
      renderer.domElement.removeEventListener('pointerdown',onDown);
      renderer.domElement.removeEventListener('pointermove',onMove);
      renderer.domElement.removeEventListener('pointerup',onUp);
      renderer.domElement.removeEventListener('pointercancel',onCancel);
      renderer.domElement.removeEventListener('lostpointercapture',onCancel);
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
      boundaryGeometry.dispose();boundaryMaterial.dispose();
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
        {error || "点击选线 / 面 · 拖动旋转 · 右键平移 · 滚轮缩放"}
      </div>
    </div>
  );
}
