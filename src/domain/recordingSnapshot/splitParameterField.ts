import {evaluatedControlParameter,evaluatedFitRange} from '../drawing/evaluatedDeformation';
import {materialTableFractionAt,materialTableParameterAt} from '../drawing/materialParameter';
import type {Cubic,DrawingDocument} from '../drawing/model';
import {subcurve} from '../drawing/roundedJoin';
import {arcField} from '../drawing/sampling';
import {InputCache} from '../geometry/cache';

export interface SnapshotSplitParameterPart {curveId:string;parameterRange:readonly [number,number]}
type Range=readonly [number,number];
const ranges=new WeakMap<DrawingDocument['nodes'],ReadonlyMap<string,Range>>();
export interface SnapshotSplitParameterResolver {parts:readonly SnapshotSplitParameterPart[];parameterAt:(t:number)=>number}
const resolvers=new WeakMap<DrawingDocument['nodes'],readonly SnapshotSplitParameterResolver[]>();
/** An inserted real view retains a live material recipe, so its full native
 * correspondence is replayed from that recipe instead of interpolating cuts. */
export function recordSnapshotSplitParameterResolvers(drawing:DrawingDocument,values:readonly SnapshotSplitParameterResolver[]):DrawingDocument {resolvers.set(drawing.nodes,values);return drawing;}
export const snapshotSplitUsesCurrentMaterialFrame=(drawing:DrawingDocument):boolean=>!!resolvers.get(drawing.nodes)?.length;
/** Current fitted coordinates belong to the evaluated frame, never persistence.
 * Material clones retain nodes; a new geometry frame receives fresh metadata. */
export function recordSnapshotSplitParameterRanges(drawing:DrawingDocument,values:ReadonlyMap<string,Range>):DrawingDocument {
 const existing=ranges.get(drawing.nodes),next=new Map(existing);
 for(const [id,range] of values){if(!id||!range.every(Number.isFinite)||range[0]<0||range[1]>1||!(range[1]>range[0]))throw Error('Snapshot split parameter range must be a finite increasing interval.');next.set(id,[...range] as [number,number]);}
 ranges.set(drawing.nodes,next);return drawing;
}
export function snapshotSplitParameterRange(drawing:DrawingDocument,curveId:string):Range|undefined {return ranges.get(drawing.nodes)?.get(curveId)??evaluatedFitRange(drawing,curveId);}
/** Read every live child in one logical parent's normalized fitted frame. */
export function snapshotSplitParameterParts(drawing:DrawingDocument,parts:readonly SnapshotSplitParameterPart[]):SnapshotSplitParameterPart[] {
 const current=parts.map(part=>({curveId:part.curveId,parameterRange:snapshotSplitParameterRange(drawing,part.curveId)??part.parameterRange})),lo=current[0]?.parameterRange[0],hi=current.at(-1)?.parameterRange[1];
 if(lo===undefined||hi===undefined||!(hi>lo))throw Error('Snapshot split parameter family has no valid fitted extent.');
 return current.map(part=>({curveId:part.curveId,parameterRange:[(part.parameterRange[0]-lo)/(hi-lo),(part.parameterRange[1]-lo)/(hi-lo)]}));
}
/** Only already evaluated real controls/programs are read. No old drawing or
 * removed curve is reconstructed, and no cage or Recorder evaluation runs. */
export function resolveSnapshotFitParameter(drawing:DrawingDocument,parts:readonly SnapshotSplitParameterPart[],t:number):number|undefined {
 if(!Number.isFinite(t)||t<0||t>1||!parts.length||parts.some(part=>!drawing.curves.some(curve=>curve.id===part.curveId)))return undefined;
 const inherited=resolvers.get(drawing.nodes)?.filter(value=>parts.every(part=>value.parts.some(candidate=>candidate.curveId===part.curveId))).sort((a,b)=>b.parts.length-a.parts.length)[0];
 if(inherited){const lo=inherited.parts.find(part=>part.curveId===parts[0].curveId)!.parameterRange[0],hi=inherited.parts.find(part=>part.curveId===parts.at(-1)!.curveId)!.parameterRange[1],a=inherited.parameterAt(lo),b=inherited.parameterAt(hi);if(!(b>a))return undefined;return t===0?0:t===1?1:(inherited.parameterAt(lo+(hi-lo)*t)-a)/(b-a);}
 const index=parts.findIndex(part=>t<=part.parameterRange[1]),i=index<0?parts.length-1:index,part=parts[i],span=part.parameterRange[1]-part.parameterRange[0];if(!(span>0))return undefined;
 const fitted=snapshotSplitParameterParts(drawing,parts)[i].parameterRange,local=Math.max(0,Math.min(1,(t-part.parameterRange[0])/span)),q=evaluatedControlParameter(drawing,part.curveId,local);
 return local===0?fitted[0]:local===1?fitted[1]:fitted[0]+(fitted[1]-fitted[0])*q;
}
export interface SnapshotSplitParameterField {parameterAt:(cuts:readonly number[],weights:readonly number[])=>number}
const fields=new WeakMap<Cubic,SnapshotSplitParameterField>();
const numericFields=new InputCache<SnapshotSplitParameterField>(256);
/** Same transport as endpointPairMaterial: move each fitted support into the
 * current parent's arc table, blend distances, then invert that SAME table.
 * Every cut and scalar output in this parent frame shares one prepared table. */
export function createSnapshotSplitParameterField(parent:Cubic):SnapshotSplitParameterField {
 const known=fields.get(parent);if(known)return known;const key=JSON.stringify(parent),shared=numericFields.get(key);if(shared){fields.set(parent,shared);return shared;}const table=arcField([parent]).parts[0];
 const field:SnapshotSplitParameterField={parameterAt(cuts,weights){
  if(cuts.length!==weights.length||!cuts.length||cuts.some(value=>!Number.isFinite(value)||value<0||value>1)||weights.some(value=>!Number.isFinite(value)||value<0)||Math.abs(weights.reduce((a,b)=>a+b,0)-1)>1e-9)throw Error('Snapshot split material parameter needs finite cuts and geometric weights.');
  if(cuts.every(value=>value===cuts[0]))return cuts[0];
  if(!(table.length>0))throw Error('Snapshot split material parameter has a degenerate parent path.');
  return materialTableParameterAt(table,cuts.reduce((sum,value,index)=>sum+weights[index]*materialTableFractionAt(table,value),0));
 }};fields.set(parent,field);numericFields.set(key,field);return field;
}

export interface SnapshotSplitMaterialFrame {parts:readonly SnapshotSplitParameterPart[];parent:Cubic}
const materialFrames=new WeakMap<DrawingDocument['nodes'],readonly SnapshotSplitMaterialFrame[]>();
export function recordSnapshotSplitMaterialFrames(drawing:DrawingDocument,frames:readonly SnapshotSplitMaterialFrame[]):DrawingDocument {materialFrames.set(drawing.nodes,frames);return drawing;}
/** An explicit scalar domain owns this parent. Its live control values are
 * evaluation results and never become source geometry or persisted state. */
export function snapshotSplitMaterialFrame(drawing:DrawingDocument,parts:readonly SnapshotSplitParameterPart[]):Cubic|undefined {
 const frame=materialFrames.get(drawing.nodes)?.filter(frame=>{const start=frame.parts.findIndex(part=>part.curveId===parts[0]?.curveId);return start>=0&&parts.every((part,index)=>frame.parts[start+index]?.curveId===part.curveId);}).sort((a,b)=>b.parts.length-a.parts.length)[0];if(!frame)return;
 const current=snapshotSplitParameterParts(drawing,frame.parts),lo=current.find(part=>part.curveId===parts[0].curveId)!.parameterRange[0],hi=current.find(part=>part.curveId===parts.at(-1)!.curveId)!.parameterRange[1];
 return lo===0&&hi===1?frame.parent:subcurve(frame.parent,lo,hi);
}
