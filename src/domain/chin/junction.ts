import type {LandmarkProject} from '../landmarks/model';
import type {Vec3} from '../project/types';
import {isChin,isDerived} from '../curves/model';
import {provider,type CurveProvider} from '../geometry/curveProvider';
import {evaluationContext,pointPosition} from '../geometry/evaluation';
import {normalizedArcLengthToT} from '../geometry/bezier';
import {add,sub,scale,dot,cross} from '../geometry/core';
import {rotateFrame,mirrorPoint,toRelative} from '../head/frame';
import {pointId,isChinNode,defaultRanges,type ChinArm} from './model';
import type {PatchBoundaryUse} from '../patches/boundary';
import type {SurfacePatch} from '../patches/model';
const len=(v:Vec3)=>Math.hypot(...v),unit=(v:Vec3)=>scale(v,1/Math.max(len(v),1e-20));
export const chinRim=(p:LandmarkProject,id:string)=>{const c=p.curves.find(c=>c.id===id);return c&&isChin(c)&&['SIDE','FRONT_RIM','REAR_RIM'].includes(c.slot)?c:undefined;};
export const chinEndpoint=(p:LandmarkProject,id:string)=>isChinNode(p)&&id===pointId('CHIN_M');
export function chinAttachments(p:LandmarkProject){
 return p.curves.flatMap(c=>isDerived(c)?[]:([['START',c.startLandmarkId],['END',c.endLandmarkId]] as const).flatMap(([endpoint,id])=>chinEndpoint(p,id)?[{curveId:c.id,pointId:id,endpoint}]:[]));
}
export function chinSurfaceAttached(p:LandmarkProject,x:SurfacePatch){
 const ids=new Set(chinAttachments(p).map(a=>a.curveId));return x.type!=='loop'&&x.boundaryUses.some(b=>ids.has(b.curveId));
}
// An unmodified source stage prevents a six-way fit from recursively reading
// its own final curves. This marker/cache is runtime-only, never serialized.
const sourceScopes=new WeakSet<LandmarkProject>(),sources=new WeakMap<LandmarkProject,LandmarkProject>();
export function chinSourceProject(p:LandmarkProject){let q=sources.get(p);if(!q){q={...p};sourceScopes.add(q);sources.set(p,q);}return q;}
export function chinArm(p:LandmarkProject,id:string):ChinArm{
 const c=p.curves.find(c=>c.id===id)!;
 const recorded=p.chinScaffold?.arms?.[id]??(c.role==='mirror'?p.chinScaffold?.arms?.[c.canonicalCurveId]:undefined);if(recorded)return recorded;
 const raw=chinSourceProject(p),center=pointId('CHIN_M'),other=c.startLandmarkId===center?c.endLandmarkId:c.startLandmarkId;
 const a=toRelative(p,pointPosition(raw,center)),b=toRelative(p,pointPosition(raw,other!));
 if(Math.abs(b[0])<1e-8)return b[1]>=a[1]?'UP':'DOWN';
 const g=evaluationContext(raw).curve(c.id),t=c.startLandmarkId===center?.05:.95,near=toRelative(p,g.evaluate(t));
 return near[2]>=a[2]?'UPPER_PAIR':'LOWER_PAIR';
}
export interface ChinField {
 key:string;center:Vec3;normal:Vec3;xAxis:Vec3;yAxis:Vec3;coefficients:[number,number];sideAngle:number;
 radius(q:Vec3):number;weight(q:Vec3):number;map(q:Vec3):Vec3;graphNormal(q:Vec3):Vec3;
 diagnostic?:string;
}
const fields=new WeakMap<LandmarkProject,ChinField>();
/** One shared, symmetry-constrained quadratic chart. The plane minimizes
 * squared normal components of the incident secants. The quadratic minimizes
 * sample residual + a positive bending-energy penalty. No cap/rim is generated.
 * The core is a single C-infinity graph; a compact C2 envelope restores sources.
 */
export function chinField(p:LandmarkProject):ChinField{
 const hit=fields.get(p);if(hit)return hit;
 const raw=chinSourceProject(p),ctx=evaluationContext(raw),center=pointPosition(raw,pointId('CHIN_M')),f=p.headFrame,R=f?.radiusX??1;
 const local=(v:Vec3)=>f?rotateFrame(v,f,true):v,world=(v:Vec3)=>f?rotateFrame(v,f):v;
 const attachments=chinAttachments(p),samples:{v:Vec3;range:number;arm:ChinArm}[]=[],keys:string[]=[];
 for(const a of attachments){const g=ctx.curve(a.curveId),lut=g.arcLengthLUT(),L=lut.at(-1)!,arm=chinArm(p,a.curveId),range=(p.chinScaffold?.ranges??defaultRanges)[arm]*R;
  keys.push(g.key);if(L<1e-9)continue;
  for(const fraction of [.5,.75,1]){const d=Math.min(range*fraction,L*.4),t=normalizedArcLengthToT(lut,a.endpoint==='START'?d/L:1-d/L);samples.push({v:local(sub(g.evaluate(t),center)),range,arm});}
 }
 let yy=0,yz=0,zz=0;
 for(const {v}of samples){const w=1/Math.max(dot(v,v),1e-20);yy+=v[1]*v[1]*w;yz+=v[1]*v[2]*w;zz+=v[2]*v[2]*w;}
 // Exact symmetry: X is always in the common tangent plane. Solve its YZ
 // principal axis analytically; do not average view-dependent face normals.
 const angle=.5*Math.atan2(2*yz,yy-zz);let t:Vec3=[0,Math.cos(angle),Math.sin(angle)];
 const mean=(upper:boolean)=>{const q=samples.filter(s=>(s.arm==='UP'||s.arm==='UPPER_PAIR')===upper);return q.reduce<Vec3>((v,s)=>add(v,scale(unit(s.v),1/Math.max(1,q.length))),[0,0,0]);};
 const separation=sub(mean(true),mean(false));separation[0]=0;if(len(separation)>.1)t=unit(separation);else if(t[1]<-1e-8||Math.abs(t[1])<=1e-8&&t[2]<0)t=scale(t,-1);
 const n:Vec3=[0,-t[2],t[1]],xAxis=world([1,0,0]),yAxis=world(t),normal=world(n);
 // Dimensionless least squares makes scaling the HeadFrame immaterial.
 const size=Math.max(...Object.values(p.chinScaffold?.ranges??defaultRanges))*R;
 let aa=.025,ab=0,bb=.025,ay=0,by=0;
 for(const {v}of samples){const x=v[0]/size,y=dot(v,t)/size,z=dot(v,n)/size,a=x*x,b=y*y;aa+=a*a;ab+=a*b;bb+=b*b;ay+=a*z;by+=b*z;}
 const det=aa*bb-ab*ab,A=(ay*bb-by*ab)/det,B=(by*aa-ay*ab)/det;
 const knots=samples.filter((_,i)=>i%3===2).map(s=>({angle:Math.atan2(dot(s.v,t),s.v[0]),radius:s.range}));
 const pairSamples=samples.filter(s=>s.arm==='UPPER_PAIR'||s.arm==='LOWER_PAIR');
 const sideAngle=Math.max(Math.PI/9,Math.min(Math.PI/3,Math.atan2(pairSamples.reduce((v,s)=>v+Math.abs(dot(s.v,t)),0),pairSamples.reduce((v,s)=>v+Math.abs(s.v[0]),0))));
 const radius=(q:Vec3)=>{
  if(!knots.length)return size;const v=sub(q,center),a=Math.atan2(dot(v,yAxis),dot(v,xAxis));let sum=0,w=0;
  for(const k of knots){const d=Math.atan2(Math.sin(a-k.angle),Math.cos(a-k.angle)),z=Math.exp(5*(Math.cos(d)-1));sum+=z*k.radius;w+=z;}return sum/w;
 };
 const weight=(q:Vec3)=>{const r=len(sub(q,center))/radius(q);if(r<=.35)return 1;if(r>=1)return 0;const u=(r-.35)/.65;return 1-u*u*u*(10+u*(-15+6*u));};
 const height=(q:Vec3)=>{const v=sub(q,center),x=dot(v,xAxis)/size,y=dot(v,yAxis)/size;return size*(A*x*x+B*y*y);};
 const map=(q:Vec3)=>{const w=weight(q);if(w===0)return q;return add(q,scale(normal,w*(height(q)-dot(sub(q,center),normal))));};
 const graphNormal=(q:Vec3)=>{const v=sub(q,center);return unit(sub(sub(normal,scale(xAxis,2*A*dot(v,xAxis)/size)),scale(yAxis,2*B*dot(v,yAxis)/size)));};
 const result:ChinField={key:JSON.stringify(['CHIN_NODE',keys,p.headFrame,p.chinScaffold?.ranges]),center,xAxis,yAxis,normal,sideAngle,coefficients:[A/size,B/size],radius,weight,map,graphNormal,...(attachments.length<2?{diagnostic:'至少连接两条线后求解局部平滑'}:{})};
 fields.set(p,result);return result;
}
const providers=new WeakMap<LandmarkProject,Map<string,CurveProvider>>();
export function chinJoinedProvider(p:LandmarkProject,id:string,g:CurveProvider):CurveProvider{
 if(!isChinNode(p)||sourceScopes.has(p)||!chinAttachments(p).some(a=>a.curveId===id))return g;
 let cache=providers.get(p);if(!cache){cache=new Map();providers.set(p,cache);}const hit=cache.get(id);if(hit)return hit;
 const c=p.curves.find(c=>c.id===id)!;
 if(c.role==='mirror'){
  const a=evaluationContext(p).curve(c.canonicalCurveId),q=provider('chinMirror:'+a.key,false,t=>mirrorPoint(p,a.evaluate(t)),t=>worldMirror(a.derivative(t)));
  const worldMirror=(v:Vec3)=>sub(v,scale(p.headFrame?rotateFrame([1,0,0],p.headFrame):[1,0,0],2*dot(v,p.headFrame?rotateFrame([1,0,0],p.headFrame):[1,0,0])));cache.set(id,q);return q;
 }
 const field=chinField(p),a=chinAttachments(p).find(a=>a.curveId===id)!,start=a.endpoint==='START',arm=chinArm(p,id),range=(p.chinScaffold!.ranges??defaultRanges)[arm]*(p.headFrame?.radiusX??1),lut=g.arcLengthLUT(),L=lut.at(-1)!;
 const cut=normalizedArcLengthToT(lut,start?Math.min(.4,range/L):1-Math.min(.4,range/L)),span=start?cut:1-cut,sign=start?1:-1;
 if(L<1e-10||span<1e-10){cache.set(id,g);return g;}
 const P=g.evaluate(cut),D=scale(g.derivative(cut),span*sign),h=1e-5,A1=scale(sub(g.derivative(Math.min(1,cut+h)),g.derivative(Math.max(0,cut-h))),span*span/(Math.min(1,cut+h)-Math.max(0,cut-h)));
 const relative=sub(P,field.center),x=Math.abs(dot(relative,field.xAxis)),y=Math.abs(dot(relative,field.yAxis)),upper=arm==='UP'||arm==='UPPER_PAIR';
 // A regular six-ray fan is essential: projecting six tangents onto a plane
 // alone can leave both upper/lower spokes on the same side and fold the fan.
 const side=dot(relative,field.xAxis)<0?-1:1,central=arm==='UP'||arm==='DOWN';
 const ray=central?scale(field.yAxis,upper?1:-1):add(scale(field.xAxis,side*Math.cos(field.sideAngle)),scale(field.yAxis,(upper?1:-1)*Math.sin(field.sideAngle)));
 const D0=scale(ray,Math.max(len(relative),range*.5)),A0=scale(field.normal,2*(field.coefficients[0]*dot(D0,field.xAxis)**2+field.coefficients[1]*dot(D0,field.yAxis)**2));
 // The quintic is the minimum integrated squared third derivative with these
 // endpoint jets. Source position, tangent and curvature are exact at the cut.
 const c0=field.center,c1=D0,c2=scale(A0,.5),d=sub(P,add(add(c0,c1),c2)),e=sub(D,add(c1,scale(c2,2))),f=sub(A1,scale(c2,2));
 const c3=add(sub(scale(d,10),scale(e,4)),scale(f,.5)),c4=sub(add(scale(d,-15),scale(e,7)),f),c5=add(sub(scale(d,6),scale(e,3)),scale(f,.5));
 const evaluate=(t:number)=>{const r=(start?t:1-t)/span;if(r>=1)return g.evaluate(t);let P=c5;for(const c of [c4,c3,c2,c1,c0])P=add(c,scale(P,r));const u=Math.max(0,(r-.65)/.35),fade=1-u*u*u*(10+u*(-15+6*u));return add(P,scale(sub(field.map(P),P),fade));};
 const derivative=(t:number)=>{if((start?t:1-t)>=span)return g.derivative(t);const h=1e-7,lo=Math.max(0,t-h),hi=Math.min(1,t+h);return scale(sub(evaluate(hi),evaluate(lo)),1/(hi-lo));};

 const q=provider(g.key+field.key,false,evaluate,derivative);cache.set(id,q);return q;
}
/** Point topology closes directly. There is no implicit fourth/rim boundary. */
export function completeChinBoundary(_p:LandmarkProject,uses:PatchBoundaryUse[]){return uses;}
