import {junctionEnabled} from './bindingState';
import {endpointEditGroup,evaluateRecording,type RecordingEndpoint} from './junctions';
import {displayShape,semanticPointId,type Cubic,type Point2,type Recording,type View} from './model';
import {pointUsers} from './points';
import {smoothGeometry} from './smooth';
import {curveVisible} from './visibility';

export const RECORDING_SNAP_PX=10;
export interface SnapTarget {id:string;name:string;shape:Cubic;auxiliary:boolean}
export interface EndpointSnap {target:SnapTarget;point:Point2;t:number;endpoint:boolean}

/** Snapshot what is drawn at drag start. Exclude geometry that this drag moves,
 * including bound partners and dependent transitions, to avoid chasing itself. */
export function recordingSnapTargets(r:Recording,view:View,moving:RecordingEndpoint):SnapTarget[]{
 const evaluated=evaluateRecording(r,view),group=endpointEditGroup(r,moving,evaluated);
 const ids=new Set(group.map(p=>p.id));
 for(const p of group){const id=semanticPointId(r.curves.find(c=>c.id===p.id)!,p.end);if(id)for(const c of pointUsers(r,id))ids.add(c.id);}
 return targetsExcept(r,view,ids);
}
export function recordingPointSnapTargets(r:Recording,view:View,pointId:string):SnapTarget[]{
 return targetsExcept(r,view,new Set(pointUsers(r,pointId).map(c=>c.id)));
}
function targetsExcept(r:Recording,view:View,excluded:Set<string>):SnapTarget[]{
 const smooth=smoothGeometry(r,view);
 let changed=true;
 while(changed){changed=false;for(const j of r.junctions??[]){
  if(junctionEnabled(j,view)&&excluded.has(j.masterCurveId)&&!excluded.has(j.followerCurveId)){
   excluded.add(j.followerCurveId);changed=true;
  }
 }}
 const targets:SnapTarget[]=r.curves.filter(c=>!excluded.has(c.id)&&curveVisible(c,view)).map(c=>({
  id:c.id,name:c.name,shape:displayShape(smooth.sources.get(c.id)!,view),auxiliary:!!c.auxiliary,
 }));
 for(const tr of smooth.transitions){
  if(tr.trims.some(p=>excluded.has(p.id)))continue;
  const sources=tr.trims.map(p=>r.curves.find(c=>c.id===p.id)!);
  targets.push({id:tr.id,name:sources.map(c=>c.name).join(' ↔ '),shape:displayShape(tr.shape,view),auxiliary:sources.every(c=>c.auxiliary)});
 }
 return targets;
}

function pointAt(s:Cubic,t:number):Point2 {
 const a=1-t,b=[a*a*a,3*a*a*t,3*a*t*t,t*t*t];
 return [0,1].map(k=>s.reduce((sum,p,i)=>sum+p[k]*b[i],0)) as Point2;
}
function bisect(s:Cubic):[Cubic,Cubic]{
 const midpoint=(a:Point2,b:Point2):Point2=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
 const a=midpoint(s[0],s[1]),b=midpoint(s[1],s[2]),c=midpoint(s[2],s[3]);
 const d=midpoint(a,b),e=midpoint(b,c),m=midpoint(d,e);
 return [[s[0],a,d,m],[m,e,c,s[3]]];
}

/** Nearest-point search in CSS pixels, not normalized model units. Bézier hull
 * bounds retain tight bends/loops; the result is on the cubic, not a polyline. */
export function snapRecordingEndpoint(point:Point2,targets:SnapTarget[],scale:Point2):EndpointSnap|null {
 let endpoint:EndpointSnap|null=null,endpointD=RECORDING_SNAP_PX**2;
 for(const target of targets)for(const i of [0,3] as const){
  const p=target.shape[i],d=((p[0]-point[0])*scale[0])**2+((p[1]-point[1])*scale[1])**2;
  if(d<=endpointD){endpointD=d;endpoint={target,point:[...p],t:i===0?0:1,endpoint:true};}
 }
 // Prefer exact endpoints in the capture radius, making joins easy to close.
 if(endpoint)return endpoint;
 let hit:EndpointSnap|null=null,best=RECORDING_SNAP_PX**2;
 for(const target of targets){
  const screen=target.shape.map(p=>[(p[0]-point[0])*scale[0],(p[1]-point[1])*scale[1]]) as Cubic;
  const consider=(t:number)=>{const p=pointAt(screen,t),d=p[0]**2+p[1]**2;
   if(d<=best){best=d;hit={target,point:pointAt(target.shape,t),t,endpoint:false};}
  };
  const visit=(s:Cubic,lo:number,hi:number,depth:number)=>{
   const minX=Math.min(...s.map(p=>p[0])),maxX=Math.max(...s.map(p=>p[0]));
   const minY=Math.min(...s.map(p=>p[1])),maxY=Math.max(...s.map(p=>p[1]));
   const dx=Math.max(minX,0,-maxX),dy=Math.max(minY,0,-maxY);
   if(dx*dx+dy*dy>best)return;
   const mid=(lo+hi)/2;consider(mid);
   if(depth===0||Math.hypot(maxX-minX,maxY-minY)<.02)return;
   const [a,b]=bisect(s);visit(a,lo,mid,depth-1);visit(b,mid,hi,depth-1);
  };
  visit(screen,0,1,24);
 }
 return hit;
}
