import {memo,useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {hairBasis,type HairView} from '../../domain/hairstyle/projection';
import type {HairGeometry} from '../../domain/hairstyle/geometry';
import type {Vec3} from '../../domain/hairstyle/model';

type HairLine=THREE.Line<THREE.BufferGeometry,THREE.LineBasicMaterial|THREE.LineDashedMaterial>;
type Runtime={renderer:THREE.WebGLRenderer;scene:THREE.Scene;camera:THREE.OrthographicCamera;shell:THREE.Group;strands:THREE.Group;lines:Map<string,{line:HairLine;points:Vec3[]}>;points:THREE.Points<THREE.BufferGeometry,THREE.PointsMaterial>};
const emptySelection:string[]=[];
function setPositions(geometry:THREE.BufferGeometry,points:Vec3[]){
 let attribute=geometry.getAttribute('position') as THREE.BufferAttribute|undefined;
 if(!attribute||attribute.count!==points.length){attribute=new THREE.Float32BufferAttribute(new Float32Array(points.length*3),3);geometry.setAttribute('position',attribute);}
 for(let i=0;i<points.length;i++)attribute.setXYZ(i,...points[i]);
 attribute.needsUpdate=true;geometry.computeBoundingSphere();
}
function makeLine(points:Vec3[],color:number,dashed=false):HairLine {
 const geo=new THREE.BufferGeometry();setPositions(geo,points);
 const mat=dashed?new THREE.LineDashedMaterial({color,dashSize:.035,gapSize:.025,depthTest:false}):new THREE.LineBasicMaterial({color,depthTest:false});
 const line=new THREE.Line(geo,mat);if(dashed)line.computeLineDistances();line.renderOrder=10;return line;
}
function disposeGroup(group:THREE.Group){
 for(const child of group.children){const object=child as THREE.Mesh;object.geometry.dispose();(Array.isArray(object.material)?object.material:[object.material]).forEach(m=>m.dispose());}
 group.clear();
}
function HairScene({geometry,view,width,height,unit,pan,guides,selected=emptySelection}:{selected?:string[];geometry:HairGeometry;view:HairView;width:number;height:number;unit:number;pan:[number,number];guides:boolean}){
 const host=useRef<HTMLDivElement>(null),runtime=useRef<Runtime|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{let renderer:THREE.WebGLRenderer;try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});}catch{setFailed(true);return;}
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-2,2,2,-2,.01,100),shell=new THREE.Group(),strands=new THREE.Group();scene.add(shell,strands);
  const points=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({color:0xffedb0,size:8,sizeAttenuation:false,depthTest:false}));points.renderOrder=11;scene.add(points);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x000000,0);host.current!.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xf0f7ff,0x52616e,2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(3,5,6);scene.add(light);
  runtime.current={renderer,scene,camera,shell,strands,points,lines:new Map()};
  return()=>{disposeGroup(shell);disposeGroup(strands);points.geometry.dispose();points.material.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();runtime.current=null;};
 },[]);
 // Static shell/normals/wire buffers survive strand edits and selection changes.
 useEffect(()=>{const r=runtime.current;if(!r)return;disposeGroup(r.shell);const m=geometry.shell;
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(m.vertices.flat(),3));geo.setIndex(m.triangles.flat());geo.computeVertexNormals();
  const mat=new THREE.MeshStandardMaterial({color:0x82949d,side:THREE.DoubleSide,roughness:.85,transparent:true,opacity:.5,depthWrite:false});r.shell.add(new THREE.Mesh(geo,mat));
  if(geometry.base){const base=new THREE.BufferGeometry();base.setAttribute('position',new THREE.Float32BufferAttribute(geometry.base.vertices.flat(),3));base.setIndex(geometry.base.triangles.flat());base.computeVertexNormals();r.shell.add(new THREE.Mesh(base,new THREE.MeshStandardMaterial({color:0xb19672,side:THREE.DoubleSide,transparent:true,opacity:.28,depthWrite:false})));}
  if(geometry.rim)r.shell.add(makeLine(geometry.rim,0xdfb16e));
  if(guides)geometry.netLines.forEach(p=>r.shell.add(makeLine(p,0x668b91)));
 },[geometry.shell,geometry.base,geometry.rim,geometry.netLines,guides]);
 useEffect(()=>{const r=runtime.current;if(!r)return;
  const entries=geometry.strands?geometry.strands.map(a=>({id:a.id,points:a.points,color:0x91d6c5,dashed:false})):[
   {id:'guide',points:[geometry.crown,geometry.tip],color:0xd0d9df,dashed:true},
   ...geometry.arcs.map((a,i)=>({id:'arc'+i,points:a.points,color:i?0xf1b768:0x77ddbb,dashed:false})),
   ...geometry.centerArcs.map((a,i)=>({id:'center'+i,points:a.points,color:0xe4a7cf,dashed:false})),
   ...geometry.interiorArcs.map(a=>({id:a.id,points:a.points,color:0xd4e8f1,dashed:false}))];
  const used=new Set(entries.map(e=>e.id));
  for(const [id,old] of r.lines)if(!used.has(id)){r.strands.remove(old.line);old.line.geometry.dispose();old.line.material.dispose();r.lines.delete(id);}
  for(const e of entries){
   const old=r.lines.get(e.id);
   if(!old){const line=makeLine(e.points,e.color,e.dashed);r.strands.add(line);r.lines.set(e.id,{line,points:e.points});}
   else if(old.points!==e.points){setPositions(old.line.geometry,e.points);if(e.dashed)old.line.computeLineDistances();old.points=e.points;}
  }
 },[geometry]);
 useEffect(()=>{const r=runtime.current;if(!r)return;
  if(geometry.strands)for(const [id,entry] of r.lines)entry.line.material.color.setHex(geometry.strands.find(s=>s.id===id)?.projectionMisses?.length?0xf06b55:selected.includes(id)?0xffbc62:0x91d6c5);
  const positions=geometry.strands?geometry.strands.filter(a=>selected.includes(a.id)).flatMap(a=>[a.cubic[0],a.cubic[3]]):[geometry.crown,geometry.tip,geometry.centerTip];
  setPositions(r.points.geometry,positions);r.points.visible=positions.length>0;
 },[geometry,selected]);
 useEffect(()=>{const r=runtime.current;if(!r)return;const c=r.camera,b=hairBasis(view);c.position.set(...b.forward).multiplyScalar(12);c.up.set(...b.up);c.lookAt(0,0,0);c.left=(-width/2-pan[0])/unit;c.right=(width/2-pan[0])/unit;c.top=(height/2+pan[1])/unit;c.bottom=(-height/2+pan[1])/unit;c.updateProjectionMatrix();},[view,width,height,unit,pan]);
 useEffect(()=>{runtime.current?.renderer.setSize(width,height);},[width,height]);
 // One draw after all updates, instead of drawing once per independent effect.
 useEffect(()=>{const r=runtime.current;if(r)r.renderer.render(r.scene,r.camera);});
 return <div ref={host} className="hair-webgl" aria-hidden={!failed}>{failed&&<span>WebGL 不可用，请开启浏览器图形加速。</span>}</div>;
}
export default memo(HairScene);
