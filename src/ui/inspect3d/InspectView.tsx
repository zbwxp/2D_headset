import {curveInputKey} from '../../domain/geometry/revisions';
import type {PatchMesh} from '../../domain/patches/geometry';
import {count,timed} from '../../domain/geometry/diagnostics';
import {pointPosition} from "../../domain/geometry/evaluation";
import {subscribeSmooth,evaluationToken} from "../../domain/smooth/evaluation";
import {useInspectionCamera} from "../windows/state";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import {pickCurve, type CurveSegment} from "./picking";
import {tessellate} from "../../domain/patches/geometry";
import {defaultDisplay,patchSampling} from "../../domain/patches/model";
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
    const pose=useInspectionCamera.getState();
    camera.position.fromArray(pose.position);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.fromArray(pose.target);
    controls.update();
    const publishCamera=()=>useInspectionCamera.setState({position:camera.position.toArray(),target:controls.target.toArray(),quaternion:camera.quaternion.toArray()});
    publishCamera();
    controls.addEventListener("change",publishCamera);
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
    let smoothToken="",lastCurveKey="";
    let patchLayout="",curveLayout="";
    const curveInputs=new Map<string,ReturnType<typeof curveControls>>();
    const curveSamples=new WeakMap<ReturnType<typeof curveControls>,ReturnType<typeof flatten>>();
    const patchInputs=new Map<string,PatchMesh>();
    const typedMeshes=new WeakMap<PatchMesh,{positions:Float32Array;normals:Float32Array}>();
    const arrays=(m:PatchMesh)=>{let a=typedMeshes.get(m);if(a)return a;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(m.vertices.flat(),3));g.setIndex(m.triangles.flat());g.computeVertexNormals();a={positions:g.getAttribute('position').array as Float32Array,normals:g.getAttribute('normal').array as Float32Array};typedMeshes.set(m,a);g.dispose();return a;};
    const update = () => {
      const s = useEditor.getState();
      const opacity=s.project.patchDisplay?.opacity3d??defaultDisplay.opacity3d;
      const transparent=opacity<1;
      if(patchMaterial.transparent!==transparent){patchMaterial.transparent=transparent;patchMaterial.needsUpdate=true;sortDirty=true;}
      patchMaterial.opacity=opacity;
      patchMaterial.depthWrite=!transparent;
      patchMesh.visible=opacity>0 && s.project.patchDisplay?.visible!==false;
      const old=lastRenderState;lastRenderState=s;
      // Display-only changes must not rebuild source samples or GPU geometry.
      if(old&&smoothToken===evaluationToken(s.project)&&old.project.patchDisplay?.quality===s.project.patchDisplay?.quality&&old.project.patchDisplay?.visible===s.project.patchDisplay?.visible&&old.project.landmarks===s.project.landmarks&&old.project.curves===s.project.curves&&old.project.patches===s.project.patches&&old.project.centerlineOrder===s.project.centerlineOrder&&old.selectedId===s.selectedId&&old.selectedCurveId===s.selectedCurveId&&old.selectedPatchId===s.selectedPatchId&&old.patchCreation===s.patchCreation)return;
      const endUpdate=timed('threeGeometryUpdate');
      smoothToken=evaluationToken(s.project);
      const patches=(s.project.patchDisplay?.visible===false?[]:s.project.patches??[]).map(p=>({p,m:tessellate(s.project,p,patchSampling(s.project.patchDisplay).subdivisions)}));
      const layout=patches.map(({p,m})=>p.id+':'+m.vertices.length+':'+m.triangles.length).join('|');
      const rebuild=layout!==patchLayout||!patchGeometry.getAttribute('position');
      if(rebuild){patchLayout=layout;patchInputs.clear();const size=patches.reduce((n,{m})=>n+m.vertices.length*3,0);for(const key of ['position','normal','color'])patchGeometry.setAttribute(key,new THREE.BufferAttribute(new Float32Array(size),3));patchTriangles=[];patchCenters=[];trianglePatchIds=[];}
      let vertexOffset=0,triangleOffset=0,changed=false;
      for(const {p,m} of patches){
        if(rebuild||patchInputs.get(p.id)!==m){const a=arrays(m);for(const key of ['position','normal'] as const){const attr=patchGeometry.getAttribute(key) as THREE.BufferAttribute;(attr.array as Float32Array).set(key==='position'?a.positions:a.normals,vertexOffset*3);attr.addUpdateRange(vertexOffset*3,m.vertices.length*3);attr.needsUpdate=true;}for(let j=0;j<m.triangles.length;j++){const t=m.triangles[j],at=triangleOffset+j;patchTriangles[at]=t.map(i=>i+vertexOffset);trianglePatchIds[at]=p.id;patchCenters[at]=new THREE.Vector3(...m.vertices[t[0]]).add(new THREE.Vector3(...m.vertices[t[1]])).add(new THREE.Vector3(...m.vertices[t[2]])).multiplyScalar(1/3);}patchInputs.set(p.id,m);count('threeBufferRebuilds');changed=true;}
        if(rebuild||old?.selectedPatchId!==s.selectedPatchId){const color=new THREE.Color(p.id===s.selectedPatchId?0xe3bcf4:0xbecdcf).toArray(),attr=patchGeometry.getAttribute('color') as THREE.BufferAttribute;for(let i=0;i<m.vertices.length;i++)(attr.array as Float32Array).set(color,(vertexOffset+i)*3);attr.addUpdateRange(vertexOffset*3,m.vertices.length*3);attr.needsUpdate=true;}
        vertexOffset+=m.vertices.length;triangleOffset+=m.triangles.length;
      }
      if(changed||rebuild){sortedPatchIds=[...trianglePatchIds];patchGeometry.setIndex(patchTriangles.flat());patchGeometry.computeBoundingSphere();sortDirty=true;}
      const nextCurveKey=curveInputKey(s.project);
      if(nextCurveKey!==lastCurveKey||old?.selectedCurveId!==s.selectedCurveId||old?.patchCreation!==s.patchCreation){lastCurveKey=nextCurveKey;curveSegments=[];

      const boundaryVertices:number[]=[];
      const lines=s.project.curves.map(c=>{const cp=curveControls(s.project,c);let samples=curveSamples.get(cp);if(!samples){samples=flatten(cp,Math.max(...cp.map(p=>norm([p[0]-cp[0][0],p[1]-cp[0][1],p[2]-cp[0][2]])))*1e-4||1e-6);curveSamples.set(cp,samples);}return {c,cp,samples};});
      const layout=lines.map(({c,samples})=>c.id+':'+samples.length).join('|'),rebuild=layout!==curveLayout||!curveGeometry.getAttribute('position');
      if(rebuild){curveLayout=layout;const size=lines.reduce((n,{samples})=>n+(samples.length-1)*6,0);curveGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(size),3));curveGeometry.setAttribute('color',new THREE.BufferAttribute(new Float32Array(size),3));curveInputs.clear();}
      let offset=0,changed=false;
      for(const {c,cp,samples} of lines){const dirty=rebuild||curveInputs.get(c.id)!==cp,positions=curveGeometry.getAttribute('position') as THREE.BufferAttribute,colors=curveGeometry.getAttribute('color') as THREE.BufferAttribute,color=new THREE.Color(c.id===s.selectedCurveId?0xf0d8ff:0xab9fdd).toArray();
       for(let i=1;i<samples.length;i++){curveSegments.push({id:c.id,a:new THREE.Vector3(...samples[i-1]),b:new THREE.Vector3(...samples[i])});if(s.patchCreation?.includes(c.id))boundaryVertices.push(...samples[i-1],...samples[i]);const at=offset+(i-1)*6;if(dirty){(positions.array as Float32Array).set(samples[i-1],at);(positions.array as Float32Array).set(samples[i],at+3);}if(rebuild||old?.selectedCurveId!==s.selectedCurveId){(colors.array as Float32Array).set(color,at);(colors.array as Float32Array).set(color,at+3);}}
       const length=(samples.length-1)*6;if(dirty){positions.addUpdateRange(offset,length);positions.needsUpdate=true;count('threeCurveBufferRebuilds');curveInputs.set(c.id,cp);changed=true;}if(rebuild||old?.selectedCurveId!==s.selectedCurveId){colors.addUpdateRange(offset,length);colors.needsUpdate=true;}offset+=length;
      }
      if(changed)curveGeometry.computeBoundingSphere();
      boundaryGeometry.dispose();boundaryGeometry=new LineSegmentsGeometry();boundaryHighlight.geometry=boundaryGeometry;boundaryHighlight.visible=boundaryVertices.length>0;if(boundaryVertices.length)boundaryGeometry.setPositions(boundaryVertices);
      }
      guideGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(centerlineGuide(s.project).flat(), 3),
      );
      guideGeometry.computeBoundingSphere();
      guide.computeLineDistances();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          s.project.landmarks.flatMap((l) => pointPosition(s.project,l.id)),
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
            : (s.selectedId ? pointPosition(s.project,s.selectedId) : []),
          3,
        ),
      );
      selectedGeometry.computeBoundingSphere();endUpdate();
    };
    update();
    let updatePending=false;const schedule=()=>{updatePending=true;};
    const unsub = useEditor.subscribe(schedule);
    const unsubSmooth=subscribeSmooth(schedule);
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
      if(updatePending){updatePending=false;update();}
      controls.update();
      camera.updateMatrixWorld();
      if(patchMesh.visible && patchMaterial.transparent && (sortDirty || !sortCamera.equals(camera.matrixWorldInverse))){
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
      unsubSmooth();
      resize.disconnect();
      renderer.domElement.removeEventListener('pointerdown',onDown);
      renderer.domElement.removeEventListener('pointermove',onMove);
      renderer.domElement.removeEventListener('pointerup',onUp);
      renderer.domElement.removeEventListener('pointercancel',onCancel);
      renderer.domElement.removeEventListener('lostpointercapture',onCancel);
      publishCamera();
      controls.removeEventListener("change",publishCamera);
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
