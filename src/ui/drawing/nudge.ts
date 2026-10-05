import {add,curveById,objectById,type DrawingDocument as Doc,type Point2} from '../../domain/drawing/model';
import {moveHandle,moveNode,setMirrorAxis} from '../../domain/drawing/commands';
import {translateObjects} from '../../domain/drawing/movement';
import {setInkEnd} from '../../domain/drawing/paintCommands';
import {changeDisplayInterval} from '../../domain/drawing/displayIntervals';
import {inkEndpointInfo} from '../../domain/drawing/appearance';
import {clampReferenceOffset} from '../../domain/recording/reference';
import {selectedObjects,type DrawingSelection} from './session';
import {prepareDrawingControlEditPlan,applyDrawingControlEditPlan,type DrawingControlEditPlan} from '../../domain/drawing/controlEditPlan';

export type DrawingNudgePlan=
 |{readonly kind:'geometry';readonly before:Doc;readonly selection:DrawingSelection;readonly controlPlan:DrawingControlEditPlan;readonly origin?:Point2}
 |{readonly kind:'mirror-axis'|'reference'|'display-interval'|'ink-end'|'objects';readonly before:Doc;readonly selection:DrawingSelection};

/** Freeze the semantic target once. Metadata/material controls keep their
 * existing command, while scalar geometry uses the pointer authoring plan. */
export function prepareDrawingNudgePlan(before:Doc,selection:DrawingSelection):DrawingNudgePlan {
 const s=structuredClone(selection),base={before,selection:s};
 if(s.mirrorAxis)return {...base,kind:'mirror-axis'};
 if(s.reference)return {...base,kind:'reference'};
 if(s.displayInterval)return {...base,kind:'display-interval'};
 if(s.handle){const curve=curveById(before,s.handle.curveId);if(curve)return {...base,kind:'geometry',origin:[...curve.handles[s.handle.end]],controlPlan:prepareDrawingControlEditPlan(before,{kind:'handle',endpoint:s.handle,allowHidden:true})};}
 if(s.node){const node=before.nodes.find(n=>n.id===s.node);if(node)return {...base,kind:'geometry',origin:[...node.position],controlPlan:prepareDrawingControlEditPlan(before,{kind:'node',nodeId:s.node,allowHidden:true})};}
 if(s.inkEnd)return {...base,kind:'ink-end'};
 const ids=selectedObjects(s);
 // Mixed paint selections own boundary/offset transport in translateObjects.
 // Its complete canonical command must not be narrowed to only curve IDs.
 if(ids.some(id=>!curveById(before,id)))return {...base,kind:'objects'};
 return {...base,kind:'geometry',controlPlan:prepareDrawingControlEditPlan(before,{kind:'curves',curveIds:ids,allowHidden:true})};
}
export function applyDrawingNudgePlan(plan:DrawingNudgePlan,offset:Point2,previous=plan.before,delta=offset):Doc {
 if(plan.kind!=='geometry')return plan.kind==='objects'?nudgeSelection(plan.before,plan.selection,offset):nudgeSelection(previous,plan.selection,delta);
 return applyDrawingControlEditPlan(plan.controlPlan,plan.origin?{kind:'point',position:add(plan.origin,offset)}:{kind:'map',map:point=>add(point,offset),allowRelated:true});
}

export const hasNudgeTarget=(s:DrawingSelection)=>!!(s.mirrorAxis||s.reference||s.displayInterval||s.inkEnd||s.handle||s.node||selectedObjects(s).length);
export function nudgeSelection(d:Doc,s:DrawingSelection,delta:Point2):Doc{
 if(s.mirrorAxis)return delta[0]?setMirrorAxis(d,(d.mirrorAxisX??0)+delta[0]):d;
 if(s.reference){const ref=d.reference;if(!ref)return d;if(ref.locked)throw Error('对象已锁定。');
  const offset=add(ref.offset,delta).map(clampReferenceOffset) as Point2;return offset.every((v,i)=>v===ref.offset[i])?d:{...d,reference:{...ref,offset}};
 }
 if(s.displayInterval){const g=s.displayInterval,track=d.displayIntervals?.find(t=>t.id===g.track),range=track?.ranges.find(r=>r.id===g.range);if(!range)return d;
  const key=g.end?'end':'start',value=Math.max(0,Math.min(1,range[key]+delta[0]+delta[1]));return changeDisplayInterval(d,g.track,g.range,{[key]:value});
 }
 if(s.handle){const curve=curveById(d,s.handle.curveId);return curve?moveHandle(d,s.handle,add(curve.handles[s.handle.end],delta),true):d;}
 if(s.node){const node=d.nodes.find(n=>n.id===s.node);return node?moveNode(d,node.id,add(node.position,delta),true):d;}
 if(s.inkEnd){
  const {id,end}=s.inkEnd,c=curveById(d,id),o=d.offsets.find(o=>o.id===id);if(!c&&!o)return d;
  if(objectById(d,id)!.locked)throw Error('对象已锁定。');
  const info=inkEndpointInfo(d,id,end),tip=info?.tip;if(!tip||!info.enabled)return d;
  const style=(c??o!).inkEnds?.[end],extension=Math.max(0,Math.min(2,(style?.extension??0)+delta[0]*tip.direction[0]+delta[1]*tip.direction[1]));
  if(extension===(style?.extension??0))return d;
  return setInkEnd(d,id,end,{extension});
 }
 return translateObjects(d,selectedObjects(s),delta);
}
