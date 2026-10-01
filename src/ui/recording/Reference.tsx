import {useEffect,useRef,useSyncExternalStore} from 'react';
import * as THREE from 'three';
import type {LandmarkProject} from '../../domain/landmarks/model';
import {helmetSurfaces} from '../../domain/head/helmet';
import {regionMesh} from '../../domain/head/regions';
import {capMesh} from '../../domain/head/caps';
import {tessellate} from '../../domain/patches/geometry';
import {evaluationContext} from '../../domain/geometry/evaluation';
import {curvePolyline} from '../../domain/geometry/curveProvider';
import {defaultHeadFrame} from '../../domain/head/frame';
import {recordingBasis} from '../../domain/recording/projection';
import {subscribeSmooth,smoothVersion} from '../../domain/continuity/evaluation';
import {useObjectVisibility} from '../authoring/visibility';
import {ownerOf} from '../../domain/modules/ownership';
import type {View,Point2} from '../../domain/recording/model';
/** Read-only reference adapter. Camera-only updates never rebuild buffers. No modeling picking/tools. */
export default function Reference({project,view,width,height,zoom,pan,unit,referenceScale=1,opacity=.35}:{unit?:number;referenceScale?:number;opacity?:number;project:LandmarkProject;view:View;width:number;height:number;zoom:number;pan:Point2}){
 const host=useRef<HTMLDivElement>(null),runtime=useRef<{renderer:THREE.WebGLRenderer;scene:THREE.Scene;camera:THREE.OrthographicCamera;group:THREE.Group}|null>(null);
 const smooth=useSyncExternalStore(subscribeSmooth,smoothVersion);const hidden=useObjectVisibility(s=>s.hidden);
 useEffect(()=>{const el=host.current!;let renderer:THREE.WebGLRenderer;try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});}catch{el.textContent='WebGL reference unavailable';return;}
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));el.appendChild(renderer.domElement);
 const scene=new THREE.Scene(),group=new THREE.Group(),camera=new THREE.OrthographicCamera(-2,2,2,-2,.01,10000);
 scene.add(group,new THREE.HemisphereLight(0xffffff,0x39434f,2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(3,4,5);scene.add(light);runtime.current={renderer,scene,camera,group};
 return()=>{renderer.dispose();el.replaceChildren();runtime.current=null;};},[]);
 useEffect(()=>{const r=runtime.current;if(!r)return;const {group}=r;
 const meshes=[...helmetSurfaces(project).map(x=>({id:x.id,mesh:x.mesh})),...(project.patches??[]).map(p=>({id:p.id,mesh:tessellate(project,p,24)})),...(project.loomisRegions??[]).map(p=>({id:p.id,mesh:regionMesh(project,p)})),...(project.loomisCaps??[]).map(p=>({id:p.id,mesh:capMesh(project,p)}))];
 const disposables:{dispose:()=>void}[]=[];
 // Recording owns its reference toggle; the modeling module's hide switch must
 // not make the alignment reference impossible to reveal here.
 const hiddenReference=(id:string)=>ownerOf(project,id)==='EYES'||hidden[id]!==undefined;
 for(const {id,mesh} of meshes){if(hiddenReference(id))continue;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(mesh.vertices.flat(),3));g.setIndex(mesh.triangles.flat());g.computeVertexNormals();const m=new THREE.MeshStandardMaterial({color:0xaebec4,side:THREE.DoubleSide,roughness:.85});group.add(new THREE.Mesh(g,m));disposables.push(g,m);}
 const ctx=evaluationContext(project);
 for(const c of project.curves){if(hiddenReference(c.id))continue;try{const pts=curvePolyline(ctx.curve(c.id));const g=new THREE.BufferGeometry().setFromPoints(pts.map(p=>new THREE.Vector3(...p))),m=new THREE.LineBasicMaterial({color:0x87939e});group.add(new THREE.Line(g,m));disposables.push(g,m);}catch{/* invalid reference curve is already reported by modeling */}}
 // HeadFrame wire is useful even when the source has no modeled surfaces.
 const f=project.headFrame??defaultHeadFrame(),g=new THREE.SphereGeometry(1,32,20),m=new THREE.MeshBasicMaterial({color:0x68828d,wireframe:true,transparent:true,opacity:.09});const ellipsoid=new THREE.Mesh(g,m);ellipsoid.scale.set(f.radiusX,f.radiusY,f.radiusZ);ellipsoid.position.set(...f.center);ellipsoid.quaternion.set(...f.orientation);group.add(ellipsoid);disposables.push(g,m);
 r.renderer.render(r.scene,r.camera);
 return()=>{group.clear();disposables.forEach(d=>d.dispose());};
 },[project.headFrame,project.patches,project.curves,project.landmarks,project.loomisScaffold,project.loomisRegions,project.loomisCaps,smooth,hidden]);
 useEffect(()=>{const r=runtime.current;if(!r)return;const f=project.headFrame??defaultHeadFrame(),b=recordingBasis(f,view),scale=referenceScale*(unit!==undefined?unit/f.radiusX:Math.min(width/(2.8*b.halfWidth),height/(2.8*b.halfHeight))*zoom);
 const c=r.camera; c.left=(-width/2-pan[0])/scale;c.right=(width/2-pan[0])/scale;c.top=(height/2+pan[1])/scale;c.bottom=(-height/2+pan[1])/scale;
 const distance=Math.max(f.radiusX,f.radiusY,f.radiusZ)*8;c.far=distance*4;c.near=distance/1000;c.position.set(...f.center).addScaledVector(new THREE.Vector3(...b.forward),distance);c.up.set(...b.up);c.lookAt(new THREE.Vector3(...f.center));c.updateProjectionMatrix();r.renderer.render(r.scene,c);
 },[project.headFrame,view,width,height,zoom,pan,smooth,unit,referenceScale]);
 // Reallocating the WebGL backing buffer on every camera rotation stalls the GPU.
 useEffect(()=>{const r=runtime.current;if(r){r.renderer.setSize(width,height);r.renderer.render(r.scene,r.camera);}},[width,height]);
 return <div className="recording-reference" data-testid="recording-head-reference" style={{opacity}} ref={host}/>;
}
