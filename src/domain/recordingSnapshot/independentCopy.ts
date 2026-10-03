import {hasEvaluatedDeformationFor,evaluatedMaterialProgram} from '../drawing/evaluatedDeformation';
import {isLayerCageDomain,type SnapshotLayerAffineDomain} from './layerDomains';
import {emptyDrawing,parseDrawing,type DrawingDocument,type Point2} from '../drawing/model';
import {planArtworkLayerImport} from '../drawing/importArtworkLayers';
import {evaluatedAffine,evaluatedAffineSource} from '../drawing/evaluatedAffine';
import {displayField,displayPath} from '../drawing/displayIntervals';
import {intervalPinch} from '../drawing/intervalPinch';
import {fillGeometry,offsetGeometry} from '../drawing/appearance';
import {identityAffine2D,inverseAffine2D,applyAffine2DVector,type Affine2D} from '../geometry/affine2d';
import {placementMatrix} from '../recordingScene/tracks';
import type {ScenePlacementValue} from '../recordingScene/model';
import {emptyRecordingSnapshot,type RecordingSnapshotWorkspace,type RecordingSnapshot} from './model';
import {resolveSnapshot,type SnapshotEvaluation} from './evaluation';
import {drawingIdentityIds,remapDrawingIdentities} from './sources';
import {parseRecordingSnapshots} from './persistence';

export class SnapshotIndependentCopyError extends Error {
 constructor(readonly code:string,readonly snapshotId:string,readonly elementId:string,message:string){super(`Current-shape independent copy of snapshot ${snapshotId}, object ${elementId}: ${message}`);}
}
const close=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
function equivalent(a:unknown,b:unknown):boolean {
 if(typeof a==='number'&&typeof b==='number')return close(a,b);
 if(a===b)return true;
 if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>equivalent(v,b[i]));
 if(a&&b&&typeof a==='object'&&typeof b==='object'){
  const left=Object.entries(a).filter(([,v])=>v!==undefined),right=Object.entries(b).filter(([,v])=>v!==undefined);
  return left.length===right.length&&left.every(([key,value])=>Object.hasOwn(b,key)&&equivalent(value,(b as Record<string,unknown>)[key]));
 }
 return false;
}
function subset(drawing:DrawingDocument,layerIds:ReadonlySet<string>):DrawingDocument {
 const layers=drawing.layers.filter(layer=>layerIds.has(layer.id)),items=new Set(layers.flatMap(layer=>layer.items)),curves=drawing.curves.filter(curve=>items.has(curve.id)),curveIds=new Set(curves.map(curve=>curve.id)),nodes=new Set(curves.flatMap(curve=>curve.nodes));
 return {...emptyDrawing(),layers,curves,nodes:drawing.nodes.filter(node=>nodes.has(node.id)),fills:drawing.fills.filter(fill=>items.has(fill.id)),offsets:drawing.offsets.filter(offset=>items.has(offset.id)),joins:drawing.joins.filter(join=>curveIds.has(join.a.curveId)||curveIds.has(join.b.curveId)),endpointLinks:drawing.endpointLinks?.filter(link=>curveIds.has(link.a.curveId)||curveIds.has(link.b.curveId)),groups:drawing.groups?.filter(group=>group.curveIds.some(id=>curveIds.has(id))).map(group=>({...group,curveIds:group.curveIds.filter(id=>curveIds.has(id))})),displayIntervals:drawing.displayIntervals?.filter(track=>curveIds.has(track.anchor.id))};
}
function objectMatrix(drawing:DrawingDocument,id:string):Affine2D {
 const affine=evaluatedAffine(drawing,id);if(!affine)return identityAffine2D();
 const p=affine.point([0,0]),x=affine.point([1,0]),y=affine.point([0,1]);
 return [x[0]-p[0],x[1]-p[1],y[0]-p[0],y[1]-p[1],p[0],p[1]];
}
/** Native per-curve placement can represent two perpendicular nonnegative axes,
 * including exact collapse. General shear/reflection uses a whole-layer domain. */
function asPlacement(matrix:Affine2D):ScenePlacementValue|undefined {
 const [a,b,c,d,e,f]=matrix,sx=Math.hypot(a,b),sy=Math.hypot(c,d),rotation=(sx?Math.atan2(b,a):sy?Math.atan2(-c,d):0)*180/Math.PI;
 const value={translation:[e,f] as Point2,rotation,scale:1,scaleX:sx,scaleY:sy};
 return equivalent(placementMatrix(value),matrix)?value:undefined;
}

/** An explicit duplicate starts a new ownership root at the saved source's
 * current shape. It does not retain semantic parents, response recipes, Warp
 * residuals or source membership tombstones. Only deferred affine material
 * geometry remains procedural, so ARC, interval support and fixed widths are
 * unchanged even under shear/reflection/zero scale. */
export function prepareIndependentSnapshotLayers(workspace:RecordingSnapshotWorkspace,source:RecordingSnapshot,layerIds:readonly string[],fresh:()=>string):{snapshot:RecordingSnapshot;library:RecordingSnapshotWorkspace['library'];idMap:Record<string,string>} {
 const fail=(elementId:string,message:string,code='INDEPENDENT_COPY_UNSUPPORTED'):never=>{throw new SnapshotIndependentCopyError(code,source.id,elementId,message);};
 const selected=new Set(layerIds),evaluation=resolveSnapshot(workspace,source.id,{useDraft:false}),current=evaluation.drawing;
 // Derived recipe values may contain transient pinch or exceed authoring
 // bounds. Never discard these when materializing the new ownership root.
 for(const track of current.displayIntervals??[])if(current.layers.some(layer=>selected.has(layer.id)&&layer.items.includes(track.anchor.id)))for(const range of track.ranges){
  if(intervalPinch(range)!==0)fail(range.id,`interval ${track.id} contains transient pinch material that has no independent stored representation.`);
  if(![range.start,range.end].every(value=>Number.isFinite(value)&&value>=0&&value<=1))fail(range.id,`interval ${track.id} has unsupported material bounds ${range.start}, ${range.end}.`);
 }
 for(const join of current.joins)if(join.mode==='ARC'&&current.layers.some(layer=>selected.has(layer.id)&&(layer.items.includes(join.a.curveId)||layer.items.includes(join.b.curveId)))&&(!join.radius||join.radius>2))fail(join.id,'evaluated ARC trim exceeds the independent relation range.');
 for(const link of current.endpointLinks??[])if(link.joinBrush?.kind==='ARC'&&current.layers.some(layer=>selected.has(layer.id)&&(layer.items.includes(link.a.curveId)||layer.items.includes(link.b.curveId)))&&link.joinBrush.trimDistance>2)fail(link.id,'evaluated display ARC trim exceeds the independent relation range.');
 if(current.layers.filter(layer=>selected.has(layer.id)).some(layer=>layer.items.some(id=>hasEvaluatedDeformationFor(current,id)&&(evaluatedMaterialProgram(current,id)?.some(step=>step.kind!=='affine')??true))))fail(source.id,'Retained cage copying requires its own material source and ordered domain program; this copy path does not yet support that representation.');
 const materialSource=evaluatedAffineSource(current)??current,plan=planArtworkLayerImport(materialSource,layerIds);
 if(plan.additionalLayerIds.length)fail(plan.dependencies.find(dependency=>plan.additionalLayerIds.includes(dependency.requiredLayerId))?.objectId??source.id,`also select dependent layers: ${plan.additionalLayerIds.join(', ')}.`,'LAYER_DEPENDENCIES');
 const wanted=subset(current,selected),material=subset(materialSource,selected),matrices=new Map(material.curves.map(curve=>[curve.id,objectMatrix(current,curve.id)]));
 // Use one order-preserving namespace for every identity, including relations
 // and range IDs. Node ordering controls open-path material direction.
 const prefix=`copy:${fresh()}:`,mapping=new Map<string,string>(),occupied=new Set([...Object.values(workspace.library).flatMap(values=>Object.keys(values)),...workspace.snapshots.flatMap(snapshot=>[snapshot.id,...snapshot.layers.map(layer=>layer.id),...Object.values(snapshot.relations).flatMap(patch=>[...patch?.add??[],...patch?.update??[]].flatMap((value:{id:string;ranges?:{id:string}[]})=>[value.id,...value.ranges?.map(range=>range.id)??[]])),...snapshot.deformation.layerDomains?.map(domain=>domain.id)??[]])]);
 const map=(id:string)=>{let value=mapping.get(id);if(value)return value;value=prefix+id;if(value.length>16384||occupied.has(value))return fail(id,'a fresh bounded identity could not be allocated.','ID_COLLISION');mapping.set(id,value);occupied.add(value);return value;};
 const copy=emptyRecordingSnapshot(map(source.id),`${source.name.slice(0,230)} independent copy`,source.kind,source.angle);
 for(const layer of material.layers){
  const curves=material.curves.filter(curve=>layer.items.includes(curve.id));if(!curves.length)continue;
  const matrix=matrices.get(curves[0].id)!;
  if(curves.every(curve=>equivalent(matrices.get(curve.id),matrix))){
   if(!equivalent(matrix,identityAffine2D())){
    // Preserve an existing operation identity when the whole current material
    // affine is exactly that operation; otherwise this is a new local domain.
    const previous=evaluation.state.layerDomains?.find((domain):domain is SnapshotLayerAffineDomain=>!isLayerCageDomain(domain)&&domain.enabled!==false&&domain.layerIds.includes(layer.id)&&equivalent(domain.matrix,matrix));
    const domains=copy.deformation.layerDomains??=[],domainId=previous?map(previous.id):fresh(),existing=domains.find(domain=>domain.id===domainId);
    if(existing)existing.layerIds.push(map(layer.id));else domains.push({id:domainId,layerIds:[map(layer.id)],matrix:previous?[...previous.matrix]:matrix});
   }
  }else{
   const placements:Record<string,ScenePlacementValue>={};
   for(const curve of curves){const affine=matrices.get(curve.id)!;if(equivalent(affine,identityAffine2D()))continue;const placement=asPlacement(affine);if(!placement)fail(curve.id,`layer ${layer.id} contains different material affines, including a shear or reflection that cannot be represented as native stroke placement.`);placements[map(curve.id)]=placement!;}
   copy.deformation.layers[map(layer.id)]={elementPlacements:placements};
  }
 }
 // Offset translations are already in evaluated coordinates. Reverse only
 // this vector before replaying the retained affine; never double-place it.
 material.offsets=material.offsets.map(offset=>{
  if(!offset.translation)return offset;
  const matrix=matrices.get(offset.source[0]?.id)??identityAffine2D();if(equivalent(matrix,identityAffine2D()))return offset;
  const inverse=inverseAffine2D(matrix);if(!inverse){if(offset.translation.every(value=>value===0))return offset;return fail(offset.id,'a translated offset under a singular material affine needs an independent preimage that this copy operation does not support.');}
  return {...offset,translation:applyAffine2DVector(inverse,offset.translation)};
 });
 const remapped=remapDrawingIdentities(material,map);
 copy.layers=remapped.layers.map(layer=>({...layer,kind:'original'}));
 copy.relations={joins:{add:remapped.joins},endpointLinks:{add:remapped.endpointLinks??[]},groups:{add:remapped.groups??[]},displayIntervals:{add:remapped.displayIntervals??[]}};
 const library={...workspace.library};
 for(const kind of ['nodes','curves','fills','offsets'] as const)(library[kind] as Record<string,{id:string}>)={...workspace.library[kind],...Object.fromEntries(remapped[kind].map(value=>[value.id,value]))};
 // The check uses a real JSON round trip and the ordinary evaluator, not a
 // transient affine registration. Nothing has been published to the draft yet.
 const candidate:RecordingSnapshotWorkspace={...workspace,library,snapshots:[...workspace.snapshots,copy]};
 let reloaded:RecordingSnapshotWorkspace;
 try{parseDrawing(remapped);reloaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(candidate)));}catch(error){return fail(source.id,`the independent representation is not serializable: ${(error as Error).message}`);}
 const actual=resolveSnapshot(reloaded,copy.id,{useDraft:false});
 verifyAppearance(evaluation,wanted,actual,mapping,fail);
 return {snapshot:copy,library,idMap:Object.fromEntries(mapping)};
}

function verifyAppearance(before:SnapshotEvaluation,wanted:DrawingDocument,after:SnapshotEvaluation,mapping:Map<string,string>,fail:(id:string,message:string)=>never):void {
 const inverse=new Map([...mapping].map(([a,b])=>[b,a])),actual=remapDrawingIdentities(after.drawing,id=>inverse.get(id)??id);
 for(const category of ['layers','nodes','curves','fills','offsets','joins','endpointLinks','groups','displayIntervals'] as const){
  const expected=wanted[category]??[],values=actual[category]??[];
  if(values.length!==expected.length)fail(expected[0]?.id??before.snapshotId,`${category} membership changed while creating the independent base.`);
  for(const value of expected){const found=values.find(next=>next.id===value.id);if(!equivalent(value,found))fail(value.id,`${category} geometry, appearance or local relationship changed while creating the independent base.`);}
 }
 const checkedPaths=new Set<string>();
 for(const curve of wanted.curves){
  const path=displayPath(before.drawing,curve.id),key=JSON.stringify(path);if(checkedPaths.has(key))continue;checkedPaths.add(key);
  const expected=displayField(before.drawing,path),copyId=mapping.get(curve.id)!,field=displayField(after.drawing,displayPath(after.drawing,copyId));
  if(!equivalent(expected.geometry.shapes,field.geometry.shapes)||!equivalent(expected.inkSpans,field.inkSpans)||!equivalent(expected.pinches,field.pinches))fail(curve.id,'derived ARC geometry or interval/brush material changed while creating the independent base.');
  // Material distances may stay pre-affine. Compare their display positions,
  // including actual interval endpoints, rather than just four curve controls.
  const samples=[0,.125,.25,.5,.75,.875,1,...(expected.inkSpans??[]).flatMap(span=>[span.start,span.end])];
  if(samples.some(s=>!equivalent(expected.at(s).p,field.at(s).p)))fail(curve.id,'material support moved while creating the independent base.');
 }
 for(const fill of wanted.fills)if(!equivalent(fillGeometry(before.drawing,fill).shapes,fillGeometry(after.drawing,after.drawing.fills.find(value=>value.id===mapping.get(fill.id))!).shapes))fail(fill.id,'fill boundary changed while creating the independent base.');
 for(const offset of wanted.offsets)if(!equivalent(offsetGeometry(before.drawing,offset),offsetGeometry(after.drawing,after.drawing.offsets.find(value=>value.id===mapping.get(offset.id))!)))fail(offset.id,'offset follower changed while creating the independent base.');
 const selected=new Set(drawingIdentityIds(wanted)),batch=(evaluation:SnapshotEvaluation,unmap:(id:string)=>string)=>evaluation.paintBatches.filter(value=>selected.has(unmap(value.owner??value.item.id))).map(value=>[unmap(value.owner??value.item.id),value.item.kind]);
 const expectedOrder=batch(before,id=>id),actualOrder=batch(after,id=>inverse.get(id)??id),different=expectedOrder.findIndex((value,index)=>!equivalent(value,actualOrder[index]));
 if(different>=0||expectedOrder.length!==actualOrder.length)fail(expectedOrder[Math.max(0,different)]?.[0]??before.snapshotId,`relative paint order depends on an external source context: expected ${JSON.stringify(expectedOrder[Math.max(0,different)])}, got ${JSON.stringify(actualOrder[Math.max(0,different)])}.`);
}
