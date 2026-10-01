import {uid,type DrawingDocument,type DrawingCurve,type Point2,type StrokeDisplayIntervals} from '../drawing/model';
import type {Hairstyle} from './model';
import {generateHair,type SectionArc} from './geometry';
import {projectHairDrawing} from './drawing';
import {fixedHairRange,resolveHairRange,type HairEndpoint,type HairStrandRule} from './strandTypes';
import {defaultPumpkinProfile,PUMPKIN_LIMITS,hairFrontCoordinates} from './profile';
import {surfaceFromView} from './surfaceCurve';

const clamp=(x:number,min=-1,max=1)=>Math.max(min,Math.min(max,x));
const samples=(random:()=>number):[number,number]=>[clamp(random(),0,1),clamp(random(),0,1)];
function endpoint(h:Hairstyle,id:string,p:Point2):HairEndpoint {
 const q=hairFrontCoordinates(h.net,p);
 return {id,x:fixedHairRange(clamp(q[0])),y:fixedHairRange(clamp(q[1])),sample:[.5,.5]};
}
/** Upgrade the editor once, after extracting old spherical attachments. Explicit
 * null is the user's ellipsoid comparison choice and must survive reopening. */
export function profileHair(input:Hairstyle):Hairstyle {
 const h=independentHair(input);
 if(h.net.profile===null||h.net.profile?.version===2)return h;
 const profile=defaultPumpkinProfile(),old=h.net.profile;
 if(old)for(const key of ['width','shoulder','crown','lower'] as const)profile[key]=clamp(old[key],...PUMPKIN_LIMITS[key]);
 profile.insetStart=profile.shoulder;
 return syncStrands({...h,net:{...h.net,profile}});
}
/** One-time conversion. Old roles become ordinary strands; author IDs and ink survive. */
export function independentHair(h:Hairstyle):Hairstyle {
 if(h.strandSet)return h;
 const g=generateHair(h),arcs=new Map<string,SectionArc>([...(h.generated?.boundaryIds??[]).map((id,i)=>[id,g.arcs[i]] as const),...(h.generated?.centerIds??[]).map((id,i)=>[id,g.centerArcs[i]] as const),...g.interiorArcs.map(a=>[a.id,a] as const)]);
 const curves=h.drawing.curves.map((c):HairStrandRule=>{
  const range=h.drawing.displayIntervals?.find(t=>t.anchor.id===c.id)?.ranges[0];
  return {id:c.id,nodes:[...c.nodes],angle:arcs.get(c.id)?.requestedAngle??25,start:fixedHairRange(range?.start??0),end:fixedHairRange(range?.end??1),sample:[.5,.5]};
 });
 const used=new Set(curves.flatMap(c=>c.nodes));
 return syncStrands({...h,generated:undefined,strandSet:{version:1,curves,endpoints:h.drawing.nodes.filter(n=>used.has(n.id)).map(n=>endpoint(h,n.id,n.position))}});
}
/** Change the front construction, then derive every camera from the same recipe. */
export function syncStrands(h:Hairstyle):Hairstyle {
 if(!h.strandSet)return independentHair(h);
 const owned=new Set(h.strandSet.curves.map(c=>c.id)),d=h.drawing;
 const byId=new Map((d.displayIntervals??[]).map(t=>[t.anchor.id,t]));
 const tracks:StrokeDisplayIntervals[]=(d.displayIntervals??[]).filter(t=>!owned.has(t.anchor.id));
 for(const c of h.strandSet.curves){
  const old=byId.get(c.id),a=clamp(resolveHairRange(c.start,c.sample[0]),0,1),b=clamp(resolveHairRange(c.end,c.sample[1]),0,1);
  if(old?.scope==='CURVE'&&!old.anchor.reverse&&old.ranges.length===1&&old.ranges[0].mode==='SHOW'&&old.ranges[0].start===Math.min(a,b)&&old.ranges[0].end===Math.max(a,b)){tracks.push(old);continue;}
  tracks.push({id:old?.id??c.id+':display',anchor:{id:c.id,reverse:false},scope:'CURVE',ranges:[{id:old?.ranges[0]?.id??c.id+':range',mode:'SHOW',start:Math.min(a,b),end:Math.max(a,b),inkEnds:old?.ranges[0]?.inkEnds??[{taper:0},{taper:0}]}]});
 }
 const next={...h,drawing:{...d,displayIntervals:tracks}};
 return {...next,drawing:projectHairDrawing(next,generateHair(next),{yaw:0,pitch:0})};
}
/** Reconcile shared Drawing operations with the procedural authoring graph.
 * A bound Drawing node is one sampled surface endpoint, including after reroll.
 * Deleting a strand deletes its recipe; duplication clones its random settings. */
export function editHairDrawing(input:Hairstyle,drawing:DrawingDocument):Hairstyle {
 const h=independentHair(input),set=h.strandSet!,old=h.drawing;
 const endpoints=new Map(set.endpoints.map(e=>[e.id,e]));
 const sourceFor=(c:DrawingCurve)=>{
  const point=(d:DrawingDocument,c:DrawingCurve)=>d.nodes.find(n=>n.id===c.nodes[0])!.position;
  const p=point(drawing,c),q=drawing.nodes.find(n=>n.id===c.nodes[1])!.position;
  return old.curves.find(o=>{const a=point(old,o),b=old.nodes.find(n=>n.id===o.nodes[1])!.position;
   return Math.hypot(q[0]-p[0]-b[0]+a[0],q[1]-p[1]-b[1]+a[1],...c.handles.flatMap((v,i)=>v.map((x,j)=>x-p[j]-o.handles[i][j]+a[j])))<1e-7;
  });
 };
 const curves=drawing.curves.map((c):HairStrandRule=>{
  const existing=set.curves.find(r=>r.id===c.id),source=existing?old.curves.find(o=>o.id===c.id):sourceFor(c),template=existing??set.curves.find(r=>r.id===source?.id);
  c.nodes.forEach((id,i)=>{if(endpoints.has(id))return;
   const p=drawing.nodes.find(n=>n.id===id)!.position,sourceId=source?.nodes[i],prior=sourceId?endpoints.get(sourceId):undefined;
   if(prior&&source){const q=hairFrontCoordinates(h.net,old.nodes.find(n=>n.id===sourceId)!.position),a=hairFrontCoordinates(h.net,p);endpoints.set(id,{...structuredClone(prior),id,x:{...prior.x,value:clamp(prior.x.value+a[0]-q[0])},y:{...prior.y,value:clamp(prior.y.value+a[1]-q[1])}});}
   else endpoints.set(id,endpoint(h,id,p));
  });
  return template?{...structuredClone(template),id:c.id,nodes:[...c.nodes]}:{id:c.id,nodes:[...c.nodes],angle:25,start:fixedHairRange(0),end:fixedHairRange(1),sample:[.5,.5]};
 });
 const used=new Set(curves.flatMap(c=>c.nodes));
 return syncStrands({...h,drawing,strandSet:{version:1,curves,endpoints:[...endpoints.values()].filter(e=>used.has(e.id))}});
}
export function addStrand(input:Hairstyle,layerId:string|null,sourceId?:string):Hairstyle {
 const h=independentHair(input),d=h.drawing,set=h.strandSet!,source=set.curves.find(c=>c.id===sourceId),id=uid(),nodes:[string,string]=[uid(),uid()];
 if(set.curves.length>=1000)throw Error('发丝数量已达上限 / Strand limit reached');
 const sourceCurve=d.curves.find(c=>c.id===sourceId),layer=d.layers.find(l=>l.id===layerId)??d.layers[0];
 if(layer?.locked)throw Error('请先解锁当前图层 / Unlock the current layer first');
 const endpoints=nodes.map((id,i)=>source?{...structuredClone(set.endpoints.find(e=>e.id===source.nodes[i])!),id}:endpoint(h,id,i?[.03,-.2]:[0,.8]));
 const rule:HairStrandRule=source?{...structuredClone(source),id,nodes}:{id,nodes,angle:25,start:fixedHairRange(0),end:fixedHairRange(1),sample:[.5,.5]};
 const curve:DrawingCurve={id,nodes,name:`发丝 ${d.curves.length+1}`,visible:true,locked:false,handles:[[0,0],[0,0]],width:sourceCurve?.width??.008,inkEnds:[{taper:0},{taper:0}]};
 const target=layer??{id:uid(),name:'发丝',visible:true,locked:false,items:[]};
 const next=syncStrands({...h,strandSet:{version:1,endpoints:[...set.endpoints,...endpoints],curves:[...set.curves,rule]},drawing:{...d,nodes:[...d.nodes,...nodes.map(id=>({id,position:[0,0] as Point2}))],curves:[...d.curves,curve],layers:layer?d.layers.map(l=>l.id===layer.id?{...l,items:[id,...l.items]}:l):[{...target,items:[id]}]}});
 if(rule.surface)return next;
 const arc=generateHair(next).strands!.find(a=>a.id===id)!,surface=surfaceFromView(next.net,arc,{yaw:0,pitch:0});
 return syncStrands({...next,strandSet:{...next.strandSet!,curves:next.strandSet!.curves.map(c=>c.id===id?{...c,surface}:c)}});
}
export function rerollStrands(input:Hairstyle,ids?:string[],random:()=>number=Math.random):Hairstyle {
 const h=independentHair(input),set=h.strandSet!,locked=new Set(h.drawing.curves.filter(c=>c.locked).map(c=>c.id)),selected=new Set((ids??set.curves.map(c=>c.id)).filter(id=>!locked.has(id))),lockedNodes=new Set(set.curves.filter(c=>locked.has(c.id)).flatMap(c=>c.nodes)),nodes=new Set(set.curves.filter(c=>selected.has(c.id)).flatMap(c=>c.nodes).filter(id=>!lockedNodes.has(id)));
 return syncStrands({...h,strandSet:{version:1,endpoints:set.endpoints.map(e=>nodes.has(e.id)?{...e,sample:samples(random)}:e),curves:set.curves.map(c=>selected.has(c.id)?{...c,sample:samples(random)}:c)}});
}
