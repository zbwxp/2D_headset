import {junctionEnabled} from './bindingState';
import {canonical,displayShape,mirrored,mirrorShape,sameView,semanticPointId,type Recording,type View,type Cubic,type RecordedCurve,type Point2} from './model';
import {editRecordedPoint,mirrorRecordedPoint} from './points';
import {boundEndpoint,endpointIndex,endpointEditGroup,evaluateRecording,inverseJunction} from './junctions';
export const defaultShape:Cubic=[[-.55,.6],[-.85,.1],[-.65,-.6],[-.1,-.85]];
export function reorderRecordedCurve(r:Recording,id:string,targetId:string,after:boolean):Recording {
 const curve=r.curves.find(c=>c.id===id);
 if(!curve||id===targetId||!r.curves.some(c=>c.id===targetId))return r;
 const curves=r.curves.filter(c=>c.id!==id);
 curves.splice(curves.findIndex(c=>c.id===targetId)+(after?1:0),0,curve);
 return curves.every((c,i)=>c===r.curves[i])?r:{...r,curves};
}
export function updateCurve(r:Recording,id:string,fn:(c:RecordedCurve)=>RecordedCurve):Recording {return {...r,curves:r.curves.map(c=>c.id===id?fn(c):c)};}
/** Pure command: caller owns the single history transaction. Seed is evaluated before mutation. */
export function editShape(r:Recording,id:string,view:View,change:(displayed:Cubic)=>Cubic):Recording {
 const c=r.curves.find(c=>c.id===id);if(!c||c.locked)return r;
 const evaluated=evaluateRecording(r,view).get(id)!;
 const seed=structuredClone(displayShape(evaluated.shape,view));
 const before=JSON.stringify(displayShape(seed,view));
 const shape=displayShape(change(seed),view),v=canonical(view);
 if(!shape.flat().every(Number.isFinite))throw Error('Invalid cubic');
 if(JSON.stringify(shape)===before)return r;
 return writeKey(r,id,v,inverseJunction(r,id,evaluated,shape));
}
export function writeKey(r:Recording,id:string,view:View,shape:Cubic):Recording {
 const c=r.curves.find(c=>c.id===id);if(!c||c.locked)return r;
 const v=canonical(view),key={...v,shape:structuredClone(shape)};
 return updateCurve(r,id,c=>({...c,keys:c.keys.some(k=>sameView(k,v))?c.keys.map(k=>sameView(k,v)?key:k):[...c.keys,key]}));
}
export function createRecorded(r:Recording,view:View,id:string,name:string,shape:Cubic=defaultShape,auxiliary=false):Recording {
 return {...r,curves:[...r.curves,{id,name,visible:true,locked:false,...(auxiliary?{auxiliary:true}:{}),keys:[{...canonical(view),shape:displayShape(structuredClone(shape),view)}]}]};
}
export function duplicate(r:Recording,id:string,view:View,newId:string,offset:Point2):Recording {
 const c=r.curves.find(c=>c.id===id);if(!c)return r;
 const shape=displayShape(evaluateRecording(r,view).get(id)!.shape,view).map(([x,y])=>[x+(c.semantic?0:offset[0]),y+(c.semantic?0:offset[1])]) as Cubic;
 const next=createRecorded(r,view,newId,c.name+' copy',shape,c.auxiliary);
 return c.semantic||c.drawing?updateCurve(next,newId,copy=>({...copy,...(c.semantic?{semantic:{...c.semantic}}:{}),...(c.drawing?{drawing:structuredClone(c.drawing)}:{})})):next;
}
export function mirrorEdit(r:Recording,source:string,target:string,view:View):Recording {
 if(r.points?.some(p=>p.id===source))return mirrorRecordedPoint(r,source,target,view);
 if(source===target)return r;const c=r.curves.find(c=>c.id===source);if(!c)return r;
 const e=evaluateRecording(r,view).get(source)!;if(e.status==='frozen')return r;
 // Mirror in displayed coordinates, then inverse whole-view mirror for storage.
 const shape=displayShape(mirrorShape(displayShape(e.shape,view)),view),to=r.curves.find(c=>c.id===target);
 return writeKey(r,target,view,to?.semantic?inverseJunction(r,target,evaluateRecording(r,view).get(target)!,shape):shape);
}
export function mergeEndpoint(r:Recording,fixed:{id:string;end:0|3},moving:{id:string;end:0|3},view:View):Recording {
 const incoming=boundEndpoint(r,moving.id,moving.end);
 if(fixed.id===moving.id||(incoming&&junctionEnabled(incoming,view)&&!r.curves.find(c=>c.id===moving.id)?.semantic))return r;
 const c=r.curves.find(c=>c.id===fixed.id),target=r.curves.find(c=>c.id===moving.id);if(!c||!target||target.locked)return r;
 const evaluated=evaluateRecording(r,view),e=evaluated.get(fixed.id)!;if(e.status==='frozen')return r;
 if(target.semantic)return editEndpoint(r,moving.id,moving.end,view,displayShape(e.shape,view)[fixed.end]);
 const seed=structuredClone(displayShape(evaluated.get(moving.id)!.shape,view)),p=displayShape(e.shape,view)[fixed.end],old=seed[moving.end],h=moving.end===0?1:2;
 seed[h]=[seed[h][0]+p[0]-old[0],seed[h][1]+p[1]-old[1]];seed[moving.end]=[...p];
 return writeKey(r,moving.id,view,inverseJunction(r,moving.id,evaluated.get(moving.id)!,displayShape(seed,view)));
}

/** Drag any member of a shared endpoint. Keys for every participating curve are
 * authored from the same pre-edit field, in one caller-owned transaction. */
export function editEndpoint(r:Recording,id:string,end:0|3,view:View,displayed:Point2):Recording {
 if(!displayed.every(Number.isFinite)||!r.curves.some(c=>c.id===id))return r;
 const e=evaluateRecording(r,view),group=endpointEditGroup(r,{id,end},e);
 if(group.some(p=>r.curves.find(c=>c.id===p.id)!.locked))return r;
 const pointId=group.map(p=>semanticPointId(r.curves.find(c=>c.id===p.id)!,p.end)).find(Boolean);
 if(pointId)return editRecordedPoint(r,pointId,view,displayed);
 const target:Point2=[mirrored(view)?-displayed[0]:displayed[0],displayed[1]];
 const before=e.get(id)!.shape[end];if(target[0]===before[0]&&target[1]===before[1])return r;
 // Follow persistent incoming relations to the root. The DAG and single incoming
 // endpoint invariant ensure there is exactly one driver for this shared point.
 let root={id,end};
 while(true){const j=boundEndpoint(r,root.id,root.end);if(!j||!junctionEnabled(j,view))break;root={id:j.masterCurveId,end:endpointIndex(j.masterEndpoint)};}
 const shapes=new Map(group.map(p=>[p.id,structuredClone(e.get(p.id)!.rawShape)]));
 const raw=shapes.get(root.id)!,h=root.end===0?1:2,old=raw[root.end];
 raw[h]=[raw[h][0]+target[0]-old[0],raw[h][1]+target[1]-old[1]];raw[root.end]=target;
 let next=r;
 for(const [curveId,shape] of shapes)next=writeKey(next,curveId,view,shape);
 return next;
}

/** Snapshot the visible POSITION shape before disabling a relation; Smooth is derived only. */
export function setBindingState(r:Recording,junctionId:string,view:View,bound:boolean):Recording {
 const j=r.junctions?.find(x=>x.id===junctionId);if(!j)return r;
 const members=[j.masterCurveId,j.followerCurveId].map(id=>r.curves.find(c=>c.id===id)!);
 if(members.some(c=>c.locked))return r;
 const v=canonical(view),evaluated=evaluateRecording(r,view);
 // Legacy always-bound relationships get explicit support at their authored views.
 const keys=j.bindingKeys?[...j.bindingKeys]:members.flatMap(c=>c.keys).filter((k,i,a)=>a.findIndex(x=>sameView(x,k))===i).map(k=>({yaw:k.yaw,pitch:k.pitch,bound:true}));
 const key={...v,bound},bindingKeys=keys.some(k=>sameView(k,v))?keys.map(k=>sameView(k,v)?key:k):[...keys,key];
 let next=r;
 if(bound)for(const c of members)next=writeKey(next,c.id,v,evaluated.get(c.id)!.rawShape);
 if(!bound){const c=members[1],e=evaluated.get(c.id)!,shape=structuredClone(e.rawShape),end=endpointIndex(j.followerEndpoint),h=end===0?1:2;shape[end]=[...e.shape[end]];shape[h]=[...e.shape[h]];next=writeKey(next,c.id,v,shape);}
 return {...next,junctions:next.junctions!.map(x=>x.id===j.id?{...x,bindingKeys}:x)};
}
