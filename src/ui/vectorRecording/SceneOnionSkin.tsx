import {memo,useEffect,useMemo,useRef,useState} from 'react';
import type {Point2} from '../../domain/drawing/model';
import type {RecordingScene,SceneSourceResolver} from '../../domain/recordingScene/model';
import {clampAngle,sameAngle,type Angle} from '../../domain/vectorRecording/interpolation';
import PaintScene from '../drawing/PaintScene';
import {curvePath} from '../drawing/geometry';
import type {EndpointOnionView,SceneOnionEndpoints} from './endpointOnion';
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

export function SceneOnionControls({settings,onChange,zh=false,preparing=false,error,frameCount,endpointViews,endpoints,onEndpointsChange,diagnostics=[],pairDriven=false}:{settings:SceneOnionSettings;onChange:(settings:SceneOnionSettings)=>void;zh?:boolean;preparing?:boolean;error?:string;frameCount?:number;endpointViews?:readonly EndpointOnionView[];endpoints?:SceneOnionEndpoints;onEndpointsChange?:(value:SceneOnionEndpoints)=>void;diagnostics?:readonly string[];pairDriven?:boolean}){
 const txt=(cn:string,en:string)=>zh?cn:en,s=normalizeSceneOnionSettings(settings),patch=(change:Partial<SceneOnionSettings>)=>onChange(normalizeSceneOnionSettings({...s,...change}));
 const ends=endpoints&&endpointViews?.filter(view=>view.id===endpoints.startSnapshotId||view.id===endpoints.endSnapshotId),axis=ends?.length===2&&Math.abs(ends[1].angle.y-ends[0].angle.y)>Math.abs(ends[1].angle.x-ends[0].angle.x)?'y':'x',negative=ends?.length===2?Math.max(...ends.map(view=>view.angle[axis]))<=0&&Math.min(...ends.map(view=>view.angle[axis]))<0:s.max<=0&&s.min<0;
 return <section className="vr-section vr-onion-controls" data-testid="scene-onion-controls">
  <h2>{endpoints?txt('两端快照插值','ENDPOINT INTERPOLATION'):txt('连续形变检查','ONION SKIN')}<label className="vr-onion-toggle"><input type="checkbox" aria-label="Onion skin" data-testid="scene-onion-toggle" checked={s.enabled} onChange={e=>patch({enabled:e.target.checked})}/>{txt('开启','On')}</label></h2>
   {endpoints&&endpointViews&&<div className="vr-onion-endpoints">{(['startSnapshotId','endSnapshotId'] as const).map((key,index)=><label key={key}>{index===0?txt('起点快照','Start snapshot'):txt('终点快照','End snapshot')}<select aria-label={index===0?'Onion start snapshot':'Onion end snapshot'} value={endpoints[key]} disabled={pairDriven} onChange={event=>onEndpointsChange?.({...endpoints,[key]:event.target.value})}>{endpointViews.map(view=><option key={view.id} value={view.id}>{view.name} · X {view.angle.x}° / Y {view.angle.y}°</option>)}</select></label>)}</div>}
  <fieldset disabled={!s.enabled} hidden={!s.enabled}>
   <div className="vr-onion-row">{!endpoints&&<label>{txt('扫描轴','Sweep')}<select aria-label="Onion sweep axis" value={s.axis} onChange={e=>patch({axis:e.target.value as 'x'|'y'})}><option value="x">X · {txt('左右转向','Yaw')}</option><option value="y">Y · {txt('上下俯仰','Pitch')}</option></select></label>}<label>{txt('步长','Step')}<select aria-label="Onion step" value={s.step} onChange={e=>patch({step:Number(e.target.value) as 5|10})}><option value="5">5°</option><option value="10">10°</option></select></label></div>
   {!endpoints&&<div className="vr-onion-row"><label>{txt('从','From')}<OnionRangeInput label="Onion minimum angle" value={s.min} commit={min=>patch({min,max:Math.max(min,s.max)})}/></label><label>{txt('到','To')}<OnionRangeInput label="Onion maximum angle" value={s.max} commit={max=>patch({max,min:Math.min(max,s.min)})}/></label></div>}
   <label className="vr-onion-opacity">{txt('透明度','Opacity')}<output>{Math.round(s.opacity*100)}%</output><input aria-label="Onion opacity" type="range" min="0" max=".5" step=".01" value={s.opacity} onChange={e=>patch({opacity:Number(e.target.value)})}/></label>
  </fieldset>
  <small>{txt('检查时暂时隐藏当前填充，关闭后恢复。','Current fills are hidden temporarily and restored when inspection closes.')}</small><small>{pairDriven?txt('与主画面共用两端控制点及 X/Y 响应；中间位置只是反推修正约束，不含独立形状键。','Uses the same endpoint controls and X/Y responses as the canvas. Intermediate positions are correction constraints, not independent shape keys.'):endpoints?txt('按线／图层的形变权重混合两端最终 Bézier。同 ID 区间仍按角度线性混合；显隐取较近端点，中点按较低角度端点。区间结构不一致时取较近端并提示。中间关键帧不参与，拖动当前端点时实时更新。','Blend final endpoint Béziers with curve/layer deformation weights. Matching interval IDs keep linear angle timing. Visibility follows the nearer endpoint; midpoint ties use the lower-angle endpoint. Mismatched interval structures use the nearer endpoint with a diagnostic. Intermediate keys are ignored; current endpoint edits update live.'):s.axis==='x'?txt('固定 Y = 0，沿 X 预览当前修改的连续形变','Hold Y = 0; preview live pose edits along X'):txt('固定 X，沿 Y 预览当前修改的连续形变','Hold X; preview live pose edits along Y')}</small>
  {s.enabled&&<div className="vr-onion-legend" aria-label="Onion guide colors"><span className="vr-onion-guide-30">{negative?'-30°':'30°'}</span><span className="vr-onion-guide-60">{negative?'-60°':'60°'}</span></div>}
  {s.enabled&&diagnostics.length>0&&<details className="vr-onion-diagnostics"><summary>{txt(`${diagnostics.length} 条插值提示`,`${diagnostics.length} interpolation notes`)}</summary>{diagnostics.map((message,index)=><p key={index}>{message}</p>)}</details>}
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
const OnionCenterlines=memo(({lines,screen}:{lines:NonNullable<SceneOnionFrame['centerlines']>;screen:(p:Point2)=>Point2})=><path data-testid="scene-onion-centerline" data-primitive-count={lines.length} d={lines.map(line=>curvePath(line.cubic,screen)).join(' ')} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"/>);
/** Insert behind the active PaintScene inside the same SVG and camera. */
function SceneOnionSkin({frames,angle,opacity,screen,unit}:{frames:readonly SceneOnionFrame[];angle:Angle;opacity:number;screen:(p:Point2)=>Point2;unit:number}){
 // The Recording canvas uses an affine camera. Keep its function identity stable
 // across opacity/cursor changes so cached poses do not rebuild their ink paths.
 const origin=screen([0,0]),x=screen([1,0]),y=screen([0,1]);
 const stableScreen=useMemo(()=>screen,[origin[0],origin[1],x[0],x[1],y[0],y[1]]);
 const visible=frames.filter(frame=>!sameAngle(frame.angle,angle));
 return <g className="vr-onion-skin" data-testid="scene-onion-skin" data-frame-count={visible.length} pointerEvents="none" aria-hidden="true">
  {visible.map(frame=><g className={`vr-onion-frame${frame.highlight?` vr-onion-guide-${frame.highlight}`:''}`} data-highlight-angle={frame.highlightAngle} key={`${frame.angle.x}:${frame.angle.y}`} data-testid="scene-onion-frame" data-angle-x={frame.angle.x} data-angle-y={frame.angle.y} opacity={Math.max(0,Math.min(1,frame.highlight?(opacity>0?Math.max(.65,opacity):0):opacity))} pointerEvents="none">{frame.centerlines?<OnionCenterlines lines={frame.centerlines} screen={stableScreen}/>:<OnionPaint d={frame.drawing} paintBatches={frame.paintBatches} screen={stableScreen} unit={unit} pixelsPerUnit={unit} preview={true} showFills={false} referenceMoving={false} tool="select" curveDown={noPick} paintDown={noPick} arcDown={noPick}/>}</g>)}
 </g>;
}
export default memo(SceneOnionSkin);
