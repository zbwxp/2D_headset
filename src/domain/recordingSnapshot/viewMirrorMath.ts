import {placeDrawingAffines} from '../drawing/affineDrawing';
import {resolveDisplayRoute} from '../drawing/displayRoutes';
import {evaluatedAffine} from '../drawing/evaluatedAffine';
import {hasEvaluatedDeformationFor} from '../drawing/evaluatedDeformation';
import {finitePoint,type DrawingDocument,type End,type Point2} from '../drawing/model';
import type {Affine2D} from '../geometry/affine2d';
import {retainSnapshotAffines} from './elementPlacement';
import {mirrorSnapshotDrawing,type SnapshotMirrorCorrespondence,type SnapshotMirrorDiagnostic,type SnapshotMirrorOptions} from './snapshotMirror';

/** A reference belongs to a complete local zero-view group. The caller chooses
 * it; neither the global Drawing axis nor individual curve bounds select it. */
export interface ViewMirrorUnpairedGroup {curveIds:readonly string[];reference:Point2}
export interface ViewMirrorOptions extends Omit<SnapshotMirrorOptions,'axisX'> {
 unpairedGroups?:readonly ViewMirrorUnpairedGroup[];
}
export interface ViewMirrorDiagnostic {
 code:'MISSING_ZERO_ENTITY'|'ZERO_TOPOLOGY_MISMATCH'|'INVALID_REFERENCE'|'REFERENCE_CONFLICT'|'LINK_CONFLICT'|'UNSUPPORTED_MATERIAL';
 entityKind:'nodes'|'curves'|'endpointLinks';entityId:string;message:string;
}
export class ViewMirrorError extends Error {
 constructor(readonly diagnostics:ViewMirrorDiagnostic[]){super(diagnostics.map(value=>value.message).join(' '));this.name='ViewMirrorError';}
}
export interface ViewMirrorResult {
 drawing:DrawingDocument;correspondence:SnapshotMirrorCorrespondence;
 diagnostics:(SnapshotMirrorDiagnostic|ViewMirrorDiagnostic)[];
}
const reflectDelta=([x,y]:Point2):Point2=>[-x,y];
const plus=(a:Point2,b:Point2):Point2=>[a[0]+b[0],a[1]+b[1]];
const minus=(a:Point2,b:Point2):Point2=>[a[0]-b[0],a[1]-b[1]];
const close=(a:Point2,b:Point2)=>Math.abs(a[0]-b[0])<=1e-10&&Math.abs(a[1]-b[1])<=1e-10;
const flip=(end:End,reverse:boolean):End=>reverse?(end===0?1:0):end;
const issue=(code:ViewMirrorDiagnostic['code'],entityKind:ViewMirrorDiagnostic['entityKind'],entityId:string,message:string):ViewMirrorDiagnostic=>({code,entityKind,entityId,message});
function components(ids:readonly string[]) {
 const parent=new Map(ids.map(id=>[id,id]));
 const root=(id:string):string=>{const next=parent.get(id);if(next===undefined)throw Error(`Missing component identity ${id}.`);if(next===id)return id;const result=root(next);parent.set(id,result);return result;};
 const join=(ids:readonly string[])=>{if(!ids.length)return;const first=root(ids[0]);for(const id of ids.slice(1))parent.set(root(id),first);};
 return {root,join};
}

/** Reflect deformation in each semantic curve's evaluated zero-view basis.
 * Paired control j -> i: zero_i + S(current_j - zero_j), S(x,y)=(-x,y).
 * An unpaired group first reflects its zero baseline around the supplied local
 * reference, then applies the same reflected delta. Calling this with
 * current===zero therefore generates 0+ by exactly the same rule.
 *
 * Canonical IDs, end parity, material routes and paint order are all delegated
 * to the existing snapshot mapper. Its axis=0 below is only the linear S
 * operation; it is never a world-space reference or a fallback mirror axis.
 */
export function mirrorViewDrawing(current:DrawingDocument,zero:DrawingDocument,options:ViewMirrorOptions):ViewMirrorResult {
 const zeroNodes=new Map(zero.nodes.map(node=>[node.id,node])),zeroCurves=new Map(zero.curves.map(curve=>[curve.id,curve]));
 const currentCurves=new Map(current.curves.map(curve=>[curve.id,curve])),currentNodes=new Map(current.nodes.map(node=>[node.id,node]));
 const diagnostics:ViewMirrorDiagnostic[]=[];
 if(zeroNodes.size!==zero.nodes.length||zeroCurves.size!==zero.curves.length)diagnostics.push(issue('INVALID_REFERENCE','nodes','','Zero-view canonical node and curve IDs must be unique.'));
 for(const node of current.nodes){if(!zeroNodes.has(node.id))diagnostics.push(issue('MISSING_ZERO_ENTITY','nodes',node.id,`Node ${node.id} has no evaluated zero-view baseline.`));else if(!finitePoint(node.position)||!finitePoint(zeroNodes.get(node.id)!.position))diagnostics.push(issue('INVALID_REFERENCE','nodes',node.id,`Node ${node.id} has non-finite current or zero-view controls.`));}
 for(const curve of current.curves){const baseline=zeroCurves.get(curve.id);if(!baseline)diagnostics.push(issue('MISSING_ZERO_ENTITY','curves',curve.id,`Curve ${curve.id} has no evaluated zero-view baseline.`));else if(curve.nodes.some((id,end)=>baseline.nodes[end]!==id))diagnostics.push(issue('ZERO_TOPOLOGY_MISMATCH','curves',curve.id,`Curve ${curve.id} changed canonical endpoints between the current and zero views.`));else if([...curve.handles,...baseline.handles].some(point=>!finitePoint(point)))diagnostics.push(issue('INVALID_REFERENCE','curves',curve.id,`Curve ${curve.id} has non-finite current or zero-view handles.`));}
 for(const pair of options.curvePairs)for(const id of [pair.a,pair.b])if(!zeroCurves.has(id)&&!diagnostics.some(value=>value.entityKind==='curves'&&value.entityId===id))diagnostics.push(issue('MISSING_ZERO_ENTITY','curves',id,`Paired curve ${id} has no evaluated zero-view baseline.`));
 if(diagnostics.length)throw new ViewMirrorError(diagnostics);
 const mapped=mirrorSnapshotDrawing(current,{...options,axisX:0},zero),mapping=mapped.correspondence;
 const paired=new Set(options.curvePairs.flatMap(pair=>[pair.a,pair.b]));
 const pairedNodes=new Set(current.curves.filter(curve=>paired.has(curve.id)).flatMap(curve=>curve.nodes));
 const references=new Map<string,Point2>();
 for(const group of options.unpairedGroups??[])for(const id of group.curveIds){
  if(!currentCurves.has(id)||!finitePoint(group.reference))diagnostics.push(issue('INVALID_REFERENCE','curves',id,`Unpaired group ${id} needs live canonical curve IDs and a finite explicit local-zero reference.`));
  else if(references.has(id))diagnostics.push(issue('REFERENCE_CONFLICT','curves',id,`Curve ${id} belongs to more than one unpaired reference group.`));
  else references.set(id,group.reference);
 }
 const nodeOwners=new Map<string,string[]>();for(const curve of current.curves)for(const id of curve.nodes)nodeOwners.set(id,[...nodeOwners.get(id)??[],curve.id]);
 const connected=components(current.curves.map(curve=>curve.id));for(const ids of nodeOwners.values())connected.join(ids);
 for(const link of current.endpointLinks??[])connected.join([link.a.curveId,link.b.curveId]);
 const componentReferences=new Map<string,Point2>();
 for(const curve of current.curves)if(!paired.has(curve.id)){
  const reference=references.get(curve.id);if(!reference){diagnostics.push(issue('INVALID_REFERENCE','curves',curve.id,`Unpaired curve ${curve.id} needs an explicit shared local-zero group reference.`));continue;}
  const component=connected.root(curve.id),previous=componentReferences.get(component);
  if(previous&&!close(previous,reference))diagnostics.push(issue('REFERENCE_CONFLICT','curves',curve.id,`Continuous unpaired component ${curve.id} cannot use different local-zero references for its segments.`));
  else componentReferences.set(component,reference);
 }
 if(diagnostics.length)throw new ViewMirrorError(diagnostics);
 const baselineNodes=new Map<string,Point2>();
 for(const node of current.nodes){
  const target=mapping.nodes[node.id];
  if(pairedNodes.has(node.id))baselineNodes.set(node.id,[...zeroNodes.get(target)!.position]);
  else {const curve=nodeOwners.get(node.id)?.[0],reference=curve?componentReferences.get(connected.root(curve)):undefined;if(!reference){diagnostics.push(issue('INVALID_REFERENCE','nodes',node.id,`Unpaired node ${node.id} has no local-zero group reference.`));continue;}const p=zeroNodes.get(node.id)!.position;baselineNodes.set(node.id,[2*reference[0]-p[0],p[1]]);}
 }
 if(diagnostics.length)throw new ViewMirrorError(diagnostics);
 // Position links retain separate IDs. Within a linked set, an explicit pair
 // is authoritative; an unpaired follower uses that same baseline exactly.
 const linked=components(current.nodes.map(node=>node.id));
 for(const link of current.endpointLinks??[])linked.join([currentCurves.get(link.a.curveId)!.nodes[link.a.end],currentCurves.get(link.b.curveId)!.nodes[link.b.end]]);
 const linkGroups=new Map<string,string[]>();for(const node of current.nodes){const root=linked.root(node.id);linkGroups.set(root,[...linkGroups.get(root)??[],node.id]);}
 for(const ids of linkGroups.values())if(ids.length>1){
  const authorities=ids.filter(id=>pairedNodes.has(id)),authority=authorities[0]??ids[0],baseline=baselineNodes.get(authority)!;
  if((authorities.length?authorities:ids).some(id=>!close(baselineNodes.get(id)!,baseline))||ids.some(id=>!close(minus(currentNodes.get(id)!.position,zeroNodes.get(id)!.position),minus(currentNodes.get(authority)!.position,zeroNodes.get(authority)!.position))))diagnostics.push(issue('LINK_CONFLICT','nodes',authority,`Linked nodes at ${authority} have incompatible zero baselines or current deformation.`));
  else for(const id of ids)baselineNodes.set(id,baseline);
 }
 if(diagnostics.length)throw new ViewMirrorError(diagnostics);
 const positions=new Map<string,Point2>();for(const node of current.nodes)positions.set(mapping.nodes[node.id],plus(baselineNodes.get(node.id)!,reflectDelta(minus(node.position,zeroNodes.get(node.id)!.position))));
 const handles=new Map<string,[Point2,Point2]>(),corrections=new Map<string,Point2[]>();
 for(const curve of current.curves){
  const target=mapping.curves[curve.id],baseline=zeroCurves.get(curve.id)!,targetZero=zeroCurves.get(target.id)!,next:[Point2,Point2]=[[0,0],[0,0]],shifts:Point2[]=[];
  for(const end of [0,1] as const){
   const targetEnd=flip(end,target.reverse),node=baseline.nodes[end];
   const zeroHandle=paired.has(curve.id)?targetZero.handles[targetEnd]:plus(baselineNodes.get(node)!,reflectDelta(minus(baseline.handles[end],zeroNodes.get(node)!.position)));
   next[targetEnd]=plus(zeroHandle,reflectDelta(minus(curve.handles[end],baseline.handles[end])));
   shifts.push(minus(baselineNodes.get(node)!,reflectDelta(zeroNodes.get(node)!.position)),minus(zeroHandle,reflectDelta(baseline.handles[end])));
  }
  handles.set(target.id,next);corrections.set(curve.id,shifts);
 }
 const result:DrawingDocument={...mapped.drawing,...(current.mirrorAxisX!==undefined?{mirrorAxisX:current.mirrorAxisX}:{}),nodes:mapped.drawing.nodes.map(node=>({...node,position:positions.get(node.id)!})),curves:mapped.drawing.curves.map(curve=>({...curve,handles:handles.get(curve.id)!}))};
 // Derived material may span several curves. A shared translation after S is
 // exact for all ordinary placements, including singular/nonuniform affines.
 // Different disconnected groups may use entirely different translations.
 const material=components(current.curves.map(curve=>curve.id));for(const ids of nodeOwners.values())material.join(ids);
 for(const relation of [...current.joins,...current.endpointLinks??[]])material.join([relation.a.curveId,relation.b.curveId]);
 for(const fill of current.fills)material.join(fill.boundary.map(use=>use.id));for(const offset of current.offsets)material.join(offset.source.map(use=>use.id));
 for(const track of current.displayIntervals??[])if(track.displayRoute)material.join([...track.displayRoute.seed.segments,...resolveDisplayRoute(current,track.displayRoute).path.segments].map(use=>use.id));
 const materialGroups=new Map<string,string[]>();for(const curve of current.curves){const root=material.root(curve.id);materialGroups.set(root,[...materialGroups.get(root)??[],curve.id]);}
 const translations=new Map<string,Point2>();
 for(const ids of materialGroups.values()){
  const shift=corrections.get(ids[0])![0],uniform=ids.every(id=>corrections.get(id)!.every(value=>close(value,shift)));
  if(!uniform&&ids.some(id=>evaluatedAffine(current,id)||hasEvaluatedDeformationFor(current,id)))diagnostics.push(issue('UNSUPPORTED_MATERIAL','curves',ids[0],`Material component ${ids[0]} needs a nonuniform zero-baseline correction. Its deferred affine/deformation geometry cannot be represented by one exact reflected material projection.`));
  if(uniform)for(const id of ids)translations.set(mapping.curves[id].id,shift);
 }
 if(diagnostics.length)throw new ViewMirrorError(diagnostics);
 const matrices:Record<string,Affine2D>=Object.fromEntries([...translations].map(([id,p])=>[id,[1,0,0,1,p[0],p[1]] as Affine2D]));
 const owners=new Map<string,string>();for(const curve of mapped.drawing.curves){owners.set(curve.id,curve.id);for(const node of curve.nodes)owners.set(node,curve.id);}for(const fill of mapped.drawing.fills)if(fill.boundary.length)owners.set(fill.id,fill.boundary[0].id);for(const offset of mapped.drawing.offsets)if(offset.source.length)owners.set(offset.id,offset.source[0].id);
 const placed=placeDrawingAffines(mapped.drawing,matrices,id=>owners.get(id));
 // Keep the exact delta arithmetic above (in particular 0+ paired controls),
 // while transferring the equivalent material projection to its node array.
 retainSnapshotAffines(result,[placed]);
 return {drawing:result,correspondence:mapping,diagnostics:mapped.diagnostics};
}
