import {curveById,nodeAt,layerFor,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {applyMirrorEditing,mirrorWritesForCurves,type MirrorDrawing,type MirrorAuthoredWrites} from '../domain/drawing/mirrorEditing';
import {setMirrorEditingEnabled,addMirrorCurvePair,changeMirrorCurvePair,removeMirrorCurvePair,setMirrorAxisNodes} from '../domain/drawing/mirrorCommands';

export type MirrorEditingCommand=
 | {op:'setMirrorEditing';enabled:boolean}
 | {op:'createMirrorPair';a:string;b:string;reverse?:boolean;ref?:string}
 | {op:'setMirrorPair';pairId:string;a?:string;b?:string;reverse?:boolean}
 | {op:'deleteMirrorPairs';pairIds:string[]}
 | {op:'setMirrorAxisNodes';nodeIds:string[]};
export const mirrorCommandNames=['setMirrorEditing','createMirrorPair','setMirrorPair','deleteMirrorPairs','setMirrorAxisNodes'];
export class MirrorApiError extends Error {constructor(readonly code:string,message:string){super(message);}}
const fail=(message:string):never=>{throw new MirrorApiError('INVALID_REQUEST',message);};
const keys=(c:Record<string,unknown>,allowed:string[])=>{const bad=Object.keys(c).filter(k=>!allowed.includes(k));if(bad.length)fail(`Unknown mirror field(s): ${bad.join(', ')}.`);};
const id=(v:unknown,label:string):string=>{if(typeof v!=='string'||!v.trim()||v.length>256)fail(`${label} must be a nonempty stable ID.`);return v as string;};
const flag=(v:unknown,label:string):boolean=>{if(typeof v!=='boolean')fail(`${label} must be a boolean.`);return v as boolean;};
const ids=(v:unknown,label:string):string[]=>{if(!Array.isArray(v)||v.length>10000)fail(`${label} must be an array of at most 10000 IDs.`);const out=(v as unknown[]).map(x=>id(x,label));if(new Set(out).size!==out.length)fail(`${label} contains duplicate IDs.`);return out;};
function curve(d:DrawingDocument,v:unknown){const key=id(v,'curve ID');if(!curveById(d,key))throw new MirrorApiError('NOT_FOUND',`Unknown mirror curve ID: ${key}.`);return key;}

/** Explicit metadata CRUD; enabling validates the source and never repairs it. */
export function applyMirrorCommand(d:DrawingDocument,c:Record<string,unknown>,created:(id:string,ref:unknown)=>void):DrawingDocument {
 const before=d.mirrorEditing??{enabled:false,curvePairs:[]};
 switch(c.op){
  case 'setMirrorEditing':keys(c,['op','enabled']);return setMirrorEditingEnabled(d,flag(c.enabled,'enabled'));
  case 'createMirrorPair':{
   keys(c,['op','a','b','reverse','ref']);const out=addMirrorCurvePair(d,curve(d,c.a),curve(d,c.b),c.reverse===undefined?false:flag(c.reverse,'reverse'));created(out.mirrorEditing!.curvePairs.at(-1)!.id,c.ref);return out;
  }
  case 'setMirrorPair':{
   keys(c,['op','pairId','a','b','reverse']);const pairId=id(c.pairId,'pairId');if(!before.curvePairs.some(p=>p.id===pairId))throw new MirrorApiError('NOT_FOUND',`Unknown mirror pair ID: ${pairId}.`);
   if(c.a===undefined&&c.b===undefined&&c.reverse===undefined)fail('Provide at least one mirror pair property to change.');
   const change={...(c.a===undefined?{}:{a:curve(d,c.a)}),...(c.b===undefined?{}:{b:curve(d,c.b)}),...(c.reverse===undefined?{}:{reverse:flag(c.reverse,'reverse')})};
   return changeMirrorCurvePair(d,pairId,change);
  }
  case 'deleteMirrorPairs':{
   keys(c,['op','pairIds']);const selected=ids(c.pairIds,'pairIds');for(const pairId of selected)if(!before.curvePairs.some(p=>p.id===pairId))throw new MirrorApiError('NOT_FOUND',`Unknown mirror pair ID: ${pairId}.`);
   return selected.reduce((next,pairId)=>removeMirrorCurvePair(next,pairId),d);
  }
  case 'setMirrorAxisNodes':{
   keys(c,['op','nodeIds']);const selected=ids(c.nodeIds,'nodeIds');for(const nodeId of selected)if(!d.nodes.some(n=>n.id===nodeId))throw new MirrorApiError('NOT_FOUND',`Unknown axis node ID: ${nodeId}.`);
   return setMirrorAxisNodes(d,selected);
  }
  default:throw new MirrorApiError('UNKNOWN_COMMAND',`Unknown mirror operation: ${String(c.op)}.`);
 }
}

/** Keep explicitly authored targets across a batch. Handle vectors are relative
 * to their nodes so a later node move translates an earlier handle intention.
 * Reflection/position-link/smooth followers never become new direct intentions. */
export class MirrorBatchIntent {
 private nodes=new Map<string,Point2>();
 private handles=new Map<string,{curveId:string;end:0|1;vector:Point2}>();
 clear(){this.nodes.clear();this.handles.clear();}
 capture(d:DrawingDocument,c:Record<string,unknown>){
  let writes:MirrorAuthoredWrites={};
  if(c.op==='moveNode')writes={nodes:[{nodeId:c.nodeId as string,position:d.nodes.find(n=>n.id===c.nodeId)!.position}]};
  if(c.op==='moveHandle')writes={handles:[{curveId:c.curveId as string,end:c.end as 0|1,position:curveById(d,c.curveId as string).handles[c.end as 0|1]}]};
  if(c.op==='transformCurves'||c.op==='deformCurves')writes=mirrorWritesForCurves(d,c.curveIds as string[]);
  if(c.op==='transformLayers'){const layers=c.layerIds as string[];writes=mirrorWritesForCurves(d,d.curves.filter(x=>layers.includes(layerFor(d,x.id)!.id)).map(x=>x.id));}
  for(const w of writes.nodes??[])this.nodes.set(w.nodeId,[...w.position]);
  for(const w of writes.handles??[]){const p=nodeAt(d,w).position;this.handles.set(JSON.stringify([w.curveId,w.end]),{curveId:w.curveId,end:w.end,vector:[w.position[0]-p[0],w.position[1]-p[1]]});}
 }
 apply(before:DrawingDocument,after:DrawingDocument):DrawingDocument {
  if(!(before as MirrorDrawing).mirrorEditing?.enabled)return after;
  const handles=[...this.handles.values()].map(w=>{const p=nodeAt(after,w).position;return {curveId:w.curveId,end:w.end,position:[p[0]+w.vector[0],p[1]+w.vector[1]] as Point2};});
  return applyMirrorEditing(before,after,{nodes:[...this.nodes].map(([nodeId,position])=>({nodeId,position})),handles});
 }
}
