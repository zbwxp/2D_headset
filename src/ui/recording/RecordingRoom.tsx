import {memo,useEffect,useId,useMemo,useRef,useState} from 'react';
import {Camera,Trash2,Move,Orbit,Scan,Eye,EyeOff,ArrowLeft} from 'lucide-react';
import {useEditor} from '../../app/store';
import {emptyPoseRecording,recordSnapshot,changePose,samePoseView,syncPoseSnapshots,type PoseRecording,type RecordedPose} from '../../domain/recording/poses';
import {evaluatePoses,poseCoverage,type PoseEvaluation} from '../../domain/recording/poseEvaluation';
import {shapeOf,type Point2} from '../../domain/drawing/model';
import type {View} from '../../domain/recording/model';
import PaintScene from '../drawing/PaintScene';
import {curvePath} from '../drawing/geometry';
import {useDrawing} from '../drawing/session';
import {useRecording} from './session';
import Reference from './Reference';
import LiveNumberInput from './LiveNumberInput';
import {frameNavigation} from './frameNavigation';
import {deletePose} from '../../domain/recording/poseInference';
import InferencePanel from './InferencePanel';
import NumericSlider from '../shared/NumericSlider';
import {uiText as t,useLanguage} from '../i18n';
import './recording.css';
import './poseRecording.css';

const EMPTY=emptyPoseRecording(),noop=()=>{},logicalScreen=([x,y]:Point2):Point2=>[x*250,-y*250];
export function commitPoseRecording(next:PoseRecording){const e=useEditor.getState();if(next===e.project.poseRecording)return;e.beginEdit();e.setPoseRecording(next);e.endEdit();}
const Artwork=memo(function Artwork({result,interactive,pixelsPerUnit}:{result:PoseEvaluation;interactive:boolean;pixelsPerUnit:number}){
 return <PaintScene d={result.drawing} pixelsPerUnit={pixelsPerUnit} interactiveEffects={interactive} opacity={result.opacity} screen={logicalScreen} unit={250} preview showFills referenceMoving={false} tool="select" curveDown={noop} paintDown={noop} arcDown={noop}/>;
});
const degrees=(v:number)=>`${+v.toFixed(2)}°`;
export default function RecordingRoom(){
 useLanguage(s=>s.language);
 const project=useEditor(s=>s.project),session=useRecording(),{view,zoom,pan}=session;
 const viewQueue=useMemo(()=>frameNavigation(v=>useRecording.getState().navigate(v)),[]);
 useEffect(()=>()=>viewQueue.cancel(),[viewQueue]);
 const library=project.drawingSnapshots,stored=useMemo(()=>syncPoseSnapshots(project.poseRecording??EMPTY,library),[project.poseRecording,library]);
 const [source,setSource]=useState(library?.activeId??library?.items[0]?.id??'');
 const [selected,setSelected]=useState<string|null>(null),[mode,setMode]=useState<'move'|'view'>('move');
 const [draft,setDraft]=useState<PoseRecording|null>(null),[error,setError]=useState('');
 const [head,setHead]=useState(true),[headOpacity,setHeadOpacity]=useState(.28),[ghosts,setGhosts]=useState(true),[focusElement,setFocusElement]=useState<string>();
 const [size,setSize]=useState({width:650,height:650});
 const host=useRef<HTMLElement>(null),svg=useRef<SVGSVGElement>(null);
 const drag=useRef<{pointer:number;start:Point2;kind:'move'|'view'|'pan';base:PoseRecording;pose?:RecordedPose;next?:PoseRecording;view:View;pan:Point2;unit:number}|null>(null);
 const numberEdit=useRef<{base:PoseRecording;next?:PoseRecording}|null>(null);
 const r=draft??stored,pose=r.poses.find(p=>p.id===selected),atPose=pose&&samePoseView(pose,view);
 const exact=r.poses.find(p=>samePoseView(p,view));
 const snapshot=library?.items.find(s=>s.id===source),sourceOfPose=library?.items.find(s=>s.id===pose?.sourceSnapshotId);
 // Reference size is independent of the artwork: resizing it must not rebuild
 // all derived strokes and fills, or invalidate their coverage cache.
 const artworkRecording=useMemo(()=>({version:1 as const,poses:r.poses,inferences:r.inferences}),[r.poses,r.inferences]);
 const artworkId=useId();
 const [settled,setSettled]=useState({recording:artworkRecording,view});
 const interactive=settled.recording!==artworkRecording||settled.view!==view;
 // Navigation updates exact source geometry/intervals/occlusion every frame.
 // Ink polygons use zoom-aware subpixel sampling; only soft-effect raster
 // resolution changes while interacting versus after settling.
 useEffect(()=>{const timer=setTimeout(()=>setSettled({recording:artworkRecording,view}),160);return()=>clearTimeout(timer);},[artworkRecording,view]);
 const result=useMemo(()=>evaluatePoses(artworkRecording,view),[artworkRecording,view]);
 const g=useMemo(()=>poseCoverage(artworkRecording,focusElement),[artworkRecording,focusElement]);
 const unit=Math.min(size.width,size.height)/2.8*zoom;
 const transform=`translate(${size.width/2+pan[0]} ${size.height/2+pan[1]}) scale(${unit/250})`;
 const warnIds=[...result.status].filter(([,s])=>s==='frozen').map(([id])=>id);
 const frozenObjects=[...result.drawing.curves,...result.drawing.fills,...result.drawing.offsets].filter(o=>warnIds.includes(o.id));
 useEffect(()=>{const el=host.current!;const ob=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));ob.observe(el);return()=>ob.disconnect();},[]);
 useEffect(()=>{if(project.recording)useEditor.getState().setPoseRecording(stored);},[project.recording,stored]);
 useEffect(()=>{if(!library?.items.some(s=>s.id===source))setSource(library?.activeId??library?.items[0]?.id??'');},[library,source]);
 const cancel=()=>{drag.current=null;numberEdit.current=null;viewQueue.cancel();setDraft(null);};
 useEffect(()=>{cancel();if(selected&&!stored.poses.some(p=>p.id===selected))setSelected(null);},[stored]);
 useEffect(()=>{const blur=()=>cancel(),visibility=()=>{if(document.hidden)cancel();},key=(e:KeyboardEvent)=>{
  if(e.key==='Escape'){cancel();return;}
  if(e.target instanceof HTMLElement&&e.target.closest('input,textarea,select,[contenteditable="true"]'))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&drag.current){e.preventDefault();e.stopImmediatePropagation();cancel();}
 };window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility);window.addEventListener('keydown',key,true);return()=>{window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('keydown',key,true);};},[]);
 function navigate(v:View){viewQueue.cancel();setError('');setDraft(null);session.navigate(v);}
 function previewView(v:View){setError('');setDraft(null);viewQueue.push(v);}
 function choose(p:RecordedPose){cancel();setSelected(p.id);setFocusElement(undefined);navigate(p);}
 function update(id:string,change:Parameters<typeof changePose>[2]){try{const next=changePose(stored,id,change);commitPoseRecording(next);setError('');if(change.yaw!==undefined||change.pitch!==undefined)session.navigate(next.poses.find(p=>p.id===id)!);}catch(e){setError((e as Error).message);}}
 function previewOffset(i:0|1,value:number){const edit=numberEdit.current;if(!edit||!pose)return;const original=edit.base.poses.find(p=>p.id===pose.id);if(!original)return;const offset:Point2=[...original.offset];offset[i]=value;edit.next=offset[i]===original.offset[i]?edit.base:changePose(edit.base,pose.id,{offset});setDraft(edit.next);setError('');}
 function finishNumber(commit:boolean){const edit=numberEdit.current;numberEdit.current=null;setDraft(null);if(commit&&edit?.next&&edit.next!==edit.base)commitPoseRecording(edit.next);}
 function capture(replace?:RecordedPose){if(!snapshot)return;try{const next=recordSnapshot(stored,snapshot,view,replace?.id);commitPoseRecording(next);choose(next.poses.find(p=>samePoseView(p,view))!);}catch(e){setError((e as Error).message);}}
 function pointerMove(e:React.PointerEvent){const d=drag.current;if(!d||d.pointer!==e.pointerId)return;
  const dx=e.clientX-d.start[0],dy=e.clientY-d.start[1];
  if(d.kind==='pan')session.set({pan:[d.pan[0]+dx,d.pan[1]+dy]});
  else if(d.kind==='view')viewQueue.push({yaw:d.view.yaw-dx*.25,pitch:d.view.pitch+dy*.25});
  else if(d.pose){d.next=changePose(d.base,d.pose.id,{offset:[d.pose.offset[0]+dx/d.unit,d.pose.offset[1]-dy/d.unit]});setDraft(d.next);}
 }
 function finish(e:React.PointerEvent){const d=drag.current;if(!d||d.pointer!==e.pointerId)return;pointerMove(e);if(d.kind==='view')viewQueue.flush();const next=d.next;drag.current=null;setDraft(null);if(next)commitPoseRecording(next);if(svg.current?.hasPointerCapture(e.pointerId))svg.current.releasePointerCapture(e.pointerId);}
 const goDrawing=()=>{cancel();session.set({room:false});useDrawing.getState().set({room:true});};
 return <main className="recording-room pose-room" data-testid="recording-room">
  <aside className="pose-sidebar">
   <div className="pose-sidebar-title"><Camera size={18}/><strong>{t('快照录制')}</strong></div>
   <section className="pose-import">
    <label>{t('绘制间快照')}<select aria-label={t('录制快照来源')} data-testid="pose-source" value={source} onChange={e=>setSource(e.target.value)}><option value="" disabled>{t('请先在绘制间保存快照')}</option>{library?.items.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <small>{t('录入到当前视角')} · {degrees(view.yaw)} / {degrees(view.pitch)}</small>
    <button className="pose-primary" data-testid="pose-capture" disabled={!snapshot} onClick={()=>capture(exact)}><Camera size={15}/>{t(exact?'替换此视角':'录入此视角')}</button>
    {exact&&<small>{t('将替换')}：{exact.name}</small>}
    <button className="pose-drawing-link" onClick={goDrawing}><ArrowLeft size={14}/>{t('去绘制间编辑画面')}</button>
   </section>
   <div className="pose-section-label">{t('已录制姿态')} <span>{r.poses.length}</span></div>
   <div className="pose-list" data-testid="pose-list">{[...r.poses].sort((a,b)=>a.yaw-b.yaw||a.pitch-b.pitch).map(p=><button key={p.id} data-testid="pose-row" className={p.id===selected?'selected':''} aria-pressed={p.id===selected} onClick={()=>choose(p)}><span>{p.name}</span><small>Yaw {degrees(p.yaw)} · Pitch {degrees(p.pitch)}</small></button>)}{!r.poses.length&&<p>{t('从上方选择快照，在合适角度录入第一帧。')}</p>}</div>
   {pose&&<section className="pose-inspector" key={pose.id}>
    <input aria-label={t('录制姿态名称')} key={pose.name} defaultValue={pose.name} onBlur={e=>{if(e.target.value!==pose.name)update(pose.id,{name:e.target.value});}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>
    <div className="pose-fields">{(['yaw','pitch'] as const).map(k=><label key={k}>{k==='yaw'?'Yaw':'Pitch'}<input aria-label={t(k==='yaw'?'姿态 Yaw':'姿态俯仰')} type="number" min={k==='yaw'?-180:-89} max={k==='yaw'?180:89} step=".25" key={pose[k]} defaultValue={+pose[k].toFixed(3)} onBlur={e=>{const value=+e.target.value;if(e.target.value.trim()&&value!==pose[k])update(pose.id,{[k]:value});}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>)}</div>
    <strong>{t('整体平移')}</strong>
    {!atPose&&<button className="pose-return" onClick={()=>choose(pose)}>{t('返回此姿态以调整位置')}</button>}
    <div className="pose-fields">{([0,1] as const).map(i=><label key={i}>{i?'Y':'X'}<LiveNumberInput label={t(i?'姿态平移 Y':'姿态平移 X')} value={pose.offset[i]} disabled={!atPose} onStart={()=>{numberEdit.current={base:stored};}} onPreview={v=>previewOffset(i,v)} onFinish={finishNumber}/></label>)}</div>
    <button disabled={!atPose||pose.offset.every(x=>x===0)} onClick={()=>update(pose.id,{offset:[0,0]})}>{t('重置平移')}</button>
    <small data-testid="pose-source-status">{sourceOfPose?<>{t('来源快照')}：{sourceOfPose.name}<br/>{t('快照更新自动同步，保留录制角度与平移。')}</>:t('原快照已删除，保留最后同步内容。')}</small>
    <button data-testid="pose-delete" onClick={()=>{commitPoseRecording(deletePose(stored,pose.id));setSelected(null);}}><Trash2 size={14}/>{t('删除录制姿态')}</button>
   </section>}
   {!!frozenObjects.length&&<details className="pose-missing"><summary>{t('未覆盖元素')} · {frozenObjects.length}</summary><small>{t('点击名称查看该元素的视角覆盖。')}</small>{frozenObjects.map(o=><button key={o.id} className={focusElement===o.id?'selected':''} onClick={()=>setFocusElement(focusElement===o.id?undefined:o.id)}>{o.name}</button>)}</details>}
   <InferencePanel recording={stored} curveId={focusElement} commit={commitPoseRecording} onError={setError} selectPose={(p,id)=>{choose(p);setFocusElement(id);}}/>
  </aside>
  <div className="recording-work">
   <nav className="recording-toolbar pose-toolbar">
    <button aria-pressed={mode==='move'} onClick={()=>{cancel();setMode('move');}}><Move size={15}/>{t('平移姿态')}</button>
    <button aria-pressed={mode==='view'} onClick={()=>{cancel();setMode('view');}}><Orbit size={15}/>{t('旋转视角')}</button>
    <button onClick={()=>session.set({zoom:1,pan:[0,0]})}><Scan size={15}/>{t('居中')}</button>
    <button aria-pressed={head} data-testid="pose-toggle-head" onClick={()=>setHead(!head)}>{head?<Eye size={15}/>:<EyeOff size={15}/>} {t('头壳参考')}</button>
    <NumericSlider className="pose-reference-scale" label="头壳大小" value={stored.referenceScale??1} min={.1} max={5} step={.01} snapTargets={[1]} inputScale={100} formatValue={v=>`${Math.round(v*100)}%`} disabled={!head}
     onEditStart={()=>useEditor.getState().beginEdit(true)} onChange={referenceScale=>{const e=useEditor.getState();e.setPoseRecording({...e.project.poseRecording??EMPTY,referenceScale});}} onEditEnd={()=>useEditor.getState().endEdit()} onUndo={()=>useEditor.getState().undo()} onRedo={()=>useEditor.getState().redo()}/>
    <label className="pose-reference-opacity">{t('参考透明度')}<input type="range" aria-label={t('头壳参考透明度')} min="0" max="1" step=".01" value={headOpacity} disabled={!head} onChange={e=>setHeadOpacity(+e.target.value)}/></label>
    <button aria-pressed={ghosts} onClick={()=>setGhosts(!ghosts)}>{t('未覆盖参考')}</button>
   </nav>
   {error&&<div className="pose-error" role="alert">{t(error)}</div>}
   {result.warnings.map(w=><div className="pose-warning" key={w}>{t(w)}</div>)}
   <div className="recording-panels pose-panels">
    <section className="recording-edit pose-stage" ref={host}>
     <div className="pose-panel-title">{t('姿态定位')}<span>Yaw {degrees(view.yaw)} · Pitch {degrees(view.pitch)}</span></div>
     {head&&<Reference project={project} view={view} width={size.width} height={size.height} zoom={zoom} pan={pan} unit={unit} referenceScale={stored.referenceScale??1} opacity={headOpacity}/>}
     <svg ref={svg} className="recording-overlay" data-testid="recording-canvas" aria-label={t('录制姿态定位画布')} width="100%" height="100%" tabIndex={0} onContextMenu={e=>e.preventDefault()} onWheel={e=>{if(!drag.current)session.set({zoom:Math.max(.15,Math.min(10,zoom*Math.exp(-e.deltaY*.001)))});}}
      onPointerDown={e=>{if(e.button!==0&&e.button!==2&&e.button!==1)return;const kind=e.button===2||e.button===1||e.shiftKey?'pan':mode;if(kind==='move'&&!atPose){setError(t('请先选择当前角度的录制姿态，再整体平移。'));return;}e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);drag.current={pointer:e.pointerId,start:[e.clientX,e.clientY],kind,base:stored,pose,view,pan,unit};setError('');}}
      onPointerMove={pointerMove} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel} style={{cursor:mode==='move'&&atPose?'move':mode==='view'?'grab':'default'}}>
      <path d={`M ${size.width/2+pan[0]} 0 V ${size.height} M 0 ${size.height/2+pan[1]} H ${size.width}`} stroke="#d9e0e3" strokeDasharray="4 5" pointerEvents="none"/>
      <g transform={transform}><g id={artworkId} data-testid="recording-artwork" data-quality={interactive?'interactive':'full'}><Artwork result={result} interactive={interactive} pixelsPerUnit={Math.max(250,unit)}/></g>{ghosts&&result.frozen.map(c=><g key={c.id}><path data-testid="pose-frozen" data-id={c.id} d={curvePath(shapeOf(result.drawing,c.id),logicalScreen)} fill="none" stroke={focusElement===c.id?'#ffad33':'#e5414e'} strokeWidth={Math.max(1.5,c.width*250)} opacity=".85" pointerEvents="none"/><path data-testid="pose-frozen-hit" data-id={c.id} d={curvePath(shapeOf(result.drawing,c.id),logicalScreen)} fill="none" stroke="transparent" strokeWidth={12*250/unit} style={{cursor:'pointer'}} onPointerDown={e=>{if(e.button!==0||e.shiftKey)return;e.stopPropagation();e.preventDefault();setFocusElement(c.id);setError('');}}/></g>)}{ghosts&&result.frozenPaints.map(o=><path key={o.id} data-testid="pose-frozen-paint" data-id={o.id} d={o.shapes.map(s=>curvePath(s,logicalScreen)).join(" ")} fill="none" stroke="#e5414e" strokeWidth="1.5" opacity=".65" pointerEvents="none"/>)}
      {focusElement&&r.inferences?.some(i=>i.curve.id===focusElement&&samePoseView(r.poses.find(p=>p.id===i.targetPoseId)!,view))&&result.drawing.curves.some(c=>c.id===focusElement)&&<path data-testid="pose-inference-guide" d={curvePath(shapeOf(result.drawing,focusElement),logicalScreen)} fill="none" stroke="#239ca9" strokeWidth={1.5*250/unit} strokeDasharray={`${4*250/unit} ${3*250/unit}`} pointerEvents="none"/>}</g>
     </svg>
     <div className="recording-hud pose-hud">{t(mode==='view'?'拖动旋转头壳与视角；右键平移画布，滚轮缩放。':atPose?'拖动画面整体平移；右键平移画布，滚轮缩放。':'当前为插值预览；选择录制姿态后可整体平移。')}<br/>{!!frozenObjects.length&&<span>{t('红色为缺少视角支撑的冻结参考，最终预览不显示。')}</span>}</div>
     {!r.poses.length&&<div className="pose-empty">{t('先定位头壳角度，再录入绘制快照。')}</div>}
    </section>
    <section className="recording-final pose-final"><div className="pose-panel-title">{t('最终录制预览')}<span>{t('仅显示有效覆盖内容')}</span></div><svg width="100%" height="100%" viewBox={`0 0 ${size.width} ${size.height}`} data-testid="recording-final"><g transform={transform}><use href={`#${artworkId}`} data-testid="recording-artwork-copy"/></g></svg></section>
   </div>
   <div className="recording-navigation pose-navigation">
    <div className="pose-angle-bars"><NumericSlider label="Recording Yaw" value={view.yaw} min={-180} max={180} step={.25} formatValue={degrees} onChange={yaw=>previewView({...view,yaw})} onEditEnd={viewQueue.flush}/><NumericSlider label="Recording Pitch" value={view.pitch} min={-89} max={89} step={.25} formatValue={degrees} onChange={pitch=>previewView({...view,pitch})} onEditEnd={viewQueue.flush}/></div>
    <svg className="recording-map pose-map" data-testid="recording-map" viewBox="-194 -103 388 211" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);mapNavigate(e);}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))mapNavigate(e);}} onPointerUp={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;mapNavigate(e);viewQueue.flush();e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={viewQueue.flush}>
     <rect x="-180" y="-89" width="360" height="178" fill="#17232b" stroke="#657d88"/>
     <path d="M -180 0 H 180 M 0 -89 V 89 M -90 -89 V 89 M 90 -89 V 89" stroke="#3b4d58"/>
     {g&&<g pointerEvents="none"><polygon points={g.hull.map(i=>`${g.points[i][0]},${-g.points[i][1]}`).join(' ')} fill="#97c67d25" stroke="#88b76b"/>{g.triangles.map((tri,i)=><polygon key={i} points={tri.map(i=>`${g.points[i][0]},${-g.points[i][1]}`).join(' ')} fill="none" stroke="#789468" strokeWidth=".7"/>)}</g>}
     {r.poses.map(p=><circle key={p.id} data-testid="recording-key-marker" cx={p.yaw} cy={-p.pitch} r="4" fill={p.id===selected?'#c5ed99':'#8fbd7d'} stroke="#fff" strokeWidth=".7" onPointerDown={e=>{e.stopPropagation();choose(p);}}><title>{p.name} · {degrees(p.yaw)} / {degrees(p.pitch)}</title></circle>)}
     <circle cx={view.yaw} cy={-view.pitch} r="5.5" fill="none" stroke="#ffc467" strokeWidth="1.5" pointerEvents="none"/>
     <g fontSize="9" fill="#aabcc4" pointerEvents="none"><text x="-180" y="102">−180°</text><text x="-4" y="102">0°</text><text x="155" y="102">180°</text><text x="-180" y="-94">Pitch +89°</text><text x="133" y="-94">Yaw →</text></g>
    </svg>
    <div className="pose-map-caption"><strong>{t(focusElement?'元素视角覆盖':'视角地图')}</strong>{focusElement&&<button onClick={()=>setFocusElement(undefined)}>{t('显示全部姿态')}</button>}<small>{t('点击或拖动导航；点击绿点选择姿态。')}</small><small>{t('左右视角分别录制，不自动镜像。')}</small></div>
   </div>
  </div>
 </main>;
 function mapNavigate(e:React.PointerEvent<SVGSVGElement>){const s=e.currentTarget,p=s.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(s.getScreenCTM()!.inverse());previewView({yaw:Math.max(-180,Math.min(180,q.x)),pitch:Math.max(-89,Math.min(89,-q.y))});}
}
