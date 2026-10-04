import {Profiler,type ProfilerOnRenderCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import PaintScene from '../../src/ui/drawing/PaintScene';
import SceneOnionSkin,{type SceneOnionFrame} from '../../src/ui/vectorRecording/SceneOnionSkin';
import {interpolateSnapshotSurfaceOnion} from '../../src/ui/vectorRecording/surfaceOnion';
import {evaluateRecordingSnapshot,getRecordingEvaluationStageTotals,prepareRecordingContext,type PreparedRecordingContext,type SnapshotEvaluation} from '../../src/domain/recordingSnapshot/evaluation';
import {drawingReadContextStats} from '../../src/domain/drawing/readContext';
import type {RecordingSnapshotWorkspace} from '../../src/domain/recordingSnapshot/model';
import {ENDPOINTS,FIXTURE_SOURCE,RECORDING_ID,VIEW,makeFixture,screen,shiftedBasis} from './recording-renderer-benchmark-fixture';
import './recording-renderer-benchmark.css';

declare const __RENDERER_BENCHMARK_REVISION__:string;
type Mode='combined'|'evaluation-only'|'render-only';
type Workload='angle'|'basis';
type Counts=Record<string,number>;
type Frame={main:SnapshotEvaluation;ghosts:SceneOnionFrame[]};
type Metrics={prepareMs:number;mainMs:number;ghostMs:number;mainStages:Counts;ghostStages:Counts;preparationStages:Counts;evaluationReadWork:Counts};
type RenderMetrics={flushMs:number;reactSceneMs:number;reactMainMs:number;reactGhostMs:number;flushResidualMs:number;renderReadWork:Counts;profileCallbacks:number};
type Sample=Metrics&RenderMetrics&{index:number;workMs:number;nextRafOpportunityMs:number;postWorkToRafMs:number;visible:boolean};
type Case={workload:Workload;ghosts:0|10|19;fills:boolean;samples:number};
type Pass={mode:Mode;config:Case;startup:Record<string,unknown>;precomputeMs:number;warmupCount:number;counts:Record<string,unknown>;samples:Sample[];summary:Record<string,unknown>};
const byId=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const sceneHost=byId<HTMLDivElement>('scene'),root=createRoot(sceneHost),noPick=()=>{},WARMUPS=4;
let stopped=false,running=false,activeProfile:Record<string,number>|undefined;
const profiler:ProfilerOnRenderCallback=(id,_phase,actualDuration)=>{if(activeProfile){activeProfile[id]=(activeProfile[id]??0)+actualDuration;activeProfile.callbacks=(activeProfile.callbacks??0)+1;}};
const report={schema:'contour-renderer-cost-v1',revision:typeof __RENDERER_BENCHMARK_REVISION__==='string'?__RENDERER_BENCHMARK_REVISION__:'dev-unversioned',createdAt:new Date().toISOString(),fixture:FIXTURE_SOURCE,environment:{userAgent:navigator.userAgent,devicePixelRatio:devicePixelRatio,hardwareConcurrency:navigator.hardwareConcurrency,viewport:{width:innerWidth,height:innerHeight},production:import.meta.env.PROD},view:{...VIEW,preview:false,tool:'select',ghostOpacity:.16,mainFillBaseline:false,ghostProduct:'controls',ghostRange:{from:{x:0,y:0},to:{x:90,y:0}}},limits:['Not a full pointer-to-paint measurement: inverse edit, transactions, input dispatch and editor overlays are excluded.','rAF intervals indicate callback opportunities only, not paint completion, FPS or dropped frames.','React production profiling build includes measurement overhead; render residual is commit plus synchronous overhead, not pure DOM time.','Public 121-curve synthetic nine-view translations do not represent private project evaluation complexity.','No GPU implementation is measured.'],passes:[] as Pass[],errors:[] as string[]};
let browserCapabilities:Record<string,unknown>|undefined;
const difference=(after:Counts,before:Counts):Counts=>Object.fromEntries(Object.entries(after).map(([key,value])=>[key,value-(before[key]??0)]));
const zeroMetrics=():Metrics=>({prepareMs:0,mainMs:0,ghostMs:0,mainStages:{},ghostStages:{},preparationStages:{},evaluationReadWork:{}});
const zeroRender=():RenderMetrics=>({flushMs:0,reactSceneMs:0,reactMainMs:0,reactGhostMs:0,flushResidualMs:0,renderReadWork:{},profileCallbacks:0});
const measure=<T,>(read:()=>T)=>{const started=performance.now(),value=read();return {value,ms:performance.now()-started};};
function nextOpportunity(){return new Promise<number>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('No foreground rAF opportunity for 10 seconds')),10000);requestAnimationFrame(()=>{clearTimeout(timeout);if(document.visibilityState!=='visible')reject(Error('Tab was hidden during measurement'));else resolve(performance.now());});});}

function renderFrame(frame:Frame,fills:boolean):RenderMetrics {
 const reads=drawingReadContextStats();activeProfile={};const start=performance.now();
 flushSync(()=>root.render(<Profiler id="scene" onRender={profiler}><svg width={VIEW.width} height={VIEW.height} viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} aria-label="Full face renderer benchmark">
  <rect width={VIEW.width} height={VIEW.height} fill="#f6f7f5"/>
  <Profiler id="ghosts" onRender={profiler}><SceneOnionSkin frames={frame.ghosts} angle={frame.main.angle} opacity={.16} screen={screen} unit={VIEW.pixelsPerUnit}/></Profiler>
  <Profiler id="main" onRender={profiler}><g data-benchmark-main="true"><PaintScene d={frame.main.drawing} paintBatches={frame.main.paintBatches} screen={screen} unit={VIEW.pixelsPerUnit} pixelsPerUnit={VIEW.pixelsPerUnit} preview={false} showFills={fills} referenceMoving={false} tool="select" curveDown={noPick} paintDown={noPick} arcDown={noPick}/></g></Profiler>
 </svg></Profiler>));
 const flushMs=performance.now()-start,profile=activeProfile;activeProfile=undefined;
 return {flushMs,reactSceneMs:profile.scene??0,reactMainMs:profile.main??0,reactGhostMs:profile.ghosts??0,flushResidualMs:Math.max(0,flushMs-(profile.scene??0)),renderReadWork:difference(drawingReadContextStats(),reads),profileCallbacks:profile.callbacks??0};
}

function sampleFrame(base:RecordingSnapshotWorkspace,context:PreparedRecordingContext,config:Case,index:number):{frame:Frame;metrics:Metrics} {
 const reads=drawingReadContextStats(),initialStages=getRecordingEvaluationStageTotals();
 const prepared=measure(()=>{
  const workspace=config.workload==='basis'?shiftedBasis(base,index):base;
  if(workspace!==base)context.fork(workspace);
  return workspace;
 });
 const afterPreparation=getRecordingEvaluationStageTotals();
 const evaluated=measure(()=>{
  const main=evaluateRecordingSnapshot(prepared.value,RECORDING_ID,{immutableInputs:true,useDraft:true,diagnostics:'preview',angle:config.workload==='angle'?{x:11.137+(index*17.713)%63,y:14.713+(index*.317)%9}:{x:37.137,y:14.713}});
  // These are lazy products in production. Attribute them to evaluation.
  void main.drawing;void main.paintBatches;
  return main;
 });
 const afterMain=getRecordingEvaluationStageTotals();
 const ghosts=measure(()=>config.ghosts?interpolateSnapshotSurfaceOnion(prepared.value.recordings[0],evaluated.value,ENDPOINTS,config.ghosts===10?10:5).frames:[]);
 const afterGhosts=getRecordingEvaluationStageTotals();
 if(evaluated.value.drawing.curves.length!==121||ghosts.value.length!==config.ghosts||ghosts.value.some(frame=>frame.centerlines?.length!==121))throw Error('Fixture lost full-curve geometry or expected ghost count');
 return {frame:{main:evaluated.value,ghosts:ghosts.value},metrics:{prepareMs:prepared.ms,mainMs:evaluated.ms,ghostMs:ghosts.ms,preparationStages:difference(afterPreparation,initialStages),mainStages:difference(afterMain,afterPreparation),ghostStages:difference(afterGhosts,afterMain),evaluationReadWork:difference(drawingReadContextStats(),reads)}};
}

function inspectScene(frame:Frame){
 const main=sceneHost.querySelector('[data-benchmark-main]'),ghost=sceneHost.querySelector('[data-testid="scene-onion-skin"]');
 const pathBytes=(element:Element|null)=>Array.from(element?.querySelectorAll('path')??[]).reduce((sum,path)=>sum+(path.getAttribute('d')?.length??0),0);
 return {mainCurves:frame.main.drawing.curves.length,mainNodes:frame.main.drawing.nodes.length,mainLayers:frame.main.drawing.layers.length,mainPaintBatches:frame.main.paintBatches.length,mainPaths:main?.querySelectorAll('path').length??0,mainElements:main?.querySelectorAll('*').length??0,mainPathCharacters:pathBytes(main),ghostFrames:frame.ghosts.length,ghostCurves:frame.ghosts.reduce((sum,value)=>sum+(value.centerlines?.length??0),0),ghostPaths:ghost?.querySelectorAll('path').length??0,ghostElements:ghost?.querySelectorAll('*').length??0,ghostPathCharacters:pathBytes(ghost),svgElements:sceneHost.querySelectorAll('svg *').length};
}
function stats(values:number[]){const sorted=[...values].sort((a,b)=>a-b);return {p50:sorted[Math.floor((sorted.length-1)*.5)]??0,p95:sorted[Math.floor((sorted.length-1)*.95)]??0,mean:values.reduce((sum,n)=>sum+n,0)/Math.max(1,values.length),max:sorted.at(-1)??0};}
function summarize(samples:Sample[]){
 const timings=['prepareMs','mainMs','ghostMs','flushMs','reactSceneMs','reactMainMs','reactGhostMs','flushResidualMs','workMs','nextRafOpportunityMs','postWorkToRafMs'] as const;
 const counters=['preparationStages','mainStages','ghostStages','evaluationReadWork','renderReadWork'] as const;
 return {...Object.fromEntries(timings.map(key=>[key,stats(samples.map(sample=>sample[key]))])),stageTotals:Object.fromEntries(counters.map(key=>[key,samples.reduce<Counts>((sum,sample)=>{for(const [name,value] of Object.entries(sample[key]))sum[name]=(sum[name]??0)+value;return sum;},{})]))};
}
const format=(n:number)=>n.toFixed(2);
function publish(){
 byId('json').textContent=JSON.stringify({...report,browserCapabilities},null,2);byId<HTMLButtonElement>('download').disabled=!report.passes.length;
 const container=byId('summary');container.replaceChildren();
 const table=document.createElement('table'),head=document.createElement('tr');
 for(const text of ['Workload / ghosts / pass','Prepare p50','Main eval p50','Ghost eval p50','React render p50','Flush p50','Work p50 / p95','rAF opportunity p50 / p95']){const cell=document.createElement('th');cell.textContent=text;head.append(cell);}table.append(head);
 for(const pass of report.passes){const row=document.createElement('tr'),s=pass.summary as Record<string,ReturnType<typeof stats>>;for(const text of [`${pass.config.workload} / ${pass.config.ghosts} / ${pass.mode}${pass.config.fills?' / fills':''}`,format(s.prepareMs.p50),format(s.mainMs.p50),format(s.ghostMs.p50),format(s.reactSceneMs.p50),format(s.flushMs.p50),`${format(s.workMs.p50)} / ${format(s.workMs.p95)}`,`${format(s.nextRafOpportunityMs.p50)} / ${format(s.nextRafOpportunityMs.p95)}`]){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}table.append(row);}
 container.append(table);
}
function selected():Case{return {workload:byId<HTMLSelectElement>('workload').value as Workload,ghosts:Number(byId<HTMLSelectElement>('ghosts').value) as Case['ghosts'],fills:byId<HTMLInputElement>('fills').checked,samples:Number(byId<HTMLSelectElement>('samples').value)};}
function status(text:string){byId('status').textContent=text;}
function controls(disabled:boolean){for(const id of ['preview','run','matrix','workload','ghosts','fills','samples','capabilities'])(byId(id) as HTMLButtonElement).disabled=disabled;byId<HTMLButtonElement>('stop').disabled=!disabled;}

async function runPass(config:Case,mode:Mode){
 status(`${config.workload}, ${config.ghosts} ghosts: ${mode} · cold preparation`);
 // Reset the React tree outside timing, so firstRender includes a fresh mount.
 // Module/JIT caches may already be warm; this is a cold workspace, not process.
 flushSync(()=>root.render(null));
 await nextOpportunity();
 const fixture=measure(makeFixture),prepared=measure(()=>prepareRecordingContext(fixture.value.workspace,{immutableInputs:true,useDraft:true,diagnostics:'preview'}));
 const cold=sampleFrame(fixture.value.workspace,prepared.value,config,0),coldRender=renderFrame(cold.frame,config.fills);
 if(!coldRender.profileCallbacks)throw Error('React Profiler is inactive. Use scripts/build-recording-renderer-benchmark.mjs and its production profiling bundle.');
 const pass:Pass={mode,config,startup:{scope:'fresh immutable workspace and React mount; module/JIT caches may be warm',fixtureAllocationMs:fixture.ms,contextPreparationMs:prepared.ms,firstEvaluation:cold.metrics,firstRender:coldRender,sourceCounts:fixture.value.sourceCounts},precomputeMs:0,warmupCount:WARMUPS,counts:{},samples:[],summary:{}};
 await nextOpportunity();
 const retained:Frame[]=[];
 if(mode==='render-only'){
  const before=performance.now();
  for(let i=1;i<=config.samples+WARMUPS;i++){
   retained.push(sampleFrame(fixture.value.workspace,prepared.value,config,i).frame);
   if(i%4===0){status(`${config.workload}, ${config.ghosts} ghosts: pre-evaluate renderer-only frame ${i}/${config.samples+WARMUPS}`);await nextOpportunity();}
   if(stopped)return;
  }
  pass.precomputeMs=performance.now()-before;
 }
 let lastFrame=cold.frame;
 for(let i=1;i<=config.samples+WARMUPS;i++){
  if(stopped)return;
  const rafStart=await nextOpportunity(),start=performance.now();
  const sampled=mode==='render-only'?{frame:retained[i-1],metrics:zeroMetrics()}:sampleFrame(fixture.value.workspace,prepared.value,config,i);
  const rendered=mode==='evaluation-only'?zeroRender():renderFrame(sampled.frame,config.fills),workEnded=performance.now();
  const nextRaf=await nextOpportunity();
  const sample:Sample={...sampled.metrics,...rendered,index:i,workMs:workEnded-start,nextRafOpportunityMs:nextRaf-rafStart,postWorkToRafMs:nextRaf-workEnded,visible:document.visibilityState==='visible'};
  if(i>WARMUPS)pass.samples.push(sample);
  lastFrame=sampled.frame;
  if(i%8===0)status(`${config.workload}, ${config.ghosts} ghosts: ${mode} · ${Math.max(0,i-WARMUPS)}/${config.samples} measured frames`);
 }
 // DOM inspection and reporting are outside every measured frame.
 if(mode==='evaluation-only')renderFrame(lastFrame,config.fills);
 pass.counts=inspectScene(lastFrame);pass.summary=summarize(pass.samples);report.passes.push(pass);
 byId('counts').textContent=JSON.stringify(pass.counts);publish();await nextOpportunity();
}
async function run(matrix:boolean){
 if(running)return;running=true;stopped=false;controls(true);
 try{
  const config=selected();
  for(const ghosts of matrix?[0,10,19] as const:[config.ghosts])for(const mode of ['combined','evaluation-only','render-only'] as const){if(stopped)break;await runPass({...config,ghosts},mode);}
  status(stopped?'Stopped. Completed passes remain available.':`Complete: ${report.passes.length} passes. Download JSON for cold costs, raw frames, counters and environment.`);
 }catch(error){const message=error instanceof Error?error.message:String(error);report.errors.push(message);status(`Measurement stopped: ${message}`);publish();}
 finally{running=false;controls(false);}
}
async function preview(){
 if(running)return;controls(true);
 try{const fixture=makeFixture(),config=selected(),context=prepareRecordingContext(fixture.workspace,{immutableInputs:true,useDraft:true,diagnostics:'preview'}),sample=sampleFrame(fixture.workspace,context,config,0);renderFrame(sample.frame,config.fills);byId('counts').textContent=JSON.stringify(inspectScene(sample.frame));status('Preview ready. All six eye/ear layers are visible. Run selected case or matrix to measure.');}
 catch(error){status(String(error));}
 finally{controls(false);}
}
byId('preview').addEventListener('click',()=>void preview());
byId('run').addEventListener('click',()=>void run(false));byId('matrix').addEventListener('click',()=>void run(true));byId('stop').addEventListener('click',()=>{stopped=true;});
byId('download').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({...report,browserCapabilities},null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`contour-renderer-${report.revision}-${new Date().toISOString().replaceAll(':','-')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
byId('capabilities').addEventListener('click',()=>void (async()=>{
 if(running)return;byId<HTMLButtonElement>('capabilities').disabled=true;
 const result:Record<string,unknown>={scope:'this browser/device only; does not measure another computer',secureContext:isSecureContext,checkedAt:new Date().toISOString(),speedup:'No performance inference from API availability'};
 try{
  const gpu=(navigator as Navigator&{gpu?:{requestAdapter:()=>Promise<{info?:{vendor?:string;architecture?:string;device?:string;description?:string;isFallbackAdapter?:boolean};isFallbackAdapter?:boolean}|null>}}).gpu;
  result.webgpuApi=!!gpu;
  if(gpu){const adapter=await gpu.requestAdapter();result.webgpuAdapter=!!adapter;if(adapter){result.adapterInfo=adapter.info?{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description}:null;result.isFallbackAdapter=adapter.isFallbackAdapter??adapter.info?.isFallbackAdapter??null;}}
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');result.webgl2=!!gl;
  if(gl){result.webglVersion=gl.getParameter(gl.VERSION);result.webglRenderer=gl.getParameter(gl.RENDERER);gl.getExtension('WEBGL_lose_context')?.loseContext();}
 }catch(error){result.error=error instanceof Error?error.message:String(error);}
 browserCapabilities=result;byId('capability-status').textContent=JSON.stringify(result);byId<HTMLButtonElement>('capabilities').disabled=false;publish();
})());
byId('environment').textContent=`${report.revision} · ${import.meta.env.PROD?'production profiling bundle':'development build (not for final measurements)'} · DPR ${devicePixelRatio} · ${navigator.hardwareConcurrency} logical cores`;
