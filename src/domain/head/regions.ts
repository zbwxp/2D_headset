import type {LandmarkProject} from '../landmarks/model';
import type {Vec3} from '../project/types';
import {isSection} from '../curves/model';
import {dot,add,scale,sub} from '../geometry/core';
import {toHead,mirrorPoint} from './frame';
import type {PatchMesh} from '../patches/geometry';
export interface LoomisRegion {id:string;name:string;cuts:{curveId:string;side:1|-1}[];seed:Vec3}
type Plane={curveId:string;n:Vec3;d:number};
const unit=(v:Vec3):Vec3=>scale(v,1/Math.hypot(...v));
export function sectionPlane(p:LandmarkProject,id:string):Plane {
 const c=p.curves.find(c=>c.id===id);if(!c||!isSection(c))throw Error('球面区域只能使用 Loomis Section');
 const owner=c.role==='mirror'?p.curves.find(x=>x.id===c.canonicalCurveId):c;
 if(!owner||!isSection(owner)||owner.role!=='canonical')throw Error('Section 缺少源平面');
 const n=[...owner.section.planeNormal] as Vec3;if(c.role==='mirror')n[0]*=-1;
 return {curveId:id,n,d:owner.section.planeOffset};
}
let sphere:Vec3[][]|undefined;
export function sphereTriangles(){
 if(sphere)return sphere;
 const v:Vec3[]=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
 let t=[[0,2,4],[2,1,4],[1,3,4],[3,0,4],[2,0,5],[1,2,5],[3,1,5],[0,3,5]].map(f=>f.map(i=>v[i]));
 for(let k=0;k<5;k++)t=t.flatMap(([a,b,c])=>{const ab=unit(add(a,b)),bc=unit(add(b,c)),ca=unit(add(c,a));return [[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]];});
 return sphere=t;
}
function clip(poly:Vec3[],plane:Plane,side:number,previous:Plane[]){
 const value=(v:Vec3)=>side*(dot(v,plane.n)-plane.d),out:Vec3[]=[];
 for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length],va=value(a),vb=value(b);
  if(va>=-1e-12)out.push(a);
  if((va>1e-12&&vb< -1e-12)||(va< -1e-12&&vb>1e-12)){
   // An edge introduced by an earlier cut follows that small circle, not
   // a great-circle chord. Preserve both analytic planes at their intersection.
   const support=previous.find(p=>Math.abs(dot(a,p.n)-p.d)<1e-9&&Math.abs(dot(b,p.n)-p.d)<1e-9);
   const center=support?scale(support.n,support.d):[0,0,0] as Vec3,radius=support?Math.sqrt(1-support.d*support.d):1;
   const interpolate=(t:number)=>add(center,scale(unit(add(scale(sub(a,center),1-t),scale(sub(b,center),t))),radius));
   let lo=0,hi=1;for(let j=0;j<38;j++){const m=(lo+hi)/2,q=interpolate(m);if((value(q)>0)===(va>0))lo=m;else hi=m;}
   const m=(lo+hi)/2;out.push(interpolate(m));
  }
 }
 return out;
}
export interface RegionCandidate {key:string;cuts:LoomisRegion['cuts'];seed:Vec3;mesh:PatchMesh}
const cache=new Map<string,RegionCandidate[]>();
/** Plane arrangement on the unit sphere. Connected components are separate selectable regions. */
export function regionCandidates(p:LandmarkProject,ids:string[]):RegionCandidate[]{
 const planes=[...new Set(ids)].sort().map(id=>sectionPlane(p,id));if(!planes.length)return [];
 const key=JSON.stringify([planes,p.headFrame]);const hit=cache.get(key);if(hit)return hit;
 let pieces=sphereTriangles().map(poly=>({poly,signs:[] as (1|-1)[]}));
 for(const [index,plane] of planes.entries())pieces=pieces.flatMap(f=>([1,-1] as const).flatMap(side=>{const poly=clip(f.poly,plane,side,planes.slice(0,index));return poly.length>=3?[{poly,signs:[...f.signs,side]}]:[];}));
 const buckets=new Map<string,typeof pieces>();for(const f of pieces){const key=f.signs.join(',');const a=buckets.get(key)??[];a.push(f);buckets.set(key,a);}
 const result:RegionCandidate[]=[];
 for(const [signKey,faces] of buckets){
  const vertexKey=(v:Vec3)=>v.map(x=>Math.round(x*1e7)).join(','),links=new Map<string,number[]>();
  faces.forEach((f,i)=>f.poly.forEach(v=>{const key=vertexKey(v),list=links.get(key)??[];list.push(i);links.set(key,list);}));
  const seen=new Set<number>();for(let start=0;start<faces.length;start++){
   if(seen.has(start))continue;const queue=[start];seen.add(start);const component:typeof faces=[];
   for(let k=0;k<queue.length;k++){const f=faces[queue[k]];component.push(f);for(const v of f.poly)for(const i of links.get(vertexKey(v))??[])if(!seen.has(i)){seen.add(i);queue.push(i);}}
   const vertices:Vec3[]=[],triangles:number[][]=[];for(const f of component){const at=vertices.length;vertices.push(...f.poly.map(v=>toHead(p,v)));for(let j=1;j<f.poly.length-1;j++)triangles.push([at,at+j,at+j+1]);}
   if(!triangles.length)continue;
   const seed=unit(component[0].poly.reduce((a,b)=>add(a,b),[0,0,0] as Vec3));
   result.push({key:signKey+':'+start,cuts:planes.map((x,i)=>({curveId:x.curveId,side:component[0].signs[i]})),seed,mesh:{vertices,triangles}});
  }
 }
 if(cache.size>12)cache.clear();cache.set(key,result);return result;
}
const mirrorMeshes=new WeakMap<PatchMesh,PatchMesh>();
export function regionMesh(p:LandmarkProject,r:LoomisRegion):PatchMesh {
 const owner=r.id.endsWith(':mirror')?p.loomisRegions?.find(x=>x.id===r.id.slice(0,-7)):undefined;
 if(owner){const source=regionMesh(p,owner);let mesh=mirrorMeshes.get(source);if(!mesh){mesh={...source,vertices:source.vertices.map(v=>mirrorPoint(p,v)),triangles:source.triangles.map(t=>[t[0],t[2],t[1]])};mirrorMeshes.set(source,mesh);}return mesh;}

 try {const candidates=regionCandidates(p,r.cuts.map(c=>c.curveId)).filter(c=>c.cuts.every(x=>r.cuts.some(y=>y.curveId===x.curveId&&y.side===x.side)));
 return candidates.sort((a,b)=>dot(b.seed,r.seed)-dot(a.seed,r.seed))[0]?.mesh??{vertices:[],triangles:[],invalid:'所选球面区域已退化'};
 }catch(e){return {vertices:[],triangles:[],invalid:(e as Error).message};}
}
export function mirroredRegion(p:LandmarkProject,r:LoomisRegion):LoomisRegion|undefined {
 const cuts=r.cuts.map(c=>{const host=p.curves.find(x=>x.id===c.curveId)!;return {...c,curveId:host.mirrorPartnerCurveId??host.id,side:!host.mirrorPartnerCurveId&&isSection(host)&&host.side==='CENTERLINE'?-c.side as 1|-1:c.side};});
 return {...r,id:crypto.randomUUID(),cuts,seed:[-r.seed[0],r.seed[1],r.seed[2]]};
}
export function parseRegions(raw:unknown,p:LandmarkProject):LoomisRegion[]{
 if(raw===undefined)return [];if(!Array.isArray(raw))throw Error('Loomis 区域数据无效');
 const ids=new Set<string>();return raw.map(r=>{if(!r||typeof r.id!=='string'||ids.has(r.id)||typeof r.name!=='string'||!Array.isArray(r.cuts)||!r.cuts.length||!Array.isArray(r.seed)||r.seed.length!==3||!r.seed.every(Number.isFinite)||Math.abs(Math.hypot(...r.seed)-1)>1e-6)throw Error('Loomis 区域数据无效');ids.add(r.id);
 const seen=new Set<string>();for(const c of r.cuts){sectionPlane(p,c.curveId);if(seen.has(c.curveId)||(c.side!==1&&c.side!==-1))throw Error('Loomis 区域边界无效');seen.add(c.curveId);}return {id:r.id,name:r.name,cuts:r.cuts,seed:r.seed};});
}
export const regionsKey=(p:LandmarkProject)=>JSON.stringify([p.loomisRegions,p.headFrame,p.curves.filter(isSection)]);
