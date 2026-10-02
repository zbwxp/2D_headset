import {useMemo,type ReactNode} from 'react';
import LayerPanel from '../drawing/LayerPanel';
import {selectedLayers,type DrawingSelection} from '../drawing/session';
import type {DrawingDocument} from '../../domain/drawing/model';
import type {SceneEvaluation} from '../../domain/recordingScene/evaluation';
import type {SceneCommand} from '../../domain/recordingScene/commands';
import {sceneLayerKey,type RecordingScene,type SceneLayerRef,type SceneObjectRef} from '../../domain/recordingScene/model';
import {evaluateDepthTrack,evaluateVisibilityTrack} from '../../domain/recordingScene/tracks';
import '../drawing/drawing.css';
import './SceneLayerPanel.css';

export interface SceneLayerPanelProps {
 scene:RecordingScene;evaluated:SceneEvaluation;selection:DrawingSelection;
 onSelection:(selection:DrawingSelection)=>void;run:(commands:SceneCommand[])=>unknown;
 headerActions?:ReactNode;editEnabled:boolean;
}

/** Excluded source slots remain in the evaluator for offset provenance, but
 * only included scene layers belong in the editable combined layer list. */
export function sceneLayerPanelDocument(evaluated:SceneEvaluation):DrawingDocument {
 const included=new Set(evaluated.layers.filter(layer=>layer.included).map(layer=>layer.compiledLayerId));
 return {...evaluated.drawing,layers:evaluated.drawing.layers.filter(layer=>included.has(layer.id))};
}

function layerRef(evaluated:SceneEvaluation,id:string):SceneLayerRef|undefined {
 const layer=evaluated.layers.find(layer=>layer.compiledLayerId===id&&layer.included);
 return layer?{instanceId:layer.instanceId,sourceLayerId:layer.sourceLayerId}:undefined;
}
function objectRef(evaluated:SceneEvaluation,id:string):SceneObjectRef|undefined {
 const source=evaluated.provenance[id];
 if(!source?.sourceLayerId||!evaluated.layers.some(layer=>layer.included&&layer.instanceId===source.instanceId&&layer.sourceLayerId===source.sourceLayerId))return;
 if(![...evaluated.drawing.curves,...evaluated.drawing.fills,...evaluated.drawing.offsets].some(object=>object.id===id))return;
 return {instanceId:source.instanceId,sourceLayerId:source.sourceLayerId,sourceObjectId:source.sourceId};
}

/** Every Eye operates on true source members. A closed legacy layer gate must
 * first become explicit member states so revealing one member keeps its peers
 * hidden. Commands only address scene tracks; no compiled/source data is saved. */
export function sceneLayerVisibilityCommands(scene:RecordingScene,evaluated:SceneEvaluation,ids:readonly string[],visible:boolean):SceneCommand[] {
 const commands:SceneCommand[]=[],targets=new Map<string,SceneObjectRef>();
 for(const id of ids){const target=objectRef(evaluated,id);if(target)targets.set(id,target);}
 if(visible){
  const opened=new Set<string>();
  for(const target of targets.values()){
   const key=sceneLayerKey(target);if(opened.has(key))continue;
   const gate=scene.visibilityTracks.find(track=>!track.target.sourceObjectId&&sceneLayerKey(track.target)===key);
   if(!gate||evaluateVisibilityTrack(gate,scene.angle)!==false)continue;
   opened.add(key);const ref={instanceId:target.instanceId,sourceLayerId:target.sourceLayerId};
   commands.push({op:'setVisibility',target:ref,visible:true});
   const compiled=evaluated.layerMap[key],members=evaluated.drawing.layers.find(layer=>layer.id===compiled)?.items??[];
   for(const id of members){if(targets.has(id))continue;const member=objectRef(evaluated,id);if(member)commands.push({op:'setVisibility',target:member,visible:false});}
  }
 }
 for(const target of targets.values())commands.push({op:'setVisibility',target,visible});
 return commands;
}

/** A drag changes the moved layer's scene depth, normally as one command.
 * Equal-rank neighbors require spreading just that tied band, preserving the
 * requested global order across instances without rewriting source layers. */
export function sceneLayerReorderCommands(scene:RecordingScene,evaluated:SceneEvaluation,id:string,target:string,after=false):SceneCommand[] {
 const layers=sceneLayerPanelDocument(evaluated).layers,from=layers.find(layer=>layer.id===id);
 if(!from||id===target||!layers.some(layer=>layer.id===target))return [];
 const remaining=layers.filter(layer=>layer.id!==id),slot=remaining.findIndex(layer=>layer.id===target)+(after?1:0),ordered=[...remaining];ordered.splice(slot,0,from);
 if(ordered.every((layer,index)=>layer.id===layers[index].id))return [];
 const bases=new Map(evaluated.source.layers.map((layer,index)=>[layer.id,index]));
 const depth=(layerId:string)=>{const ref=layerRef(evaluated,layerId),track=ref&&scene.depthTracks?.find(track=>sceneLayerKey(track.target)===sceneLayerKey(ref));return track?evaluateDepthTrack(track,scene.angle):0;};
 const rank=(layerId:string)=>(bases.get(layerId)??0)-depth(layerId);
 const before=remaining[slot-1],next=remaining[slot],low=before?rank(before.id):undefined,high=next?rank(next.id):undefined;
 const assigned=new Map<string,number>();
 if(low===undefined)assigned.set(id,(high??0)-1);
 else if(high===undefined)assigned.set(id,low+1);
 else if(low!==high)assigned.set(id,(low+high)/2);
 else {
  let start=slot,end=slot;
  while(start>0&&rank(ordered[start-1].id)===low)start--;
  while(end<ordered.length-1&&rank(ordered[end+1].id)===low)end++;
  const lowerGap=start?low-rank(ordered[start-1].id):1,upperGap=end<ordered.length-1?rank(ordered[end+1].id)-low:1;
  const step=Math.min(1,lowerGap,upperGap)/(end-start+2),middle=(start+end)/2;
  for(let index=start;index<=end;index++)assigned.set(ordered[index].id,low+(index-middle)*step);
 }
 const commands:SceneCommand[]=[];
 for(const [layerId,value] of assigned){const ref=layerRef(evaluated,layerId),base=bases.get(layerId);if(!ref||base===undefined)continue;const offset=base-value;if(offset!==depth(layerId))commands.push({op:'setLayerOrder',target:ref,value:offset});}
 return commands;
}

const ignore=()=>{};
export default function SceneLayerPanel({scene,evaluated,selection,onSelection,run,headerActions,editEnabled}:SceneLayerPanelProps){
 const document=useMemo(()=>sceneLayerPanelDocument(evaluated),[evaluated]);
 const sections=useMemo(()=>scene.instances.map(instance=>({id:instance.id,name:instance.name,layerIds:evaluated.layers.filter(layer=>layer.instanceId===instance.id&&layer.included).map(layer=>layer.compiledLayerId)})),[scene.instances,evaluated.layers]);
 const active=selectedLayers(selection).at(-1)??null;
 const commit=(commands:SceneCommand[])=>{if(editEnabled&&commands.length)run(commands);};
 return <div className="scene-layer-panel drawing-sidebar" data-testid="scene-layer-panel"><LayerPanel
  document={document} selection={selection} active={active} choose={onSelection} setLayer={ignore}
  layerSections={sections} poseMode structuralReadOnly editEnabled={editEnabled} headerActions={headerActions}
  onVisibilityChange={(ids,visible)=>commit(sceneLayerVisibilityCommands(scene,evaluated,ids,visible))}
  onLayerReorder={(id,target,after)=>commit(sceneLayerReorderCommands(scene,evaluated,id,target,after))}
  run={ignore} openProperties={ignore} closeProperties={ignore} upload={ignore}
  deleteSelected={ignore} cutSelected={ignore} pasteSelected={ignore} canPaste={false}
 /></div>;
}
