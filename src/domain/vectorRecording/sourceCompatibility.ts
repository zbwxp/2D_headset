import {displayField,displayPath} from '../drawing/displayIntervals';
import {transportDeformedIntervals} from '../drawing/deform';
import {intervalPinch,withIntervalPinch} from '../drawing/intervalPinch';
import {shapeOf,type CurveUse,type DrawingDocument,type GeometryEndpoint} from '../drawing/model';
import {applyIntervalOverrides,validateIntervalOverrides} from './intervals';
import {drawingSignature,sourceIntervalFrames,type ArtworkRig,type VectorPose} from './model';

const endpoint=(e:GeometryEndpoint)=>[e.curveId,e.end];
const uses=(items:readonly CurveUse[])=>items.map(u=>[u.id,u.reverse]);
const byId=<T extends {id:string}>(items:readonly T[])=>[...items].sort((a,b)=>a.id.localeCompare(b.id));

/** Geometry coordinates and paint values may change without invalidating a rig.
 * Material identity, ownership and complete display traversal must not change. */
function structureJSON(d:DrawingDocument):string {
 return JSON.stringify({
  version:1,
  nodes:d.nodes.map(n=>n.id).sort(),
  curves:byId(d.curves).map(c=>[c.id,c.nodes]),
  layers:byId(d.layers).map(l=>[l.id,[...l.items].sort()]),
  fills:byId(d.fills).map(f=>[f.id,uses(f.boundary)]),
  offsets:byId(d.offsets).map(o=>[o.id,uses(o.source)]),
  joins:byId(d.joins).map(j=>[j.id,endpoint(j.a),endpoint(j.b),j.mode,j.mode==='ARC'?j.radius:null]),
  links:byId(d.endpointLinks??[]).map(l=>[l.id,endpoint(l.a),endpoint(l.b),l.throughDisplay===true,l.joinBrush?.kind??'SHARP',l.joinBrush?.kind==='ARC'?l.joinBrush.trimDistance:null]),
  tracks:byId(d.displayIntervals??[]).map(t=>{
   const path=displayPath(d,t.anchor.id),route=t.displayRoute;
   return [t.id,[t.anchor.id,t.anchor.reverse],t.scope??null,t.revealFrom??null,t.inferenceInkVersion??null,
    route?[route.seed.closed,uses(route.seed.segments),[...route.throughLinkIds]]:null,
    [path.closed,uses(path.segments)],t.ranges.map(r=>r.id).sort()];
  }),
 });
}
/** Compact change detector for persistence, not a security hash. The precise
 * sync path below still compares complete canonical structures directly. */
export function sourceStructureSignature(d:DrawingDocument):string {
 const json=structureJSON(d);let a=2166136261,b=2246822519;
 for(let i=0;i<json.length;i++){a=Math.imul(a^json.charCodeAt(i),16777619);b=Math.imul(b^json.charCodeAt(i),3266489917);}
 return `${json.length}:${(a>>>0).toString(16)}:${(b>>>0).toString(16)}`;
}

/** Carry accepted key appearance through a same-topology SOURCE edit exactly
 * once. Warp controls are untouched; an unknown baseline never authorizes sync. */
export function synchronizeCompatibleSource(rig:ArtworkRig,before:DrawingDocument,after:DrawingDocument):ArtworkRig|undefined {
 try {
  if(!rig.sourceSignature||rig.sourceSignature!==drawingSignature(before))return undefined;
  const structure=sourceStructureSignature(before);
  if(rig.sourceStructureSignature!==undefined&&rig.sourceStructureSignature!==structure||structureJSON(after)!==structureJSON(before))return undefined;
  const changedTracks=new Set((before.displayIntervals??[]).filter(t=>displayPath(before,t.anchor.id).segments.some(u=>JSON.stringify(shapeOf(before,u.id))!==JSON.stringify(shapeOf(after,u.id)))).map(t=>t.id));
  const move=<T extends VectorPose>(pose:T):T=>{
   if(!pose.intervalOverrides?.length)return pose;
   validateIntervalOverrides(pose.intervalOverrides,before);
   if(!pose.intervalOverrides.some(t=>changedTracks.has(t.id)))return pose;
   const old=applyIntervalOverrides(before,pose.intervalOverrides);
   for(const doc of [old,after])for(const track of pose.intervalOverrides.filter(t=>changedTracks.has(t.id))){
    const field=displayField(doc,displayPath(doc,track.anchor.id));
    if(field.geometry.error||'diagnostics' in field&&Array.isArray(field.diagnostics)&&field.diagnostics.length)throw Error('Invalid interval material geometry');
   }
   const moved=transportDeformedIntervals(old,{...after,displayIntervals:old.displayIntervals});
   // The legacy transporter clamps a source cut when a changed ARC trims it
   // away. A round trip detects that material loss instead of approving it.
   const returned=transportDeformedIntervals(moved,{...before,displayIntervals:moved.displayIntervals});
   const roundtrip=new Map(returned.displayIntervals?.map(t=>[t.id,t]));
   const tracks=new Map(moved.displayIntervals?.map(t=>[t.id,t]));
   const intervalOverrides=pose.intervalOverrides.map(t=>{
    const next=tracks.get(t.id);if(!next)throw Error('Missing interval material');
    const back=roundtrip.get(t.id),closed=displayPath(before,t.anchor.id).closed&&t.scope!=='CURVE';
    for(const r of t.ranges){const b=back?.ranges.find(x=>x.id===r.id);if(!b)throw Error('Missing interval material');
     for(const side of ['start','end'] as const){const delta=Math.abs(r[side]-b[side]);if((closed?Math.min(delta,Math.abs(1-delta)):delta)>1e-8)throw Error('Interval material was trimmed away');}
    }
    return JSON.stringify(t)===JSON.stringify(next)?t:{...next,ranges:next.ranges.map(r=>withIntervalPinch(r,intervalPinch(t.ranges.find(x=>x.id===r.id)!)))};
   });
   validateIntervalOverrides(intervalOverrides,after);
   return intervalOverrides.every((t,i)=>t===pose.intervalOverrides![i])?pose:{...pose,intervalOverrides};
  };
  const keys=rig.keys.map(move),draft=rig.draft?move(rig.draft):undefined;
  return {...rig,sourceSignature:drawingSignature(after),sourceStructureSignature:structure,sourceIntervalFrames:sourceIntervalFrames(after),
   keys:keys.every((k,i)=>k===rig.keys[i])?rig.keys:keys,...(rig.draft?{draft}:{}),
  };
 }catch{return undefined;}
}
