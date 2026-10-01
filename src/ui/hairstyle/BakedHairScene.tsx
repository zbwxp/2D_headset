import {memo,useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {hairBasis,type HairView} from '../../domain/hairstyle/projection';
import {hairBakeMesh,type HairBake} from '../../domain/hairstyle/studio';
import {prepareHairBake} from './hairBakePreview';

function BakedHairScene({bake,view,width,height,unit,pan}:{bake:HairBake;view:HairView;width:number;height:number;unit:number;pan:[number,number]}){
 const host=useRef<HTMLDivElement>(null),[message,setMessage]=useState('正在准备烘焙预览…');
 const runtime=useRef<{renderer:THREE.WebGLRenderer;scene:THREE.Scene;camera:THREE.OrthographicCamera}|null>(null);
 useEffect(()=>{
  let renderer:THREE.WebGLRenderer;try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});}catch{setMessage('WebGL 不可用，请开启浏览器图形加速。');return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-2,2,2,-2,.01,100);host.current!.appendChild(renderer.domElement);runtime.current={renderer,scene,camera};
  return()=>{runtime.current=null;renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();};
 },[]);
 useEffect(()=>{
  const r=runtime.current;if(!r)return;let cancelled=false;const geometries:THREE.BufferGeometry[]=[],materials:THREE.Material[]=[];let texture:THREE.CanvasTexture|undefined;const group=new THREE.Group();r.scene.add(group);setMessage('正在准备烘焙预览…');
  prepareHairBake(bake).then(({canvas,mesh,bounds})=>{
   if(cancelled)return;
   const make=(vertices:number[][],triangles:number[][])=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices.flat(),3));g.setIndex(triangles.flat());geometries.push(g);return g;};
   // Invisible depth shell hides paint behind the crown and the opposite side.
   const shell=hairBakeMesh(bake.net,bounds,false,320);
   if(bake.net.profile?.version===2){const center=shell.vertices.length;shell.vertices.push([bake.net.center[0],bake.net.center[1]+bake.net.profile.baseHeight*bake.net.radiusY,bake.net.center[2]]);const row=96*321;for(let i=0;i<320;i++)shell.triangles.push([center,row+i+1,row+i]);}
   const depthGeo=make(shell.vertices,shell.triangles),depthMat=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:true,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:2,polygonOffsetUnits:2});
   materials.push(depthMat);const depth=new THREE.Mesh(depthGeo,depthMat);depth.renderOrder=-1;group.add(depth);
   texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,r.renderer.capabilities.getMaxAnisotropy());
   const geo=make(mesh.vertices,mesh.triangles);geo.setAttribute('uv',new THREE.Float32BufferAttribute(mesh.uv.flat(),2));
   const mat=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,side:THREE.FrontSide,toneMapped:false});materials.push(mat);
   group.add(new THREE.Mesh(geo,mat));setMessage('');r.renderer.render(r.scene,r.camera);
  }).catch(e=>{if(!cancelled)setMessage(e instanceof Error?e.message:String(e));});
  return()=>{cancelled=true;r.scene.remove(group);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());texture?.dispose();};
 },[bake]);
 useEffect(()=>{const r=runtime.current;if(!r)return;const b=hairBasis(view),c=r.camera;c.position.set(...b.forward).multiplyScalar(30);c.up.set(...b.up);c.lookAt(0,0,0);c.left=(-width/2-pan[0])/unit;c.right=(width/2-pan[0])/unit;c.top=(height/2+pan[1])/unit;c.bottom=(-height/2+pan[1])/unit;c.updateProjectionMatrix();r.renderer.setSize(width,height);r.renderer.render(r.scene,c);},[view,width,height,unit,pan,bake]);
 return <div className="hair-webgl" data-testid="hair-baked-scene"><div ref={host} className="hair-webgl"/>{message&&<span className="hair-bake-message" role="status">{message}</span>}</div>;
}
export default memo(BakedHairScene);
