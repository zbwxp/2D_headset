import {memo,useEffect,useId,useMemo,useRef,useState} from 'react';
import type {Point2} from '../../domain/drawing/model';
import type {RecordingScene,SceneSourceResolver} from '../../domain/recordingScene/model';
import {clampAngle,sameAngle,type Angle} from '../../domain/vectorRecording/interpolation';
import PaintScene from '../drawing/PaintScene';
import {createSceneOnionSweepQueue,evaluateSceneOnionFrame,markSceneOnionHighlights,normalizeSceneOnionSettings,sampleSceneOnionAngles,sceneOnionInspectionSignature,sceneOnionSweepAnchor,type SceneOnionFrame,type SceneOnionSettings} from './angleInspection';
import './angleInspection.css';
export {DEFAULT_SCENE_ONION_SETTINGS,type SceneOnionFrame,type SceneOnionSettings} from './angleInspection';

const EMPTY_FRAMES:SceneOnionFrame[]=[];
/** Current drafts stay private to a transient sweep, shared with the v2
 * preview behavior. Repeated drag input coalesces without starving updates. */
export function useSceneOnionFrames(scene:RecordingScene,resolve:SceneSourceResolver,settings:SceneOnionSettings,stopAtWarpId?:string){
 const signature=useMemo(()=>sceneOnionInspectionSignature(scene),[scene]),inspection=useMemo(()=>JSON.parse(signature) as RecordingScene,[signature]);
 const {enabled,axis,step,min,max}=normalizeSceneOnionSettings(settings),fixed=sceneOnionSweepAnchor(scene.angle,axis)[axis==='x'?'y':'x'];
 const space=useMemo(()=>({resolve,stopAtWarpId,axis,step,min,max,fixed}),[resolve,stopAtWarpId,axis,step,min,max,fixed]);
 const request=useMemo(()=>({space,scene:inspection,angles:sampleSceneOnionAngles(axis==='x'?{x:0,y:fixed}:{x:fixed,y:0},{enabled,axis,step,min,max,opacity:1},true)}),[space,inspection]);
 const [result,setResult]=useState<{request:typeof request;frames:SceneOnionFrame[];error?:string}|null>(null);
 const queue=useMemo(()=>createSceneOnionSweepQueue<typeof request,SceneOnionFrame>(
  item=>item.angles.length,
  (item,index)=>evaluateSceneOnionFrame(item.scene,item.space.resolve,item.angles[index],item.space.stopAtWarpId),
  (item,frames,error)=>setResult({request:item,frames:markSceneOnionHighlights(frames,{...item.space,enabled:true,opacity:1}),error}),
 ),[space]);
 useEffect(()=>{if(enabled)queue.update(request);else queue.cancel();},[queue,request,enabled]);
 useEffect(()=>()=>queue.cancel(),[queue]);
 const ready=enabled&&result?.request===request,compatible=enabled&&result?.request.space===space;
 return {frames:compatible?result.frames:EMPTY_FRAMES,preparing:enabled&&!ready,error:ready?result.error:undefined};
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
  <small>{s.axis==='x'?txt('固定 Y = 0，沿 X 预览当前修改的连续形变','Hold Y = 0; preview live pose edits along X'):txt('固定 X，沿 Y 预览当前修改的连续形变','Hold X; preview live pose edits along Y')}</small>
  {s.enabled&&<div className="vr-onion-legend" aria-label="Onion guide colors"><span className="vr-onion-guide-30">{s.max<=0&&s.min<0?'-30°':'30°'}</span><span className="vr-onion-guide-60">{s.max<=0&&s.min<0?'-60°':'60°'}</span></div>}
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
 const filterPrefix=useId();
 const origin=screen([0,0]),x=screen([1,0]),y=screen([0,1]);
 const stableScreen=useMemo(()=>screen,[origin[0],origin[1],x[0],x[1],y[0],y[1]]);
 const visible=frames.filter(frame=>!sameAngle(frame.angle,angle));
 return <g className="vr-onion-skin" data-testid="scene-onion-skin" data-frame-count={visible.length} pointerEvents="none" aria-hidden="true">
  <defs>{(['base','30','60'] as const).map(tone=><filter key={tone} id={`${filterPrefix}-${tone}`} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB"><feFlood floodColor={tone==='30'?'#20b9b3':tone==='60'?'#ef9670':'#88a7b9'}/><feComposite in2="SourceGraphic" operator="in"/></filter>)}</defs>
  {visible.map(frame=><g className={`vr-onion-frame${frame.highlight?` vr-onion-guide-${frame.highlight}`:''}`} filter={`url(#${filterPrefix}-${frame.highlight??'base'})`} data-highlight-angle={frame.highlightAngle} key={`${frame.angle.x}:${frame.angle.y}`} data-testid="scene-onion-frame" data-angle-x={frame.angle.x} data-angle-y={frame.angle.y} opacity={Math.max(0,Math.min(1,opacity))} pointerEvents="none"><OnionPaint d={frame.drawing} paintBatches={frame.paintBatches} screen={stableScreen} unit={unit} pixelsPerUnit={unit} preview={true} showFills={false} referenceMoving={false} tool="select" curveDown={noPick} paintDown={noPick} arcDown={noPick}/></g>)}
 </g>;
}
export default memo(SceneOnionSkin);
