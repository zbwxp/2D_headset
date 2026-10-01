import {coverage,evaluateWeights,type Evaluated} from './evaluation';
import type {RecordedCurve,View,Cubic,Point2} from './model';
import {emptyDrawing,shapeOf,type DrawingDocument as Doc,type DrawingCurve} from '../drawing/model';
import {blendPoseIntervals} from './poseIntervals';
import {blendPoseInkEnds} from './poseInkEnds';
import {resolvePoseInferences} from './poseInference';
import type {PoseRecording,RecordedPose} from './poses';
import {fillGeometry,offsetGeometry} from '../drawing/appearance';

type Status=Evaluated['status'];
interface Sample {pose:RecordedPose;weight:number}
interface Field {poses:RecordedPose[];field:RecordedCurve}
export interface PoseEvaluation {
 drawing:Doc;status:Map<string,Status>;opacity:Map<string,number>;frozen:DrawingCurve[];
 frozenPaints:{id:string;shapes:Cubic[]}[];
 warnings:string[];at:View;
}
const cache=new WeakMap<PoseRecording,Map<string,Field>>();
const blank:Cubic=[[0,0],[0,0],[0,0],[0,0]];
function fieldFor(r:PoseRecording,ids:number[]):Field {
 let fields=cache.get(r);if(!fields){fields=new Map();cache.set(r,fields);}
 const key=ids.join(','),hit=fields.get(key);if(hit)return hit;
 const poses=ids.map(i=>r.poses[i]),field:RecordedCurve={id:key,name:key,visible:true,locked:false,keys:poses.map(p=>({yaw:p.yaw,pitch:p.pitch,shape:blank}))};
 const result={poses,field};fields.set(key,result);return result;
}
export function poseCoverage(r:PoseRecording,id?:string){
 r=resolvePoseInferences(r);
 const ids=r.poses.flatMap((p,i)=>!id||[...p.drawing.curves,...p.drawing.fills,...p.drawing.offsets].some(c=>c.id===id)?[i]:[]);
 return ids.length?coverage(fieldFor(r,ids).field):null;
}
function samples(r:PoseRecording,view:View,has:(d:Doc)=>boolean,atView?:Map<Field,ReturnType<typeof sampleField>>){
 const f=fieldFor(r,r.poses.flatMap((p,i)=>has(p.drawing)?[i]:[]));
 const hit=atView?.get(f);if(hit)return hit;
 const result=sampleField(f,view);atView?.set(f,result);return result;
}
function sampleField(f:Field,view:View){
 const result=evaluateWeights(f.field,view,false);
 return {...result,samples:result.weights.filter(w=>w.weight>1e-10).map(w=>({pose:f.poses[w.index],weight:w.weight}))};
}
const strongest=(s:Sample[])=>s.reduce((a,b)=>a.weight>=b.weight?a:b).pose;
const weighted=(s:Sample[],f:(p:RecordedPose)=>number)=>s.reduce((sum,x)=>sum+x.weight*f(x.pose),0);
const point=(s:Sample[],f:(p:RecordedPose)=>Point2):Point2=>[weighted(s,p=>f(p)[0]),weighted(s,p=>f(p)[1])];
/** Merge missing objects into their source neighbours without moving shared objects. */
function unionOrder(primary:string[],sources:string[][]){
 const result=[...primary];for(const source of sources)for(let i=0;i<source.length;i++){
  const id=source[i];if(result.includes(id))continue;
  const next=source.slice(i+1).find(x=>result.includes(x)),prev=source.slice(0,i).reverse().find(x=>result.includes(x));
  result.splice(next?result.indexOf(next):prev?result.indexOf(prev)+1:result.length,0,id);
 }return result;
}
/** Geometry stays in full Drawing form. Missing samples are never fabricated.
 * Translation is applied per supporting pose, so a one-key ghost stays still. */
export function evaluatePoses(r:PoseRecording,view:View):PoseEvaluation {
 r=resolvePoseInferences(r);
 const status=new Map<string,Status>(),opacity=new Map<string,number>(),warnings:string[]=[],frozenPaints:PoseEvaluation['frozenPaints']=[];
 if(!r.poses.length)return {drawing:emptyDrawing(),status,opacity,frozen:[],frozenPaints,warnings,at:view};
 const atView=new Map<Field,ReturnType<typeof sampleField>>();
 const global=samples(r,view,()=>true,atView),base=strongest(global.samples),priority=[base,...r.poses.filter(p=>p!==base)];
 // Metadata is read-only. Only the arrays/coordinates modified below need copies.
 const d:Doc={...base.drawing,curves:[],nodes:[],fills:[],offsets:[],displayIntervals:[]};
 // Curve/interval coverage can differ from the dominant pose. Build ownership
 // for the entire union before any derived stroke lookup (including frozen
 // curves and curves inferred into only some poses), not after interpolation.
 const objects=new Set(priority.flatMap(p=>[...p.drawing.curves,...p.drawing.fills,...p.drawing.offsets].map(o=>o.id)));
 const layerIds=unionOrder(base.drawing.layers.map(l=>l.id),priority.map(p=>p.drawing.layers.map(l=>l.id))),owned=new Set<string>();
 d.layers=layerIds.map(id=>{const layers=priority.flatMap(p=>p.drawing.layers.filter(l=>l.id===id)),template=layers[0];
  return {...template,items:unionOrder(template.items,layers.map(l=>l.items)).filter(id=>{if(!objects.has(id)||owned.has(id))return false;owned.add(id);return true;})};
 });
 const curveIds=[...new Set(priority.flatMap(p=>p.drawing.curves.map(c=>c.id)))];
 const nodePositions=new Map<string,Point2[]>(),curveFields=new Map<string,ReturnType<typeof samples>>();
 for(const id of curveIds){
  const e=samples(r,view,d=>d.curves.some(c=>c.id===id),atView),source=strongest(e.samples),template=source.drawing.curves.find(c=>c.id===id)!;
  curveFields.set(id,e);status.set(id,e.status);
  const shape=[0,1,2,3].map(j=>point(e.samples,p=>{const q=shapeOf(p.drawing,id)[j];return [q[0]+p.offset[0],q[1]+p.offset[1]];})) as Cubic;
  const visibility=weighted(e.samples,p=>p.drawing.curves.find(c=>c.id===id)!.visible?1:0);
  const alpha=weighted(e.samples,p=>{const c=p.drawing.curves.find(c=>c.id===id)!;return c.visible&&c.inkVisible!==false?1:0;});
  opacity.set(id,e.status==='frozen'?0:alpha);
  // Active topology follows the dominant pose. Ghosts get private nodes so an
  // active neighbour can never pull their frozen geometry to another view.
  const c:DrawingCurve={...template,nodes:template.nodes.map(n=>e.status==='frozen'?`ghost:${id}:${n}`:n) as [string,string],handles:[shape[1],shape[2]],width:weighted(e.samples,p=>p.drawing.curves.find(c=>c.id===id)!.width),visible:visibility>1e-10,inkVisible:alpha>1e-10};
  if(e.samples.length>1)c.inkEnds=blendPoseInkEnds(id,e.samples.map(s=>({drawing:s.pose.drawing,weight:s.weight})));
  if(alpha>1e-10&&alpha<1-1e-10||e.status==='frozen')c.localPaintOrder=true;
  for(const end of [0,1] as const){const n=c.nodes[end];nodePositions.set(n,[...(nodePositions.get(n)??[]),shape[end?3:0]]);}
  d.curves.push(c);
 }
 d.nodes=[...nodePositions].map(([id,ps])=>({id,position:[ps.reduce((s,p)=>s+p[0],0)/ps.length,ps.reduce((s,p)=>s+p[1],0)/ps.length]}));
 const curves=new Map(d.curves.map(c=>[c.id,c])),nodes=new Map(d.nodes.map(n=>[n.id,n]));
 const node=(e:{curveId:string;end:0|1})=>nodes.get(curves.get(e.curveId)!.nodes[e.end])!;
 d.joins=d.joins.filter(j=>status.get(j.a.curveId)!=='frozen'&&status.get(j.b.curveId)!=='frozen'&&node(j.a).id===node(j.b).id);
 // Linear cubic interpolation does not guarantee G1. Keep the authored lengths
 // and project onto the shared opposing axis in the evaluated copy only.
 for(const j of d.joins){if(j.mode!=='SMOOTH')continue;
  const a=curves.get(j.a.curveId)!,b=curves.get(j.b.curveId)!,p=node(j.a).position;
  const av=a.handles[j.a.end].map((x,i)=>x-p[i]),bv=b.handles[j.b.end].map((x,i)=>x-p[i]),la=Math.hypot(...av),lb=Math.hypot(...bv);
  if(la<1e-10||lb<1e-10)continue;
  const axis=av.map((x,i)=>x/la-bv[i]/lb),len=Math.hypot(...axis);if(len<1e-10)continue;
  a.handles[j.a.end]=axis.map((x,i)=>p[i]+x/len*la) as Point2;b.handles[j.b.end]=axis.map((x,i)=>p[i]-x/len*lb) as Point2;
 }
 d.endpointLinks=d.endpointLinks?.filter(l=>status.get(l.a.curveId)!=='frozen'&&status.get(l.b.curveId)!=='frozen');
 for(const l of d.endpointLinks??[]){const a=node(l.a),b=node(l.b);if(a.id===b.id)continue;
  const target:Point2=[(a.position[0]+b.position[0])/2,(a.position[1]+b.position[1])/2];
  for(const n of [a,b]){const delta=target.map((v,i)=>v-n.position[i]);for(const c of d.curves)for(const i of [0,1] as const)if(c.nodes[i]===n.id)c.handles[i]=c.handles[i].map((v,k)=>v+delta[k]) as Point2;n.position=[...target];}
 }
 const intervalIds=new Set<string>(),intervalsByField=new Map<ReturnType<typeof samples>,ReturnType<typeof blendPoseIntervals>>();
 for(const [id,e] of curveFields){
  if(!e.samples.some(s=>s.pose.drawing.displayIntervals?.some(t=>t.anchor.id===id)))continue;
  let tracks=intervalsByField.get(e);if(!tracks){tracks=e.samples.length===1?(e.samples[0].pose.drawing.displayIntervals??[]):blendPoseIntervals(d,e.samples.map(s=>({drawing:s.pose.drawing,weight:s.weight})));intervalsByField.set(e,tracks);}
  for(const track of tracks)if(track.anchor.id===id&&!intervalIds.has(track.id)){d.displayIntervals!.push(track);intervalIds.add(track.id);}
 }
 for(const kind of ['fills','offsets'] as const){
  const ids=[...new Set(priority.flatMap(p=>p.drawing[kind].map(o=>o.id)))];
  for(const id of ids){const e=samples(r,view,d=>d[kind].some(o=>o.id===id),atView),o={...strongest(e.samples).drawing[kind].find(o=>o.id===id)!};
   const refs='boundary' in o?o.boundary:o.source,frozen=e.status==='frozen'||refs.some(x=>status.get(x.id)==='frozen');
   status.set(id,frozen?'frozen':e.status);const alpha=weighted(e.samples,p=>p.drawing[kind].find(o=>o.id===id)!.visible?1:0);opacity.set(id,frozen?0:alpha);o.visible=alpha>1e-10&&!frozen;
   if(frozen&&alpha>1e-10){
    const source=strongest(e.samples),original=source.drawing[kind].find(x=>x.id===id)!;
    const geometry='boundary' in original?fillGeometry(source.drawing,original):offsetGeometry(source.drawing,original);
    if(!geometry.error)frozenPaints.push({id,shapes:geometry.shapes.map(s=>s.map(p=>[p[0]+source.offset[0],p[1]+source.offset[1]]) as Cubic)});
   }
   if('boundary' in o)d.fills.push(o);else d.offsets.push(o);
  }
 }
 // Organization does not affect paint; keep only groups whose members exist.
 d.groups=d.groups?.map(g=>({...g,curveIds:g.curveIds.filter(id=>curves.has(id))})).filter(g=>g.curveIds.length);
 const active=global.samples.filter(s=>s.weight>1e-8);
 if(active.length>1&&active.some(s=>s.pose.drawing.curves.some(c=>{const b=base.drawing.curves.find(x=>x.id===c.id);return b&&b.nodes.some((n,i)=>n!==c.nodes[i]);})))warnings.push('姿态的端点连接关系不同；当前采用较近姿态的连接关系。');
 return {drawing:d,status,opacity,frozen:d.curves.filter(c=>status.get(c.id)==='frozen'&&c.visible&&c.inkVisible!==false),frozenPaints,warnings,at:global.at};
}
