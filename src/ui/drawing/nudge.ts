import {add,curveById,objectById,type DrawingDocument as Doc,type Point2} from '../../domain/drawing/model';
import {moveHandle,moveNode,setMirrorAxis} from '../../domain/drawing/commands';
import {translateObjects} from '../../domain/drawing/movement';
import {setInkEnd} from '../../domain/drawing/paintCommands';
import {changeDisplayInterval} from '../../domain/drawing/displayIntervals';
import {inkEndpointInfo} from '../../domain/drawing/appearance';
import {clampReferenceOffset} from '../../domain/recording/reference';
import {selectedObjects,type DrawingSelection} from './session';

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
