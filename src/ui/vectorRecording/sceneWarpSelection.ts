import type {DrawingSelection} from '../drawing/session';
import {instanceObjectId,sceneLayerKey,type RecordingScene,type SceneLayerRef} from '../../domain/recordingScene/model';

export type SceneWarpAction={kind:'none'|'create'|'blocked'}|{kind:'show';warpId:string};

/** Resolve direct bindings, never a common ancestor or an implied rebind. */
export function sceneWarpAction(scene:RecordingScene,refs:readonly SceneLayerRef[]):SceneWarpAction{
 if(!refs.length)return {kind:'none'};
 const bindings=refs.map(ref=>scene.bindings.find(b=>sceneLayerKey(b)===sceneLayerKey(ref)));
 if(bindings.every(b=>!b))return {kind:'create'};
 const id=bindings[0]?.warpId;
 if(id&&bindings.every(b=>b?.warpId===id)&&scene.warps.some(w=>w.id===id))return {kind:'show',warpId:id};
 return {kind:'blocked'};
}

/** Showing a grid never implicitly selects its Warp as a save target. */
export function sceneLayerWarpSelection(scene:RecordingScene,refs:readonly SceneLayerRef[],activeWarpId:string){
 const action=sceneWarpAction(scene,refs);
 return {activeWarpId:action.kind==='show'?action.warpId:refs.length?'':activeWarpId,warpIds:[] as string[],layerRefs:refs.map(ref=>({...ref}))};
}

/** Instance removal invalidates only its namespaced source selections. */
export function pruneRemovedSceneInstanceSelection(selection:DrawingSelection,instanceId:string):DrawingSelection{
 const prefix=instanceObjectId(instanceId,''),keep=(id:string|undefined)=>id===undefined||!id.startsWith(prefix),layers=selection.layers?.filter(id=>keep(id)),paintIds=selection.paintIds?.filter(id=>keep(id));
 return {...selection,ids:selection.ids.filter(id=>keep(id)),layers,paintIds,
  layer:keep(selection.layer)?selection.layer:layers?.length===1?layers[0]:undefined,
  paint:keep(selection.paint)?selection.paint:paintIds?.length===1?paintIds[0]:undefined,
  group:keep(selection.group)?selection.group:undefined,node:keep(selection.node)?selection.node:undefined,
  handle:keep(selection.handle?.curveId)?selection.handle:undefined,
  displayInterval:keep(selection.displayInterval?.track)?selection.displayInterval:undefined,
  inkEnd:keep(selection.inkEnd?.id)?selection.inkEnd:undefined,
 };
}
