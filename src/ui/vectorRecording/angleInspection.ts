import type {Point2} from '../../domain/drawing/model';
import type {PaintBatch} from '../../domain/drawing/depth';
import {evaluateScene} from '../../domain/recordingScene/evaluation';
import type {RecordingScene,SceneSourceResolver,SceneTrack} from '../../domain/recordingScene/model';
import type {RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
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
export interface SceneOnionFrame {angle:Angle;drawing:ReturnType<typeof evaluateScene>['drawing'];paintBatches:PaintBatch[];highlight?:'30'|'60';highlightAngle?:number}

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


/** Default yaw inspection stays in the horizontal transition plane even if
 * the angle pad cursor has a small pitch offset. Explicit pitch sweeps hold X. */
export function sceneOnionSweepAnchor(angle:Angle,axis:'x'|'y'):Angle {
 return {x:axis==='y'?clampAngle(angle.x):0,y:0};
}

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
  intervalTracks:scene.intervalTracks.map(saved),depthTracks:scene.depthTracks?.map(saved),placementTracks:scene.placementTracks?.map(saved),shapeTracks:scene.shapeTracks?.map(saved),
  tolerance:scene.tolerance,legacy:scene.legacy,
 };
 return JSON.stringify(snapshot);
}

/** Same source resolver and local coordinate boundary as the active view. */
export function evaluateSceneOnionFrame(scene:RecordingScene,resolve:SceneSourceResolver,angle:Angle,stopAtWarpId?:string):SceneOnionFrame {
 const evaluated=evaluateScene(scene,resolve,{angle,useDraft:false,diagnostics:'preview',...(stopAtWarpId?{stopAtWarpId}:{})});
 return {angle:evaluated.angle,drawing:evaluated.drawing,paintBatches:evaluated.paintBatches};
}

/** Substitute the live pose only in an inspection copy, never in authored data.
 * At a saved angle the existing key is replaced; elsewhere a temporary sample
 * exists solely for this sweep. Drafts at other angles are always excluded. */
export function sceneOnionInspectionTrack<T extends SceneTrack<unknown>>(track:T,currentAngle?:Angle):T {
 const {draft,...saved}=track;
 if(!draft||!currentAngle||!sameAngle(draft.angle,currentAngle))return saved as T;
 const old=track.keys.find(key=>sameAngle(key.angle,draft.angle));
 let temporaryId='__onion-current-draft__';while(track.keys.some(key=>key.id===temporaryId))temporaryId+='-';
 const key={...(old??{id:temporaryId}),angle:{...draft.angle},value:structuredClone(draft.value)};
 return {...saved,keys:old?track.keys.map(value=>value===old?key:value):[...track.keys,key]} as T;
}

/** Cursor-only changes reuse a sweep; matching live draft values invalidate it. */
export function snapshotOnionInspectionSignature(workspace:RecordingSnapshotWorkspace,recordingId:string,currentAngle:Angle):string {
 return JSON.stringify({...workspace,activeRecordingId:undefined,legacyArchive:undefined,
  snapshots:workspace.snapshots.map(({draft,...snapshot})=>{void draft;return snapshot;}),
  recordings:workspace.recordings.map(recording=>({...recording,angle:{x:0,y:0},activeSnapshotId:undefined,
   tracks:recording.tracks.map(track=>sceneOnionInspectionTrack(track,recording.id===recordingId?currentAngle:undefined)),
   ...(recording.legacy?{legacy:{...recording.legacy,scene:JSON.parse(recording.id===recordingId?sceneOnionInspectionSignature(recording.legacy.scene,currentAngle):sceneOnionSavedSignature(recording.legacy.scene))}}:{}),
  })),
 });
}

export function sceneOnionInspectionSignature(scene:RecordingScene,currentAngle:Angle=scene.angle):string {
 const saved=JSON.parse(sceneOnionSavedSignature(scene)) as RecordingScene;
 const tracks=['warps','visibilityTracks','intervalTracks','depthTracks','placementTracks','shapeTracks'] as const;
 for(const name of tracks)if(scene[name])(saved[name] as SceneTrack<unknown>[])=scene[name]!.map(track=>sceneOnionInspectionTrack(track,currentAngle));
 return JSON.stringify(saved);
}

/** Start inspection at the authored/view endpoint extent of one sweep axis. */
export function sceneOnionRangeFromViews(views:readonly {angle:Angle}[],axis:'x'|'y'='x'):Pick<SceneOnionSettings,'min'|'max'> {
 const values=views.map(view=>clampAngle(view.angle[axis]));
 return values.length?{min:Math.min(...values),max:Math.max(...values)}:{min:0,max:90};
}

/** The two guide poses are sampled results, never authored keys. A negative
 * range uses -30/-60; non-aligned steps highlight their nearest sampled pose. */
export function markSceneOnionHighlights(frames:readonly SceneOnionFrame[],settings:SceneOnionSettings):SceneOnionFrame[] {
 const {axis,min,max}=normalizeSceneOnionSettings(settings),sign=max<=0&&min<0?-1:1;
 const highlights=new Map<SceneOnionFrame,{highlight:'30'|'60';highlightAngle:number}>();
 for(const guide of [30,60] as const){
  const target=guide*sign;if(target<min||target>max)continue;
  const closest=frames.filter(frame=>!highlights.has(frame)).reduce<SceneOnionFrame|undefined>((best,frame)=>!best||Math.abs(frame.angle[axis]-target)<Math.abs(best.angle[axis]-target)?frame:best,undefined);
  if(closest)highlights.set(closest,{highlight:String(guide) as '30'|'60',highlightAngle:target});
 }
 return frames.map(frame=>{const {highlight:_,highlightAngle:__,...plain}=frame;return {...plain,...highlights.get(frame)};});
}

/** Coalesce bursts without starving a continuous drag. Each completed sweep
 * uses one coherent preview copy; only the newest pending copy runs next.
 * A coordinate-space change or disable cancels every queued callback. */
export function createSceneOnionSweepQueue<Request,Frame>(count:(request:Request)=>number,evaluate:(request:Request,index:number)=>Frame,publish:(request:Request,frames:Frame[],error?:string)=>void,delay=24){
 let pending:Request|undefined,completed:Request|undefined,timer:ReturnType<typeof setTimeout>|undefined,running=false,generation=0;
 function start(){
  if(running||pending===undefined||pending===completed)return;
  running=true;const token=generation;
  timer=setTimeout(()=>{
   if(token!==generation)return;
   const request=pending!;let index=0;const frames:Frame[]=[];
   const finish=(error?:string)=>{if(token!==generation)return;completed=request;running=false;publish(request,error?[]:frames,error);start();};
   function next(){
    if(token!==generation)return;
    if(index>=count(request)){finish();return;}
    try{frames.push(evaluate(request,index++));}catch(error){finish(error instanceof Error?error.message:String(error));return;}
    if(index<count(request))timer=setTimeout(next,0);else finish();
   }
   next();
  },delay);
 }
 return {
  update(request:Request){pending=request;start();},
  cancel(){generation++;clearTimeout(timer);timer=undefined;pending=undefined;completed=undefined;running=false;},
 };
}
