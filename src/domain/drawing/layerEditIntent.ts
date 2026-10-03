import {splitCurve} from './commands';
import {curveById,layerFor,uid,type DrawingDocument} from './model';
import type {MirrorCurvePair} from './mirrorEditing';

/** A split is authored before parsing or synchronizing a Drawing document. Its
 * IDs travel beside the document through the transaction, never as document
 * metadata or a geometry-derived guess. Geometry is deliberately absent: the
 * same plan can split each reference's already-deformed controls. */
export interface CurveSplitIntent {
 readonly kind:'split-curve';
 readonly curveId:string;
 readonly sourceLayerId:string;
 readonly sourceNodeIds:readonly [string,string];
 /** Native source-curve parameter, independent of any path traversal. */
 readonly t:number;
 readonly childCurveIds:readonly [string,string];
 readonly seamNodeId:string;
 readonly seamJoinId:string;
 readonly intervals:readonly CurveSplitIntervalIdentities[];
 readonly correspondenceNotice?:string;
}
export interface CurveSplitIntervalIdentities {
 readonly trackId:string;
 readonly rightTrackId:string;
 readonly ranges:readonly {readonly rangeId:string;readonly rightRangeId:string}[];
}
/** Bounded first explicit topology intent; add/delete remain existing commands. */
export interface PairedCurveSplitIntent {
 readonly kind:'split-curves';
 readonly splits:readonly CurveSplitIntent[];
 readonly mirrorPairs:readonly {readonly oldPairId:string;readonly left:MirrorCurvePair;readonly right:MirrorCurvePair}[];
}
export type LayerEditIntent=CurveSplitIntent|PairedCurveSplitIntent;
export interface CurveSplitProvenance {
 readonly sourceCurveId:string;
 readonly sourceNodeIds:readonly [string,string];
 readonly splitT:number;
 readonly children:readonly [
  {readonly curveId:string;readonly sourceInterval:readonly [0,number]},
  {readonly curveId:string;readonly sourceInterval:readonly [number,1]},
 ];
 readonly seamNodeId:string;
}
export interface CurveSplitIntentOptions {
 allocateId?:()=>string;
 /** Freeze the affected references before preparing the plan. Their local
  * interval additions need identities in the same allocation pass. */
 relatedDrawings?:readonly DrawingDocument[];
}
const allIds=(drawing:DrawingDocument)=>[
 ...drawing.nodes,...drawing.curves,...drawing.layers,...drawing.fills,...drawing.offsets,...drawing.joins,
 ...(drawing.endpointLinks??[]),...(drawing.groups??[]),...(drawing.displayIntervals??[]),
 ...(drawing.displayIntervals??[]).flatMap(track=>track.ranges),...(drawing.mirrorEditing?.curvePairs??[]),
].map(value=>value.id);
const validT=(t:number)=>Number.isFinite(t)&&t>1e-5&&t<1-1e-5;
const allocatedIds=(intent:CurveSplitIntent)=>[
 ...intent.childCurveIds,intent.seamNodeId,intent.seamJoinId,
 ...intent.intervals.flatMap(track=>[track.rightTrackId,...track.ranges.map(range=>range.rightRangeId)]),
];

/** Allocate all topology/material identities once, before any document changes.
 * The first track/range identities survive on the left child. The planned new
 * IDs identify their right-hand counterparts in every affected snapshot. */
export function createCurveSplitIntent(drawing:DrawingDocument,curveId:string,t:number,options:CurveSplitIntentOptions={}):CurveSplitIntent {
 const curve=curveById(drawing,curveId),layer=layerFor(drawing,curveId);
 if(!curve||!layer)throw Error('The curve to split does not exist.');
 if(!validT(t))throw Error('Choose a finite split parameter inside the curve.');
 const drawings=[drawing,...(options.relatedDrawings??[])],occupied=new Set(drawings.flatMap(allIds)),allocate=options.allocateId??uid;
 const fresh=()=>{const id=allocate();if(typeof id!=='string'||!id||occupied.has(id))throw Error('The split identity allocator returned an existing or invalid ID.');occupied.add(id);return id;};
 const childCurveIds:[string,string]=[fresh(),fresh()],seamNodeId=fresh(),seamJoinId=fresh(),tracks=new Map<string,Set<string>>();
 for(const document of drawings)for(const track of document.displayIntervals??[])if(track.scope==='CURVE'&&track.anchor.id===curveId){
  let ranges=tracks.get(track.id);if(!ranges){ranges=new Set();tracks.set(track.id,ranges);}for(const range of track.ranges)ranges.add(range.id);
 }
 const intervals=[...tracks].sort(([a],[b])=>a.localeCompare(b)).map(([trackId,ranges])=>({trackId,rightTrackId:fresh(),ranges:[...ranges].sort().map(rangeId=>({rangeId,rightRangeId:fresh()}))}));
 return {kind:'split-curve',curveId,sourceLayerId:layer.id,sourceNodeIds:[...curve.nodes],t,childCurveIds,seamNodeId,seamJoinId,intervals};
}

/** Explicit source/presentation ID conversion also covers the allocated IDs.
 * An identity mapper must leave unknown fresh IDs unchanged. */
export function mapCurveSplitIntent(intent:CurveSplitIntent,id:(id:string)=>string):CurveSplitIntent {
 return {...intent,curveId:id(intent.curveId),sourceLayerId:id(intent.sourceLayerId),sourceNodeIds:intent.sourceNodeIds.map(id) as [string,string],childCurveIds:intent.childCurveIds.map(id) as [string,string],seamNodeId:id(intent.seamNodeId),seamJoinId:id(intent.seamJoinId),intervals:intent.intervals.map(track=>({trackId:id(track.trackId),rightTrackId:id(track.rightTrackId),ranges:track.ranges.map(range=>({rangeId:id(range.rangeId),rightRangeId:id(range.rightRangeId)}))}))};
}

/** Fail before any mutation or allocation, including stale orientation and an
 * unplanned material range. A reference may own a different layer slot. */
export function assertCurveSplitIntent(drawing:DrawingDocument,intent:CurveSplitIntent):void {
 if(intent.kind!=='split-curve'||!validT(intent.t)||!intent.curveId||!intent.sourceLayerId||intent.childCurveIds.length!==2||intent.sourceNodeIds.length!==2)throw Error('Invalid curve split intent.');
 const curve=curveById(drawing,intent.curveId);
 if(!curve||curve.nodes.some((id,end)=>id!==intent.sourceNodeIds[end]))throw Error('The split intent no longer matches the source curve topology.');
 const fresh=allocatedIds(intent),occupied=new Set(allIds(drawing));
 if(fresh.some(id=>typeof id!=='string'||!id||occupied.has(id))||new Set(fresh).size!==fresh.length)throw Error('The split intent contains an existing or duplicate new identity.');
 if(new Set(intent.intervals.map(track=>track.trackId)).size!==intent.intervals.length||intent.intervals.some(track=>!track.trackId||new Set(track.ranges.map(range=>range.rangeId)).size!==track.ranges.length||track.ranges.some(range=>!range.rangeId)))throw Error('The split intent contains invalid material identities.');
 for(const track of drawing.displayIntervals??[])if(track.scope==='CURVE'&&track.anchor.id===intent.curveId){
  const plan=intent.intervals.find(value=>value.trackId===track.id);
  if(!plan||track.ranges.some(range=>!plan.ranges.some(value=>value.rangeId===range.id)))throw Error('The split intent is missing a curve-local material identity. Prepare the plan from all affected snapshots.');
 }
}

export function curveSplitProvenance(intent:CurveSplitIntent):CurveSplitProvenance {
 return {sourceCurveId:intent.curveId,sourceNodeIds:[...intent.sourceNodeIds],splitT:intent.t,children:[{curveId:intent.childCurveIds[0],sourceInterval:[0,intent.t]},{curveId:intent.childCurveIds[1],sourceInterval:[intent.t,1]}],seamNodeId:intent.seamNodeId};
}

/** Map a known source material parameter, including a reversed path's native
 * parameter. At the seam either child is equivalent; default to the left. */
export function splitCurveParameter(intent:CurveSplitIntent,t:number,seamSide:0|1=0):{curveId:string;t:number} {
 if(!Number.isFinite(t)||t<0||t>1||!validT(intent.t))throw Error('Invalid split material parameter.');
 const side=t>intent.t||t===intent.t&&seamSide===1?1:0;
 return {curveId:intent.childCurveIds[side],t:side?(t-intent.t)/(1-intent.t):t/intent.t};
}

/** Pure dry run/application. Propagation preserves hidden/locked reference
 * states; the initiating authoring command must have passed its normal guards.
 * This uses Drawing's sole split kernel and never allocates an identity. */
export function applyCurveSplitIntent(drawing:DrawingDocument,intent:CurveSplitIntent,options:{propagate?:boolean}={}) {
 const result=splitCurve(drawing,intent.curveId,intent.t,{intent,...options});
 return {...result,intent,provenance:curveSplitProvenance(intent)};
}

export const curveSplitIntents=(intent:LayerEditIntent):readonly CurveSplitIntent[]=>intent.kind==='split-curves'?intent.splits:[intent];
/** Mirror is an editing behavior: only enabled correspondence adds a second
 * target. With the toggle off the ordinary split only retires stale metadata. */
export function createLayerCurveSplitIntent(drawing:DrawingDocument,curveId:string,t:number,options:CurveSplitIntentOptions={}):LayerEditIntent {
 const occupied=new Set([drawing,...(options.relatedDrawings??[])].flatMap(allIds)),allocate=options.allocateId??uid;
 const fresh=()=>{const id=allocate();if(!id||occupied.has(id))throw Error('The split identity allocator returned an existing or invalid ID.');occupied.add(id);return id;};
 const first=createCurveSplitIntent(drawing,curveId,t,{...options,allocateId:fresh}),pair=drawing.mirrorEditing?.enabled?drawing.mirrorEditing.curvePairs.find(value=>value.a===curveId||value.b===curveId):undefined;
 if(!pair)return first;
 // A reversed self-pair has no second curve identity. Keep the explicit split
 // and retire that correspondence instead of constraining the topology edit.
 if(pair.a===pair.b&&pair.reverse)return {...first,correspondenceNotice:'The curve was split normally. Its reversed self-mirror correspondence was removed because it no longer identifies one curve.'};
 const otherId=pair.a===curveId?pair.b:pair.a,second=otherId===curveId?first:createCurveSplitIntent(drawing,otherId,pair.reverse?1-t:t,{...options,allocateId:fresh});
 const a=pair.a===curveId?first:second,b=pair.b===curveId?first:second;
 return {kind:'split-curves',splits:first===second?[first]:[first,second],mirrorPairs:[{oldPairId:pair.id,left:{id:fresh(),a:a.childCurveIds[0],b:b.childCurveIds[pair.reverse?1:0],reverse:pair.reverse},right:{id:fresh(),a:a.childCurveIds[1],b:b.childCurveIds[pair.reverse?0:1],reverse:pair.reverse}}]};
}
export function mapLayerEditIntent(intent:LayerEditIntent,id:(id:string)=>string):LayerEditIntent {
 if(intent.kind==='split-curve')return mapCurveSplitIntent(intent,id);
 const pair=(value:MirrorCurvePair):MirrorCurvePair=>({...value,id:id(value.id),a:id(value.a),b:id(value.b)});
 return {...intent,splits:intent.splits.map(value=>mapCurveSplitIntent(value,id)),mirrorPairs:intent.mirrorPairs.map(value=>({oldPairId:id(value.oldPairId),left:pair(value.left),right:pair(value.right)}))};
}
export function applyLayerEditIntent(drawing:DrawingDocument,intent:LayerEditIntent,options:{propagate?:boolean}={}) {
 if(intent.kind==='split-curve')return applyCurveSplitIntent(drawing,intent,options);
 let document=drawing;for(const split of intent.splits)document=applyCurveSplitIntent(document,split,options).document;
 if(drawing.mirrorEditing){const replaced=new Set(intent.mirrorPairs.map(value=>value.oldPairId));document={...document,mirrorEditing:{...drawing.mirrorEditing,curvePairs:[...drawing.mirrorEditing.curvePairs.filter(pair=>!replaced.has(pair.id)&&document.curves.some(curve=>curve.id===pair.a)&&document.curves.some(curve=>curve.id===pair.b)),...intent.mirrorPairs.flatMap(value=>[value.left,value.right])]}};}
 return {document,intent,ids:[...intent.splits[0].childCurveIds],provenance:intent.splits.map(curveSplitProvenance)};
}
