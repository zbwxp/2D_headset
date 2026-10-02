import {syncVectorRecordingSources} from './vectorSourceSync';
/** Fixed, source-read-only Recording commands. No raw project/pose replacement. */
import type {LandmarkProject} from '../domain/landmarks/model';
import {emptyDrawing,layerFor,objectById,type DrawingDocument,type Point2,type TerminusBrushStyle,type DisplayIntervalMode} from '../domain/drawing/model';
import {changeDisplayInterval,setDisplayIntervalEnd} from '../domain/drawing/displayIntervals';
import {displayRouteDiagnostics} from '../domain/drawing/displayRouteInk';
import {moveWarpNode,validateWarpGrid} from '../domain/vectorWarp/model';
import {deformDrawing} from '../domain/vectorWarp/evaluation';
import {pinWarpPoint,WarpPinError,type WarpPointPinResult} from '../domain/vectorWarp/constraints';
import {parseVectorRecording} from '../domain/vectorRecording/persistence';
import {applyIntervalOverrides} from '../domain/vectorRecording/intervals';
import {sameAngle,type Angle} from '../domain/vectorRecording/interpolation';
import {emptyVectorRecording,sourceArtworkId,ensureArtworkRig,replaceRig,acceptArtworkSource,changedIntervalTracks,drawingSignature,addDeformer,removeDeformer,setDeformerParent,setRigAngle,currentPose,evaluatePose,saveKeyform,discardDraft,applyVisibility,deformerChain,type ArtworkRig,type VectorPose,type VectorRecording} from '../domain/vectorRecording/model';

export type RecordingCommand=
 | {op:'ensureRig'}|{op:'acceptSource'}
 | {op:'setAngle';angle:Angle}
 | {op:'createDeformer';layerIds:string[];name?:string;parentId?:string;rows?:number;columns?:number;ref?:string}
 | {op:'setDeformer';deformerId:string;name?:string;parentId?:string|null}
 | {op:'deleteDeformer';deformerId:string}
 | {op:'bindLayers';layerIds:string[];deformerId:string|null}
 | {op:'editGridNodes';deformerId:string;edits:Array<{index:number;position?:Point2;handleU?:Point2;handleV?:Point2;twist?:Point2}>;moveHandles?:boolean}
 | {op:'pinGridPoint';deformerId:string;sourcePoint:Point2;targetPoint:Point2}
 | {op:'saveKeyform';name?:string;ref?:string}|{op:'loadKeyform';keyformId:string}|{op:'renameKeyform';keyformId:string;name:string}|{op:'deleteKeyform';keyformId:string}
 | {op:'discardDraft'}|{op:'resetGrids';deformerIds?:string[]}|{op:'setTolerance';pixels:number}
 | {op:'setVisibility';objectIds?:string[];layerIds?:string[];visible:boolean}|{op:'setPoseIntervalEnabled';rangeIds:string[];enabled:boolean}
 | {op:'changePoseInterval';rangeId:string;mode?:DisplayIntervalMode;start?:number;end?:number;fullLoop?:boolean}
 | {op:'setPoseIntervalEnd';rangeId:string;end:0|1;style:TerminusBrushStyle}|{op:'resetPoseIntervals'};
export const recordingCommandNames=['ensureRig','acceptSource','setAngle','createDeformer','setDeformer','deleteDeformer','bindLayers','editGridNodes','pinGridPoint','saveKeyform','loadKeyform','renameKeyform','deleteKeyform','discardDraft','resetGrids','setTolerance','setVisibility','setPoseIntervalEnabled','changePoseInterval','setPoseIntervalEnd','resetPoseIntervals'];
export interface RecordingBatch {commands:RecordingCommand[];expectedRevision?:string;dryRun?:boolean}
export interface RecordingQuery {deformerIds?:string[];deformerNames?:string[];includeKeyGrids?:boolean;angle?:Angle;expectedRevision?:string}
export interface RecordingPinReport extends Omit<WarpPointPinResult,'grid'> {commandIndex:number;deformerId:string;angle:Angle;sourcePoint:Point2;targetPoint:Point2;targetParentId:string|null}
export interface RecordingCreation {commandIndex:number;kind:'rig'|'deformer'|'keyform';id:string;ref?:string;created:boolean}
export class RecordingApiError extends Error {constructor(readonly code:string,message:string,readonly commandIndex?:number){super(message);}}
const fail=(code:string,message:string):never=>{throw new RecordingApiError(code,message);};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))fail('INVALID_REQUEST','Expected a JSON object.');return v as Record<string,unknown>;};
const keys=(v:Record<string,unknown>,allowed:string[])=>{const bad=Object.keys(v).filter(k=>!allowed.includes(k));if(bad.length)fail('INVALID_REQUEST',`Unknown field(s): ${bad.join(', ')}.`);};
const id=(v:unknown,label:string):string=>{if(typeof v!=='string'||!v.trim()||v.length>256)fail('INVALID_REQUEST',`${label} must be a nonempty stable ID.`);return v as string;};
const name=(v:unknown)=>{const n=id(v,'name').trim();if(n.length>120)fail('INVALID_REQUEST','Names must have at most 120 characters.');return n;};
const number=(v:unknown,label:string,min=-10000,max=10000)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail('INVALID_REQUEST',`${label} must be finite and between ${min} and ${max}.`);return v as number;};
const bool=(v:unknown,label:string)=>{if(typeof v!=='boolean')fail('INVALID_REQUEST',`${label} must be a boolean.`);return v as boolean;};
const point=(v:unknown,label:string):Point2=>{if(!Array.isArray(v)||v.length!==2)fail('INVALID_REQUEST',`${label} must be [x,y].`);return (v as unknown[]).map(x=>number(x,label)) as Point2;};
const angle=(v:unknown):Angle=>{const a=object(v);keys(a,['x','y']);return {x:number(a.x,'angle.x',-90,90),y:number(a.y,'angle.y',-90,90)};};
const ids=(v:unknown,label:string,empty=false):string[]=>{if(!Array.isArray(v)||v.length>10000||!empty&&!v.length)fail('INVALID_REQUEST',`${label} must contain ${empty?'0':'1'}–10000 IDs.`);const out=(v as unknown[]).map(x=>id(x,label));if(new Set(out).size!==out.length)fail('INVALID_REQUEST',`${label} must not repeat IDs.`);return out;};
const active=(p:LandmarkProject)=>sourceArtworkId(p.drawingSnapshots?.activeId);
const drawing=(p:LandmarkProject)=>p.drawing??emptyDrawing();
const existingRig=(r:VectorRecording,artworkId:string)=>r.rigs.find(x=>x.artworkId===artworkId);
function needRig(r:VectorRecording,artworkId:string){const rig=existingRig(r,artworkId);if(!rig)fail('RIG_REQUIRED','Create the active artwork rig with ensureRig first.');return rig!;}
function deformer(rig:ArtworkRig,v:unknown){const key=id(v,'deformerId'),d=rig.deformers.find(x=>x.id===key);if(!d)fail('NOT_FOUND',`Unknown deformer ID: ${key}.`);return d!;}
function keyform(rig:ArtworkRig,v:unknown){const key=id(v,'keyformId'),k=rig.keys.find(x=>x.id===key);if(!k)fail('NOT_FOUND',`Unknown keyform ID: ${key}.`);return k!;}
function layers(d:DrawingDocument,v:unknown,empty=false){const out=ids(v,'layerIds',empty);for(const id of out)if(!d.layers.some(l=>l.id===id))fail('NOT_FOUND',`Unknown layer ID: ${id}.`);return out;}
function sourceReady(rig:ArtworkRig,d:DrawingDocument){if(rig.sourceSignature!==drawingSignature(d))fail('SOURCE_REVIEW_REQUIRED','Source artwork changed. Inspect affected tracks, then explicitly acceptSource before recording edits.');}
function range(d:DrawingDocument,value:unknown){const rangeId=id(value,'rangeId'),track=d.displayIntervals?.find(t=>t.ranges.some(r=>r.id===rangeId));if(!track)fail('NOT_FOUND',`Unknown source range ID: ${rangeId}.`);return {rangeId,track:track!};}
function style(v:unknown):TerminusBrushStyle{const s=object(v);keys(s,['taper','extension','taperWidthScale','interior']);if(!Object.keys(s).length)fail('INVALID_REQUEST','Provide an explicit terminus brush change.');if(s.taper!==undefined&&s.taperWidthScale!==undefined)fail('INVALID_REQUEST','Choose taper or taperWidthScale.');return {...(s.taper===undefined?{}:{taper:number(s.taper,'taper',0,20)}),...(s.extension===undefined?{}:{extension:number(s.extension,'extension',0,2)}),...(s.taperWidthScale===undefined?{}:{taperWidthScale:number(s.taperWidthScale,'taperWidthScale',0,200)}),...(s.interior===undefined?{}:{interior:bool(s.interior,'interior')})};}
const isAnchor=(a:Angle)=>a.x===0&&[-90,0,90].includes(a.y)||a.y===0&&[-90,0,90].includes(a.x);

export function recordingOverview(project:LandmarkProject,raw:unknown={}){
 project=syncVectorRecordingSources(project);
 const q=object(raw);keys(q,['deformerIds','deformerNames','includeKeyGrids','angle','expectedRevision']);if(q.includeKeyGrids!==undefined)bool(q.includeKeyGrids,'includeKeyGrids');
 const selectedIds=q.deformerIds===undefined?undefined:ids(q.deformerIds,'deformerIds',true),selectedNames=q.deformerNames===undefined?undefined:ids(q.deformerNames,'deformerNames',true),a=q.angle===undefined?undefined:angle(q.angle),d=drawing(project),recording=project.vectorRecording??emptyVectorRecording(),rig=existingRig(recording,active(project));
 if(!rig)return {artworkId:active(project),exists:false,sourceReadOnly:true,tolerancePixels:recording.tolerance*250};
 selectedIds?.forEach(id=>deformer(rig,id));let pose:VectorPose|undefined,poseEvaluationError:string|undefined;try{pose=a?evaluatePose(rig,a,d):currentPose(rig,d);}catch(error){poseEvaluationError=(error as Error).message;}const deformers=rig.deformers.filter(x=>(!selectedIds||selectedIds.includes(x.id))&&(!selectedNames||selectedNames.includes(x.name)));
 return structuredClone({artworkId:rig.artworkId,rigId:rig.id,exists:true,sourceReadOnly:true,sourceReviewRequired:rig.sourceSignature!==drawingSignature(d),changedIntervalTrackIds:[...changedIntervalTracks(rig,d)],angle:a??rig.angle,storedAngle:rig.angle,hasDraft:!!rig.draft,parameters:{x:{name:rig.driver?.parameterX??'Angle X',min:-90,max:90},y:{name:rig.driver?.parameterY??'Angle Y',min:-90,max:90}},tolerancePixels:recording.tolerance*250,
  coordinateSystem:{unit:'source',gridNodes:'deformer-local output positions; parent grids are applied afterward',handles:'absolute outgoing handleU/handleV positions',twist:'cell-coordinate mixed derivative vector',index:'row-major; columns+1 nodes per row; rows/columns count cells'},
  deformers:deformers.map(x=>({...x,currentGrid:pose?(pose.grids[x.id]??x.grid):null,boundLayerIds:Object.entries(rig.bindings).filter(([,id])=>id===x.id).map(([id])=>id)})),bindings:rig.bindings,keys:rig.keys.map(k=>q.includeKeyGrids?k:{id:k.id,name:k.name,angle:k.angle}),poseEvaluationError:poseEvaluationError??null,poseVisibility:pose?.visibility??null,poseIntervalEnabled:pose?.intervals??null,poseIntervalOverrides:pose?.intervalOverrides??null});
}

export function prepareRecordingBatch(project:LandmarkProject,raw:unknown){
 project=syncVectorRecordingSources(project);
 const request=object(raw);keys(request,['commands','expectedRevision','dryRun']);if(request.dryRun!==undefined)bool(request.dryRun,'dryRun');if(!Array.isArray(request.commands)||request.commands.length>1000)fail('INVALID_REQUEST','commands must be an array of at most 1000 commands.');
 const source=drawing(project),artworkId=active(project),before=project.vectorRecording??emptyVectorRecording(),refs=new Map<string,string>(),created:RecordingCreation[]=[],pinResults:RecordingPinReport[]=[];let next=structuredClone(before);
 const canonical=(key:string)=>[...next.rigs.flatMap(r=>[r,...r.deformers,...r.keys]),...source.layers,...source.curves,...source.nodes,...source.fills,...source.offsets].some(x=>x.id===key);
 const resolve=(v:unknown,key=''):unknown=>{if(typeof v==='string'&&/Id$|Ids$/.test(key)&&v.startsWith('$')){if(canonical(v))return v;const mapped=refs.get(v.slice(1));if(!mapped)fail('UNKNOWN_REFERENCE',`Unknown recording reference: ${v}.`);return mapped;}if(Array.isArray(v))return v.map(x=>resolve(x,key));if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,resolve(x,k)]));return v;};
 for(const [commandIndex,input] of (request.commands as unknown[]).entries())try{
  const c=object(resolve(input)),op=c.op;
  const report=(kind:RecordingCreation['kind'],entityId:string,ref:unknown,isNew=true)=>{let label:string|undefined;if(ref!==undefined){label=id(ref,'ref');if(!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(label))fail('INVALID_REQUEST','Invalid recording ref.');if(refs.has(label))fail('DUPLICATE_REFERENCE',`Duplicate ref: ${label}.`);if(canonical(`$${label}`))fail('REFERENCE_COLLISION',`Reference $${label} collides with a canonical ID.`);refs.set(label,entityId);}created.push({commandIndex,kind,id:entityId,created:isNew,...(label?{ref:label}:{})});};
  if(op==='ensureRig'){keys(c,['op']);const old=existingRig(next,artworkId);next=ensureArtworkRig(next,artworkId,source);if(!old)report('rig',needRig(next,artworkId).id,undefined);continue;}
  let rig=needRig(next,artworkId);
  if(op==='acceptSource'){keys(c,['op']);next=replaceRig(next,acceptArtworkSource(rig,source));continue;}
  sourceReady(rig,source);
  const pose=()=>structuredClone(currentPose(rig,source));const setPose=(p:VectorPose)=>{rig={...rig,draft:p};};
  switch(op){
   case 'setAngle':keys(c,['op','angle']);if(rig.draft)fail('DIRTY_DRAFT','Save or explicitly discard the current draft before changing angle.');rig=setRigAngle(rig,angle(c.angle));break;
   case 'createDeformer':{
    keys(c,['op','layerIds','name','parentId','rows','columns','ref']);const layerIds=layers(source,c.layerIds,true),parent=c.parentId===undefined?undefined:deformer(rig,c.parentId).id,rows=c.rows===undefined?3:number(c.rows,'rows',1,16),columns=c.columns===undefined?3:number(c.columns,'columns',1,16);if(!Number.isInteger(rows)||!Number.isInteger(columns))fail('INVALID_REQUEST','rows and columns must be integers.');rig=addDeformer(rig,source,layerIds,parent,rows,columns);const newest=rig.deformers.at(-1)!;rig={...rig,bindings:{...rig.bindings,...Object.fromEntries(layerIds.map(id=>[id,newest.id]))}};if(c.name!==undefined)rig={...rig,deformers:rig.deformers.map(x=>x.id===newest.id?{...x,name:name(c.name)}:x)};report('deformer',newest.id,c.ref);break;
   }
   case 'setDeformer':{
    keys(c,['op','deformerId','name','parentId']);const d=deformer(rig,c.deformerId);if(c.name===undefined&&c.parentId===undefined)fail('INVALID_REQUEST','Provide a deformer property to change.');if(c.parentId!==undefined)rig=setDeformerParent(rig,d.id,c.parentId===null?undefined:deformer(rig,c.parentId).id);if(c.name!==undefined)rig={...rig,deformers:rig.deformers.map(x=>x.id===d.id?{...x,name:name(c.name)}:x)};break;
   }
   case 'deleteDeformer':keys(c,['op','deformerId']);rig=removeDeformer(rig,deformer(rig,c.deformerId).id);break;
   case 'bindLayers':{
    keys(c,['op','layerIds','deformerId']);const layerIds=layers(source,c.layerIds),d=c.deformerId===null?undefined:deformer(rig,c.deformerId).id,bindings={...rig.bindings};for(const layer of layerIds)if(d===undefined)delete bindings[layer];else Object.defineProperty(bindings,layer,{value:d,enumerable:true,writable:true,configurable:true});rig={...rig,bindings};break;
   }
   case 'editGridNodes':{
    keys(c,['op','deformerId','edits','moveHandles']);const d=deformer(rig,c.deformerId),p=pose();let grid=p.grids[d.id]??d.grid;const follow=c.moveHandles===undefined?true:bool(c.moveHandles,'moveHandles');if(!Array.isArray(c.edits)||!c.edits.length||c.edits.length>grid.nodes.length)fail('INVALID_REQUEST','edits must contain 1 to node-count unique node edits.');const seen=new Set<number>();
    for(const raw of c.edits as unknown[]){const e=object(raw);keys(e,['index','position','handleU','handleV','twist']);const i=number(e.index,'index',0,grid.nodes.length-1);if(!Number.isInteger(i)||seen.has(i))fail('INVALID_REQUEST','Node indices must be unique integers.');seen.add(i);if(!['position','handleU','handleV','twist'].some(k=>e[k]!==undefined))fail('INVALID_REQUEST','Each node edit needs a position, handle or twist.');if(e.position!==undefined)grid=moveWarpNode(grid,i,point(e.position,'position'),follow);else grid=structuredClone(grid);for(const k of ['handleU','handleV','twist'] as const)if(e[k]!==undefined)grid.nodes[i][k]=point(e[k],k);}
    validateWarpGrid(grid);setPose({...p,grids:{...p.grids,[d.id]:grid}});break;
   }
   case 'pinGridPoint':{
    keys(c,['op','deformerId','sourcePoint','targetPoint']);const d=deformer(rig,c.deformerId),p=pose(),grid=p.grids[d.id]??d.grid,sourcePoint=point(c.sourcePoint,'sourcePoint'),targetPoint=point(c.targetPoint,'targetPoint'),parentId=d.parentId??null,parent=parentId?deformer(rig,parentId):undefined;
    const result=pinWarpPoint(grid,{sourcePoint,targetPoint,gridParentId:parentId,targetParentId:parentId,...(parent?{parentBounds:parent.grid.bounds}:{})});const {grid:pinned,...diagnostics}=result;
    setPose({...p,grids:{...p.grids,[d.id]:pinned}});pinResults.push({commandIndex,deformerId:d.id,angle:{...rig.angle},sourcePoint,targetPoint,targetParentId:parentId,...diagnostics});break;
   }
   case 'saveKeyform':{keys(c,['op','name','ref']);const old=rig.keys.find(k=>sameAngle(k.angle,rig.angle));rig=saveKeyform(rig,c.name===undefined?undefined:name(c.name),source);report('keyform',rig.keys.find(k=>sameAngle(k.angle,rig.angle))!.id,c.ref,!old);break;}
   case 'loadKeyform':{keys(c,['op','keyformId']);const k=keyform(rig,c.keyformId);if(rig.draft)fail('DIRTY_DRAFT','Save or explicitly discard the current draft before loading a keyform.');rig=setRigAngle(rig,k.angle);break;}
   case 'renameKeyform':{keys(c,['op','keyformId','name']);const k=keyform(rig,c.keyformId),n=name(c.name);rig={...rig,keys:rig.keys.map(x=>x.id===k.id?{...x,name:n}:x)};break;}
   case 'deleteKeyform':{keys(c,['op','keyformId']);const k=keyform(rig,c.keyformId);if(isAnchor(k.angle))fail('ANCHOR_REQUIRED','The five base angle keyforms cannot be deleted.');if(rig.draft)fail('DIRTY_DRAFT','Save or discard the draft before deleting a keyform.');rig={...rig,keys:rig.keys.filter(x=>x.id!==k.id)};break;}
   case 'discardDraft':keys(c,['op']);rig=discardDraft(rig);break;
   case 'resetGrids':{keys(c,['op','deformerIds']);const selected=c.deformerIds===undefined?rig.deformers.map(x=>x.id):ids(c.deformerIds,'deformerIds');selected.forEach(x=>deformer(rig,x));const p=pose();setPose({...p,grids:{...p.grids,...Object.fromEntries(selected.map(id=>[id,structuredClone(deformer(rig,id).grid)]))}});break;}
   case 'setTolerance':keys(c,['op','pixels']);next={...next,tolerance:number(c.pixels,'pixels',.1,20)/250};break;
   case 'setVisibility':{keys(c,['op','objectIds','layerIds','visible']);const direct=c.objectIds===undefined?[]:ids(c.objectIds,'objectIds'),selectedLayers=c.layerIds===undefined?[]:layers(source,c.layerIds),selected=[...new Set([...direct,...source.layers.filter(l=>selectedLayers.includes(l.id)).flatMap(l=>l.items)])],visible=bool(c.visible,'visible');if(!selected.length)fail('INVALID_REQUEST','Provide objectIds or layerIds for pose visibility.');selected.forEach(id=>{if(!objectById(source,id))fail('NOT_FOUND',`Unknown source object: ${id}.`);});const p=pose();setPose({...p,visibility:{...p.visibility,...Object.fromEntries(selected.map(id=>[id,visible]))}});break;}
   case 'setPoseIntervalEnabled':{keys(c,['op','rangeIds','enabled']);const selected=ids(c.rangeIds,'rangeIds'),enabled=bool(c.enabled,'enabled');selected.forEach(id=>range(source,id));const p=pose();setPose({...p,intervals:{...p.intervals,...Object.fromEntries(selected.map(id=>[id,enabled]))}});break;}
   case 'changePoseInterval':case 'setPoseIntervalEnd':{
    keys(c,op==='changePoseInterval'?['op','rangeId','mode','start','end','fullLoop']:['op','rangeId','end','style']);const p=pose(),d=applyIntervalOverrides(source,p.intervalOverrides),r=range(d,c.rangeId);let edited:DrawingDocument;
    if(op==='setPoseIntervalEnd'){if(c.end!==0&&c.end!==1)fail('INVALID_REQUEST','end must be 0 or 1.');edited=setDisplayIntervalEnd(d,r.track.id,r.rangeId,c.end as 0|1,style(c.style));}
    else {if(c.mode!==undefined&&c.mode!=='SHOW'&&c.mode!=='HIDE')fail('INVALID_REQUEST','mode must be SHOW or HIDE.');const change={...(c.mode===undefined?{}:{mode:c.mode as DisplayIntervalMode}),...(c.start===undefined?{}:{start:number(c.start,'start',0,1)}),...(c.end===undefined?{}:{end:number(c.end,'end',0,1)}),...(c.fullLoop===undefined?{}:{fullLoop:bool(c.fullLoop,'fullLoop')})};if(!Object.keys(change).length)fail('INVALID_REQUEST','Provide an interval change.');edited=changeDisplayInterval(d,r.track.id,r.rangeId,change);}
    setPose({...p,intervalOverrides:structuredClone(edited.displayIntervals??[])});break;
   }
   case 'resetPoseIntervals':{keys(c,['op']);const {intervalOverrides,...p}=pose();void intervalOverrides;setPose({...p,intervals:{}});break;}
   default:fail('UNKNOWN_COMMAND',`Unknown Recording command: ${String(op)}.`);
  }
  next=replaceRig(next,rig);next=parseVectorRecording(next);
 }catch(error){const e=error as Error;throw new RecordingApiError(e instanceof RecordingApiError?e.code:e instanceof WarpPinError?`WARP_PIN_${e.code}`:'CONSTRAINT_VIOLATION',e.message,commandIndex);}
 next=parseVectorRecording(next);return {before,next,sourceId:artworkId,changed:JSON.stringify(before)!==JSON.stringify(next),dryRun:request.dryRun===true,created,pinResults};
}

/** Same full evaluation pipeline as the Recording UI, without child-local isolation. */
export function evaluateRecording(project:LandmarkProject,request:{angle?:Angle;useDraft?:boolean}={}){
 project=syncVectorRecordingSources(project);
 const d=drawing(project),recording=project.vectorRecording??emptyVectorRecording(),rig=needRig(recording,active(project));sourceReady(rig,d);if(request.useDraft!==undefined)bool(request.useDraft,'useDraft');const a=request.angle===undefined?rig.angle:angle(request.angle),wantsDraft=request.useDraft??request.angle===undefined;if(wantsDraft&&!sameAngle(a,rig.angle))fail('DRAFT_ANGLE_MISMATCH','A draft belongs only to the current stored angle.');const usedDraft=wantsDraft&&!!rig.draft,pose=wantsDraft?currentPose(rig,d):evaluatePose(rig,a,d),visible=applyVisibility(d,pose),evaluated=deformDrawing(visible,id=>deformerChain(rig,layerFor(d,id)?.id??'',pose),{tolerance:recording.tolerance,diagnostics:'full'});
 return {artworkId:rig.artworkId,rigId:rig.id,angle:a,usedDraft,hasUnappliedDraft:!!rig.draft&&!usedDraft,pose:structuredClone(pose),...evaluated,routeDiagnostics:displayRouteDiagnostics(evaluated.drawing)};
}
