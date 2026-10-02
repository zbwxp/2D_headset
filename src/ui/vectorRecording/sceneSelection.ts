import type {SceneSelection} from '../../domain/recordingScene/commands';
import type {SceneLayerRef} from '../../domain/recordingScene/model';

/** Optional selectors are omitted when empty. The shared command contract uses
 * a supplied layerRefs list as a nonempty selection, not as a second empty kind. */
export function sceneSelectionPayload(warpIds:readonly string[],layerRefs:readonly SceneLayerRef[]):SceneSelection{
 return {...(warpIds.length?{warpIds:[...warpIds]}:{}),...(layerRefs.length?{layerRefs:layerRefs.map(ref=>({...ref}))}:{})};
}
