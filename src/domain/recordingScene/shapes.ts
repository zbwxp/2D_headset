import {add,sub,mul,length,finitePoint,nodeAt,curveById,shapeOf,type DrawingDocument,type Endpoint,type Point2,type Cubic} from '../drawing/model';
import {moveNode,moveHandle} from '../drawing/commands';
import {linkedNodeIds} from '../drawing/endpointLinks';
import {transportDeformedIntervals} from '../drawing/deform';
import {displayPath} from '../drawing/displayIntervals';
import {intervalPinch,withIntervalPinch} from '../drawing/intervalPinch';
import type {DeformedDrawing} from '../vectorWarp/evaluation';
import {instanceObjectId,identitySceneShape,type RecordingScene,type SceneSourceResolver,type SceneShapeValue,type SceneSourceObject,type SceneDiagnostic,type Angle} from './model';
import {evaluateShapeTrack} from './tracks';
import {evaluateScene} from './evaluation';

const zero=():Point2=>[0,0];
const offset=(value:SceneShapeValue,id:string):Point2=>Object.hasOwn(value.nodes,id)?value.nodes[id]:zero();
const handles=(value:SceneShapeValue,id:string):[Point2,Point2]=>Object.hasOwn(value.handles,id)?value.handles[id]:[zero(),zero()];
const nonzero=(p:Point2)=>p[0]!==0||p[1]!==0;
const endpointKey=(e:Endpoint)=>JSON.stringify([e.curveId,e.end]);
type SmoothComponent={ends:Map<string,{endpoint:Endpoint;sign:number}>;driver:Endpoint;conflict:boolean};
/** A stable authority and alternating directions retain G1 between angle keys.
 * The graph includes Drawing joins and cross-layer SMOOTH display links. */
function smoothComponents(d:DrawingDocument):SmoothComponent[]{
 const pairs=[...d.joins.filter(j=>j.mode==='SMOOTH'),...(d.endpointLinks??[]).filter(l=>l.joinBrush?.kind==='SMOOTH')].sort((a,b)=>a.id.localeCompare(b.id));
 const graph=new Map<string,Endpoint[]>();for(const pair of pairs)for(const [a,b] of [[pair.a,pair.b],[pair.b,pair.a]]){const key=endpointKey(a);graph.set(key,[...(graph.get(key)??[]),b]);}
 const done=new Set<string>(),result:SmoothComponent[]=[];
 for(const pair of pairs){const start=endpointKey(pair.a);if(done.has(start))continue;const ends=new Map([[start,{endpoint:pair.a,sign:1}]]),queue=[pair.a];let conflict=false;
  for(const current of queue){const key=endpointKey(current),sign=ends.get(key)!.sign;done.add(key);for(const next of graph.get(key)??[]){const other=endpointKey(next),known=ends.get(other);if(known){if(known.sign!==-sign)conflict=true;}else{ends.set(other,{endpoint:next,sign:-sign});queue.push(next);}}}
  result.push({ends,driver:pair.a,conflict});
 }return result;
}
function projectSmooth(d:DrawingDocument,component:SmoothComponent,driver=component.driver,authoring=false):void {
 if(component.conflict)throw Error('SMOOTH links request conflicting handle directions.');
 const vector=sub(curveById(d,driver.curveId).handles[driver.end],nodeAt(d,driver).position),size=length(vector),driverSign=component.ends.get(endpointKey(driver))!.sign;
 if(size<1e-7)throw Error('A SMOOTH handle cannot collapse to zero.');
 for(const {endpoint,sign} of component.ends.values()){
  const curve=curveById(d,endpoint.curveId),node=nodeAt(d,endpoint).position,old=curve.handles[endpoint.end],extent=length(sub(old,node));
  if(extent<1e-7)throw Error('A SMOOTH handle cannot collapse to zero.');
  const position=add(node,mul(vector,extent/size*sign/driverSign));
  if(authoring&&curve.locked&&length(sub(old,position))>1e-12)throw Error('关联对象已锁定，无法修改。');
 }
 for(const {endpoint,sign} of component.ends.values()){const curve=curveById(d,endpoint.curveId),node=nodeAt(d,endpoint).position,extent=length(sub(curve.handles[endpoint.end],node));curve.handles[endpoint.end]=add(node,mul(vector,extent/size*sign/driverSign));}
}
const cubicAt=(shape:Cubic,t:number):Point2=>{const u=1-t,weights=[u*u*u,3*u*u*t,3*u*t*t,t*t*t];return shape.reduce<Point2>((p,q,i)=>add(p,mul(q,weights[i])),[0,0]);};

/** Apply all instance channels coherently to one transient, post-Warp document.
 * No authoring commands run here: locks never disable an already-authored pose. */
export function applySceneShapes(result:DeformedDrawing,scene:RecordingScene,angle:Angle,useDraft:boolean,provenance:Record<string,SceneSourceObject>,diagnostics:SceneDiagnostic[]):DeformedDrawing {
 if(!scene.shapeTracks?.length)return result;
 const values=new Map(scene.shapeTracks.map(t=>[t.instanceId,{track:t,value:evaluateShapeTrack(t,angle,useDraft)}])),before=result.drawing;
 const nodes=new Map(before.nodes.map(n=>[n.id,n])),curves=new Map(before.curves.map(c=>[c.id,c]));
 for(const [instanceId,{track,value}] of values){
  for(const id of Object.keys(value.nodes))if(!nodes.has(instanceObjectId(instanceId,id)))diagnostics.push({code:'SHAPE',instanceId,trackId:track.id,sourceObjectId:id,message:'The shape node is missing or outside this instance; its offset is retained.'});
  for(const id of Object.keys(value.handles))if(!curves.has(instanceObjectId(instanceId,id)))diagnostics.push({code:'SHAPE',instanceId,trackId:track.id,sourceObjectId:id,message:'The shape curve is missing or outside this instance; its handle offsets are retained.'});
 }
 const deltas=new Map<string,Point2>(),visited=new Set<string>();
 for(const node of before.nodes){if(visited.has(node.id))continue;const component=[...linkedNodeIds(before,node.id)].sort();component.forEach(id=>visited.add(id));
  const requested=component.map(id=>{const p=provenance[id],v=p&&values.get(p.instanceId)?.value;return v?offset(v,p.sourceId):zero();}),first=requested[0];
  if(requested.some(p=>length(sub(first,p))>1e-8)){const p=provenance[node.id];diagnostics.push({code:'SHAPE',instanceId:p?.instanceId,sourceObjectId:p?.sourceId,message:'Linked endpoint shape offsets conflict; this linked component keeps its Warp positions.'});component.forEach(id=>deltas.set(id,zero()));}
  else component.forEach(id=>deltas.set(id,first));
 }
 const changedHandles=new Set<string>();
 const drawing:DrawingDocument={...before,nodes:before.nodes.map(n=>({...n,position:add(n.position,deltas.get(n.id)??zero())})),curves:before.curves.map(c=>{const p=provenance[c.id],value=p&&values.get(p.instanceId)?.value,delta=value?handles(value,p.sourceId):[zero(),zero()];return {...c,handles:([0,1] as const).map(end=>{if(nonzero(delta[end]))changedHandles.add(endpointKey({curveId:c.id,end}));return add(add(c.handles[end],deltas.get(c.nodes[end])??zero()),delta[end]);}) as [Point2,Point2]};})};
 const changed=drawing.nodes.some(n=>nonzero(deltas.get(n.id)??zero()))||changedHandles.size>0;if(!changed)return result;
 for(const component of smoothComponents(drawing))if([...component.ends.keys()].some(id=>changedHandles.has(id)))try{projectSmooth(drawing,component);}catch(error){const p=provenance[component.driver.curveId];diagnostics.push({code:'SHAPE',instanceId:p?.instanceId,sourceObjectId:p?.sourceId,message:error instanceof Error?error.message:String(error)});}
 const intervalTransportErrors=[...result.intervalTransportErrors];
 if(before.displayIntervals?.length){
  drawing.displayIntervals=before.displayIntervals.map(track=>{
   try{const next=transportDeformedIntervals({...before,displayIntervals:[track]},drawing).displayIntervals![0],strengths=new Map(track.ranges.map(r=>[r.id,intervalPinch(r)]));return {...structuredClone(next),ranges:next.ranges.map(r=>withIntervalPinch({...r},strengths.get(r.id)??0))};}
   catch(error){let sourceCurveIds=[track.anchor.id];try{sourceCurveIds=displayPath(before,track.anchor.id).segments.map(s=>s.id);}catch{/* Keep the anchor as local diagnostic context. */}const message=error instanceof Error?error.message:String(error),p=provenance[track.id];intervalTransportErrors.push({trackId:track.id,sourceCurveIds,message});diagnostics.push({code:'SHAPE',instanceId:p?.instanceId,trackId:p?.sourceId,message:`Shape material transport: ${message}`});return structuredClone(track);}
  });
 }
 // Shape is an intentional cubic correction to BOTH the fitted cubic and its
 // reference target. It shifts diagnostic locations, never inflates fit error.
 const fit=result.diagnostics.map(d=>{const curveId=d.sourceCurveId!;if(!curves.has(curveId))return d;const old=shapeOf(before,curveId),cubic=shapeOf(drawing,curveId),delta=cubic.map((p,i)=>sub(p,old[i])) as Cubic,shift=cubicAt(delta,d.peakT);return {...d,cubic,peakExpected:add(d.peakExpected,shift),peakActual:add(d.peakActual,shift)};});
 return {...result,drawing,diagnostics:fit,intervalTransportErrors};
}

export interface SceneShapeEdit {instanceId:string;kind:'node'|'handle';nodeId?:string;curveId?:string;end?:0|1;/** Unplaced, post-Warp coordinates. */position:Point2}
/** Drawing's move semantics act on the current evaluated pose. The result is
 * diffed against today's Warp baseline, retaining absent-source authored IDs. */
export function deriveSceneShapeEdit(scene:RecordingScene,resolve:SceneSourceResolver,edit:SceneShapeEdit):SceneShapeValue {
 if(!scene.instances.some(i=>i.id===edit.instanceId))throw Error('Missing scene instance');if(!finitePoint(edit.position))throw Error('Shape position must be finite.');
 const evaluated=evaluateScene(scene,resolve,{omitPlacements:true,diagnostics:'preview'}),base=evaluated.preShapeDrawing,current=evaluated.drawing;
 let next:DrawingDocument;
 if(edit.kind==='node'){
  const id=edit.nodeId&&instanceObjectId(edit.instanceId,edit.nodeId);if(!id||!current.nodes.some(n=>n.id===id))throw Error('The source shape node is missing from this instance.');next=moveNode(current,id,edit.position,true);
 }else{
  const id=edit.curveId&&instanceObjectId(edit.instanceId,edit.curveId);if(!id||!current.curves.some(c=>c.id===id)||edit.end!==0&&edit.end!==1)throw Error('The source shape handle is missing from this instance.');const endpoint={curveId:id,end:edit.end};
  next=moveHandle(current,endpoint,edit.position,true);
  const component=smoothComponents(next).find(c=>c.ends.has(endpointKey(endpoint)));if(component){next=structuredClone(next);projectSmooth(next,component,endpoint,true);}
 }
 const track=scene.shapeTracks?.find(t=>t.instanceId===edit.instanceId),prior=track?evaluateShapeTrack(track,scene.angle):identitySceneShape();
 const nodes=Object.fromEntries(Object.entries(prior.nodes)),handles=Object.fromEntries(Object.entries(prior.handles));
 const baseNodes=new Map(base.nodes.map(n=>[n.id,n.position])),baseCurves=new Map(base.curves.map(c=>[c.id,c])),currentNodes=new Map(current.nodes.map(n=>[n.id,n.position]));
 const clean=(p:Point2):Point2=>p.map(n=>Math.abs(n)<1e-12?0:n) as Point2;
 for(const node of next.nodes){const p=evaluated.provenance[node.id];if(p?.instanceId!==edit.instanceId||length(sub(node.position,currentNodes.get(node.id)!))<1e-12)continue;const delta=clean(sub(node.position,baseNodes.get(node.id)!));if(nonzero(delta))Object.defineProperty(nodes,p.sourceId,{value:delta,enumerable:true,writable:true,configurable:true});else delete nodes[p.sourceId];}
 for(const curve of next.curves){const p=evaluated.provenance[curve.id];if(p?.instanceId!==edit.instanceId)continue;const old=baseCurves.get(curve.id)!,now=curveById(current,curve.id),priorDelta=Object.hasOwn(handles,p.sourceId)?handles[p.sourceId]:[zero(),zero()];let changed=false;
  const delta=([0,1] as const).map(end=>{const vector=sub(curve.handles[end],nodeAt(next,{curveId:curve.id,end}).position),currentVector=sub(now.handles[end],currentNodes.get(now.nodes[end])!);if(length(sub(vector,currentVector))<1e-12)return priorDelta[end];changed=true;return clean(sub(vector,sub(old.handles[end],baseNodes.get(old.nodes[end])!)));}) as [Point2,Point2];
  if(changed){if(delta.some(nonzero))Object.defineProperty(handles,p.sourceId,{value:delta,enumerable:true,writable:true,configurable:true});else delete handles[p.sourceId];}
 }
 return {nodes,handles};
}
