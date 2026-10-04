import type {CurveSplitIntent} from '../drawing/layerEditIntent';
import type {DrawingDocument} from '../drawing/model';
import {mirrorSnapshotDrawing,type SnapshotMirrorOptions,type SnapshotSplitMirrorMaterial} from './snapshotMirror';

/** Curve-local split tracks normalize their native direction. Keep the exact
 * pre-split semantic track/range pairing instead of asking the changed anchor
 * signatures to infer it again. This is identity/parity data only. */
export function splitSnapshotMirrorMaterial(parent:DrawingDocument,mirror:SnapshotMirrorOptions,intents:readonly CurveSplitIntent[]):SnapshotSplitMirrorMaterial[]|undefined {
 const explicit=new Set(mirror.curvePairs.flatMap(pair=>[pair.a,pair.b])),curves=new Set(parent.curves.map(curve=>curve.id)),pairs=[...mirror.curvePairs,...(parent.mirrorEditing?.curvePairs??[]).filter(pair=>!explicit.has(pair.a)&&!explicit.has(pair.b))].filter(pair=>curves.has(pair.a)&&curves.has(pair.b));
 const mapped=mirrorSnapshotDrawing(parent,{...mirror,curvePairs:pairs}).correspondence,tracks=new Map((parent.displayIntervals??[]).map(track=>[track.id,track])),plans=new Map(intents.flatMap(intent=>intent.intervals.map(track=>[track.trackId,{intent,track}] as const))),retired=new Set(plans.keys()),result=(mirror.splitMaterials??[]).filter(pair=>!retired.has(pair.a)&&!retired.has(pair.b)),seen=new Set<string>();
 for(const [id,source] of plans){
  if(seen.has(id)||!tracks.has(id))continue;
  const other=mapped.displayIntervals[id],target=plans.get(other),track=tracks.get(id)!;
  if(!target||!tracks.has(other))continue;
  // An unmatched material moves to another curve while retaining its ID; it
  // has no second allocated child plan and remains a preflight boundary.
  if(target.intent.curveId!==mapped.curves[track.anchor.id].id)continue;
  seen.add(id);seen.add(other);const reverse=mapped.curves[track.anchor.id].reverse;
  for(const side of [0,1] as const){const targetSide=reverse?1-side:side;
   result.push({a:side?source.track.rightTrackId:id,b:targetSide?target.track.rightTrackId:other,ranges:source.track.ranges.map(range=>{const otherRange=mapped.ranges[range.rangeId],right=target.track.ranges.find(value=>value.rangeId===otherRange);if(!right)throw Error(`Mirror split material ${id} has no exact range identity ${range.rangeId}.`);return {a:side?range.rightRangeId:range.rangeId,b:targetSide?right.rightRangeId:otherRange};})});
  }
 }
 return result.length?result:undefined;
}
