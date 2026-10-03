import type {Cubic,Point2} from '../../domain/drawing/model';
import type {PaintBatch} from '../../domain/drawing/depth';
import {evaluateScene} from '../../domain/recordingScene/evaluation';
import type {RecordingScene,SceneSourceResolver,SceneTrack} from '../../domain/recordingScene/model';
import type {RecordingSnapshotWorkspace,RecordingSnapshot,SnapshotRecording,SnapshotPoseTrack} from '../../domain/recordingSnapshot/model';
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
export interface SceneOnionFrame {angle:Angle;drawing:ReturnType<typeof evaluateScene>['drawing'];paintBatches:PaintBatch[];centerlines?:Array<{id:string;cubic:Cubic}>;highlight?:'30'|'60';highlightAngle?:number}

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

/** Keep only the requested Recording and its actual parent snapshot graph.
 * Reference images and recovery archives are unrelated to contour evaluation.
 * Geometry can stay shared because the native evaluator never mutates inputs. */
export function snapshotOnionReachableWorkspace(workspace:RecordingSnapshotWorkspace,recordingId:string):RecordingSnapshotWorkspace {
 const recording=workspace.recordings.find(value=>value.id===recordingId);if(!recording)throw Error('Missing recording');
 const byId=new Map(workspace.snapshots.map(snapshot=>[snapshot.id,snapshot])),reachable=new Set<string>();
 const visit=(id:string)=>{if(reachable.has(id))return;reachable.add(id);const snapshot=byId.get(id);for(const layer of snapshot?.layers??[])if(layer.kind==='reference')visit(layer.baseSnapshotId);for(const issue of Object.values({...snapshot?.inheritedState?.intervalMaterialIssues,...snapshot?.deformation.intervalMaterialIssues}))visit(issue.sourceSnapshotId);};
 recording.snapshotIds.forEach(visit);
 let previousSize=-1;while(previousSize!==reachable.size){previousSize=reachable.size;for(const owner of workspace.recordings)if(owner.id===recordingId||owner.snapshotIds.some(id=>reachable.has(id))){
  for(const track of owner.tracks)if(track.channel==='interval'&&track.materialIssue)visit(track.materialIssue.sourceSnapshotId);
  if(owner.legacy)for(const source of workspace.snapshots)if(owner.legacy.scene.instances.some(instance=>instance.artworkId===source.source?.artworkId))visit(source.id);
 }}
 const snapshots:RecordingSnapshot[]=workspace.snapshots.filter(snapshot=>reachable.has(snapshot.id)).map(snapshot=>{
  const {draft,source,...saved}=snapshot;void draft;
  if(!source)return saved;const {reference,...metadata}=source;void reference;return {...saved,source:metadata};
 });
 const library:RecordingSnapshotWorkspace['library']={nodes:{},curves:{},fills:{},offsets:{}};
 for(const snapshot of snapshots)for(const layer of snapshot.layers)if(layer.kind==='original')for(const id of layer.items){
  const curve=workspace.library.curves[id];if(curve){library.curves[id]=curve;for(const nodeId of curve.nodes)if(workspace.library.nodes[nodeId])library.nodes[nodeId]=workspace.library.nodes[nodeId];}
  if(workspace.library.fills[id])library.fills[id]=workspace.library.fills[id];
  if(workspace.library.offsets[id])library.offsets[id]=workspace.library.offsets[id];
 }
 const recordings=workspace.recordings.filter(value=>value.id===recordingId||value.snapshotIds.some(id=>reachable.has(id))).map(value=>({...value,angle:{x:0,y:0},activeSnapshotId:undefined,snapshotIds:value.snapshotIds.filter(id=>reachable.has(id))}));
 return {version:2,library,snapshots,recordings};
}

/** A hook-local cache separates static source/graph data from live pose values.
 * Unchanged immutable track values are fingerprinted once; dragging serializes
 * only the changed channel. No full workspace stringify/parse sits on input. */
export function createSnapshotOnionInspectionCache(){
 let previousWorkspace:RecordingSnapshotWorkspace|undefined,previousRecordingId:string|undefined,base:RecordingSnapshotWorkspace|undefined,lastKey:string|undefined,lastResult:RecordingSnapshotWorkspace|undefined;
 const recent=new Map<string,RecordingSnapshotWorkspace>();
 const tracks=new WeakMap<SnapshotPoseTrack,{saved:SnapshotPoseTrack;savedKey:string;live?:SnapshotPoseTrack;liveKey?:string}>();
 function trackValue(track:SnapshotPoseTrack,angle:Angle|undefined){
  let cached=tracks.get(track);
  if(!cached){const saved=sceneOnionInspectionTrack(track);cached={saved,savedKey:JSON.stringify(saved)};tracks.set(track,cached);}
  if(angle&&track.draft&&sameAngle(track.draft.angle,angle)){
   if(!cached.live){cached.live=sceneOnionInspectionTrack(track,angle);cached.liveKey=JSON.stringify(cached.live);}
   return {track:cached.live,key:cached.liveKey!};
  }
  return {track:cached.saved,key:cached.savedKey};
 }
 return {get(workspace:RecordingSnapshotWorkspace,recordingId:string,currentAngle:Angle):RecordingSnapshotWorkspace{
  const recording=workspace.recordings.find(value=>value.id===recordingId);if(!recording)throw Error('Missing recording');
  const prior=previousWorkspace?.recordings.find(value=>value.id===recordingId);
  if(!base||previousRecordingId!==recordingId||previousWorkspace?.library!==workspace.library||previousWorkspace?.snapshots!==workspace.snapshots||prior?.snapshotIds!==recording.snapshotIds||prior?.legacy!==recording.legacy){
   base=snapshotOnionReachableWorkspace(workspace,recordingId);lastKey=undefined;lastResult=undefined;recent.clear();
  }
  previousWorkspace=workspace;previousRecordingId=recordingId;
  const recordings:SnapshotRecording[]=[],keys:string[]=[];
  for(const saved of base.recordings){
   const actual=workspace.recordings.find(value=>value.id===saved.id)!;
   const values=actual.tracks.map(track=>trackValue(track,actual.id===recordingId?currentAngle:undefined));
   const legacy=actual.legacy?{...actual.legacy,scene:JSON.parse(actual.id===recordingId?sceneOnionInspectionSignature(actual.legacy.scene,currentAngle):sceneOnionSavedSignature(actual.legacy.scene))}:undefined;
   // An inverse-correction draft owns scalar responses for the whole segment.
   // Its scalar constraints remain live when the cursor moves along the pair.
   const {draft,...pair}=actual.endpointPair??{},endpointPair=actual.endpointPair?{...pair,...(actual.id===recordingId&&draft?{responses:draft.responses}:{})} as NonNullable<SnapshotRecording['endpointPair']>:undefined;
   keys.push(JSON.stringify([actual.id,actual.tolerance,actual.interpolationWeights,actual.mode,endpointPair,legacy]),...values.map(value=>value.key));
   recordings.push({...saved,mode:actual.mode,endpointPair,tolerance:actual.tolerance,interpolationWeights:actual.interpolationWeights,tracks:values.map(value=>value.track),...(legacy?{legacy}:{})});
  }
  const key=keys.join('\n');if(lastResult&&lastKey===key)return lastResult;
  const cached=recent.get(key);if(cached){recent.delete(key);recent.set(key,cached);lastKey=key;lastResult=cached;return cached;}
  lastKey=key;lastResult={...base,recordings};recent.set(key,lastResult);if(recent.size>4)recent.delete(recent.keys().next().value!);return lastResult;
 }};
}

/** Standalone saved/live comparison helper. Interactive callers use the cache. */
export function snapshotOnionInspectionSignature(workspace:RecordingSnapshotWorkspace,recordingId:string,currentAngle:Angle):string {
 return JSON.stringify(createSnapshotOnionInspectionCache().get(workspace,recordingId,currentAngle));
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

/** Evaluate the two guide poses first so the useful transition landmarks
 * appear before the rest of a large preview sweep has finished. */
export function prioritizeSceneOnionAngles(angles:readonly Angle[],settings:SceneOnionSettings):Angle[]{
 const {axis,min,max}=normalizeSceneOnionSettings(settings),sign=max<=0&&min<0?-1:1,priority:number[]=[];
 for(const target of [30*sign,60*sign]){
  if(target<min||target>max)continue;
  let nearest=-1;for(let index=0;index<angles.length;index++)if(!priority.includes(index)&&(nearest<0||Math.abs(angles[index][axis]-target)<Math.abs(angles[nearest][axis]-target)))nearest=index;
  if(nearest>=0)priority.push(nearest);
 }
 return [...priority,...angles.map((_,index)=>index).filter(index=>!priority.includes(index))].map(index=>angles[index]);
}

/** Coalesce bursts without starving a continuous drag. Each completed sweep
 * uses one coherent preview copy; only the newest pending copy runs next.
 * A coordinate-space change or disable cancels every queued callback. */
export function createSceneOnionSweepQueue<Request,Frame>(count:(request:Request)=>number,evaluate:(request:Request,index:number)=>Frame,publish:(request:Request,frames:Frame[],error?:string)=>void,delay=24,onFrame?:(request:Request,frame:Frame,index:number)=>void){
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
    try{const frame=evaluate(request,index);frames.push(frame);onFrame?.(request,frame,index);index++;}catch(error){finish(error instanceof Error?error.message:String(error));return;}
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
