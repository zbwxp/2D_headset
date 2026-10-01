import {worldPoint,type AssemblyFrame,type Vec3} from './model';
import {resolvePlacement,placementWeights,type PlacementRecording} from './placement';

export interface LocatorYawSample {yaw:number;world:Vec3;covered?:boolean;recorded?:boolean;keyId?:string}
export interface LocatorYawOrbit {locatorId:string;samples:LocatorYawSample[];closed?:boolean}
/** Same local-yaw evaluation as the live pose. Drafts are deliberately excluded:
 * the trajectory previews saved keys, while the point previews the current edit. */
export function locatorYawOrbits(a:AssemblyFrame&{placement?:PlacementRecording},options:{sourcePitch?:number}={}):LocatorYawOrbit[]{
 const r=a.placement?.enabled?a.placement:undefined,angles=new Set(Array.from({length:97},(_,i)=>-180+i*360/96));
 r?.keys.forEach(k=>angles.add(k.yaw));
 // Extra samples between close keys keep short, strongly corrected segments
 // readable. They still use the real evaluator, never a display-only spline.
 const keyAngles=[...new Set(r?.keys.map(k=>k.yaw)??[])].sort((a,b)=>a-b);
 for(let i=1;i<keyAngles.length;i++)for(let j=1;j<12;j++)angles.add(keyAngles[i-1]+(keyAngles[i]-keyAngles[i-1])*j/12);
 const partial=r?{...r,loop:false}:undefined;
 const samples=[...angles].sort((a,b)=>a-b).map(yaw=>{
  // Inspect one recorded pitch row while freely tilting its geometry. The
  // viewing pitch must not select a different motion row or erase its coverage.
  const pose={...a.pose,yaw},sourcePose={...pose,pitch:options.sourcePitch??pose.pitch};
  const frame=resolvePlacement(a,sourcePose,false),heights=new Map(frame.planes.map(p=>[p.id,p.height]));
  const covered=!r||r.keys.length<=1||placementWeights(r,sourcePose).covered;
  const recorded=!partial||partial.keys.length<=1||placementWeights(partial,sourcePose).covered;
  const key=r?placementWeights(r,sourcePose).exact:undefined;
  return {yaw,covered,recorded,keyId:key?.id,points:new Map(frame.locators.flatMap(l=>{const y=heights.get(l.planeId);return y===undefined?[]:[[l.id,worldPoint([l.x,y,l.z],pose)] as const];}))};
 });
 return a.locators.map(l=>{
  const own=r?.sparse?{...r,keys:r.keys.filter(k=>k.values.locators[l.id]!==undefined||k.values.planes[l.planeId]!==undefined)}:r;
  return {locatorId:l.id,closed:!own||own.loop||own.keys.length<=1,samples:samples.flatMap(s=>{
   const world=s.points.get(l.id);if(!world)return [];
   if(!r?.sparse||!own)return [{yaw:s.yaw,world,covered:s.covered,recorded:s.recorded,keyId:s.keyId}];
   const pose={yaw:s.yaw,pitch:options.sourcePitch??a.pose.pitch},e=placementWeights(own,pose),partial=placementWeights({...own,loop:false},pose);
   return [{yaw:s.yaw,world,covered:own.keys.length<=1||e.covered,recorded:own.keys.length<=1||partial.covered,keyId:e.exact?.id}];
  })};
 });
}
