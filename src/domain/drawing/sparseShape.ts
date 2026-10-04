import {add,sub,length,type DrawingDocument,type Endpoint,type Point2} from './model';
import {drawingSmoothComponents,projectDrawingSmoothComponent} from './smoothHandleAuthoring';
import type {SceneShapeValue} from '../recordingScene/model';

const endpointKey=(e:Endpoint)=>JSON.stringify([e.curveId,e.end]);
const zero=():Point2=>[0,0];
const offset=(value:SceneShapeValue,id:string):Point2=>Object.hasOwn(value.nodes,id)?value.nodes[id]:zero();
const handles=(value:SceneShapeValue,id:string):[Point2,Point2]=>Object.hasOwn(value.handles,id)?value.handles[id]:[zero(),zero()];
const nonzero=(p:Point2)=>p[0]!==0||p[1]!==0;
const equal=(a:Point2,b:Point2)=>Object.is(a[0],b[0])&&Object.is(a[1],b[1]);
const ends=[0,1] as const;

export interface DrawingShapeIssue {targetId?:string;message:string}
export interface DrawingShapeApplication {
 drawing:DrawingDocument;
 changed:boolean;
 issues:DrawingShapeIssue[];
 /** JSON [curveId,end] keys for explicitly nonzero handle offsets. */
 changedHandles:Set<string>;
}
/** Complete changed sparse controls from an immutable writer, never selection. */
export type DrawingShapeControl={kind:'node';nodeId:string}|{kind:'handle';curveId:string;end:0|1};
export interface DrawingShapeChanges {structureUnchanged:true;controls:readonly DrawingShapeControl[]}
export interface DrawingShapeEvaluationOptions {
 /** Caller owns this source and result and will never mutate either. */
 retainRevision?:boolean;
 previous?:DrawingShapeApplication;
 changes?:DrawingShapeChanges;
}
export interface DrawingShapeRevision {readonly previous:DrawingShapeApplication;readonly dirtyCurveIds:readonly string[]}
const revisions=new WeakMap<DrawingShapeApplication,DrawingShapeRevision>();
export const drawingShapeRevision=(result:DrawingShapeApplication)=>revisions.get(result);
const work={plans:0,fullApplications:0,revisionApplications:0,nodeComponents:0,nodeControls:0,handleControls:0,projectedComponents:0,copiedControlSlots:0};
export const drawingShapeWorkStats=()=>({...work});
export function resetDrawingShapeWorkStats():void {for(const key of Object.keys(work) as (keyof typeof work)[])work[key]=0;}

type SmoothComponent=ReturnType<typeof drawingSmoothComponents>[number];
interface ShapePlan {
 before:DrawingDocument;
 stamp:readonly unknown[];
 nodeSlots:Map<string,number>;
 curveSlots:Map<string,number>;
 nodeComponents:Map<string,number>;
 components:{ids:string[];targetId:string}[];
 nodeEnds:Map<string,Endpoint[]>;
 smooth:SmoothComponent[];
 smoothAtEnd:Map<string,number>;
}
interface ShapeProduct {
 plan:ShapePlan;
 raw:DrawingDocument;
 deltas:Point2[];
 activeComponents:number;
 linkIssues:(DrawingShapeIssue|undefined)[];
 smoothIssues:(DrawingShapeIssue|undefined)[];
}
const products=new WeakMap<DrawingShapeApplication,ShapeProduct>();
const sourceStamp=(d:DrawingDocument):readonly unknown[]=>[d.nodes,d.curves,d.joins,d.endpointLinks,d.layers,d.fills,d.offsets,d.groups,d.displayIntervals,d.reference,d.mirrorEditing,d.mirrorAxisX];
function prepare(before:DrawingDocument):ShapePlan {
 work.plans++;
 const nodeSlots=new Map(before.nodes.map((n,i)=>[n.id,i])),curveSlots=new Map(before.curves.map((c,i)=>[c.id,i])),adjacent=new Map<string,string[]>(),nodeEnds=new Map<string,Endpoint[]>();
 for(const curve of before.curves)for(const end of ends){const id=curve.nodes[end],values=nodeEnds.get(id)??[];values.push({curveId:curve.id,end});nodeEnds.set(id,values);}
 for(const link of before.endpointLinks??[]){const a=before.curves[curveSlots.get(link.a.curveId)!].nodes[link.a.end],b=before.curves[curveSlots.get(link.b.curveId)!].nodes[link.b.end];adjacent.set(a,[...adjacent.get(a)??[],b]);adjacent.set(b,[...adjacent.get(b)??[],a]);}
 const components:ShapePlan['components']=[],nodeComponents=new Map<string,number>();
 for(const node of before.nodes){
  if(nodeComponents.has(node.id))continue;
  const ids=[node.id],seen=new Set(ids);for(const id of ids)for(const next of adjacent.get(id)??[])if(!seen.has(next)){seen.add(next);ids.push(next);}
  ids.sort();const index=components.length;components.push({ids,targetId:node.id});for(const id of ids)nodeComponents.set(id,index);
 }
 const smooth=drawingSmoothComponents(before),smoothAtEnd=new Map<string,number>();smooth.forEach((component,index)=>{for(const key of component.ends.keys())smoothAtEnd.set(key,index);});
 return {before,stamp:sourceStamp(before),nodeSlots,curveSlots,nodeComponents,components,nodeEnds,smooth,smoothAtEnd};
}
function componentDelta(plan:ShapePlan,index:number,value:SceneShapeValue):{delta:Point2;issue?:DrawingShapeIssue} {
 work.nodeComponents++;const {ids,targetId}=plan.components[index],requested=ids.map(id=>offset(value,id)),first=requested[0];work.nodeControls+=ids.length;
 return requested.some(p=>length(sub(first,p))>1e-8)?{delta:zero(),issue:{targetId,message:'Linked endpoint shape offsets conflict; this linked component keeps its Warp positions.'}}:{delta:first};
}
/** Both cold and revised products use these exact scalar-first offset operations. */
function shapeHandle(plan:ShapePlan,deltas:readonly Point2[],value:SceneShapeValue,id:string,end:0|1):Point2 {
 work.handleControls++;const curve=plan.before.curves[plan.curveSlots.get(id)!];
 return add(add(curve.handles[end],deltas[plan.nodeComponents.get(curve.nodes[end])!]??zero()),handles(value,id)[end]);
}
/** Project the existing Drawing kernel on only its complete component. Its node
 * and curve objects are the actual owned output objects; no alternate math. */
function project(plan:ShapePlan,drawing:DrawingDocument,index:number):DrawingShapeIssue|undefined {
 work.projectedComponents++;const component=plan.smooth[index],curveIds=new Set([...component.ends.values()].map(({endpoint})=>endpoint.curveId)),curves=[...curveIds].map(id=>drawing.curves[plan.curveSlots.get(id)!]),nodeIds=new Set(curves.flatMap(curve=>curve.nodes));
 const local={...drawing,curves,nodes:[...nodeIds].map(id=>drawing.nodes[plan.nodeSlots.get(id)!])};
 try{projectDrawingSmoothComponent(local,component);}catch(error){return {targetId:component.driver.curveId,message:error instanceof Error?error.message:String(error)};}
}
function issuesFor(plan:ShapePlan,value:SceneShapeValue,links:ShapeProduct['linkIssues'],smooth:ShapeProduct['smoothIssues']):DrawingShapeIssue[] {
 const issues:DrawingShapeIssue[]=[];
 for(const id of Object.keys(value.nodes))if(!plan.nodeSlots.has(id))issues.push({targetId:id,message:'The shape node is missing; its offset is retained.'});
 for(const id of Object.keys(value.handles))if(!plan.curveSlots.has(id))issues.push({targetId:id,message:'The shape curve is missing; its handle offsets are retained.'});
 for(const issue of links)if(issue)issues.push(issue);for(const issue of smooth)if(issue)issues.push(issue);return issues;
}
function retain(result:DrawingShapeApplication,product:ShapeProduct,options:DrawingShapeEvaluationOptions):DrawingShapeApplication {
 if(options.retainRevision&&product.plan.nodeSlots.size===product.plan.before.nodes.length&&product.plan.curveSlots.size===product.plan.before.curves.length)products.set(result,product);return result;
}
function revise(before:DrawingDocument,value:SceneShapeValue,options:DrawingShapeEvaluationOptions):DrawingShapeApplication|undefined {
 const previous=options.previous,changes=options.changes,prior=previous&&products.get(previous);
 if(!prior||!previous||!changes?.structureUnchanged||prior.plan.before!==before||!sourceStamp(before).every((entry,index)=>entry===prior.plan.stamp[index]))return undefined;
 const plan=prior.plan,dirtyComponents=new Set<number>(),dirtyEnds=new Map<string,Endpoint>();
 for(const control of changes.controls){
  if(control.kind==='node'){const index=plan.nodeComponents.get(control.nodeId);if(index!==undefined)dirtyComponents.add(index);}
  else if(plan.curveSlots.has(control.curveId))dirtyEnds.set(endpointKey(control),control);
 }
 work.revisionApplications++;
 const deltas=[...prior.deltas],linkIssues=[...prior.linkIssues],smoothIssues=[...prior.smoothIssues],changedHandles=new Set(previous.changedHandles);
 let activeComponents=prior.activeComponents;
 const nodes=[...prior.raw.nodes],rawCurves=[...prior.raw.curves],ownedRaw=new Set<string>(),dirtyNodes=new Set<string>();
 work.copiedControlSlots+=nodes.length+rawCurves.length;
 for(const index of dirtyComponents){
  const next=componentDelta(plan,index,value);linkIssues[index]=next.issue;
  if(nonzero(deltas[index]))activeComponents--;if(nonzero(next.delta))activeComponents++;deltas[index]=next.delta;
  for(const id of plan.components[index].ids){
   const slot=plan.nodeSlots.get(id)!,position=add(before.nodes[slot].position,next.delta);
   if(!equal(nodes[slot].position,position)){nodes[slot]={...before.nodes[slot],position};dirtyNodes.add(id);}
   for(const end of plan.nodeEnds.get(id)??[])dirtyEnds.set(endpointKey(end),end);
  }
 }
 const touchedSmooth=new Set<number>(),possiblyDirty=new Set<string>();
 for(const [key,{curveId,end}] of dirtyEnds){
  const slot=plan.curveSlots.get(curveId)!,point=shapeHandle(plan,deltas,value,curveId,end),isNonzero=nonzero(handles(value,curveId)[end]),wasNonzero=changedHandles.has(key);
  if(isNonzero)changedHandles.add(key);else changedHandles.delete(key);
  const changed=!equal(point,rawCurves[slot].handles[end]);
  if(changed){if(!ownedRaw.has(curveId)){rawCurves[slot]={...rawCurves[slot],handles:[...rawCurves[slot].handles]};ownedRaw.add(curveId);}rawCurves[slot].handles[end]=point;possiblyDirty.add(curveId);}
  const smooth=plan.smoothAtEnd.get(key);if(smooth!==undefined&&(changed||wasNonzero!==isNonzero||dirtyNodes.has(before.curves[slot].nodes[end])))touchedSmooth.add(smooth);
 }
 for(const id of dirtyNodes)for(const end of plan.nodeEnds.get(id)??[])possiblyDirty.add(end.curveId);
 const raw={...before,nodes,curves:rawCurves},changed=activeComponents>0||changedHandles.size>0;
 let drawing:DrawingDocument=before;
 if(changed){
  const curves=[...previous.drawing.curves],owned=new Set<string>();work.copiedControlSlots+=curves.length;
  const write=(endpoint:Endpoint)=>{const slot=plan.curveSlots.get(endpoint.curveId)!;if(equal(curves[slot].handles[endpoint.end],rawCurves[slot].handles[endpoint.end])&&!plan.smoothAtEnd.has(endpointKey(endpoint)))return;if(!owned.has(endpoint.curveId)){curves[slot]={...curves[slot],handles:[...curves[slot].handles]};owned.add(endpoint.curveId);}curves[slot].handles[endpoint.end]=rawCurves[slot].handles[endpoint.end];};
  for(const endpoint of dirtyEnds.values())if(!plan.smoothAtEnd.has(endpointKey(endpoint)))write(endpoint);
  drawing={...before,nodes,curves};
  for(const index of touchedSmooth){
   const component=plan.smooth[index];for(const {endpoint} of component.ends.values()){write(endpoint);possiblyDirty.add(endpoint.curveId);}
   smoothIssues[index]=[...component.ends.keys()].some(key=>changedHandles.has(key))?project(plan,drawing,index):undefined;
  }
 }else smoothIssues.fill(undefined);
 const dirtyCurveIds:string[]=[];
 for(const id of possiblyDirty){const slot=plan.curveSlots.get(id)!,a=previous.drawing.curves[slot],b=drawing.curves[slot];if(ends.some(end=>!equal(a.handles[end],b.handles[end])||!equal(previous.drawing.nodes[plan.nodeSlots.get(a.nodes[end])!].position,drawing.nodes[plan.nodeSlots.get(b.nodes[end])!].position)))dirtyCurveIds.push(id);else if(drawing!==before)drawing.curves[slot]=a;}
 const result={drawing,changed,issues:issuesFor(plan,value,linkIssues,smoothIssues),changedHandles};
 revisions.set(result,Object.freeze({previous,dirtyCurveIds:Object.freeze(dirtyCurveIds)}));
 return retain(result,{plan,raw,deltas,activeComponents,linkIssues,smoothIssues},options);
}

/** Apply sparse, node-relative controls to canonical Drawing IDs. This is a
 * post-deformation correction: authored locks do not disable its evaluation.
 * Materials and derived geometry remain the caller's responsibility. Retained
 * revisions require exact immutable source identity and complete writer proof. */
export function applyDrawingShapeValue(before:DrawingDocument,value:SceneShapeValue,options:DrawingShapeEvaluationOptions={}):DrawingShapeApplication {
 const revised=revise(before,value,options);if(revised)return revised;
 work.fullApplications++;const plan=prepare(before),linkIssues:ShapeProduct['linkIssues']=[],smoothIssues:ShapeProduct['smoothIssues']=[],deltas:Point2[]=[],changedHandles=new Set<string>();let activeComponents=0;
 plan.components.forEach((_,index)=>{const next=componentDelta(plan,index,value);deltas[index]=next.delta;linkIssues[index]=next.issue;if(nonzero(next.delta))activeComponents++;});
 const raw:DrawingDocument={...before,nodes:before.nodes.map(n=>({...n,position:add(n.position,deltas[plan.nodeComponents.get(n.id)!]??zero())})),curves:before.curves.map(c=>({...c,handles:ends.map(end=>{if(nonzero(handles(value,c.id)[end]))changedHandles.add(endpointKey({curveId:c.id,end}));return shapeHandle(plan,deltas,value,c.id,end);}) as [Point2,Point2]}))};
 const changed=activeComponents>0||changedHandles.size>0,drawing=changed?{...raw,curves:raw.curves.map(c=>({...c,handles:[...c.handles] as [Point2,Point2]}))}:before;
 if(changed)plan.smooth.forEach((component,index)=>{if([...component.ends.keys()].some(key=>changedHandles.has(key)))smoothIssues[index]=project(plan,drawing,index);});
 return retain({drawing,changed,issues:issuesFor(plan,value,linkIssues,smoothIssues),changedHandles},{plan,raw,deltas,activeComponents,linkIssues,smoothIssues},options);
}
