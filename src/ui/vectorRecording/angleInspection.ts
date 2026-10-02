import type {Point2} from '../../domain/drawing/model';
import type {PaintBatch} from '../../domain/drawing/depth';
import {evaluateScene} from '../../domain/recordingScene/evaluation';
import type {RecordingScene,SceneSourceResolver} from '../../domain/recordingScene/model';
import {clampAngle,sameAngle,type Angle} from '../../domain/vectorRecording/interpolation';

export interface SceneOnionSettings {
 enabled:boolean;
 axis:'x'|'y';
 step:5|10;
 min:number;
 max:number;
 opacity:number;
}
export const DEFAULT_SCENE_ONION_SETTINGS:SceneOnionSettings={enabled:false,axis:'x',step:10,min:-90,max:90,opacity:.16};
export const MAX_SCENE_ONION_FRAMES=37;
export interface SceneOnionFrame {angle:Angle;drawing:ReturnType<typeof evaluateScene>['drawing'];paintBatches:PaintBatch[]}

export function normalizeSceneOnionSettings(settings:SceneOnionSettings):SceneOnionSettings {
 const a=clampAngle(settings.min),b=clampAngle(settings.max);
 return {...settings,axis:settings.axis==='y'?'y':'x',step:settings.step===5?5:10,min:Math.min(a,b),max:Math.max(a,b),opacity:Math.max(0,Math.min(1,Number.isFinite(settings.opacity)?settings.opacity:.16))};
}

/** Pad coordinates are fractions, with screen Y increasing downward. */
export function sceneAngleFromPad(x:number,y:number):Angle {
 const round=(value:number)=>Math.round(clampAngle(value)*10)/10;
 return {x:round(x*180-90),y:round(90-y*180)};
}
export function sceneAngleToPad(angle:Angle):Point2 {return [(clampAngle(angle.x)+90)/180,(90-clampAngle(angle.y))/180];}

/** Start at min and advance by the chosen step, without exceeding max.
 * Keeping the optional current frame in the cache lets cursor moves along the
 * swept axis reuse evaluated poses; the renderer always omits that frame. */
export function sampleSceneOnionAngles(angle:Angle,settings:SceneOnionSettings,includeCurrent=false):Angle[] {
 const {axis,step,min,max}=normalizeSceneOnionSettings(settings),fixed=axis==='x'?'y':'x',result:Angle[]=[];
 for(let index=0;index<MAX_SCENE_ONION_FRAMES;index++){
  const value=Math.round((min+index*step)*1e6)/1e6;if(value>max+1e-6)break;
  const sample={...angle,[axis]:value,[fixed]:clampAngle(angle[fixed])};
  if(includeCurrent||!sameAngle(sample,angle))result.push(sample);
 }
 return result;
}

/** Transactions detach the entire scene even for a cursor move. This saved-only
 * signature stays stable across cursor/draft/viewpoint changes and isolates the
 * inspection cache from an in-progress grid gesture. */
export function sceneOnionSavedSignature(scene:RecordingScene):string {
 const saved=<T extends {draft?:unknown},>(track:T)=>{const {draft:_,...rest}=track;return rest;};
 const snapshot:RecordingScene={
  id:scene.id,name:scene.name,angle:{x:0,y:0},instances:scene.instances,bindings:scene.bindings,
  warps:scene.warps.map(saved),visibilityTracks:scene.visibilityTracks.map(saved),
  intervalTracks:scene.intervalTracks.map(saved),depthTracks:scene.depthTracks?.map(saved),placementTracks:scene.placementTracks?.map(saved),
  tolerance:scene.tolerance,legacy:scene.legacy,
 };
 return JSON.stringify(snapshot);
}

/** Same source resolver and local coordinate boundary as the active view. */
export function evaluateSceneOnionFrame(scene:RecordingScene,resolve:SceneSourceResolver,angle:Angle,stopAtWarpId?:string):SceneOnionFrame {
 const evaluated=evaluateScene(scene,resolve,{angle,useDraft:false,diagnostics:'preview',...(stopAtWarpId?{stopAtWarpId}:{})});
 return {angle:evaluated.angle,drawing:evaluated.drawing,paintBatches:evaluated.paintBatches};
}
