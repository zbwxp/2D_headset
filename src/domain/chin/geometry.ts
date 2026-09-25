import type {LandmarkProject} from '../landmarks/model';
import type {Vec3} from '../project/types';
import type {ChinCurve} from '../curves/model';
import {evaluationContext} from '../geometry/evaluation';
import {provider,type CurveProvider} from '../geometry/curveProvider';
import {InputCache} from '../geometry/cache';
import {add,sub,scale,dot,cross} from '../geometry/core';
import {toHead,toRelative,mirrorPoint} from '../head/frame';
import {CHIN,seamDirection,type ChinParameters} from './model';
import type {PatchMesh} from '../patches/geometry';

/** Dimensions use radiusX as one common R. Rotate the local shape before
 * converting to ellipsoid coordinates, so pitch is a rigid rotation even on
 * an anisotropic HeadFrame. Positive pitch raises the forward (+Z) side. */
export function chinKernel(a:ChinParameters,q:Vec3,axisRatios:Vec3=[1,1,1]):Vec3{
 const rear=Math.max(0,-q[2]),front=Math.max(0,q[2]),belly=1-.45*(1-a.roundness)*q[1]**2;
 // Roundness changes the belly profile independently of the pole height.
 // Width/depth are full extents; height is the lower half-shell's depth.
 // Normalize bulge so it redistributes the profile within the requested depth.
 const x=.5*a.width*q[0]*belly*(1-a.pinchToNeck*rear**2),y=a.height*q[1],z=.5*a.depth*belly*(q[2]+a.frontBulge*front**3-a.rearBulge*rear**3)/(1+.5*(a.frontBulge+a.rearBulge)),angle=a.pitch*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
 return [x,a.y+(c*y+s*z)*axisRatios[1],a.z+(-s*y+c*z)*axisRatios[2]];
}
const mirror=(v:Vec3):Vec3=>[-v[0],v[1],v[2]];
const phi=(a:Vec3,b:Vec3)=>{const r=Math.hypot(...sub(a,b))/1.4;return r>=1?0:(1-r)**4*(4*r+1);};
/** Compact C2 displacement field. Samples are source constraints, coefficients
 * are runtime-only. Symmetric sample pairs make the entire result symmetric. */
function fit(nodes:Vec3[],values:Vec3[]){
 const n=nodes.length,L=new Float64Array(n*n);
 for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let v=phi(nodes[i],nodes[j])+(i===j?1e-9:0);for(let k=0;k<j;k++)v-=L[i*n+k]*L[j*n+k];if(i===j){if(v<=1e-14)throw Error('约束采样退化，请减少重叠约束');L[i*n+j]=Math.sqrt(v);}else L[i*n+j]=v/L[j*n+j];}
 const weights=Array.from({length:n},()=>[0,0,0] as Vec3);
 for(let c=0;c<3;c++){const y=new Float64Array(n);for(let i=0;i<n;i++){let v=values[i][c];for(let j=0;j<i;j++)v-=L[i*n+j]*y[j];y[i]=v/L[i*n+i];}for(let i=n-1;i>=0;i--){let v=y[i];for(let j=i+1;j<n;j++)v-=L[j*n+i]*weights[j][c];weights[i][c]=v/L[i*n+i];}}
 return (q:Vec3)=>{const out:Vec3=[0,0,0];for(let i=0;i<n;i++){const w=phi(q,nodes[i]);for(let j=0;j<3;j++)out[j]+=weights[i][j]*w;}return out;};
}
const charts=(()=>{const q:Vec3[]=[[0,-1,0]],triangles:number[][]=[],rings=24,segments=96;for(let j=1;j<=rings;j++){const a=Math.PI*j/(2*rings);for(let i=0;i<segments;i++){const t=Math.PI*2*i/segments;q.push([Math.sin(a)*Math.cos(t),-Math.cos(a),Math.sin(a)*Math.sin(t)]);}}
 const at=(j:number,i:number)=>1+(j-1)*segments+(i%segments+segments)%segments;
 for(let i=0;i<segments;i++)triangles.push([0,at(1,i),at(1,i+1)]);
 for(let j=1;j<rings;j++)for(let i=0;i<segments;i++)triangles.push([at(j,i),at(j+1,i),at(j,i+1)],[at(j,i+1),at(j+1,i),at(j+1,i+1)]);
 return {q,triangles};})();
export interface ChinResult {key:string;evaluate:(q:Vec3)=>Vec3;mesh:PatchMesh;diagnostic?:string;maxError:number}
const cache=new InputCache<ChinResult>(32),seams=new InputCache<CurveProvider>(256),evaluating=new WeakSet<LandmarkProject>();
export function chinGeometry(p:LandmarkProject):ChinResult{
 if(p.chinScaffold?.version===3){
  const {y,z}=p.chinScaffold.parameters,key=JSON.stringify(['chinPoint',p.headFrame,y,z]),hit=cache.get(key);if(hit)return hit;
  const P=toHead(p,[0,y,z]);return cache.set(key,{key,evaluate:()=>P,mesh:{vertices:[],triangles:[]},maxError:0});
 }
 if(!p.chinScaffold)throw Error('缺少下巴辅助壳');if(evaluating.has(p))throw Error('下巴约束不能依赖下巴壳本身，请复制为独立控制线');evaluating.add(p);
 try{
 const s=p.chinScaffold,ctx=evaluationContext(p),sources=s.bindings.map(b=>({b,g:ctx.curve(b.curveId)}));
 const key=JSON.stringify([p.headFrame,s.parameters,sources.map(({b,g})=>[b,g.key])]),hit=cache.get(key);if(hit)return hit;
 const f=p.headFrame,axisRatios:Vec3=[1,(f?.radiusX??1)/(f?.radiusY??1),(f?.radiusX??1)/(f?.radiusZ??1)];
 const base=(q:Vec3)=>chinKernel(s.parameters,q,axisRatios),nodes:Vec3[]=[],values:Vec3[]=[];let diagnostic:string|undefined,field=(q:Vec3)=>base(q),maxError=0;
 try{
 const addNode=(q:Vec3,target:Vec3)=>{const delta=sub(target,base(q)),j=nodes.findIndex(n=>Math.hypot(...sub(n,q))<1e-8);if(j>=0){if(Math.hypot(...sub(values[j],delta))>1e-4)throw Error('骨架交点上的曲线约束不一致，请对齐端点或移除冲突约束');return;}nodes.push(q);values.push(delta);};
 for(const {b,g} of sources)for(let i=0;i<=24;i++){const t=i/24,q=seamDirection(b.slot,t);let target=toRelative(p,g.atArcLength(b.reversed?1-t:t));if(b.reflect)target=mirror(target);if(b.slot==='CENTER'&&Math.abs(target[0])>1e-6)throw Error('中线约束必须位于模型中线');if(target[0]<-1e-6)throw Error('右侧约束不能跨越中线');if(Math.abs(q[0])<1e-8&&Math.abs(target[0])>1e-5)throw Error('横弧的中央端点必须落在中线');addNode(q,target);addNode(mirror(q),mirror(target));}
 if(nodes.length){const displacement=fit(nodes,values);field=q=>{const left=q[0]<0,c=left?mirror(q):q,v=add(base(c),displacement(c));if(Math.abs(c[0])<1e-10)v[0]=0;return left?mirror(v):v;};maxError=Math.max(...nodes.map((q,i)=>Math.hypot(...sub(field(q),add(base(q),values[i])))));
 // Reject collapsed/inverted local parameter cells before publishing a damaged
 // shell. Source curves stay authored; removing the conflicting constraint recovers.
 const v=charts.q.map(field),a=charts.q.map(base);for(const f of charts.triangles){const n=cross(sub(v[f[1]],v[f[0]]),sub(v[f[2]],v[f[0]])),m=cross(sub(a[f[1]],a[f[0]]),sub(a[f[2]],a[f[0]]));if(!n.every(Number.isFinite)||Math.hypot(...n)<Math.hypot(...m)*.005||dot(n,m)<0)throw Error('约束导致下巴局部折返或塌缩；当前显示默认壳，请调整或移除约束');}
 }
 }catch(e){diagnostic=(e as Error).message;field=base;}
 const evaluate=(q:Vec3)=>toHead(p,field(q)),mesh={vertices:charts.q.map(evaluate),triangles:charts.triangles,...(diagnostic?{warning:diagnostic}:{})};
 return cache.set(key,{key,evaluate,mesh,diagnostic,maxError});
 }finally{evaluating.delete(p);}
}
export function chinProvider(p:LandmarkProject,c:ChinCurve):CurveProvider{
 const result=chinGeometry(p),key=result.key+c.id,hit=seams.get(key);if(hit)return hit;
 const evaluate=(t:number)=>{const q=seamDirection(c.slot,t),v=result.evaluate(q);return c.role==='mirror'?mirrorPoint(p,v):v;};
 return seams.set(key,provider(key,false,evaluate,t=>{const lo=Math.max(0,t-1e-5),hi=Math.min(1,t+1e-5);return scale(sub(evaluate(hi),evaluate(lo)),1/(hi-lo));}));
}
export const chinSurfaces=(p:LandmarkProject)=>p.chinScaffold?.version===2&&p.chinScaffold.visible?[{id:CHIN,mesh:chinGeometry(p).mesh}]:[];
export const chinKey=(p:LandmarkProject)=>p.chinScaffold?chinGeometry(p).key+String(p.chinScaffold.visible):'';
/** Display triangulation is used only to locate the hit. Persist a unit domain
 * direction, never triangle IDs/barycentric coordinates. */
export function chinHitDirection(triangle:number,barycentric:Vec3):Vec3 {
 const f=charts.triangles[triangle];if(!f)throw Error('下巴面命中无效');
 const q=f.reduce<Vec3>((out,i,j)=>add(out,scale(charts.q[i],barycentric[j])),[0,0,0]);
 return scale(q,1/Math.hypot(...q));
}
