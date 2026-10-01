import {add,sub,mul,length,curveById,shapeOf,nodeAt,layerFor,groupFor,joinAt,members,uid,parseDrawing,emptyDrawing,finitePoint,validInkEnds,type InkEnds,type DrawingDocument as Doc,type DrawingCurve,type Cubic,type Point2,type Endpoint,type End,type TangentJoin,type StrokeDisplayIntervals as Track} from '../drawing/model';
import {displayField,displayPath,pathTracks,subtractInkSpans} from '../drawing/displayIntervals';
import type {DrawingSnapshotState} from '../drawing/snapshots';
import type {PoseRecording,RecordedPose} from './poses';
import {resolvedCurveInkEnds} from './poseInkEnds';

export interface InferenceConnection {end:End;other:Endpoint;mode?:TangentJoin['mode'];radius?:number}
export interface PoseInference {
 id:string;sourcePoseId:string;targetPoseId:string;layerId:string;curve:DrawingCurve;shape:Cubic;
 connections:InferenceConnection[];sourceOrder:string[];revealFrom:End;supportCount:number;
 /** Rendered source A/B ink, before any inferred gap. Missing only in V0.13.11 drafts. */
 sourceInkEnds?:InkEnds;
}
const findPose=(r:PoseRecording,id:string)=>{const p=r.poses.find(p=>p.id===id);if(!p)throw Error('录制姿态不存在。');return p;};
const withSourceInk=(r:PoseRecording,item:PoseInference):PoseInference=>item.sourceInkEnds?item:{...item,sourceInkEnds:resolvedCurveInkEnds(findPose(r,item.sourcePoseId).drawing,item.curve.id)};

/** Affine least squares in centered coordinates, with a similarity/translation
 * fallback for rank-deficient layers. No perspective denominators or new curves. */
export function layerTrend(source:Doc,target:Doc,layerId:string){
 const layer=source.layers.find(l=>l.id===layerId),destination=target.layers.find(l=>l.id===layerId);
 if(!layer||!destination)throw Error('目标姿态缺少对应图层。');
 const ids=layer.items.filter(id=>curveById(source,id)&&curveById(target,id)&&destination.items.includes(id));
 if(!ids.length)throw Error('同图层没有共同曲线，无法推断位置。');
 const pairs=ids.flatMap(id=>shapeOf(source,id).map((p,i)=>({p,q:shapeOf(target,id)[i]})));
 const mean=(key:'p'|'q'):Point2=>[0,1].map(i=>pairs.reduce((n,x)=>n+x[key][i],0)/pairs.length) as Point2;
 const a=mean('p'),b=mean('q');let xx=0,xy=0,yy=0,xu=0,xv=0,yu=0,yv=0;
 for(const {p,q} of pairs){const [x,y]=sub(p,a),[u,v]=sub(q,b);xx+=x*x;xy+=x*y;yy+=y*y;xu+=x*u;xv+=x*v;yu+=y*u;yv+=y*v;}
 const det=xx*yy-xy*xy,total=xx+yy;
 let matrix:number[];
 if(det>1e-8*total*total)matrix=[(xu*yy-yu*xy)/det,(yu*xx-xu*xy)/det,(xv*yy-yv*xy)/det,(yv*xx-xv*xy)/det];
 else {const c=total>1e-12?(xu+yv)/total:1,s=total>1e-12?(xv-yu)/total:0;matrix=[c,-s,s,c];}
 // Strongly ill-conditioned authoring data should yield a modest initial guess.
 if(!matrix.every(Number.isFinite)||Math.hypot(...matrix)>8)matrix=[1,0,0,1];
 const map=(p:Point2):Point2=>{const [x,y]=sub(p,a);return add(b,[matrix[0]*x+matrix[1]*y,matrix[2]*x+matrix[3]*y]);};
 return {map,supportCount:ids.length};
}

export function inferPoseCurves(r:PoseRecording,curveId:string,sourcePoseId:string,targetPoseIds:string[],revealFrom?:End):PoseRecording{
 const source=findPose(r,sourcePoseId),c=curveById(source.drawing,curveId),layer=c&&layerFor(source.drawing,curveId);
 if(!c||!layer)throw Error('源姿态中没有这条曲线。');
 if(!targetPoseIds.length)throw Error('请选择至少一个目标姿态。');
 const from=revealFrom??r.inferences?.find(i=>i.curve.id===curveId)?.revealFrom??(Math.random()<.5?0:1);
 const drafts=[...(r.inferences??[])];
 for(const targetPoseId of new Set(targetPoseIds)){
  const target=findPose(r,targetPoseId);
  if(curveById(target.drawing,curveId)||drafts.some(i=>i.curve.id===curveId&&i.targetPoseId===targetPoseId))throw Error('目标姿态已有该曲线或推断草稿。');
  const fit=layerTrend(source.drawing,target.drawing,layer.id),shape=shapeOf(source.drawing,curveId).map(fit.map) as Cubic;
  const connections:InferenceConnection[]=[];
  for(const end of [0,1] as const){
   const j=joinAt(source.drawing,{curveId,end}),others=members(source.drawing,c.nodes[end]).filter(e=>e.curveId!==curveId);
   const other=others.find(e=>curveById(target.drawing,e.curveId)&&layerFor(target.drawing,e.curveId)?.id===layer.id);
   if(!other)continue;
   const p=nodeAt(target.drawing,other).position,delta=sub(p,shape[end?3:0]);shape[end?3:0]=[...p];shape[end?2:1]=add(shape[end?2:1],delta);
   const joined=j&&(j.a.curveId===other.curveId||j.b.curveId===other.curveId);
   connections.push({end,other:{...other},...(joined?{mode:j.mode,...(j.radius!==undefined?{radius:j.radius}:{})}:{})});
  }
  const item:PoseInference={id:uid(),sourcePoseId,targetPoseId,layerId:layer.id,curve:structuredClone(c),shape,connections,sourceOrder:[...layer.items],revealFrom:from,supportCount:fit.supportCount,sourceInkEnds:resolvedCurveInkEnds(source.drawing,curveId)};
  // Validate the exact patch now so generation is all-or-nothing across targets.
  parseDrawing(insertInferredCurve(target.drawing,item));drafts.push(item);
 }
 return {...r,inferences:drafts};
}

/** Convert masks on joining paths to local curve scopes before changing path
 * membership. Existing visible segments keep their own arc-length locations. */
function preserveJoinedIntervals(d:Doc,connections:InferenceConnection[]):Doc{
 const paths=new Map<string,ReturnType<typeof displayPath>>();
 for(const x of connections){if(!curveById(d,x.other.curveId))continue;const p=displayPath(d,x.other.curveId);paths.set(p.segments.map(s=>s.id).sort().join('|'),p);}
 let tracks=[...(d.displayIntervals??[])];
 for(const path of paths.values()){
  const original=pathTracks(d,path).filter(t=>!t.scope);if(!original.length)continue;
  // Only canonicalize path-scoped tracks; existing per-curve tracks stay intact.
  const field=displayField({...d,displayIntervals:original},path),ids=new Set(original.map(t=>t.id));tracks=tracks.filter(t=>!ids.has(t.id));
  if(!field.total)continue;
  if(field.geometry.pieces.some(p=>p.joinId))throw Error('目标连接笔画同时含圆弧和显示区间，请先在绘制间整理连接。');
  for(const use of path.segments){
   const track:Track={id:`infer-preserve:${original[0].id}:${use.id}`,scope:'CURVE',anchor:{...use},ranges:[]};
   const lo=field.native(track,0),hi=field.native(track,1),size=hi-lo;if(size<1e-12)continue;
   const gaps=subtractInkSpans([{start:lo,end:hi,ends:[{},{}]}],field.inkSpans??[]);
   if(!gaps.length)continue;
   track.ranges=gaps.map((g,i)=>({id:`${track.id}:${i}`,mode:'HIDE',start:(g.start-lo)/size,end:(g.end-lo)/size,inkEnds:g.ends}));tracks.push(track);
  }
 }
 return {...d,displayIntervals:tracks};
}

export function insertInferredCurve(d:Doc,item:PoseInference):Doc{
 const id=item.curve.id;if(curveById(d,id))throw Error('目标姿态已有该曲线，请先删除推断草稿。');
 const layer=d.layers.find(l=>l.id===item.layerId);if(!layer)throw Error('目标姿态缺少对应图层。');
 const connections=item.connections.filter(x=>curveById(d,x.other.curveId)&&layerFor(d,x.other.curveId)?.id===layer.id);
 const groups=new Set(connections.map(x=>groupFor(d,x.other.curveId)?.id));
 if(groups.size>1)throw Error('连接端点分属不同组合，请先在绘制间整理组合。');
 const n=preserveJoinedIntervals(d,connections),shape=item.shape.map(p=>[...p]) as Cubic,c={...structuredClone(item.curve),nodes:[`inferred:${id}:0`,`inferred:${id}:1`] as [string,string],handles:[shape[1],shape[2]] as [Point2,Point2]},joins=[...n.joins];
 for(const x of connections){
  const other=curveById(d,x.other.curveId),p=nodeAt(d,x.other).position,delta=sub(p,shape[x.end?3:0]);
  c.nodes[x.end]=other.nodes[x.other.end];c.handles[x.end]=add(c.handles[x.end],delta);shape[x.end?3:0]=[...p];
  if(x.mode&&!joinAt(d,x.other)&&c.width===other.width&&(c.profile??'UNIFORM')===(other.profile??'UNIFORM')&&!!c.profileReverse===!!other.profileReverse){
   if(x.mode==='SMOOTH'){const v=sub(other.handles[x.other.end],p),len=length(v);if(len<1e-10)continue;c.handles[x.end]=add(p,mul(v,-length(sub(c.handles[x.end],p))/len));}
   if(x.mode==='ARC'&&(!length(sub(c.handles[x.end],p))||!length(sub(other.handles[x.other.end],p))))continue;
   joins.push({id:`inferred-join:${id}:${x.end}`,a:{curveId:id,end:x.end},b:{...x.other},mode:x.mode,...(x.radius!==undefined?{radius:x.radius}:{})});
  }
 }
 const nodes=[...n.nodes];for(const end of [0,1] as const)if(!nodes.some(p=>p.id===c.nodes[end]))nodes.push({id:c.nodes[end],position:shape[end?3:0]});
 const items=[...layer.items],sourceIndex=item.sourceOrder.indexOf(id),next=item.sourceOrder.slice(sourceIndex+1).find(x=>items.includes(x)),previous=item.sourceOrder.slice(0,sourceIndex).reverse().find(x=>items.includes(x));
 items.splice(next?items.indexOf(next):previous?items.indexOf(previous)+1:items.length,0,id);
 const ink=item.sourceInkEnds??[{taper:0,extension:0},{taper:0,extension:0}];
 // HIDE's lower edge ends the surviving left run (source B); its upper edge
 // starts the surviving right run (source A). These are not fresh pen defaults.
 const track:Track={id:`inferred-ink:${id}`,scope:'CURVE',inferenceInkVersion:1,revealFrom:item.revealFrom,anchor:{id,reverse:false},ranges:[{id:`inferred-gap:${id}`,mode:'HIDE',start:0,end:1,inkEnds:[{...ink[1]},{...ink[0]}]}]};
 const groupId=[...groups][0];
 return {...n,curves:[...n.curves,c],nodes,joins,layers:n.layers.map(l=>l.id===layer.id?{...l,items}:l),groups:n.groups?.map(g=>g.id===groupId?{...g,curveIds:[...g.curveIds,id]}:g),displayIntervals:[...(n.displayIntervals??[]),track]};
}

const resolved=new WeakMap<PoseRecording,PoseRecording>();
/** Overlay pending edits after snapshot synchronization; never bake them into
 * the authoritative recording copies or they would be lost on the next sync. */
export function resolvePoseInferences(r:PoseRecording):PoseRecording{
 if(!r.inferences?.length)return r;const hit=resolved.get(r);if(hit)return hit;
 const poses=r.poses.map(p=>{let drawing=p.drawing;for(const item of r.inferences!)if(item.targetPoseId===p.id&&!curveById(drawing,item.curve.id)){
  try{drawing=insertInferredCurve(drawing,withSourceInk(r,item));}catch{/* Conflicting drafts remain editable/discardable; source stays usable. */}
 }return drawing===p.drawing?p:{...p,drawing};});
 const result={...r,poses};resolved.set(r,result);return result;
}
export function inferenceProblem(r:PoseRecording,item:PoseInference):string|undefined{
 try{const p=findPose(r,item.targetPoseId);insertInferredCurve(p.drawing,withSourceInk(r,item));}catch(e){return (e as Error).message;}return undefined;
}
export function discardPoseInference(r:PoseRecording,id:string){return {...r,inferences:r.inferences?.filter(i=>i.id!==id)};}
export function deletePose(r:PoseRecording,id:string){return {...r,poses:r.poses.filter(p=>p.id!==id),inferences:r.inferences?.filter(i=>i.sourcePoseId!==id&&i.targetPoseId!==id)};}

export function applyPoseInference<T extends DrawingSnapshotState&{poseRecording?:PoseRecording}>(state:T,id:string):T{
 const r=state.poseRecording,draft=r?.inferences?.find(i=>i.id===id);if(!r||!draft)throw Error('推断草稿不存在。');const item=withSourceInk(r,draft);
 const pose=findPose(r,item.targetPoseId),library=state.drawingSnapshots,snapshot=library?.items.find(s=>s.id===pose.sourceSnapshotId);
 if(!library||!snapshot)throw Error('目标绘制快照已删除，无法应用。');
 const drawing=parseDrawing(insertInferredCurve(snapshot.drawing,item));
 // Patch the active drawing too, without replacing any unrelated unsaved work.
 const current=library.activeId===snapshot.id&&state.drawing?parseDrawing(insertInferredCurve(state.drawing,item)):state.drawing;
 return {...state,drawing:current,drawingSnapshots:{...library,items:library.items.map(s=>s.id===snapshot.id?{...s,drawing}:s)},poseRecording:discardPoseInference(r,id)};
}

export function parsePoseInferences(value:unknown,poses:RecordedPose[]):PoseInference[]{
 if(!Array.isArray(value))throw Error('姿态推断草稿无效。');const ids=new Set<string>(),targets=new Set<string>();
 return value.map((item:PoseInference)=>{
  const bad=()=>{throw Error('姿态推断草稿无效。');};
  if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id)||!poses.some(p=>p.id===item.sourcePoseId)||!poses.some(p=>p.id===item.targetPoseId)||item.sourcePoseId===item.targetPoseId||typeof item.layerId!=='string'||!item.layerId||!Array.isArray(item.shape)||item.shape.length!==4||!item.shape.every(finitePoint)||![0,1].includes(item.revealFrom)||!Number.isSafeInteger(item.supportCount)||item.supportCount<1||!Array.isArray(item.sourceOrder)||!item.sourceOrder.every(x=>typeof x==='string')||!Array.isArray(item.connections))return bad();
  ids.add(item.id);const key=`${item.targetPoseId}:${item.curve?.id}`;if(targets.has(key))return bad();targets.add(key);
  const ends=new Set<number>();for(const c of item.connections){if(!c||![0,1].includes(c.end)||ends.has(c.end)||!c.other||typeof c.other.curveId!=='string'||![0,1].includes(c.other.end)||c.mode!==undefined&&!['SMOOTH','CUSP','ARC'].includes(c.mode)||c.mode==='ARC'&&(!Number.isFinite(c.radius)||c.radius!<=0||c.radius!>2))return bad();ends.add(c.end);}
  const doc={...emptyDrawing(),layers:[{id:'validation-layer',name:'Validation',items:[item.curve.id],visible:true,locked:false}],curves:[{...item.curve,nodes:['validation-a','validation-b'] as [string,string]}],nodes:[{id:'validation-a',position:item.shape[0]},{id:'validation-b',position:item.shape[3]}]};parseDrawing(doc);
  if(!validInkEnds(item.sourceInkEnds))return bad();
  return structuredClone(withSourceInk({version:1,poses},item));
 });
}

/** Only upgrade the identifiable, unedited V0.13.11 generated ink defaults.
 * Range locations and explicit custom styles remain author-owned. */
export function upgradeAppliedInferenceInk<T extends DrawingSnapshotState&{poseRecording?:PoseRecording}>(state:T):T{
 const sources=[...(state.poseRecording?.poses.map(p=>p.drawing)??[]),...(state.drawingSnapshots?.items.map(s=>s.drawing)??[])],cache=new Map<Doc,Doc>();
 const upgrade=(d:Doc):Doc=>{
  const hit=cache.get(d);if(hit)return hit;let changed=false;
  const displayIntervals=d.displayIntervals?.map(track=>{
   const id=track.anchor.id;
   if(track.inferenceInkVersion!==undefined||track.id!==`inferred-ink:${id}`||track.scope!=='CURVE'||track.revealFrom===undefined)return track;
   changed=true;
   const legacy=(e:InkEnds[number])=>e.taperWidthScale===20&&Object.keys(e).length===1;
   const ranges=track.ranges.map(r=>{
    if(r.id!==`inferred-gap:${id}`||r.mode!=='HIDE'||!r.inkEnds?.every(legacy))return r;
    const source=sources.find(s=>curveById(s,id)&&!s.displayIntervals?.some(t=>t.id===track.id)&&JSON.stringify(curveById(s,id).inkEnds)===JSON.stringify(curveById(d,id).inkEnds));
    const ends=resolvedCurveInkEnds(source??{...d,displayIntervals:d.displayIntervals?.filter(t=>t!==track)},id);
    const forward:InkEnds=[{...ends[1]},{...ends[0]}],reverse=track.anchor.reverse!==(r.start>r.end);
    return {...r,inkEnds:reverse?[forward[1],forward[0]] as InkEnds:forward};
   });
   return {...track,inferenceInkVersion:1 as const,ranges};
  });
  const out=changed?{...d,displayIntervals}:d;cache.set(d,out);return out;
 };
 return {...state,...(state.drawing?{drawing:upgrade(state.drawing)}:{}),...(state.drawingSnapshots?{drawingSnapshots:{...state.drawingSnapshots,items:state.drawingSnapshots.items.map(s=>({...s,drawing:upgrade(s.drawing)}))}}:{}),...(state.poseRecording?{poseRecording:{...state.poseRecording,poses:state.poseRecording.poses.map(p=>({...p,drawing:upgrade(p.drawing)}))}}:{})};
}
