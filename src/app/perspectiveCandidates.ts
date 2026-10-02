import {loadSceneExample,planSceneExampleImport} from './sceneExamples';
import type {DrawingSnapshotState} from '../domain/drawing/snapshots';
import type {LandmarkProject} from '../domain/landmarks/model';
import type {VectorRecording} from '../domain/vectorRecording/model';
import type {RecordingScene,RecordingScenes,WarpGrid} from '../domain/recordingScene/model';
import {parseRecordingScenes} from '../domain/recordingScene/persistence';
import {evaluateScene} from '../domain/recordingScene/evaluation';
import {recordingSceneSources} from '../domain/recordingScene/sources';

export const PERSPECTIVE_CANDIDATE_SCENE_IDS={B:'c34f5ae5-b981-574c-81b5-90b2ab319c02',C:'8f67c9a2-a6dd-54b8-87ce-90c2ab319c02'} as const;
const SHARED_WARP_ID='3565055a-65e6-5ce6-94bb-2e9cd7406e42';
const CANDIDATES=['B','C'] as const;
const ORIGINAL_ARTWORK_IDS=['9c7fc5b1-bb99-44d7-bed8-e1671519a0c8','b153e894-d79f-46a3-9b3b-50458c607e07','a357b990-bf4f-4d4c-9e46-3d994d1759fb'];
type Candidate=typeof CANDIDATES[number];
export interface PerspectiveCandidates {project:LandmarkProject;grids:Record<Candidate,WarpGrid>}
const names={B:'90°候选 B · 仅端点（近0.75 / 远0.30）',C:'90°候选 C · 仅端点（近0.85 / 远0.12）'};
const sourceMessage='无法可靠复用候选场景的两个来源画稿，已停止导入，未新增画稿。请先恢复双源场景起步稿的原来源结构，或在空工程／原始三稿工程中导入候选。';

function replaceEndpoint(scene:RecordingScene,warpId:string,grid:WarpGrid){
 const warp=scene.warps.find(w=>w.id===warpId),key=warp?.keys.find(k=>k.angle.x===90&&k.angle.y===0);
 if(!warp||!key)throw Error('90°候选缺少共享 Warp 端点');
 if(grid.rows!==warp.restGrid.rows||grid.columns!==warp.restGrid.columns||JSON.stringify(grid.bounds)!==JSON.stringify(warp.restGrid.bounds))throw Error('90°候选网格与原始 rest 区域不一致');
 key.value=structuredClone(grid);
}

/** The payload holds only the two offline grids; all source and scene data is
 * read from the unchanged two-source starter. Fit warnings are deliberately
 * accepted, and the starter tolerance is never relaxed. */
export async function loadPerspectiveCandidates(load?:()=>Promise<{project:string;grids:string}>):Promise<PerspectiveCandidates>{
 const payload=load?await load():undefined;
 const [project,raw]=await Promise.all([loadSceneExample(payload?async()=>payload.project:undefined),payload?Promise.resolve(payload.grids):(async()=>{
  const response=await fetch(new URL('../assets/three-piece-perspective-candidate-grids.json',import.meta.url),{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('90°候选网格载入失败');
  return response.text();
 })()]);
 const grids=JSON.parse(raw) as Record<Candidate,WarpGrid>,sources=recordingSceneSources(project);
 for(const label of CANDIDATES){
  if(!grids[label])throw Error(`90°候选 ${label} 网格缺失`);
  const scene=structuredClone(project.recordingScenes!.scenes[0]);replaceEndpoint(scene,SHARED_WARP_ID,grids[label]);
  parseRecordingScenes({version:1,scenes:[scene]});
  for(const x of [0,90]){
   const result=evaluateScene(scene,id=>sources[id],{angle:{x,y:0}});
   if(result.diagnostics.length||result.intervalTransportErrors.length||result.conflictingNodeIds.length)throw Error(`90°候选 ${label} 无法完整解析`);
  }
 }
 return {project,grids};
}

/** Prepare two independent scenes atomically. Stable scene identities retain
 * every later user edit on repeated imports, even after renaming a candidate.
 * B's cursor alone moves to the advertised 90° endpoint on activation. */
export function planPerspectiveCandidateImport(state:DrawingSnapshotState,loaded:PerspectiveCandidates,existingScenes?:RecordingScenes,existingRecording?:VectorRecording){
 if(existingScenes)parseRecordingScenes(existingScenes);
 const steps:DrawingSnapshotState[]=[],scenes:RecordingScene[]=[],reusedScenes={B:false,C:false};
 let next=state,reusedSources=true,preservedDraftId:string|undefined;
 for(const label of CANDIDATES){
  const known=existingScenes?.scenes.find(scene=>scene.id===PERSPECTIVE_CANDIDATE_SCENE_IDS[label]);
  if(known){scenes.push(label==='B'&&(known.angle.x!==90||known.angle.y!==0)?{...known,angle:{x:90,y:0}}:known);reusedScenes[label]=true;continue;}
  const currentScenes={version:1 as const,activeSceneId:existingScenes?.activeSceneId,scenes:[...(existingScenes?.scenes??[]),...scenes.filter(scene=>!existingScenes?.scenes.some(existing=>existing.id===scene.id))]};
  const plan=planSceneExampleImport(next,loaded.project,currentScenes,existingRecording,{reuseScene:false});
  // Planning is pure. Reject uncertain reuse before the caller can apply even
  // the first snapshot step; an existing five-source library cannot grow.
  const initialCount=state.drawingSnapshots?.items.length??0;
  const isOriginalLibrary=initialCount===3&&ORIGINAL_ARTWORK_IDS.every(id=>state.drawingSnapshots?.items.some(item=>item.id===id));
  if(plan.steps.length&&initialCount!==0&&!isOriginalLibrary)throw Error(sourceMessage);
  const scene={...plan.scene,id:PERSPECTIVE_CANDIDATE_SCENE_IDS[label],name:names[label],angle:{x:90,y:0}};
  replaceEndpoint(scene,plan.idMaps.warps[SHARED_WARP_ID],loaded.grids[label]);
  scene.warps.find(w=>w.id===plan.idMaps.warps[SHARED_WARP_ID])!.keys.find(k=>k.angle.x===90&&k.angle.y===0)!.name=`90°候选 ${label} · 仅端点`;
  const sources=recordingSceneSources(plan.state);
  parseRecordingScenes({...currentScenes,scenes:[...currentScenes.scenes,scene]});
  for(const x of [0,90]){
   const result=evaluateScene(scene,id=>sources[id],{angle:{x,y:0}});
   if(result.diagnostics.length||result.intervalTransportErrors.length||result.conflictingNodeIds.length)throw Error(`90°候选 ${label} 与当前来源画稿不兼容，请恢复双源场景的来源结构后重试`);
  }
  steps.push(...plan.steps);next=plan.state;scenes.push(scene);preservedDraftId??=plan.preservedDraftId;reusedSources&&=plan.steps.length===0;
 }
 return {steps,state:next,scenes,activeSceneId:PERSPECTIVE_CANDIDATE_SCENE_IDS.B,reused:reusedScenes.B&&reusedScenes.C,reusedScenes,reusedSources,preservedDraftId};
}
