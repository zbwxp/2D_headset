import {getSmoothResult,subscribeSmooth} from "../../domain/smooth/evaluation";
import {useEffect,useState} from 'react';
import {useEditor} from '../../app/store';
import type {ContourSource} from '../../domain/contour/source';
import type {Silhouette,Orientation} from '../../domain/contour/silhouette';
import type {ContourRequest} from './contour.worker';
import {useInspectionCamera,useWindows} from './state';
type Result=Silhouette & {id:number;revision:string;invalid:string[];triangleCount:number;error?:string};
export default function ContourPanel(){
 const camera=useInspectionCamera(),threeDVisible=useWindows(s=>s.visible.threeD);
 const [result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(true),[failure,setFailure]=useState('');
 useEffect(()=>{
 let worker:Worker;
 try{worker=new Worker(new URL('./contour.worker.ts',import.meta.url),{type:'module'});}catch(e){setFailure((e as Error).message);setBusy(false);return;}
 let active=true,frame=0,inflight=false,pending=false,requestId=0,revision=0,lastSent='',signature='';
 let source:ContourSource,orientation:Orientation=[0,0,0,1],orientationKey='';
 const schedule=()=>{
 pending=true;setBusy(true);
 if(frame||inflight)return;
 frame=requestAnimationFrame(()=>{
 frame=0;if(!active||!pending)return;pending=false;inflight=true;
 const request:ContourRequest={id:++requestId,revision:String(revision),orientation};
 if(lastSent!==request.revision){request.source=source;lastSent=request.revision;}
 worker.postMessage(request);
 });
 };
 const sourceChanged=()=>{
 const p=useEditor.getState().project;
 const next={landmarks:p.landmarks,curves:p.curves,patches:p.patches??[],surfaceSmooth:p.surfaceSmooth,smoothResult:p.surfaceSmooth?.enabled&&p.surfaceSmooth.strength>0?getSmoothResult(p):undefined};
 const key=JSON.stringify(next);
 if(key===signature)return;signature=key;source=next;revision++;schedule();
 };
 const cameraChanged=()=>{
 // Round sub-numerical OrbitControls noise so dolly does not trigger new silhouettes.
 const q=useInspectionCamera.getState().quaternion.map(x=>+x.toFixed(10)) as Orientation,key=q.join(',');
 if(key===orientationKey)return;orientationKey=key;orientation=q;schedule();
 };
 worker.onmessage=(event:MessageEvent<Result>)=>{
 if(!active)return;inflight=false;
 if(event.data.revision===String(revision)){setResult(event.data);setFailure(event.data.error??'');}
 if(pending)schedule();else setBusy(false);
 };
 worker.onerror=e=>{if(active){inflight=false;setBusy(false);setFailure(e.message||'轮廓计算失败');}};
 sourceChanged();cameraChanged();
 const unsubscribeSource=useEditor.subscribe((s,previous)=>{
 if(s.project.landmarks!==previous.project.landmarks||s.project.curves!==previous.project.curves||s.project.patches!==previous.project.patches||s.project.surfaceSmooth!==previous.project.surfaceSmooth)sourceChanged();
 });
 const unsubscribeSmooth=subscribeSmooth(sourceChanged);
 const unsubscribeCamera=useInspectionCamera.subscribe(cameraChanged);
 return()=>{active=false;cancelAnimationFrame(frame);unsubscribeSource();unsubscribeCamera();unsubscribeSmooth();worker.terminate();};
 },[]);
 const delta=camera.target.map((x,i)=>x-camera.position[i]),length=Math.hypot(...delta),direction=delta.map(x=>x/length);
 const paths=result?.paths??[],empty=!paths.length;
 return <div className="contour-preview" data-testid="contour-preview" data-direction={direction.join(',')} aria-busy={busy}>
 <div className="contour-view-info">正交投影 · {threeDVisible?'跟随 3D 朝向':'保持 3D 最后朝向'}{busy?' · 更新中':''}</div>
 <div className="contour-drawing">
 <svg data-testid="contour-silhouette" aria-label="只读外轮廓" viewBox={'0 0 '+(result?.resolution??768)+' '+(result?.resolution??768)} role="img">
 {paths.map((path,i)=><path key={i} d={'M'+path.map(p=>p.join(',')).join('L')+'Z'} fill="none" stroke="#000" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>)}
 </svg>
 {(failure||empty&&!busy)&&<div className="contour-placeholder">{failure?'无法生成轮廓：'+failure:result?.triangleCount?'当前方向没有可见曲面覆盖':'尚无可求值曲面，请先绘制 Patch。'}</div>}
 </div>
 {result && result.invalid?.length>0&&<div className="contour-view-info" title={result.invalid.join('\n')}>⚠ {result.invalid.length} 个无效 Patch 未参与轮廓</div>}
 <div className="contour-view-info">只读 · 最终曲面外轮廓 · 固定精度</div>
 </div>;
}
