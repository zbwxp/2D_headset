import {memo,useEffect,useMemo,useRef,useState} from 'react';
import type {Point2} from '../../domain/drawing/model';
import type {RecordingScene,SceneSourceResolver} from '../../domain/recordingScene/model';
import {clampAngle,sameAngle,type Angle} from '../../domain/vectorRecording/interpolation';
import PaintScene from '../drawing/PaintScene';
import {evaluateSceneOnionFrame,normalizeSceneOnionSettings,sampleSceneOnionAngles,sceneOnionSavedSignature,type SceneOnionFrame,type SceneOnionSettings} from './angleInspection';
import './angleInspection.css';
export {DEFAULT_SCENE_ONION_SETTINGS,type SceneOnionFrame,type SceneOnionSettings} from './angleInspection';

const EMPTY_FRAMES:SceneOnionFrame[]=[];
/** One pose per task keeps pointer input responsive. A new request cancels any
 * pending sweep; no old-space frames remain visible while preparing its result. */
export function useSceneOnionFrames(scene:RecordingScene,resolve:SceneSourceResolver,settings:SceneOnionSettings,stopAtWarpId?:string){
 const signature=useMemo(()=>sceneOnionSavedSignature(scene),[scene]),savedScene=useMemo(()=>JSON.parse(signature) as RecordingScene,[signature]);
 const normalized=normalizeSceneOnionSettings(settings),{enabled,axis,step,min,max}=normalized,fixed=clampAngle(scene.angle[axis==='x'?'y':'x']);
 const request=useMemo(()=>({scene:savedScene,resolve,stopAtWarpId,angles:sampleSceneOnionAngles(axis==='x'?{x:0,y:fixed}:{x:fixed,y:0},{enabled,axis,step,min,max,opacity:1},true)}),[savedScene,resolve,stopAtWarpId,axis,step,min,max,fixed]);
 const [result,setResult]=useState<{request:typeof request;frames:SceneOnionFrame[];error?:string}|null>(null);
 useEffect(()=>{
  if(!enabled||result?.request===request)return;
  let cancelled=false,index=0,timer:ReturnType<typeof setTimeout>;const frames:SceneOnionFrame[]=[];
  function next(){
   if(cancelled)return;
   try{frames.push(evaluateSceneOnionFrame(request.scene,request.resolve,request.angles[index],request.stopAtWarpId));}
   catch(error){if(!cancelled)setResult({request,frames:[],error:error instanceof Error?error.message:String(error)});return;}
   index++;if(index<request.angles.length)timer=setTimeout(next,0);else if(!cancelled)setResult({request,frames});
  }
  if(request.angles.length)timer=setTimeout(next,80);else setResult({request,frames});
  return()=>{cancelled=true;clearTimeout(timer);};
 },[request,enabled,result?.request]);
 const ready=enabled&&result?.request===request;
 return {frames:ready?result.frames:EMPTY_FRAMES,preparing:enabled&&!ready,error:ready?result.error:undefined};
}

export function SceneOnionControls({settings,onChange,zh=false,preparing=false,error,frameCount}:{settings:SceneOnionSettings;onChange:(settings:SceneOnionSettings)=>void;zh?:boolean;preparing?:boolean;error?:string;frameCount?:number}){
 const txt=(cn:string,en:string)=>zh?cn:en,s=normalizeSceneOnionSettings(settings),patch=(change:Partial<SceneOnionSettings>)=>onChange(normalizeSceneOnionSettings({...s,...change}));
 return <section className="vr-section vr-onion-controls" data-testid="scene-onion-controls">
  <h2>{txt('连续形变检查','ONION SKIN')}<label className="vr-onion-toggle"><input type="checkbox" aria-label="Onion skin" data-testid="scene-onion-toggle" checked={s.enabled} onChange={e=>patch({enabled:e.target.checked})}/>{txt('开启','On')}</label></h2>
  <fieldset disabled={!s.enabled} hidden={!s.enabled}>
   <div className="vr-onion-row"><label>{txt('扫描轴','Sweep')}<select aria-label="Onion sweep axis" value={s.axis} onChange={e=>patch({axis:e.target.value as 'x'|'y'})}><option value="x">X · {txt('左右转向','Yaw')}</option><option value="y">Y · {txt('上下俯仰','Pitch')}</option></select></label><label>{txt('步长','Step')}<select aria-label="Onion step" value={s.step} onChange={e=>patch({step:Number(e.target.value) as 5|10})}><option value="5">5°</option><option value="10">10°</option></select></label></div>
   <div className="vr-onion-row"><label>{txt('从','From')}<OnionRangeInput label="Onion minimum angle" value={s.min} commit={min=>patch({min,max:Math.max(min,s.max)})}/></label><label>{txt('到','To')}<OnionRangeInput label="Onion maximum angle" value={s.max} commit={max=>patch({max,min:Math.min(max,s.min)})}/></label></div>
   <label className="vr-onion-opacity">{txt('透明度','Opacity')}<output>{Math.round(s.opacity*100)}%</output><input aria-label="Onion opacity" type="range" min="0" max=".5" step=".01" value={s.opacity} onChange={e=>patch({opacity:Number(e.target.value)})}/></label>
  </fieldset>
  <small>{s.axis==='x'?txt('固定 Y，沿 X 查看已保存的形变','Hold Y; inspect saved poses along X'):txt('固定 X，沿 Y 查看已保存的形变','Hold X; inspect saved poses along Y')}</small>
  {s.enabled&&<p role="status" aria-live="polite" className={error?'vr-error':'vr-onion-status'} data-testid="scene-onion-status">{error?txt(`检查未就绪：${error}`,`Inspection unavailable: ${error}`):preparing?txt('正在准备轮廓…','Preparing contours…'):txt(`${frameCount??0} 个轮廓 · 当前角度单独显示`,`${frameCount??0} contours · current angle shown separately`)}</p>}
 </section>;
}

function OnionRangeInput({label,value,commit}:{label:string;value:number;commit:(value:number)=>void}){
 const [draft,setDraft]=useState(String(value)),cancelled=useRef(false);
 useEffect(()=>setDraft(String(value)),[value]);
 function finish(){if(cancelled.current){cancelled.current=false;setDraft(String(value));return;}const parsed=Number(draft);if(draft.trim()&&Number.isFinite(parsed)){const next=clampAngle(parsed);setDraft(String(next));if(next!==value)commit(next);}else setDraft(String(value));}
 return <input aria-label={label} type="number" min="-90" max="90" step="1" value={draft} onChange={event=>setDraft(event.target.value)} onBlur={finish} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelled.current=true;event.currentTarget.blur();}}}/>;
}

const noPick=()=>{};
const OnionPaint=memo(PaintScene);
/** Insert behind the active PaintScene inside the same SVG and camera. */
function SceneOnionSkin({frames,angle,opacity,screen,unit}:{frames:readonly SceneOnionFrame[];angle:Angle;opacity:number;screen:(p:Point2)=>Point2;unit:number}){
 // The Recording canvas uses an affine camera. Keep its function identity stable
 // across opacity/cursor changes so cached poses do not rebuild their ink paths.
 const origin=screen([0,0]),x=screen([1,0]),y=screen([0,1]);
 const stableScreen=useMemo(()=>screen,[origin[0],origin[1],x[0],x[1],y[0],y[1]]);
 const visible=frames.filter(frame=>!sameAngle(frame.angle,angle));
 return <g className="vr-onion-skin" data-testid="scene-onion-skin" data-frame-count={visible.length} pointerEvents="none" aria-hidden="true">
  {visible.map(frame=><g key={`${frame.angle.x}:${frame.angle.y}`} data-testid="scene-onion-frame" data-angle-x={frame.angle.x} data-angle-y={frame.angle.y} opacity={Math.max(0,Math.min(1,opacity))} pointerEvents="none"><OnionPaint d={frame.drawing} paintBatches={frame.paintBatches} screen={stableScreen} unit={unit} pixelsPerUnit={unit} preview={true} showFills={false} referenceMoving={false} tool="select" curveDown={noPick} paintDown={noPick} arcDown={noPick}/></g>)}
 </g>;
}
export default memo(SceneOnionSkin);
