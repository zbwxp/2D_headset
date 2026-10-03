import {add,sub,length,type DrawingDocument,type Endpoint,type Point2} from './model';
import {linkedNodeIds} from './endpointLinks';
import {drawingSmoothComponents,projectDrawingSmoothComponent} from './smoothHandleAuthoring';
import type {SceneShapeValue} from '../recordingScene/model';

const endpointKey=(e:Endpoint)=>JSON.stringify([e.curveId,e.end]);
const zero=():Point2=>[0,0];
const offset=(value:SceneShapeValue,id:string):Point2=>Object.hasOwn(value.nodes,id)?value.nodes[id]:zero();
const handles=(value:SceneShapeValue,id:string):[Point2,Point2]=>Object.hasOwn(value.handles,id)?value.handles[id]:[zero(),zero()];
const nonzero=(p:Point2)=>p[0]!==0||p[1]!==0;

export interface DrawingShapeIssue {targetId?:string;message:string}
export interface DrawingShapeApplication {
 drawing:DrawingDocument;
 changed:boolean;
 issues:DrawingShapeIssue[];
 /** JSON [curveId,end] keys for explicitly nonzero handle offsets. */
 changedHandles:Set<string>;
}

/** Apply sparse, node-relative controls to canonical Drawing IDs. This is a
 * post-deformation correction: authored locks do not disable its evaluation.
 * Materials and derived geometry remain the caller's responsibility. */
export function applyDrawingShapeValue(before:DrawingDocument,value:SceneShapeValue):DrawingShapeApplication {
 const issues:DrawingShapeIssue[]=[],nodeIds=new Set(before.nodes.map(n=>n.id)),curveIds=new Set(before.curves.map(c=>c.id));
 for(const id of Object.keys(value.nodes))if(!nodeIds.has(id))issues.push({targetId:id,message:'The shape node is missing; its offset is retained.'});
 for(const id of Object.keys(value.handles))if(!curveIds.has(id))issues.push({targetId:id,message:'The shape curve is missing; its handle offsets are retained.'});
 const deltas=new Map<string,Point2>(),visited=new Set<string>();
 for(const node of before.nodes){
  if(visited.has(node.id))continue;
  const component=[...linkedNodeIds(before,node.id)].sort();component.forEach(id=>visited.add(id));
  const requested=component.map(id=>offset(value,id)),first=requested[0];
  if(requested.some(p=>length(sub(first,p))>1e-8)){
   issues.push({targetId:node.id,message:'Linked endpoint shape offsets conflict; this linked component keeps its Warp positions.'});
   component.forEach(id=>deltas.set(id,zero()));
  }else component.forEach(id=>deltas.set(id,first));
 }
 const changedHandles=new Set<string>();
 const drawing:DrawingDocument={...before,nodes:before.nodes.map(n=>({...n,position:add(n.position,deltas.get(n.id)??zero())})),curves:before.curves.map(c=>{
  const delta=handles(value,c.id);
  return {...c,handles:([0,1] as const).map(end=>{
   if(nonzero(delta[end]))changedHandles.add(endpointKey({curveId:c.id,end}));
   return add(add(c.handles[end],deltas.get(c.nodes[end])??zero()),delta[end]);
  }) as [Point2,Point2]};
 })};
 const changed=drawing.nodes.some(n=>nonzero(deltas.get(n.id)??zero()))||changedHandles.size>0;
 if(!changed)return {drawing:before,changed,issues,changedHandles};
 for(const component of drawingSmoothComponents(drawing))if([...component.ends.keys()].some(id=>changedHandles.has(id)))try{
  projectDrawingSmoothComponent(drawing,component);
 }catch(error){issues.push({targetId:component.driver.curveId,message:error instanceof Error?error.message:String(error)});}
 return {drawing,changed,issues,changedHandles};
}
