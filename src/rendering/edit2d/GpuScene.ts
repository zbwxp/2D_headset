import {screenToWorld} from '../orthographic';
import type {RenderSurfaceHit} from './picking';
import * as THREE from 'three';
import {Line2} from 'three/examples/jsm/lines/Line2.js';
import {LineGeometry} from 'three/examples/jsm/lines/LineGeometry.js';
import {LineMaterial} from 'three/examples/jsm/lines/LineMaterial.js';
import {viewMatrix,projectionMatrix,type OrthographicViewState} from '../orthographic';
import type {EditRenderSnapshot,EditRenderStyle} from './types';
import {count,timed} from '../../domain/geometry/diagnostics';

// NDC bias corresponds to 0.0001 world units with the shared default depth range.
export const CURVE_DEPTH_BIAS=1e-7;
export const CURVE_WIDTH_CSS=1.5;
export function applyCamera(camera:THREE.Camera,view:OrthographicViewState){
 camera.matrixAutoUpdate=false;camera.matrixWorldAutoUpdate=false;
 camera.matrixWorldInverse.fromArray(viewMatrix(view));camera.matrixWorld.copy(camera.matrixWorldInverse).invert();
 camera.projectionMatrix.fromArray(projectionMatrix(view));camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
function lineMaterial(depth:boolean,dashed=false){
 const m=new LineMaterial({dashed,dashSize:.04,gapSize:.025,color:0xab9fdd,linewidth:CURVE_WIDTH_CSS,worldUnits:false,transparent:true,opacity:depth?1:.25,depthTest:depth,depthWrite:false});
 // Derivative-smoothed caps without alpha-to-coverage: coverage must not multiply
 // the requested 25% x-ray alpha a second time. MSAA handles ribbon edges.
 m.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('gl_Position = clip;','gl_Position = clip; gl_Position.z -= '+CURVE_DEPTH_BIAS+' * gl_Position.w;');
  shader.fragmentShader=shader.fragmentShader.replace('if ( len2 > 1.0 ) discard;', 'alpha *= 1.0 - smoothstep(1.0 - fwidth(len2), 1.0 + fwidth(len2), len2);');
 };
 m.customProgramCacheKey=()=> 'edit-ribbon-aa-bias-v1'+dashed;return m;
}
type SurfaceResource={token:string;geometry:THREE.BufferGeometry;depth:THREE.Mesh;color:THREE.Mesh};
type CurveResource={token:string;geometry:LineGeometry;xray:Line2;front:Line2};
/** Persistent renderer resources. Only evaluated buffers, view and display state enter.
 * Scenes/resources are separate from the visible canvas lifecycle for future target rendering.
 */
export class GpuScene {
 readonly camera=new THREE.Camera();
 readonly depthScene=new THREE.Scene();readonly colorScene=new THREE.Scene();
 readonly xrayScene=new THREE.Scene();readonly frontScene=new THREE.Scene();
 readonly surfaces=new Map<string,SurfaceResource>();readonly curves=new Map<string,CurveResource>();
 readonly depthMaterial=new THREE.MeshBasicMaterial({side:THREE.DoubleSide,colorWrite:false,depthTest:true,depthWrite:true,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
 readonly colorMaterial=new THREE.ShaderMaterial({
  uniforms:{opacity:{value:.75}},
  // Match MeshBasicMaterial project_vertex operation order exactly. Multiplying
  // projection*modelView first can round depth differently and leave color holes.
  vertexShader:'varying vec3 n; void main(){ n=normalMatrix*normal; vec4 mvPosition=vec4(position,1.0); mvPosition=modelViewMatrix*mvPosition; gl_Position=projectionMatrix*mvPosition; }',
  fragmentShader:'uniform float opacity; varying vec3 n; void main(){ vec3 nn=n*inversesqrt(max(dot(n,n),1e-12)); float light=0.68+0.32*abs(dot(nn,normalize(vec3(-0.3,0.5,1.0)))); gl_FragColor=vec4(vec3(0.58,0.66,0.68)*light,opacity);\n #include <colorspace_fragment>\n }',
  side:THREE.DoubleSide,transparent:true,depthTest:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1,
  // A coincident second surface must not blend alpha again. This marks only
  // successful nearest-depth samples; it is not a transparency layer algorithm.
  stencilWrite:true,stencilRef:0,stencilFunc:THREE.EqualStencilFunc,stencilZPass:THREE.IncrementWrapStencilOp,
 });
 readonly dashedXray=lineMaterial(false,true);readonly dashedFront=lineMaterial(true,true);
 readonly xrayMaterial=lineMaterial(false);readonly frontMaterial=lineMaterial(true);
 constructor(){this.colorMaterial.forceSinglePass=true;}
 update(snapshot:EditRenderSnapshot,style:EditRenderStyle){
  const done=timed('gpuResourcePreparation');
  const surfaceIds=new Set(snapshot.surface.map(x=>x.id)),curveIds=new Set(snapshot.curves.map(x=>x.id));
  for(const [id,r] of this.surfaces)if(!surfaceIds.has(id)){this.depthScene.remove(r.depth);this.colorScene.remove(r.color);r.geometry.dispose();this.surfaces.delete(id);count('gpuSurfaceDisposals');}
  for(const data of snapshot.surface){
   let r=this.surfaces.get(data.id);if(r?.token===data.geometryToken)continue;
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));geometry.setIndex(new THREE.BufferAttribute(data.indices,1));
   if(data.normals)geometry.setAttribute('normal',new THREE.BufferAttribute(data.normals,3));
   if(r){r.geometry.dispose();r.geometry=geometry;r.depth.geometry=geometry;r.color.geometry=geometry;r.token=data.geometryToken;}
   else {const depth=new THREE.Mesh(geometry,this.depthMaterial),color=new THREE.Mesh(geometry,this.colorMaterial);depth.frustumCulled=color.frustumCulled=false;
    r={token:data.geometryToken,geometry,depth,color};this.surfaces.set(data.id,r);this.depthScene.add(depth);this.colorScene.add(color);}
   r.depth.visible=r.color.visible=!data.invalid&&data.indices.length>0;
   count('gpuSurfaceUploads');count('gpuUploadBytes',data.positions.byteLength+data.indices.byteLength+(data.normals?.byteLength??0));
  }
  for(const [id,r] of this.curves)if(!curveIds.has(id)){this.xrayScene.remove(r.xray);this.frontScene.remove(r.front);r.geometry.dispose();this.curves.delete(id);count('gpuCurveDisposals');}
  for(const data of snapshot.curves){
   let r=this.curves.get(data.id);
   if(!r||r.token!==data.geometryToken){
    const geometry=new LineGeometry();geometry.setPositions(data.samples);
    if(r){r.geometry.dispose();r.geometry=geometry;r.xray.geometry=geometry;r.front.geometry=geometry;r.token=data.geometryToken;}
    else {const xray=new Line2(geometry,data.dashed?this.dashedXray:this.xrayMaterial),front=new Line2(geometry,data.dashed?this.dashedFront:this.frontMaterial);xray.frustumCulled=front.frustumCulled=false;
     r={token:data.geometryToken,geometry,xray,front};this.curves.set(data.id,r);this.xrayScene.add(xray);this.frontScene.add(front);}
    if(data.dashed){r.xray.computeLineDistances();r.front.computeLineDistances();}
    count('gpuCurveUploads');count('gpuUploadBytes',Math.max(0,data.samples.length-3)*2*4);
   }
   r.xray.visible=r.front.visible=!style.selectedCurveIds.has(data.id);
  }
  this.colorMaterial.uniforms.opacity.value=style.surfaceOpacity;this.xrayMaterial.opacity=this.dashedXray.opacity=style.hiddenCurveOpacity;
  done();
 }
 draw(renderer:THREE.WebGLRenderer,view:OrthographicViewState){
  const done=timed('gpuDrawSubmission');applyCamera(this.camera,view);
  renderer.clear(true,true,true);
  renderer.render(this.depthScene,this.camera);
  renderer.render(this.colorScene,this.camera);
  renderer.render(this.xrayScene,this.camera);
  renderer.render(this.frontScene,this.camera);
  count('gpuFrames');done();
 }
 pick(renderer:THREE.WebGLRenderer,view:OrthographicViewState,x:number,y:number,ids?:ReadonlySet<string>):RenderSurfaceHit|null {
  if(x<0||y<0||x>=view.viewportWidth||y>=view.viewportHeight)return null;
  applyCamera(this.camera,view);
  const size=new THREE.Vector2();renderer.getDrawingBufferSize(size);this.pickTarget.setSize(size.x,size.y);
  const scene=new THREE.Scene(),mapping:string[]=[];
  for(const [id,r] of this.surfaces){if(!r.depth.visible||ids&&!ids.has(id))continue;const index=mapping.push(id),m=new THREE.ShaderMaterial({uniforms:{idColor:{value:new THREE.Vector3((index&255)/255,((index>>8)&255)/255,((index>>16)&255)/255)}},vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform vec3 idColor;void main(){gl_FragColor=vec4(idColor,1.0);}',side:THREE.DoubleSide,blending:THREE.NoBlending,depthTest:true,depthWrite:true});const mesh=new THREE.Mesh(r.geometry,m);mesh.frustumCulled=false;scene.add(mesh);}
  const previous=renderer.getRenderTarget(),color=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha();
  const pixel=new Uint8Array(4);
  try{renderer.setRenderTarget(this.pickTarget);renderer.setClearColor(0,0);renderer.clear(true,true,true);renderer.render(scene,this.camera);renderer.readRenderTargetPixels(this.pickTarget,Math.min(size.x-1,Math.floor(x/view.viewportWidth*size.x)),Math.min(size.y-1,size.y-1-Math.floor(y/view.viewportHeight*size.y)),1,1,pixel);}
  finally{renderer.setRenderTarget(previous);renderer.setClearColor(color,alpha);for(const m of scene.children)(m as THREE.Mesh).material instanceof THREE.Material&&((m as THREE.Mesh).material as THREE.Material).dispose();}
  const id=mapping[(pixel[0]+(pixel[1]<<8)+(pixel[2]<<16))-1];if(!id)return null;
  const origin=new THREE.Vector3(...screenToWorld([x,y],view,1000)),direction=new THREE.Vector3(...view.forward).negate(),ray=new THREE.Raycaster(origin,direction);
  const mesh=new THREE.Mesh(this.surfaces.get(id)!.geometry,this.pickRayMaterial);mesh.updateMatrixWorld();const hit=ray.intersectObject(mesh)[0];if(!hit?.face)return null;
  const pos=mesh.geometry.getAttribute('position'),face=hit.face,bary=THREE.Triangle.getBarycoord(hit.point,new THREE.Vector3().fromBufferAttribute(pos,face.a),new THREE.Vector3().fromBufferAttribute(pos,face.b),new THREE.Vector3().fromBufferAttribute(pos,face.c),new THREE.Vector3());
  return {id,world:hit.point.toArray(),depth:1000-hit.distance,triangle:hit.faceIndex!,barycentric:bary?.toArray()??[1,0,0]};
 }
 readonly pickTarget=new THREE.WebGLRenderTarget(1,1,{depthBuffer:true,stencilBuffer:false,type:THREE.UnsignedByteType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
 readonly pickRayMaterial=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
 dispose(){this.pickTarget.dispose();this.pickRayMaterial.dispose();
  for(const r of this.surfaces.values())r.geometry.dispose();for(const r of this.curves.values())r.geometry.dispose();
  this.surfaces.clear();this.curves.clear();
  this.depthScene.clear();this.colorScene.clear();this.xrayScene.clear();this.frontScene.clear();
  this.dashedXray.dispose();this.dashedFront.dispose();this.depthMaterial.dispose();this.colorMaterial.dispose();this.xrayMaterial.dispose();this.frontMaterial.dispose();
 }
}
