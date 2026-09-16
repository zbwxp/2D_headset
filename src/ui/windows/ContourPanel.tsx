import {surfaceInputKey} from '../../domain/geometry/revisions';
import {evaluationToken} from '../../domain/continuity/evaluation';
import {count} from '../../domain/geometry/diagnostics';
import {getSmoothResult,subscribeSmooth} from "../../domain/continuity/evaluation";
import {useEffect,useState} from 'react';
import {useEditor} from '../../app/store';
import type {ContourSource} from '../../domain/contour/source';
import type {Silhouette,Orientation} from '../../domain/contour/silhouette';
import type {ContourRequest} from './contour.worker';
import {contourProfile as metrics,type JobTiming} from './contourProfile';
import {useInspectionCamera,useWindows} from './state';
type Result=Silhouette & {orientation?:Orientation;type:string;timing:JobTiming;id:number;revision:string;invalid:string[];triangleCount:number;error?:string};
export default function ContourPanel(){
 const threeDVisible=useWindows(s=>s.visible.threeD);
 const [result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(true),[failure,setFailure]=useState('');
 useEffect(()=>{
 let worker:Worker;
 try{worker=new Worker(new URL('./contour.worker.ts',import.meta.url),{type:'module'});}catch(e){setFailure((e as Error).message);setBusy(false);return;}
 let active=true,frame=0,requestId=0,revision=0,lastSent='',signature='';
 let source:ContourSource,orientation:Orientation=[0,0,0,1],orientationKey='';
 let dispatchedAt=0,requestBudgetMs=32;
 const post=(request:ContourRequest)=>{
 const start=performance.now();worker.postMessage(request);
 if(metrics){metrics.postMs+=performance.now()-start;
 const measuredAt=performance.now();const bytes=new TextEncoder().encode(JSON.stringify(request)).byteLength;metrics.payloadMeasurementMs+=performance.now()-measuredAt;
 if(request.type==='SET_SURFACE'){metrics.uploads++;metrics.surfaceBytes+=bytes;}else{metrics.requests++;metrics.bytes+=bytes;}}
 };
 const schedule=()=>{
 setBusy(true);if(frame)return;
 frame=requestAnimationFrame(()=>{
 frame=0;if(!active)return;
 // Backpressure: do not repeatedly cancel a job just before completion on a 60Hz
 // display when the full-quality worker needs >16ms. Keep only latest camera input.
 if(performance.now()-dispatchedAt<requestBudgetMs){schedule();return;}
 const start=performance.now();
 if(lastSent!==String(revision)){post({type:'SET_SURFACE',revision:String(revision),source});lastSent=String(revision);}
 const request:ContourRequest={type:'RENDER',id:++requestId,revision:String(revision),orientation};
 if(metrics)metrics.prepMs+=performance.now()-start;
 dispatchedAt=performance.now();count('contourDispatches');post(request);
 });
 };
 const sourceChanged=()=>{
 const p=useEditor.getState().project;
 const next={loomisScaffold:p.loomisScaffold,loomisCaps:p.loomisCaps,loomisRegions:p.loomisRegions,headFrame:p.headFrame,landmarks:p.landmarks,curves:p.curves,patches:p.patches??[],surfaceContinuity:p.surfaceContinuity,smoothResult:getSmoothResult(p)};
 const key=surfaceInputKey(p)+evaluationToken(p);
 if(key===signature)return;signature=key;source=next;revision++;schedule();
 };
 const cameraChanged=()=>{
 // Round sub-numerical OrbitControls noise so dolly does not trigger new silhouettes.
 const q=useInspectionCamera.getState().quaternion.map(x=>+x.toFixed(10)) as Orientation,key=q.join(',');
 if(key===orientationKey)return;if(metrics)metrics.camera++;orientationKey=key;orientation=q;schedule();
 };
 worker.onmessage=(event:MessageEvent<Result>)=>{
 if(!active)return;
 const data=event.data;
 if(data.type==='STARTED'){if(metrics)metrics.started++;return;}
 if(metrics&&data.timing){metrics.stages.push(data.timing);if(metrics.stages.length>2000)metrics.stages.shift();}
 if(data.type==='CANCELLED'){requestBudgetMs=Math.max(requestBudgetMs*1.15,data.timing.total*1.25);if(metrics)metrics.cancelled++;return;}
 if(data.type==='SURFACE_ERROR'){if(data.revision===String(revision)){setFailure(data.error??'轮廓源未准备');setBusy(false);}return;}
 if(metrics)metrics.completed++;
 if(data.timing)requestBudgetMs=Math.max(16,requestBudgetMs*.75+data.timing.total*1.25*.25);
 // Newest submitted display-frame request is authoritative. Unsent intra-frame input
 // is coalesced by RAF; it does not invalidate every completion between display frames.
 if(data.id===requestId&&data.revision===String(revision)){
 if(metrics){metrics.installed++;metrics.latencies.push(performance.now()-dispatchedAt);if(metrics.latencies.length>2000)metrics.latencies.shift();}
 setResult(data);setFailure(data.error??'');if(!frame)setBusy(false);
 }else if(metrics)metrics.stale++;
 };
 worker.onerror=e=>{if(active){setBusy(false);setFailure(e.message||'轮廓计算失败');}};
 sourceChanged();cameraChanged();
 const unsubscribeSource=useEditor.subscribe((s,previous)=>{
 if(s.project.loomisScaffold!==previous.project.loomisScaffold||s.project.loomisCaps!==previous.project.loomisCaps||s.project.loomisRegions!==previous.project.loomisRegions||s.project.headFrame!==previous.project.headFrame||s.project.landmarks!==previous.project.landmarks||s.project.curves!==previous.project.curves||s.project.patches!==previous.project.patches||s.project.surfaceContinuity!==previous.project.surfaceContinuity)sourceChanged();
 });
 const unsubscribeSmooth=subscribeSmooth(sourceChanged);
 const unsubscribeCamera=useInspectionCamera.subscribe(cameraChanged);
 return()=>{active=false;cancelAnimationFrame(frame);unsubscribeSource();unsubscribeCamera();unsubscribeSmooth();worker.terminate();};
 },[]);
 const camera=useInspectionCamera.getState();
 const delta=camera.target.map((x,i)=>x-camera.position[i]),length=Math.hypot(...delta),direction=delta.map(x=>x/length);
 const paths=result?.paths??[],openPaths=result?.openPaths??[],empty=!paths.length&&!openPaths.length;
 return <div className="contour-preview" data-testid="contour-preview" data-direction={direction.join(',')} aria-busy={busy||!failure&&result?.orientation?.join(',')!==camera.quaternion.map(x=>+x.toFixed(10)).join(',')}>
 <div className="contour-view-info">正交投影 · {threeDVisible?'跟随 3D 朝向':'保持 3D 最后朝向'}{busy?' · 更新中':''}</div>
 <div className="contour-drawing">
 <svg data-testid="contour-silhouette" aria-label="只读外轮廓" viewBox={'0 0 '+(result?.resolution??768)+' '+(result?.resolution??768)} role="img">
 {paths.map((path,i)=><path key={i} d={'M'+path.map(p=>p.join(',')).join('L')+'Z'} fill="none" stroke="#000" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>)}
 {openPaths.map((path,i)=><path key={'open'+i} data-contour-open d={'M'+path.map(p=>p.join(',')).join('L')} fill="none" stroke="#000" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>)}
 </svg>
 {(failure||empty&&!busy)&&<div className="contour-placeholder">{failure?'无法生成轮廓：'+failure:result?.triangleCount?'当前方向没有可见曲面覆盖':'尚无可求值曲面，请先绘制 Patch。'}</div>}
 </div>
 {result && result.invalid?.length>0&&<div className="contour-view-info" title={result.invalid.join('\n')}>⚠ {result.invalid.length} 个无效 Patch 未参与轮廓</div>}
 <div className="contour-view-info">只读 · 可见几何轮廓 · 固定精度</div>
 </div>;
}
