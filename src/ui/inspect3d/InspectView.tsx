import {chinSurfaces} from '../../domain/chin/geometry';
import {headPerspective} from '../../domain/head/perspective';
import {displayPoint,displayCurveSamples,displayTransform} from '../../rendering/moduleDisplay';
import {eyeObjectMatrix} from '../../rendering/eyeDisplay';
import {eyeSide} from '../../domain/eyes/scaffold';
import {eyePerspectiveMatrix} from '../../domain/eyes/perspective';
import CameraAngles from './CameraAngles';
import {createCurveHandles} from './CurveHandles';
import {gazePose,gazeFacing} from '../../domain/eyes/tracking';
import {irisMeshes} from '../../domain/eyes/gaze';
import {modulePickable} from '../authoring/moduleAccess';
import {SelectionCycle} from '../authoring/selectionCycle';
import {objectHidden as baseObjectHidden,useObjectVisibility,moduleHidden} from '../authoring/visibility';
import {uiText} from "../i18n";
import {helmetSurfaces} from '../../domain/head/helmet';
import {HELMET} from '../../domain/head/scaffold';
import InspectionBackground from './InspectionBackground';
import {capMesh} from '../../domain/head/caps';
import {regionMesh} from '../../domain/head/regions';
import {evaluationContext} from '../../domain/geometry/evaluation';
import {curvePolyline,type CurveProvider} from '../../domain/geometry/curveProvider';
import {frameWire,rotateFrame} from '../../domain/head/frame';
import {loopCorrespondence,authoringBoundaries} from '../patches/authoring';
import {useUI} from '../session';
import {eligibleAnchors,boundaryGeometry as getBoundaryGeometry} from '../../domain/patches/boundary';
import {curveInputKey} from '../../domain/geometry/revisions';
import type {PatchMesh} from '../../domain/patches/geometry';
import {count,timed} from '../../domain/geometry/diagnostics';
import {pointPosition} from "../../domain/geometry/evaluation";
import {subscribeSmooth,evaluationToken} from "../../domain/continuity/evaluation";
import {useInspectionCamera} from "../windows/state";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import {pickAnchor,pickCurve, type CurveSegment} from "./picking";
import {tessellate} from "../../domain/patches/geometry";
import {defaultDisplay,patchSampling} from "../../domain/patches/model";
import { flatten, norm } from "../../domain/geometry/bezier";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { centerlineGuide } from "../../domain/landmarks/model";
import { useEditor } from "../../app/store";
export default function InspectView() {
  const host = useRef<HTMLDivElement>(null),
    reset = useRef<() => void>(() => {}),setPitch=useRef<(degrees:number)=>void>(()=>{});
  const perspective=useInspectionCamera(s=>s.perspective);
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
    renderer.setClearColor(0x1e2429, 0);
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    let camera:THREE.PerspectiveCamera|THREE.OrthographicCamera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
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
    const updateProjection=()=>{
      const aspect=(element.clientWidth||1)/(element.clientHeight||1);
      if(camera instanceof THREE.PerspectiveCamera)camera.aspect=aspect;
      else {const half=camera.position.distanceTo(controls.target)*Math.tan(34*Math.PI/360);camera.left=-half*aspect;camera.right=half*aspect;camera.top=half;camera.bottom=-half;}
      camera.updateProjectionMatrix();
    };
    const switchProjection=()=>{
      const perspective=useInspectionCamera.getState().perspective;
      if(perspective===(camera instanceof THREE.PerspectiveCamera))return;
      const old=camera;
      camera=perspective?new THREE.PerspectiveCamera(34,1,.1,100):new THREE.OrthographicCamera(-1,1,1,-1,.1,100);
      camera.position.copy(old.position);camera.quaternion.copy(old.quaternion);
      if(old instanceof THREE.OrthographicCamera)camera.position.sub(controls.target).divideScalar(old.zoom).add(controls.target);
      controls.object=camera;updateProjection();controls.update();publishCamera();
    };
    switchProjection();
    const unsubscribeProjection=useInspectionCamera.subscribe((s,old)=>{if(s.perspective!==old.perspective)switchProjection();});

    setPitch.current=(degrees)=>{
      // Drain residual orbit damping before applying an exact display-only pose.
      const damping=controls.enableDamping;controls.enableDamping=false;controls.update();
      const f=useEditor.getState().project.headFrame,world=gazeFacing(camera.quaternion.toArray()),local=f?rotateFrame(world,f,true):world;
      const yaw=Math.atan2(local[0],local[2]),pitch=Math.max(-89.999999,Math.min(89.999999,degrees))*Math.PI/180;
      const direction:[number,number,number]=[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)];
      const facing=f?rotateFrame(direction,f):direction,distance=camera.position.distanceTo(controls.target);
      camera.position.copy(controls.target).addScaledVector(new THREE.Vector3(...facing),distance);
      controls.update();controls.enableDamping=damping;publishCamera();
    };
    reset.current = () => {
      camera.zoom=1;camera.position.set(3, 1.25, 4.6);
      controls.target.set(0, 0, 0);
      updateProjection();controls.update();
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

    const frameGeometry=new THREE.BufferGeometry(),frameMaterial=new THREE.LineBasicMaterial({color:0x83b5c1,transparent:true,opacity:.5});
    scene.add(new THREE.LineSegments(frameGeometry,frameMaterial));
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
    const objectHidden=(id:string)=>{const p=useEditor.getState().project;return baseObjectHidden(id)||!!(p.eyeScaffold&&p.geometryModules?.[id]==='EYES'&&(p.curves.some(c=>c.id===id)||p.landmarks.some(l=>l.id===id)||p.patches?.some(x=>x.id===id)));};
    const irisGroup=new THREE.Group();scene.add(irisGroup);
    let irisSignature='';
    const clearIris=()=>{irisGroup.traverse(o=>{const m=o as THREE.Mesh;if(m.geometry){m.geometry.dispose();const materials=Array.isArray(m.material)?m.material:[m.material];materials.forEach(x=>x.dispose());}});irisGroup.clear();};
    const updateIris=()=>{const s=useEditor.getState(),p=s.project,key=JSON.stringify([p.gazeEyeball,p.eyeScaffold,p.headFrame,p.patches,p.patchDisplay,evaluationToken(p),s.selection,s.selectionTick,useObjectVisibility.getState().hidden,p.curves.filter(c=>p.geometryModules?.[c.id]==='EYES'),p.landmarks.filter(l=>p.geometryModules?.[l.id]==='EYES')]);if(key===irisSignature)return;irisSignature=key;clearIris();
     const meshes=moduleHidden('EYES')?[]:irisMeshes(p);renderer.domElement.dataset.irisCount=String(meshes.length);if(!p.eyeScaffold||moduleHidden('EYES'))return;
     for(const side of ['left','right'] as const){const group=new THREE.Group();group.userData.side=side;group.matrixAutoUpdate=false;irisGroup.add(group);
      const ball=new THREE.Group();ball.userData.ball=true;group.add(ball);const m=meshes.find(m=>m.side===side);
      if(m){const selected=s.selection?.id===m.id,g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(m.vertices.flat(),3));g.setIndex(m.triangles.flat());g.computeVertexNormals();const mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:selected?0x819c72:0x537875,roughness:.8,side:THREE.DoubleSide}));mesh.userData.irisId=m.id;ball.add(mesh);
       const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(m.rim.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color:selected?0xffcf70:0x213e3e}));line.userData.irisId=m.id;ball.add(line);}
      const eye=p.eyeScaffold[side];eye.curveIds.forEach((id,i)=>{if(!p.curves.some(c=>c.id===id)||baseObjectHidden(id,false))return;const samples=evaluationContext(p).curve(id).sample(32);const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(samples.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color:s.selectedCurveId===id?0xffcf70:0xab9fdd}));line.userData.curveId=id;(i>=12&&i<24?ball:group).add(line);});
     }
     const custom=new THREE.Group();custom.userData.custom=true;irisGroup.add(custom);
     for(const patch of p.patchDisplay?.visible===false?[]:(p.patches??[]).filter(x=>p.geometryModules?.[x.id]==='EYES'&&!baseObjectHidden(x.id))){const m=tessellate(p,patch,patchSampling(p.patchDisplay).subdivisions),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(m.vertices.flat(),3));g.setIndex(m.triangles.flat());g.computeVertexNormals();const opacity=p.patchDisplay?.opacity3d??defaultDisplay.opacity3d,mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:s.selectedPatchId===patch.id?0xe3bcf4:0xbecdcf,roughness:.85,side:THREE.DoubleSide,transparent:opacity<1,opacity,depthWrite:opacity>=1}));mesh.userData.surfaceId=patch.id;mesh.matrixAutoUpdate=false;custom.add(mesh);}
     for(const c of p.curves.filter(c=>p.geometryModules?.[c.id]==='EYES'&&!eyeSide(p,c.id)&&!baseObjectHidden(c.id))){const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(evaluationContext(p).curve(c.id).sample(96).map(v=>new THREE.Vector3(...v))),new THREE.LineBasicMaterial({color:s.selectedCurveId===c.id?0xffcf70:0xab9fdd}));line.userData.curveId=c.id;line.matrixAutoUpdate=false;custom.add(line);}
     for(const l of p.landmarks.filter(l=>p.geometryModules?.[l.id]==='EYES'&&!eyeSide(p,l.id)&&!baseObjectHidden(l.id))){const point=new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...pointPosition(p,l.id))]),new THREE.PointsMaterial({color:s.selectedId===l.id?0xffcf70:0x9bc9df,size:5,sizeAttenuation:false}));point.userData.pointId=l.id;point.matrixAutoUpdate=false;custom.add(point);}
    };
    const poseIris=()=>{const p=useEditor.getState().project;if(!p.eyeScaffold)return;const facing=gazeFacing(camera.quaternion.toArray());renderer.domElement.dataset.gazeFacing=facing.join(',');for(const group of irisGroup.children){if(group.userData.custom){for(const child of group.children){child.matrix.copy(eyeObjectMatrix(p,child.userData.curveId??child.userData.pointId??child.userData.surfaceId,facing));child.matrixWorldNeedsUpdate=true;}continue;}group.matrix.copy(eyePerspectiveMatrix(p,group.userData.side,facing));group.matrixWorldNeedsUpdate=true;const ball=group.children.find(c=>c.userData.ball)!,pose=gazePose(p,group.userData.side,facing),center=new THREE.Vector3(...pose.center);ball.quaternion.copy(pose.rotation);ball.position.copy(center).sub(center.clone().applyQuaternion(pose.rotation));}irisGroup.updateMatrixWorld(true);
      curveSegments=curveSegments.filter(c=>p.geometryModules?.[c.id]!=='EYES');
      irisGroup.traverse(o=>{if(!o.userData.curveId)return;const attr=(o as THREE.Line).geometry.getAttribute('position');for(let i=1;i<attr.count;i++)curveSegments.push({id:o.userData.curveId,a:new THREE.Vector3().fromBufferAttribute(attr,i-1).applyMatrix4(o.matrixWorld),b:new THREE.Vector3().fromBufferAttribute(attr,i).applyMatrix4(o.matrixWorld)});});
    };
    const eyePickPoints=()=>{poseIris();const points:{id:string;position:THREE.Vector3}[]=[];irisGroup.traverse(o=>{if(o.userData.pointId)points.push({id:o.userData.pointId,position:new THREE.Vector3().fromBufferAttribute((o as THREE.Points).geometry.getAttribute('position'),0).applyMatrix4(o.matrixWorld)});});return points;};
    scene.add(new THREE.HemisphereLight(0xffffff,0x48545d,2));
    const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(2,4,5);scene.add(light);
    let patchTriangles:number[][]=[],patchCenters:THREE.Vector3[]=[];
    let trianglePatchIds:string[]=[],sortedPatchIds:string[]=[],curveSegments:CurveSegment[]=[];
    renderer.domElement.tabIndex=0;
    const raycaster=new THREE.Raycaster();
    const selectionCycle=new SelectionCycle();
    const displayPosition=(id:string)=>{const p=useEditor.getState().project;return displayPoint(p,id,pointPosition(p,id),gazeFacing(camera.quaternion.toArray()));};
    const pointAt=(e:PointerEvent)=>{
      const s=useEditor.getState(),rect=renderer.domElement.getBoundingClientRect();camera.updateMatrixWorld();
      const points=s.patchCreation?(s.patchCreation.host?eligibleAnchors(s.project,s.patchCreation.host):[]):s.project.landmarks;
      const derived=eyePickPoints().filter(x=>points.some(l=>l.id===x.id)&&modulePickable(x.id));
      return pickAnchor([...derived,...points.filter(l=>!objectHidden(l.id)&&modulePickable(l.id)).map(l=>({id:l.id,position:new THREE.Vector3(...displayPosition(l.id))}))],camera,rect.width,rect.height,e.clientX-rect.left,e.clientY-rect.top);
    };
    const pickPointGeometry=new THREE.BufferGeometry(),pickPointMaterial=new THREE.PointsMaterial({size:17,sizeAttenuation:false,color:0xffcf70,depthTest:false,depthWrite:false});
    pickPointMaterial.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nfloat r=distance(gl_PointCoord,vec2(0.5));if(r>0.5||r<0.32)discard;');};
    const anchorGeometry=new THREE.BufferGeometry(),anchorMaterial=pickPointMaterial.clone();anchorMaterial.size=13;anchorMaterial.onBeforeCompile=pickPointMaterial.onBeforeCompile;
    const anchorMarkers=new THREE.Points(anchorGeometry,anchorMaterial);anchorMarkers.renderOrder=13;anchorMarkers.visible=false;scene.add(anchorMarkers);
    const pickPoint=new THREE.Points(pickPointGeometry,pickPointMaterial);pickPoint.visible=false;scene.add(pickPoint);
    const pickLineGeometry=new LineSegmentsGeometry(),pickLineMaterial=new LineMaterial({color:0xffcf70,linewidth:4,worldUnits:false,depthTest:false,depthWrite:false,transparent:true}),pickLine=new LineSegments2(pickLineGeometry,pickLineMaterial);pickLine.visible=false;pickLine.renderOrder=14;scene.add(pickLine);
    let hoverKey='';
    const clearPickHover=()=>{hoverKey='';pickPoint.visible=false;pickLine.visible=false;renderer.domElement.style.cursor='';renderer.domElement.removeAttribute('title');delete renderer.domElement.dataset.hoverPoint;delete renderer.domElement.dataset.hoverCurve;};
    const updatePickHover=(e:PointerEvent)=>{
      if(e.buttons){clearPickHover();return;}
      const s=useEditor.getState(),rect=renderer.domElement.getBoundingClientRect();camera.updateMatrixWorld();
      const point=pointAt(e);
      if(s.patchCreation?.host)s.hoverPatchAnchor(point??undefined);
      const curve=point||s.patchCreation?.host?null:pickCurve(curveSegments.filter(c=>modulePickable(c.id)),camera,rect.width,rect.height,e.clientX-rect.left,e.clientY-rect.top);
      const key=point?'point:'+point:curve?'curve:'+curve:'';if(key===hoverKey)return;clearPickHover();hoverKey=key;if(!key)return;
      renderer.domElement.style.cursor='pointer';
      if(point){pickPointGeometry.setAttribute('position',new THREE.Float32BufferAttribute(eyePickPoints().find(x=>x.id===point)?.position.toArray()??displayPosition(point),3));pickPointGeometry.computeBoundingSphere();pickPoint.visible=true;renderer.domElement.dataset.hoverPoint=point;renderer.domElement.title=s.project.landmarks.find(l=>l.id===point)?.name??'语义点';}
      else if(curve){pickLineGeometry.setPositions(curveSegments.filter(c=>c.id===curve).flatMap(c=>[...c.a.toArray(),...c.b.toArray()]));pickLineMaterial.resolution.set(rect.width,rect.height);pickLine.visible=true;renderer.domElement.dataset.hoverCurve=curve;renderer.domElement.title=s.project.curves.find(c=>c.id===curve)?.name??'结构线';}
    };
    const clearCameraHover=()=>{clearPickHover();selectionCycle.reset();};controls.addEventListener('change',clearCameraHover);
    let press:{id:number;x:number;y:number;moved:boolean}|null=null;
    const onDown=(e:PointerEvent)=>{
      renderer.domElement.focus({preventScroll:true});clearPickHover();
      if(press){press.moved=true;return;}
      if(e.button===0&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey)press={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};
    };
    const onMove=(e:PointerEvent)=>{selectionCycle.move(e.clientX,e.clientY);if(press&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>4)press.moved=true;if(!press)updatePickHover(e);};
    const onCancel=()=>{press=null;clearPickHover();};
    const onLeave=()=>{selectionCycle.reset();clearPickHover();useEditor.getState().hoverPatchAnchor(undefined);};
    const onUp=(e:PointerEvent)=>{
      const down=press;press=null;
      if(!down||down.id!==e.pointerId||down.moved||e.button!==0||Math.hypot(e.clientX-down.x,e.clientY-down.y)>4)return;
      const rect=renderer.domElement.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
      if(x<0||y<0||x>rect.width||y>rect.height)return;
      camera.updateMatrixWorld();
      const s=useEditor.getState();
      // Curve authoring shares the same endpoint transaction as the 2D viewport.
      const point=pointAt(e);
      if(s.tool.kind==='mergePoint'){selectionCycle.reset();if(point)s.pickMergePoint(point);return;}
      if(s.tool.kind==='curve'){selectionCycle.reset();if(point)s.pickCurveEndpoint(point);return;}
      if(s.tool.kind==='patch'){
        selectionCycle.reset();if(s.patchCreation?.host){if(point)s.pickPatchAnchor(point);}
        else {const edge=pickCurve(curveSegments.filter(c=>modulePickable(c.id)),camera,rect.width,rect.height,x,y);if(edge)s.pickPatchEdge(edge);}
        return;
      }
      const hits:{kind:string;id:string}[]=[];
      let candidates=[...eyePickPoints().filter(x=>modulePickable(x.id)),...s.project.landmarks.filter(l=>!objectHidden(l.id)&&modulePickable(l.id)).map(l=>({id:l.id,position:new THREE.Vector3(...displayPosition(l.id))}))];
      while(candidates.length){const id=pickAnchor(candidates,camera,rect.width,rect.height,x,y);if(!id)break;hits.push({kind:'point',id});candidates=candidates.filter(c=>c.id!==id);}
      let segments=curveSegments.filter(c=>modulePickable(c.id));
      while(segments.length){const id=pickCurve(segments,camera,rect.width,rect.height,x,y);if(!id)break;hits.push({kind:'curve',id});segments=segments.filter(c=>c.id!==id);}
      raycaster.setFromCamera(new THREE.Vector2(x/rect.width*2-1,1-y/rect.height*2),camera);
      poseIris();raycaster.params.Line.threshold=.015;raycaster.params.Points.threshold=.025;
      if(s.activeModule==='EYES')for(const h of raycaster.intersectObjects(irisGroup.children,true)){const d=h.object.userData;if(d.irisId)hits.push({kind:'iris',id:d.irisId});else if(d.curveId)hits.push({kind:'curve',id:d.curveId});else if(d.pointId)hits.push({kind:'point',id:d.pointId});else if(d.surfaceId)hits.push({kind:'surface',id:d.surfaceId});}
      patchMesh.updateMatrixWorld();
      for(const hit of patchMesh.visible?raycaster.intersectObject(patchMesh,false):[]){const id=hit.faceIndex!=null?sortedPatchIds[hit.faceIndex]:undefined;if(id&&!objectHidden(id)&&modulePickable(id))hits.push({kind:'surface',id});}
      const hit=selectionCycle.next(hits,e.clientX,e.clientY,s.project);if(!hit)return;
      if(hit.kind==='iris'){s.selectObject({kind:'surface',source:'IRIS',id:hit.id});return;}
      if(hit.kind==='point'){s.selectLandmark(hit.id);return;}
      if(hit.kind==='curve'){s.selectCurve(hit.id);return;}
      const cap=s.project.loomisCaps?.find(c=>c.id===hit.id);if(cap)s.selectObject({kind:'surface',source:'CAP',id:hit.id});else s.selectPatch(hit.id);
    };
    renderer.domElement.addEventListener('pointerdown',onDown);
    renderer.domElement.addEventListener('pointermove',onMove);
    renderer.domElement.addEventListener('pointerup',onUp);
    renderer.domElement.addEventListener('pointercancel',onCancel);
    renderer.domElement.addEventListener('pointerleave',onLeave);
    renderer.domElement.addEventListener('lostpointercapture',onCancel);
    const curveHandles=createCurveHandles(element,()=>camera,controls);
    material.depthTest=false;selectedMaterial.depthTest=false;material.transparent=true;selectedMaterial.transparent=true;
    points.renderOrder=10;
    scene.children.filter(o=>o instanceof THREE.Points).forEach(o=>o.renderOrder=10);
    pickPoint.renderOrder=15;
    let lastHidden:unknown;
    let lastSelectionTick=-1;
    let lastRenderState: ReturnType<typeof useEditor.getState> | undefined;
    let sortDirty=true;
    const sortCamera=new THREE.Matrix4();
    let smoothToken="",lastCurveKey="",lastHeadDisplayKey="";
    const currentHeadPose=()=>headPerspective(useEditor.getState().project,gazeFacing(camera.quaternion.toArray()));
    const headDisplayKey=()=>{const pose=currentHeadPose();return pose.active?pose.key:"identity";};
    let patchLayout="",curveLayout="";
    const curveInputs=new Map<string,CurveProvider>();
    const curveSamples=new WeakMap<CurveProvider,ReturnType<typeof flatten>>();
    const patchInputs=new Map<string,PatchMesh>();
    const typedMeshes=new WeakMap<PatchMesh,{positions:Float32Array;normals:Float32Array}>();
    const arrays=(m:PatchMesh)=>{let a=typedMeshes.get(m);if(a)return a;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(m.vertices.flat(),3));g.setIndex(m.triangles.flat());g.computeVertexNormals();a={positions:g.getAttribute('position').array as Float32Array,normals:g.getAttribute('normal').array as Float32Array};typedMeshes.set(m,a);g.dispose();return a;};
    let lastChinGuides:boolean|undefined;
    const update = () => {
      clearPickHover();
      const s = useEditor.getState();
      const pose=currentHeadPose(),poseKey=pose.active?pose.key:"identity",poseChanged=poseKey!==lastHeadDisplayKey;lastHeadDisplayKey=poseKey;
      const display=(id:string,v:import("../../domain/project/types").Vec3)=>displayPoint(s.project,id,v,gazeFacing(camera.quaternion.toArray()));
      updateIris();
      const opacity=s.project.patchDisplay?.opacity3d??defaultDisplay.opacity3d;
      const transparent=opacity<1;
      if(patchMaterial.transparent!==transparent){patchMaterial.transparent=transparent;patchMaterial.needsUpdate=true;sortDirty=true;}
      patchMaterial.opacity=opacity;
      patchMaterial.depthWrite=!transparent;
      patchMesh.visible=opacity>0 && s.project.patchDisplay?.visible!==false;
      const visibilityChanged=lastHidden!==useObjectVisibility.getState().hidden||lastChinGuides!==useObjectVisibility.getState().chinGuides||lastSelectionTick!==s.selectionTick;lastHidden=useObjectVisibility.getState().hidden;lastChinGuides=useObjectVisibility.getState().chinGuides;lastSelectionTick=s.selectionTick;
      const old=lastRenderState;lastRenderState=s;
      // Reuse source evaluation; only pose-dependent display buffers change on orbit.
      if(!poseChanged&&!visibilityChanged&&old&&old.project.chinScaffold===s.project.chinScaffold&&old.project.loomisScaffold===s.project.loomisScaffold&&old.project.loomisCaps===s.project.loomisCaps&&old.project.loomisRegions===s.project.loomisRegions&&old.project.headFrame===s.project.headFrame&&smoothToken===evaluationToken(s.project)&&old.project.patchDisplay?.quality===s.project.patchDisplay?.quality&&old.project.patchDisplay?.visible===s.project.patchDisplay?.visible&&old.project.landmarks===s.project.landmarks&&old.project.curves===s.project.curves&&old.project.patches===s.project.patches&&old.project.centerlineOrder===s.project.centerlineOrder&&old.selectedId===s.selectedId&&old.selectedCurveId===s.selectedCurveId&&old.selectedPatchId===s.selectedPatchId&&old.patchCreation===s.patchCreation&&old.curveCreation===s.curveCreation)return;
      renderer.domElement.dataset.visiblePoints=String(s.project.landmarks.filter(l=>!objectHidden(l.id)).length);
      renderer.domElement.dataset.visibleCurves=String(s.project.curves.filter(c=>!objectHidden(c.id)).length);
      const endUpdate=timed('threeGeometryUpdate');
      smoothToken=evaluationToken(s.project);
      const patches=s.project.patchDisplay?.visible===false?[]:[...chinSurfaces(s.project).map(x=>({p:{id:x.id},m:x.mesh})),...helmetSurfaces(s.project).map(x=>({p:{id:x.id},m:x.mesh})),...(s.project.patches??[]).map(p=>({p,m:tessellate(s.project,p,patchSampling(s.project.patchDisplay).subdivisions)})),...(s.project.loomisRegions??[]).map(p=>({p,m:regionMesh(s.project,p)})),...(s.project.loomisCaps??[]).map(p=>({p,m:capMesh(s.project,p)}))].filter(({p})=>!objectHidden(p.id));
      renderer.domElement.dataset.visibleSurfaces=String(patches.length);
      const layout=patches.map(({p,m})=>p.id+':'+m.vertices.length+':'+m.triangles.length).join('|');
      const rebuild=layout!==patchLayout||!patchGeometry.getAttribute('position');
      if(rebuild){patchLayout=layout;patchInputs.clear();const size=patches.reduce((n,{m})=>n+m.vertices.length*3,0);for(const key of ['position','normal','color'])patchGeometry.setAttribute(key,new THREE.BufferAttribute(new Float32Array(size),3));patchTriangles=[];patchCenters=[];trianglePatchIds=[];}
      let vertexOffset=0,triangleOffset=0,changed=false;
      for(const {p,m} of patches){
        if(rebuild||poseChanged||patchInputs.get(p.id)!==m){const transform=displayTransform(s.project,p.id,gazeFacing(camera.quaternion.toArray())),posed=transform.active?{...m,vertices:m.vertices.map(transform.display)}:m,a=arrays(posed);for(const key of ['position','normal'] as const){const attr=patchGeometry.getAttribute(key) as THREE.BufferAttribute;(attr.array as Float32Array).set(key==='position'?a.positions:a.normals,vertexOffset*3);attr.addUpdateRange(vertexOffset*3,m.vertices.length*3);attr.needsUpdate=true;}for(let j=0;j<m.triangles.length;j++){const t=m.triangles[j],at=triangleOffset+j;patchTriangles[at]=t.map(i=>i+vertexOffset);trianglePatchIds[at]=p.id;patchCenters[at]=new THREE.Vector3(...posed.vertices[t[0]]).add(new THREE.Vector3(...posed.vertices[t[1]])).add(new THREE.Vector3(...posed.vertices[t[2]])).multiplyScalar(1/3);}patchInputs.set(p.id,m);count('threeBufferRebuilds');changed=true;}
        if(rebuild||old?.selectedPatchId!==s.selectedPatchId||old?.selectedCurveId!==s.selectedCurveId){const color=new THREE.Color((p.id===s.selectedPatchId||('hostSectionCurveId' in p&&p.hostSectionCurveId===s.selectedCurveId))?0xe3bcf4:0xbecdcf).toArray(),attr=patchGeometry.getAttribute('color') as THREE.BufferAttribute;for(let i=0;i<m.vertices.length;i++)(attr.array as Float32Array).set(color,(vertexOffset+i)*3);attr.addUpdateRange(vertexOffset*3,m.vertices.length*3);attr.needsUpdate=true;}
        vertexOffset+=m.vertices.length;triangleOffset+=m.triangles.length;
      }
      if(changed||rebuild){sortedPatchIds=[...trianglePatchIds];patchGeometry.setIndex(patchTriangles.flat());patchGeometry.computeBoundingSphere();sortDirty=true;}
      const nextCurveKey=curveInputKey(s.project);
      if(poseChanged||visibilityChanged||nextCurveKey!==lastCurveKey||old?.selectedCurveId!==s.selectedCurveId||old?.patchCreation!==s.patchCreation||old?.selectedPatchId!==s.selectedPatchId){lastCurveKey=nextCurveKey;curveSegments=[];

      const boundaryVertices:number[]=[];
      const lines=s.project.curves.filter(c=>!objectHidden(c.id)).map(c=>{const cp=evaluationContext(s.project).curve(c.id);let samples=curveSamples.get(cp);if(!samples){samples=curvePolyline(cp);curveSamples.set(cp,samples);}return {c,cp,samples:pose.active?displayCurveSamples(s.project,c.id,cp,gazeFacing(camera.quaternion.toArray())):samples};});
      const layout=lines.map(({c,samples})=>c.id+':'+samples.length).join('|'),rebuild=layout!==curveLayout||!curveGeometry.getAttribute('position');
      if(rebuild){curveLayout=layout;const size=lines.reduce((n,{samples})=>n+(samples.length-1)*6,0);curveGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(size),3));curveGeometry.setAttribute('color',new THREE.BufferAttribute(new Float32Array(size),3));curveInputs.clear();}
      let offset=0,changed=false;
      for(const {c,cp,samples} of lines){const dirty=rebuild||poseChanged||curveInputs.get(c.id)!==cp,positions=curveGeometry.getAttribute('position') as THREE.BufferAttribute,colors=curveGeometry.getAttribute('color') as THREE.BufferAttribute,color=new THREE.Color(c.id===s.selectedCurveId?0xf0d8ff:0xab9fdd).toArray();
       for(let i=1;i<samples.length;i++){curveSegments.push({id:c.id,a:new THREE.Vector3(...samples[i-1]),b:new THREE.Vector3(...samples[i])});const at=offset+(i-1)*6;if(dirty){(positions.array as Float32Array).set(samples[i-1],at);(positions.array as Float32Array).set(('systemRole' in c&&c.systemRole?.startsWith('MAIN_')&&i%6>=3)?samples[i-1]:samples[i],at+3);}if(rebuild||old?.selectedCurveId!==s.selectedCurveId){(colors.array as Float32Array).set(color,at);(colors.array as Float32Array).set(color,at+3);}}
       const length=(samples.length-1)*6;if(dirty){positions.addUpdateRange(offset,length);positions.needsUpdate=true;count('threeCurveBufferRebuilds');curveInputs.set(c.id,cp);changed=true;}if(rebuild||old?.selectedCurveId!==s.selectedCurveId){colors.addUpdateRange(offset,length);colors.needsUpdate=true;}offset+=length;
      }
      if(changed)curveGeometry.computeBoundingSphere();
      // Persistent selection is separate from pointer hover (which clears on orbit/leave).
      const selectedLine=lines.find(({c})=>c.id===s.selectedCurveId);
      if(selectedLine)for(let i=1;i<selectedLine.samples.length;i++)boundaryVertices.push(...selectedLine.samples[i-1],...selectedLine.samples[i]);
      renderer.domElement.dataset.highlightedCurve=selectedLine?.c.id??'';
      for(const {geometry,use} of authoringBoundaries(s.project,s.patchCreation,s.selectedPatchId)){const samples=displayCurveSamples(s.project,use.curveId,geometry,gazeFacing(camera.quaternion.toArray()));for(let i=1;i<samples.length;i++)boundaryVertices.push(...samples[i-1],...samples[i]);}
      for(const [a,b] of loopCorrespondence(s.project,s.patchCreation))boundaryVertices.push(...display(s.patchCreation!.uses[0].curveId,a),...display(s.patchCreation!.uses[1].curveId,b));
      boundaryGeometry.dispose();boundaryGeometry=new LineSegmentsGeometry();boundaryHighlight.geometry=boundaryGeometry;boundaryHighlight.visible=boundaryVertices.length>0;if(boundaryVertices.length)boundaryGeometry.setPositions(boundaryVertices);
      }
      const frameVertices=frameWire(s.project).flatMap(line=>line.slice(1).flatMap((q,i)=>[...pose.display(line[i]),...pose.display(q)]));
      frameGeometry.setAttribute('position',new THREE.Float32BufferAttribute(frameVertices,3));frameGeometry.computeBoundingSphere();
      guideGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(centerlineGuide(s.project).map(pose.display).flat(), 3),
      );
      guideGeometry.computeBoundingSphere();
      guide.computeLineDistances();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          s.project.landmarks.filter(l=>!objectHidden(l.id)).flatMap((l) => display(l.id,pointPosition(s.project,l.id))),
          3,
        ),
      );
      geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(
          s.project.landmarks.filter(l=>!objectHidden(l.id)).flatMap((l) =>
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
      const anchors=s.patchCreation?.host?eligibleAnchors(s.project,s.patchCreation.host):[];
      anchorMarkers.visible=anchors.length>0;
      anchorGeometry.setAttribute('position',new THREE.Float32BufferAttribute(anchors.flatMap(l=>displayPosition(l.id)),3));anchorGeometry.computeBoundingSphere();
      renderer.domElement.dataset.patchAnchors=anchors.map(l=>l.id).join(',');
      selectedGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          (s.selectedId&&objectHidden(s.selectedId))||s.selectedCurveId&&!s.patchCreation?.start
            ? []
            : (s.patchCreation?.start ? displayPosition(s.patchCreation.start) : s.curveCreation?.startId ? displayPosition(s.curveCreation.startId) : s.selectedId ? displayPosition(s.selectedId) : []),
          3,
        ),
      );
      selectedGeometry.computeBoundingSphere();endUpdate();
    };
    update();
    let updatePending=false;const schedule=()=>{updatePending=true;};
    const unsub = useEditor.subscribe(schedule);
    const unsubVisibility=useObjectVisibility.subscribe(schedule);
    const unsubSmooth=subscribeSmooth(schedule);
    const hoverGeometry=new LineSegmentsGeometry(),hoverMaterial=new LineMaterial({color:0xffcf70,linewidth:5,worldUnits:false,depthTest:false,depthWrite:false,transparent:true}),hoverLine=new LineSegments2(hoverGeometry,hoverMaterial);hoverLine.renderOrder=10;hoverLine.visible=false;scene.add(hoverLine);
    const updateHover=()=>{const b=useUI.getState().continuityHover;hoverLine.visible=false;if(b)try{const samples=curvePolyline(getBoundaryGeometry(useEditor.getState().project,b)).map(displayTransform(useEditor.getState().project,b.curveId,gazeFacing(camera.quaternion.toArray())).display),vertices:number[]=[];for(let i=1;i<samples.length;i++)vertices.push(...samples[i-1],...samples[i]);hoverGeometry.setPositions(vertices);hoverLine.visible=true;}catch{}};
    const unsubHoverSource=useEditor.subscribe((s,old)=>{if(s.project!==old.project&&useUI.getState().continuityHover)updateHover();});
    const unsubHover=useUI.subscribe((s,old)=>{if(s.continuityHover!==old.continuityHover)updateHover();});
    const resize = new ResizeObserver(() => {
      const w = element.clientWidth,
        h = element.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      boundaryMaterial.resolution.set(w,h);hoverMaterial.resolution.set(w,h);
      updateProjection();
    });
    resize.observe(element);
    let frame = 0;
    const draw = () => {
      controls.update();
      camera.updateMatrixWorld();
      if(updatePending||headDisplayKey()!==lastHeadDisplayKey){updatePending=false;update();updateHover();}
      poseIris();
      curveHandles.update();
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
      unsub();unsubVisibility();
      unsubSmooth();unsubHover();unsubHoverSource();hoverGeometry.dispose();hoverMaterial.dispose();
      resize.disconnect();unsubscribeProjection();
      curveHandles.dispose();
      renderer.domElement.removeEventListener('pointerdown',onDown);
      renderer.domElement.removeEventListener('pointermove',onMove);
      renderer.domElement.removeEventListener('pointerup',onUp);
      renderer.domElement.removeEventListener('pointercancel',onCancel);
      renderer.domElement.removeEventListener('pointerleave',onLeave);
      renderer.domElement.removeEventListener('lostpointercapture',onCancel);
      // Keep the last published pose on hide; cleanup must not publish a late
      // sub-threshold damping pose after the Contour has already settled.
      controls.removeEventListener("change",publishCamera);
      controls.removeEventListener("change",clearCameraHover);controls.dispose();
      anchorGeometry.dispose();anchorMaterial.dispose();pickPointGeometry.dispose();pickPointMaterial.dispose();pickLineGeometry.dispose();pickLineMaterial.dispose();
      frameGeometry.dispose();frameMaterial.dispose();
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
      clearIris();patchGeometry.dispose();patchMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div className="point-inspect">
      <InspectionBackground/>
      <CameraAngles onPitch={degrees=>setPitch.current(degrees)}/>
      <div ref={host} className="point-three" data-testid="point-inspect" />
      <span className="point-view-label">{uiText(perspective?'透视':'正交')}{uiText("· 语义点与结构线")}<button aria-label={uiText("切换 3D 投影")} onClick={()=>useInspectionCamera.setState({perspective:!perspective})}>{uiText(perspective?'切换正交':'切换透视')}</button></span>
      <button className="point-reset" onClick={() => reset.current()}>{uiText("居中视图 ↗")}</button>
      <div className="point-stage-hint">
        {uiText(error || "点击选点 / 线 / 面 · 拖动旋转 · 右键平移 · 滚轮缩放")}
      </div>
    </div>
  );
}
