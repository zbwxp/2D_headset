import {layerFor,type DrawingDocument,type StrokeDisplayIntervals} from '../drawing/model';
import type {WarpGrid} from '../vectorWarp/model';
import type {Angle} from '../vectorRecording/interpolation';
import type {ArtworkRig} from '../vectorRecording/model';
export type {Angle,WarpGrid};

export interface SceneLayerRef {instanceId:string;sourceLayerId:string}
export interface SceneObjectRef extends SceneLayerRef {/** Omitted means the entire layer. */sourceObjectId?:string}
export interface SceneKey<T> {id:string;name?:string;angle:Angle;value:T}
export interface SceneDraft<T> {angle:Angle;value:T}
/** Every object owns its sampling coordinates. A draft belongs to its own angle,
 * and never locks the scene cursor or adds keys to another object. */
export interface SceneTrack<T> {keys:SceneKey<T>[];draft?:SceneDraft<T>;interpolation?:'independent'|'legacy'}
export interface SceneInstance {
 id:string;artworkId:string;name:string;
 /** Omitted follows all current source layers, including later additions. */
 layerIds?:string[];
 /** Material-migration evidence only; never freezes the resolved source. */
 sourceSignature?:string;sourceStructureSignature?:string;sourceIntervalFrames?:ArtworkRig['sourceIntervalFrames'];
}
export interface SceneWarp extends SceneTrack<WarpGrid> {id:string;name:string;parentId?:string;restGrid:WarpGrid}
export interface SceneLayerBinding extends SceneLayerRef {warpId:string}
export interface SceneVisibilityTrack extends SceneTrack<boolean|null> {id:string;target:SceneObjectRef}
/** Null appearance inherits current source. Enabled flags are held separately
 * and applied after range interpolation, preserving legacy mixed SHOW/HIDE IDs. */
export interface SceneIntervalValue {appearance:StrokeDisplayIntervals|null;enabled:Record<string,boolean>}
export interface SceneIntervalTrack extends SceneTrack<SceneIntervalValue> {
 id:string;instanceId:string;sourceTrackId:string;
 /** Failed material migration suspends only this channel while the source
  * differs from its last valid baseline. Undo to that exact source reconnects. */
 materialIssue?:{sourceSignature:string;message:string};
}
export interface SceneDepthTrack extends SceneTrack<number> {id:string;target:SceneLayerRef}
/** A named editing position, independent of the scene's object tracks. */
export interface SceneViewpoint {id:string;name:string;angle:Angle}
export interface RecordingScene {
 id:string;name:string;angle:Angle;instances:SceneInstance[];warps:SceneWarp[];
 /** Absent on older scenes, whose UI may derive positions from track keys. */
 viewpoints?:SceneViewpoint[];
 bindings:SceneLayerBinding[];visibilityTracks:SceneVisibilityTrack[];intervalTracks:SceneIntervalTrack[];depthTracks?:SceneDepthTrack[];
 tolerance?:number;
 legacy?:{rigId:string;appearancePending?:boolean};
}
export interface RecordingScenes {version:1;activeSceneId?:string;scenes:RecordingScene[]}
export type SceneSourceResolver=(artworkId:string)=>DrawingDocument|undefined;
export interface SceneDiagnostic {
 code:'MISSING_SOURCE'|'MISSING_LAYER'|'MISSING_OBJECT'|'MISSING_INTERVAL'|'INTERVAL_APPEARANCE'|'ROUTE'|'SOURCE_MATERIAL'|'PARTIAL_INSTANCE'|'LOCAL_SPACE';
 message:string;instanceId?:string;sourceLayerId?:string;sourceObjectId?:string;trackId?:string;
}
export interface SceneSourceObject {instanceId:string;artworkId:string;sourceId:string;sourceLayerId?:string}

/** JSON tuples avoid separator parsing and collisions in user-supplied IDs. */
export const sceneLayerKey=(ref:SceneLayerRef):string=>JSON.stringify([ref.instanceId,ref.sourceLayerId]);
export const sceneObjectKey=(instanceId:string,sourceId:string):string=>JSON.stringify([instanceId,sourceId]);
/** The source suffix is unchanged, preserving traversal's source ID ordering.
 * The fixed, length-delimited instance prefix makes cross-instance IDs unique. */
export const instanceObjectId=(instanceId:string,sourceId:string):string=>`scene:${instanceId.length}:${instanceId}:${sourceId}`;
export const emptyRecordingScenes=():RecordingScenes=>({version:1,scenes:[]});
export const emptyRecordingScene=(id:string,name='Recording scene'):RecordingScene=>({id,name,angle:{x:0,y:0},instances:[],warps:[],bindings:[],visibilityTracks:[],intervalTracks:[],depthTracks:[]});

/** A cross-layer display interval is owned exactly once by its anchor's layer. */
export function intervalTrackLayer(track:SceneIntervalTrack,resolve:SceneSourceResolver,scene:RecordingScene):SceneLayerRef|undefined {
 const instance=scene.instances.find(i=>i.id===track.instanceId),source=instance&&resolve(instance.artworkId),interval=source?.displayIntervals?.find(t=>t.id===track.sourceTrackId),layer=interval&&source&&layerFor(source,interval.anchor.id);
 return layer?{instanceId:track.instanceId,sourceLayerId:layer.id}:undefined;
}
export function layerTrackIds(scene:RecordingScene,ref:SceneLayerRef,resolve:SceneSourceResolver):string[]{
 const key=sceneLayerKey(ref);
 return [...scene.visibilityTracks.filter(t=>sceneLayerKey(t.target)===key).map(t=>t.id),...scene.intervalTracks.filter(t=>{const owner=intervalTrackLayer(t,resolve,scene);return owner&&sceneLayerKey(owner)===key;}).map(t=>t.id),...(scene.depthTracks??[]).filter(t=>sceneLayerKey(t.target)===key).map(t=>t.id)];
}
