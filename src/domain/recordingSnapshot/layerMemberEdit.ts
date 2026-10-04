import {transferSnapshotMemberState} from './memberState';
import {parseDrawing,uid,type DrawingDocument} from '../drawing/model';
import {captureSnapshotControlTargets,assertSnapshotControlTargetReplay} from './controlTargets';
import {resolveSnapshot,type SnapshotEvaluation} from './evaluation';
import {excludeSnapshotLocalMembers} from './localMembership';
import {drawingSourceOwns} from './sources';
import {patchSnapshotRelations} from './relationAuthoringIntent';
import {parseRecordingSnapshots} from './persistence';
import {captureSnapshotResponseMembership,reconcileSnapshotMembershipResponses} from './membershipResponses';
import type {SnapshotLocalDrawingEdit} from './drawingTopology';
import type {RecordingSnapshotWorkspace,RecordingSnapshot,SnapshotDiagnostic} from './model';

const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const sorted=<T extends {id:string}>(values:readonly T[])=>[...values].sort((a,b)=>a.id.localeCompare(b.id));
const ids=(drawing:DrawingDocument)=>drawing.layers.flatMap(layer=>layer.items).sort();
/** Only organizational edits of existing members enter this route. Adding or
 * deleting material continues through the established topology transaction. */
export function hasSnapshotLayerMemberEdit(before:DrawingDocument,after:DrawingDocument):boolean {
 return memberOnlyContent(before,after)&&before.layers.every(layer=>after.layers.some(value=>value.id===layer.id))&&same(ids(before),ids(after))&&(after.layers.length!==before.layers.length||before.layers.some(layer=>!same(layer.items,after.layers.find(value=>value.id===layer.id)?.items)));
}
function memberOnlyContent(before:DrawingDocument,after:DrawingDocument):boolean {
 for(const kind of ['nodes','fills','offsets','joins','endpointLinks','displayIntervals'] as const)if(!same(sorted<{id:string}>(before[kind]??[]),sorted<{id:string}>(after[kind]??[])))return false;
 const curves=(drawing:DrawingDocument)=>sorted(drawing.curves.map(({localPaintOrder,...curve})=>curve));if(!same(curves(before),curves(after)))return false;
 if(!same(sorted(before.layers.map(({items,...layer})=>layer)),sorted(after.layers.filter(layer=>before.layers.some(value=>value.id===layer.id)).map(({items,...layer})=>layer))))return false;
 return same([before.mirrorAxisX,before.mirrorEditing],[after.mirrorAxisX,after.mirrorEditing]);
}
export function tryPrepareSnapshotLayerMemberEdit(before:RecordingSnapshotWorkspace,snapshot:RecordingSnapshot,edit:SnapshotLocalDrawingEdit,evaluation:SnapshotEvaluation):{workspace:RecordingSnapshotWorkspace;diagnostics:SnapshotDiagnostic[]}|undefined {
 const current=evaluation.drawing;if(!hasSnapshotLayerMemberEdit(current,edit.drawing))return undefined;
 const target=parseDrawing(edit.drawing);
 for(const layer of target.layers)if(!current.layers.some(value=>value.id===layer.id)&&before.snapshots.some(value=>value.id===layer.id||value.layers.some(value=>value.id===layer.id))||!current.layers.some(value=>value.id===layer.id)&&Object.values(before.library).some(values=>Object.hasOwn(values,layer.id)))throw Error('The new layer identity already belongs to the workspace.');
 const owner=(drawing:DrawingDocument,id:string)=>drawing.layers.find(layer=>layer.items.includes(id))!.id,moves=ids(current).filter(id=>owner(current,id)!==owner(target,id)).map(id=>({id,from:owner(current,id),to:owner(target,id)}));

 for(const move of moves)if([...current.curves,...current.fills,...current.offsets].find(value=>value.id===move.id)?.locked)throw Error('Unlock the selected objects before moving them between layers.');
 const membership=captureSnapshotResponseMembership(before),workspace=structuredClone(before),local=workspace.snapshots.find(value=>value.id===snapshot.id)!;
 const memberSources={...local.memberSources};
 for(const move of moves){if(memberSources[move.id]||evaluation.provenance[move.id]?.sourceSnapshotId===snapshot.id)continue;const source=snapshot.layers.find(layer=>layer.id===move.from);if(source?.kind==='reference')memberSources[move.id]=source.baseSnapshotId;}
 if(Object.keys(memberSources).length)local.memberSources=memberSources;
 local.layers=target.layers.map(layer=>{const own=local.layers.find(value=>value.id===layer.id),prior=current.layers.find(value=>value.id===layer.id);if(!own||!prior)return {...layer,kind:'original' as const};if(same(prior.items,layer.items))return own;
  if(own.kind==='original'){const owned=drawingSourceOwns(snapshot,own.id)?own.items:layer.items.filter(id=>!memberSources[id]),excluded=owned.filter(id=>!layer.items.includes(id)),added=layer.items.filter(id=>!owned.includes(id));return {...own,items:[...owned],membership:{...(added.length?{addElementIds:added}:{}),...(excluded.length?{excludeElementIds:excluded}:{}),orderOverride:[...layer.items]}};}
  const removed=prior.items.filter(id=>!layer.items.includes(id)),added=layer.items.filter(id=>!prior.items.includes(id)),patch=excludeSnapshotLocalMembers(own.membership??{},removed),addElementIds=[...new Set([...patch.addElementIds??[],...added])],excluded=(patch.excludeElementIds??[]).filter(id=>!addElementIds.includes(id));
  return {...own,membership:{...(addElementIds.length?{addElementIds}:{}),...(excluded.length?{excludeElementIds:excluded}:{}),orderOverride:[...layer.items]}};
 });
 for(const state of [local.deformation,...local.inheritedState?[local.inheritedState]:[],...local.draft?[local.draft.deformation]:[]])transferSnapshotMemberState(state,current,target,moves);
 const appearanceState=edit.state==='active-draft'&&local.draft?local.draft.deformation:local.deformation;
 for(const curve of target.curves){const prior=current.curves.find(value=>value.id===curve.id)!;if(curve.localPaintOrder===prior.localPaintOrder)continue;const layer=appearanceState.layers[owner(target,curve.id)]??={};layer.curveAppearance={...layer.curveAppearance,[curve.id]:{...layer.curveAppearance?.[curve.id],...{localPaintOrder:curve.localPaintOrder??null}}};}
 const groups=patchSnapshotRelations(local.relations.groups,current.groups??[],target.groups??[],id=>drawingSourceOwns(snapshot,id));if(groups)local.relations.groups=groups;else delete local.relations.groups;
 const arranged=(drawing:DrawingDocument):DrawingDocument=>({...drawing,layers:target.layers.map(layer=>({...(drawing.layers.find(value=>value.id===layer.id)??layer),items:[...layer.items]})),...(target.groups!==undefined?{groups:target.groups}:{})});
 // Preserve both saved and active-draft controls. The existing target solver
 // handles destination domains and cross-layer shared/SMOOTH components once.
 for(const useDraft of [false,...snapshot.draft?[true]:[]]){
  const prior=useDraft&&edit.state==='active-draft'?current:resolveSnapshot(before,snapshot.id,{useDraft,diagnostics:'preview'}).drawing,wanted=arranged(prior),now=resolveSnapshot(workspace,snapshot.id,{useDraft,diagnostics:'preview'}),state=useDraft?local.draft!.deformation:local.deformation,next=captureSnapshotControlTargets(now,wanted,state,uid);
  if(useDraft)local.draft!.deformation=next;else local.deformation=next;
  assertSnapshotControlTargetReplay(resolveSnapshot(workspace,snapshot.id,{useDraft,diagnostics:'preview'}).drawing,wanted);
 }
 const actual=resolveSnapshot(workspace,snapshot.id,{useDraft:edit.state==='active-draft',diagnostics:'preview'}).drawing;
 if(!same(actual.layers.map(layer=>[layer.id,layer.items]),target.layers.map(layer=>[layer.id,layer.items])))throw Error('The layer membership cannot reproduce the requested Drawing order.');
 const reconciled=reconcileSnapshotMembershipResponses(workspace,membership);
 return {workspace:parseRecordingSnapshots(reconciled.workspace),diagnostics:reconciled.diagnostics.map(({message})=>({code:'POSE' as const,message}))};
}
