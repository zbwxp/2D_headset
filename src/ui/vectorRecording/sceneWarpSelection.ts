import {sceneLayerKey,type RecordingScene,type SceneLayerRef} from '../../domain/recordingScene/model';

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
