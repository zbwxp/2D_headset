import {curveVisible} from './visibility';
import {junctionEnabled} from './bindingState';
import {arcLengthLUT,normalizedArcLengthToT,evaluate as bezier,derivative,split} from '../geometry/bezier';
import type {Vec3} from '../project/types';
import {evaluate,coverage} from './evaluation';
import {endpointIndex,evaluateRecording,type JunctionResult} from './junctions';
import {canonical,sameView,validateJunctions,type Cubic,type Point2,type RecordedCurve,type Recording,type RecordingJunction,type SmoothStyle,type View} from './model';
export type SmoothJunction=Extract<RecordingJunction,{mode:'SMOOTH'}>;
export const DEFAULT_STYLE:SmoothStyle={radiusScale:1,tensionA:1,tensionB:1};
const xyz=(s:Cubic):Vec3[]=>s.map(([x,y])=>[x,y,0]);
const xy=(p:number[]):Point2=>[p[0],p[1]];
const curve2=(s:Vec3[])=>s.map(xy) as Cubic;
// Runtime adapter to the existing deterministic interpolation engine. No Curve
// asset is created; only the three scalar style channels are blended.
const fields=new WeakMap<SmoothJunction,RecordedCurve>();
export function styleField(j:SmoothJunction):RecordedCurve {
 const hit=fields.get(j);if(hit)return hit;
 const field:RecordedCurve={id:j.id,name:'',visible:true,locked:false,keys:j.smoothKeys.map(k=>({yaw:k.yaw,pitch:k.pitch,shape:[[k.radiusScale,k.tensionA],[k.tensionB,0],[0,0],[0,0]]}))};
 fields.set(j,field);return field;
}
export function smoothStyle(j:SmoothJunction,v:View):SmoothStyle {
 if(!j.smoothKeys.length)return {...DEFAULT_STYLE};
 const e=evaluate(styleField(j),v),s=e.shape;
 return {radiusScale:s[0][0],tensionA:s[0][1],tensionB:s[1][0]};
}
export const smoothCoverage=(j:SmoothJunction)=>j.smoothKeys.length?coverage(styleField(j)):null;
export interface SmoothTransition {id:string;shape:Cubic;ta:Point2;tb:Point2;baseLength:number;trims:{id:string;end:0|3;t:number}[]}
export interface SmoothResult {sources:Map<string,Cubic>;transitions:SmoothTransition[];warnings:Map<string,string>}
export function smoothGeometry(r:Recording,v:View,position:Map<string,JunctionResult>=evaluateRecording(r,v)):SmoothResult {
 const sources=new Map([...position].map(([id,e])=>[id,e.shape])),warnings=new Map<string,string>(),candidates:SmoothTransition[]=[];
 for(const j of r.junctions??[]){if(j.mode!=='SMOOTH'||!junctionEnabled(j,v))continue;
  const a=position.get(j.masterCurveId)!,b=position.get(j.followerCurveId)!;
  if(a.status==='frozen'||b.status==='frozen')continue;
  // Hidden sources do not leave a detached visible transition or cropped partner.
  if(!curveVisible(r.curves.find(c=>c.id===j.masterCurveId)!,v)||!curveVisible(r.curves.find(c=>c.id===j.followerCurveId)!,v))continue;
  try{
   const ac=xyz(a.shape),bc=xyz(b.shape),al=arcLengthLUT(ac),bl=arcLengthLUT(bc),la=al.at(-1)!,lb=bl.at(-1)!,style=smoothStyle(j,v),L=j.baseRadius*style.radiusScale*Math.min(la,lb);
   if(!Number.isFinite(L)||L<=1e-10||Math.min(la,lb)<=1e-9)throw Error('圆滑几何退化');
   if(L>=la||L>=lb)throw Error('圆滑裁剪范围重叠');
   const ae=endpointIndex(j.masterEndpoint),be=endpointIndex(j.followerEndpoint);
   const at=normalizedArcLengthToT(al,ae===0?L/la:1-L/la),bt=normalizedArcLengthToT(bl,be===0?L/lb:1-L/lb);
   const pa=xy(bezier(ac,at)),pb=xy(bezier(bc,bt));
   const unit=(d:Vec3,sign:number):Point2=>{const n=Math.hypot(d[0],d[1]);if(n<1e-10)throw Error('圆滑切向退化');return [sign*d[0]/n,sign*d[1]/n];};
   const ta=unit(derivative(ac,at),ae===0?-1:1),tb=unit(derivative(bc,bt),be===0?1:-1);
   const chord=Math.hypot(pb[0]-pa[0],pb[1]-pa[1]);if(chord<1e-9)throw Error('圆滑几何退化');
   const baseLength=Math.min(L,chord)/3,ha=baseLength*style.tensionA,hb=baseLength*style.tensionB;
   const shape:Cubic=[pa,[pa[0]+ta[0]*ha,pa[1]+ta[1]*ha],[pb[0]-tb[0]*hb,pb[1]-tb[1]*hb],pb];
   if(!shape.flat().every(Number.isFinite))throw Error('圆滑几何退化');
   candidates.push({id:j.id,shape,ta,tb,baseLength,trims:[{id:j.masterCurveId,end:ae,t:at},{id:j.followerCurveId,end:be,t:bt}]});
  }catch(e){warnings.set(j.id,(e as Error).message);}
 }
 // Mark every conflicting pair before trimming either source. No partial joins.
 for(let i=0;i<candidates.length;i++)for(let k=i+1;k<candidates.length;k++)for(const a of candidates[i].trims)for(const b of candidates[k].trims){
  if(a.id===b.id&&(a.end===b.end||(a.end===0?a.t>=b.t-1e-8:b.t>=a.t-1e-8))){warnings.set(candidates[i].id,'圆滑裁剪范围重叠');warnings.set(candidates[k].id,'圆滑裁剪范围重叠');}
 }
 const transitions=candidates.filter(x=>!warnings.has(x.id)),ranges=new Map<string,[number,number]>();
 for(const transition of transitions)for(const t of transition.trims){const range=ranges.get(t.id)??[0,1];range[t.end===0?0:1]=t.t;ranges.set(t.id,range);}
 for(const [id,[lo,hi]] of ranges){const cp=xyz(sources.get(id)!);const left=hi<1?split(cp,hi)[0]:cp;const middle=lo>0?split(left,lo/hi)[1]:left;sources.set(id,curve2(middle));}
 return {sources,transitions,warnings};
}
export function smoothEditable(r:Recording,j:RecordingJunction):boolean{return [j.masterCurveId,j.followerCurveId].every(id=>r.curves.some(c=>c.id===id&&!c.locked));}
export function setSmoothMode(r:Recording,id:string,view:View,enabled:boolean):Recording{
 const j=r.junctions?.find(j=>j.id===id);if(!j||!smoothEditable(r,j))return r;
 if((j.mode==='SMOOTH')===enabled)return r;
 const e=evaluateRecording(r,view);if(enabled&&[j.masterCurveId,j.followerCurveId].some(id=>e.get(id)!.status==='frozen'))return r;
 const {masterCurveId,masterEndpoint,followerCurveId,followerEndpoint}=j;
 const next:RecordingJunction=enabled?{id,bindingKeys:j.bindingKeys,masterCurveId,masterEndpoint,followerCurveId,followerEndpoint,mode:'SMOOTH',baseRadius:.08,smoothKeys:[{...canonical(view),...DEFAULT_STYLE}]}:{id,bindingKeys:j.bindingKeys,masterCurveId,masterEndpoint,followerCurveId,followerEndpoint,mode:'POSITION'};
 const result={...r,junctions:r.junctions!.map(x=>x.id===id?next:x)};
 try{validateJunctions(result);}catch{return r;}return result;
}
export function editSmoothStyle(r:Recording,id:string,view:View,change:Partial<SmoothStyle>):Recording{
 const j=r.junctions?.find(j=>j.id===id);if(!j||j.mode!=='SMOOTH'||!smoothEditable(r,j))return r;
 const e=evaluateRecording(r,view);if([j.masterCurveId,j.followerCurveId].some(id=>e.get(id)!.status==='frozen'))return r;
 const prior=smoothStyle(j,view),style={...prior,...change};
 if(!Object.values(style).every(x=>Number.isFinite(x)&&x>0)||Object.keys(change).every(k=>style[k as keyof SmoothStyle]===prior[k as keyof SmoothStyle]))return r;
 const key={...canonical(view),...style};
 return {...r,junctions:r.junctions!.map(x=>x===j?{...j,smoothKeys:j.smoothKeys.some(k=>sameView(k,key))?j.smoothKeys.map(k=>sameView(k,key)?key:k):[...j.smoothKeys,key]}:x)};
}
/** CSS-space tangent projection remains correct under anisotropic viewport scaling. */
export function handleTension(delta:Point2,tangent:Point2,baseLength:number,current:number,scale:Point2):number{
 const d:Point2=[tangent[0]*scale[0],tangent[1]*scale[1]],den=d[0]*d[0]+d[1]*d[1];
 return Math.max(.05,Math.min(4,current+(delta[0]*d[0]+delta[1]*d[1])/(den*baseLength)));
}
