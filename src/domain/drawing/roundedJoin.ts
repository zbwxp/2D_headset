import {copyCurveSource,curveSamples,tagBridge} from './curveProvenance';
import {split} from '../geometry/bezier';
import {add,sub,mul,length,shapeOf,nodeAt,curveById,joinAt,sameEnd,type Point2,type Cubic,type Endpoint,type CurveUse,type TangentJoin,type DrawingDocument as Doc} from './model';
import {arcField} from './sampling';
import {evaluatedAffine,evaluatedAffineSource,affineGeometry,affineShape} from './evaluatedAffine';
const dot=(a:Point2,b:Point2)=>a[0]*b[0]+a[1]*b[1];
const cross=(a:Point2,b:Point2)=>a[0]*b[1]-a[1]*b[0];
const unit=(v:Point2)=>mul(v,1/(length(v)||1));
const flip=(s:Cubic)=>copyCurveSource(s,[...s].reverse() as Cubic,1,0);
const xyz=(s:Cubic)=>s.map(([x,y])=>[x,y,0] as [number,number,number]);
const cut=(s:Cubic,t:number)=>split(xyz(s),t).map(s=>s.map(([x,y])=>[x,y]) as Cubic);
export function subcurve(s:Cubic,lo:number,hi:number):Cubic{const left=hi<1?cut(s,hi)[0]:s;return copyCurveSource(s,lo>0?cut(left,lo/hi)[1]:left,lo,hi);}
const straight=(a:Point2,b:Point2):Cubic=>[a,add(a,mul(sub(b,a),1/3)),add(a,mul(sub(b,a),2/3)),b];
/** Circular arc through a,b with prescribed initial tangent. Cubic pieces span <=90 degrees. */
function circular(a:Point2,t:Point2,b:Point2):Cubic[]{
 const v=sub(b,a),len=length(v),turn=cross(t,v);if(len<1e-9)throw Error('圆弧两侧重合，请调整控制柄方向或影响范围。');
 if(Math.abs(turn)<len*1e-8){if(dot(v,t)<=0)throw Error('圆弧发生折返，请调整控制柄或减小影响范围。');return [straight(a,b)];}
 const r=dot(v,v)/(2*turn),center=add(a,mul([-t[1],t[0]],r)),ra=sub(a,center),rb=sub(b,center),start=Math.atan2(ra[1],ra[0]);
 let angle=Math.atan2(cross(ra,rb),dot(ra,rb));if(r>0&&angle<0)angle+=Math.PI*2;if(r<0&&angle>0)angle-=Math.PI*2;
 if(Math.abs(angle)>Math.PI+1e-7)throw Error('圆弧发生折返，请调整控制柄或减小影响范围。');
 const n=Math.max(1,Math.ceil(Math.abs(angle)/(Math.PI/2))),out:Cubic[]=[],radius=Math.abs(r);
 for(let i=0;i<n;i++){const a0=start+angle*i/n,a1=start+angle*(i+1)/n,k=4/3*Math.tan((a1-a0)/4),p=i?add(center,[radius*Math.cos(a0),radius*Math.sin(a0)]):a,q=i===n-1?b:add(center,[radius*Math.cos(a1),radius*Math.sin(a1)]);
  out.push([p,add(p,[-radius*Math.sin(a0)*k,radius*Math.cos(a0)*k]),sub(q,[-radius*Math.sin(a1)*k,radius*Math.cos(a1)*k]),q]);
 }return out;
}
/** Equal tangent-distance biarc. Both pieces meet with G1 continuity; a straight corner gives one circle. */
export function biarc(a:Point2,t0:Point2,b:Point2,t1:Point2):Cubic[]{
 const v=sub(b,a),size=length(v);if(size<1e-8)throw Error('圆弧两侧重合，请调整控制柄方向或影响范围。');
 t0=unit(t0);t1=unit(t1);const q=Math.max(0,1-dot(t0,t1)),B=dot(v,add(t0,t1)),den=Math.sqrt(B*B+2*q*size*size)+B;
 if(den<1e-10*size)throw Error('圆弧发生折返，请调整控制柄或减小影响范围。');
 const distance=size*size/den;if(distance>size*100)throw Error('圆弧发生折返，请调整控制柄或减小影响范围。');
 const middle=mul(add(add(a,b),mul(sub(t0,t1),distance)),.5),left=circular(a,t0,middle),right=circular(b,mul(t1,-1),middle).reverse().map(flip);
 const ta=unit(sub(left.at(-1)![3],left.at(-1)![2])),tb=unit(sub(right[0][1],right[0][0]));
 if(dot(ta,tb)<1-1e-6)throw Error('无法生成相切圆弧，请调整控制柄或影响范围。');return [...left,...right];
}
export interface ArcJoinGeometry {joinId:string;shapes:Cubic[];aT:number;bT:number;distance:number;clamped:boolean;error?:string}
const cache=new WeakMap<Doc,Map<string,ArcJoinGeometry>>();
export function roundedJoins(d:Doc):Map<string,ArcJoinGeometry>{
 const found=cache.get(d);if(found)return found;
 const source=evaluatedAffineSource(d);if(source){
  const out=new Map([...roundedJoins(source)].map(([id,g])=>{const join=d.joins.find(j=>j.id===id),affine=evaluatedAffine(d,join?.a.curveId);return [id,affine?{...g,shapes:g.shapes.map(s=>affineShape(s,affine))}:g] as const;}));cache.set(d,out);return out;
 }
 const out=new Map<string,ArcJoinGeometry>(),fields=new Map<string,ReturnType<typeof arcField>>();
 const field=(id:string)=>{let f=fields.get(id);if(!f){f=arcField([shapeOf(d,id)]);fields.set(id,f);}return f;};
 const allowance=(e:Endpoint,radius:number)=>{const requests=([0,1] as const).map(end=>joinAt(d,{curveId:e.curveId,end})).reduce((sum,j)=>sum+(j?.mode==='ARC'?j.radius!:0),0);return Math.min(radius,field(e.curveId).total*(1-1e-5)*radius/requests);};
 for(const j of d.joins){if(j.mode!=='ARC')continue;let distance=0;
  try{
   distance=Math.min(allowance(j.a,j.radius!),allowance(j.b,j.radius!));if(distance<1e-7)throw Error('源线长度退化，无法生成圆弧。');
   const at=(e:Endpoint)=>{const f=field(e.curveId),sample=f.at(e.end?1-distance/f.total:distance/f.total);return {...sample,outward:mul(sample.tangent,e.end?-1:1)};},a=at(j.a),b=at(j.b);
   if(length(a.outward)<.9||length(b.outward)<.9)throw Error('连接柄退化，无法生成圆弧。');
   out.set(j.id,{joinId:j.id,shapes:biarc(a.p,mul(a.outward,-1),b.p,b.outward),aT:a.t,bT:b.t,distance,clamped:distance<j.radius!*(1-1e-6)});
  }catch(e){out.set(j.id,{joinId:j.id,shapes:[],aT:j.a.end,bT:j.b.end,distance,clamped:false,error:(e as Error).message});}
 }
 cache.set(d,out);return out;
}
export interface DrawingPiece {inkOwner?:string;shape:Cubic;owners:string[];joinId?:string;sourceRange?:[number,number]}
export interface DerivedUses {shapes:Cubic[];pieces:DrawingPiece[];error?:string}
/** All consumers use the same trimmed source + derived arcs. Raw authoring handles stay intact. */
export function derivedUses(d:Doc,uses:CurveUse[],closed=false):DerivedUses{
 const affine=evaluatedAffine(d,uses[0]?.id);if(affine)return affineGeometry(derivedUses(evaluatedAffineSource(d)!,uses,closed),affine);
 const fail=(error:string):DerivedUses=>({shapes:[],pieces:[],error});
 if(!uses.length||uses.some(u=>!curveById(d,u.id)))return fail('边界源曲线已删除。');
 const shapes=uses.map(u=>u.reverse?flip(shapeOf(d,u.id)):shapeOf(d,u.id)),starts=uses.map(u=>({curveId:u.id,end:(u.reverse?1:0) as 0|1})),ends=uses.map(u=>({curveId:u.id,end:(u.reverse?0:1) as 0|1}));
 const trims=uses.map(()=>({lo:0,hi:1})),bridges=new Map<number,{geometry:ArcJoinGeometry;join:TangentJoin;reverse:boolean}>(),geometry=roundedJoins(d);
 for(let i=0;i<(closed?uses.length:uses.length-1);i++){
  const next=(i+1)%uses.length;if(length(sub(shapes[i][3],shapes[next][0]))>1e-7)return fail('边界未闭合或已断开。');
  const j=joinAt(d,ends[i]);if(j?.mode!=='ARC')continue;
  const reversed=sameEnd(j.b,ends[i]);if(!sameEnd(reversed?j.a:j.b,starts[next]))continue;
  const g=geometry.get(j.id)!;if(g.error)continue;
  const a=reversed?g.bT:g.aT,b=reversed?g.aT:g.bT;trims[i].hi=uses[i].reverse?1-a:a;trims[next].lo=uses[next].reverse?1-b:b;
  bridges.set(i,{geometry:g,join:j,reverse:reversed});
 }
 const pieces:DrawingPiece[]=[];uses.forEach((u,i)=>{pieces.push({shape:subcurve(shapes[i],trims[i].lo,trims[i].hi),owners:[u.id],sourceRange:[trims[i].lo,trims[i].hi]});const b=bridges.get(i);if(b){const ss=b.reverse?[...b.geometry.shapes].reverse().map(flip):b.geometry.shapes;const next=(i+1)%uses.length,a=curveSamples(shapes[i],trims[i].hi),z=curveSamples(shapes[next],trims[next].lo);pieces.push(...ss.map((shape,k)=>({shape:tagBridge([...shape] as Cubic,a,z,k/ss.length,(k+1)/ss.length),owners:[b.join.a.curveId,b.join.b.curveId],joinId:b.join.id})));}});
 return {pieces,shapes:pieces.map(p=>p.shape)};
}

/** Split only derived ARC bridges at their arc midpoint for independent ink depth.
 * Geometry/continuity stay identical; visibility still checks both source owners. */
export function partitionedUses(d:Doc,uses:CurveUse[],closed=false):DerivedUses{
 const affine=evaluatedAffine(d,uses[0]?.id);if(affine)return affineGeometry(partitionedUses(evaluatedAffineSource(d)!,uses,closed),affine);
 const g=derivedUses(d,uses,closed),pieces:DrawingPiece[]=[];
 for(let i=0;i<g.pieces.length;){
  const p=g.pieces[i];if(!p.joinId){pieces.push({...p,inkOwner:p.owners[0]});i++;continue;}
  let end=i+1;while(end<g.pieces.length&&g.pieces[end].joinId===p.joinId)end++;
  const bridge=g.pieces.slice(i,end),field=arcField(bridge.map(p=>p.shape)),half=field.total/2,cut=field.at(.5),before=g.pieces[(i-1+g.pieces.length)%g.pieces.length].owners[0],after=g.pieces[end%g.pieces.length].owners[0];
  bridge.forEach((p,k)=>{const part=field.parts[k],hi=part.start+part.length;if(part.start<half-1e-10&&hi>half+1e-10){pieces.push({...p,shape:subcurve(p.shape,0,cut.t),inkOwner:before},{...p,shape:subcurve(p.shape,cut.t,1),inkOwner:after});}else pieces.push({...p,inkOwner:hi<=half+1e-10?before:after});});
  i=end;
 }
 return {...g,pieces,shapes:pieces.map(p=>p.shape)};
}
