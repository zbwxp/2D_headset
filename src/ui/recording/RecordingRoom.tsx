import {curveVisible,pointVisible,visibleAtView} from '../../domain/recording/visibility';
import {recordingSnapTargets,recordingPointSnapTargets,snapRecordingEndpoint,type SnapTarget,type EndpointSnap} from '../../domain/recording/snapping';
import {createRecordedPoint,createSemanticCurve,displayPoint,editRecordedPoint,evaluatePoint,pointCoverage} from '../../domain/recording/points';
import PointPanel from './PointPanel';
import SortableList from './SortableList';
import FrameVisibility from './FrameVisibility';
import DrawingRegions from './DrawingRegions';
import {addDrawingRegion,cubicSpan,curveDrawingPieces,drawingIntervals,finalDrawingStrokes,pieceIntervals,pointOnDrawingCurve} from '../../domain/recording/drawingRegions';
import {useRecordedPointArrowKeys} from './useRecordedPointArrowKeys';
import KeyList from './KeyList';
import {smoothGeometry,smoothCoverage,smoothStyle,editSmoothStyle,handleTension,smoothEditable} from '../../domain/recording/smooth';
import JunctionInspector from './JunctionInspector';
import {bindEndpoints,canEditEndpoint,deleteRecordedCurve,evaluateRecording} from '../../domain/recording/junctions';
import {useEffect,useMemo,useRef,useState} from 'react';
import {useEditor} from '../../app/store';
import {VIEW_EPS,canonical,displayShape,emptyRecording,sameView,type Recording,type Cubic,type Point2,type View} from '../../domain/recording/model';
import {coverage} from '../../domain/recording/evaluation';
import {createRecorded,duplicate,editShape,editEndpoint,mergeEndpoint,mirrorEdit,updateCurve,reorderRecordedCurve} from '../../domain/recording/commands';
import {defaultHeadFrame} from '../../domain/head/frame';
import {recordingBasis} from '../../domain/recording/projection';
import {useRecording,type RecordingTool} from './session';
import Reference from './Reference';
import Background from './Background';
import NumericSlider from '../shared/NumericSlider';
import {uiText as t,useLanguage} from '../i18n';
import './recording.css';
const EMPTY=emptyRecording();
const path=(s:Point2[])=>`M ${s[0]} C ${s[1]} ${s[2]} ${s[3]}`;
const GUIDE_DASH='7 5';
function commit(next:Recording){const e=useEditor.getState();if(next===e.project.recording)return;e.beginEdit();e.setRecording(next);e.endEdit();}
export default function RecordingRoom(){
 useLanguage(s=>s.language);
 const project=useEditor(s=>s.project),stored=project.recording??EMPTY,session=useRecording();
 const {view,selected,tool,first,zoom,pan}=session;
 const [backgroundMoving,setBackgroundMoving]=useState(false);
 const [junctionId,setJunctionId]=useState<string|null>(null);
 const [draft,setDraft]=useState<Recording|null>(null),[hint,setHint]=useState('');
 const [snap,setSnap]=useState<EndpointSnap|null>(null);
 const [regionHover,setRegionHover]=useState<{t:number;point:Point2}|null>(null);
 const r=draft??stored,curve=r.curves.find(c=>c.id===selected),selectedPoint=r.points?.find(p=>p.id===selected);
 const editHost=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:600,height:600});
 const drag=useRef<{id:string;index:number;base:Recording;shape:Cubic;start:Point2;pointer:number;next:Recording|null;point?:boolean;targets?:SnapTarget[];smooth?:{handle:0|1;tangent:Point2;baseLength:number;tension:number}}|null>(null);
 const cameraDrag=useRef<{start:Point2;view:View;pan:Point2;panMode:boolean}|null>(null);
 useRecordedPointArrowKeys(()=>backgroundMoving||!!drag.current||!!cameraDrag.current);
 const svg=useRef<SVGSVGElement>(null);
 const frame=project.headFrame??defaultHeadFrame(),basis=recordingBasis(frame,view);
 const scale=Math.min(size.width/(2.8*basis.halfWidth),size.height/(2.8*basis.halfHeight))*zoom;
 const sx=scale*basis.halfWidth,sy=scale*basis.halfHeight;
 const screen=(p:Point2):Point2=>[size.width/2+pan[0]+p[0]*sx,size.height/2+pan[1]-p[1]*sy];
 const local=(e:{clientX:number;clientY:number}):Point2=>{const box=svg.current!.getBoundingClientRect();return [(e.clientX-box.left-size.width/2-pan[0])/sx,-(e.clientY-box.top-size.height/2-pan[1])/sy];};
 const derived=useMemo(()=>evaluateRecording(r,view),[r,view]);
 const evaluated=curve?derived.get(curve.id):null;
 const pointItems=useMemo(()=>(r.points??[]).filter(p=>pointVisible(p,view)).map(p=>({p,e:evaluatePoint(p,view)})),[r.points,view]);
 const smooth=useMemo(()=>smoothGeometry(r,view,derived),[r,view,derived]);
 const guideIds=useMemo(()=>new Set(r.curves.filter(c=>c.auxiliary).map(c=>c.id)),[r.curves]);
 const transitionDash=(tr:{trims:{id:string}[]})=>tr.trims.every(p=>guideIds.has(p.id))?GUIDE_DASH:undefined;
 const junction=r.junctions?.find(j=>j.id===junctionId);
 const items=useMemo(()=>r.curves.filter(c=>curveVisible(c,view)).map(c=>({c,e:derived.get(c.id)!})),[r,derived,view]);
 const finalStrokes=useMemo(()=>finalDrawingStrokes(items.filter(x=>x.e.status!=='frozen').map(x=>x.c),smooth),[items,smooth]);
 const regionPieces=useMemo(()=>curve?curveDrawingPieces(curve.id,smooth):[],[curve,smooth]);
 const regionTargets=useMemo(()=>regionPieces.map((p,i)=>({id:String(i),name:curve!.name,auxiliary:false,shape:displayShape(cubicSpan(p.shape,p.render),view)})),[regionPieces,curve,view]);
 const regionHit=(event:{clientX:number;clientY:number})=>{
  if(!curve||curve.locked||!curveVisible(curve,view))return null;
  const hit=snapRecordingEndpoint(local(event),regionTargets,[sx,sy]);if(!hit)return null;
  const [a,b]=regionPieces[+hit.target.id].source;return {t:Math.max(0,Math.min(1,a+(b-a)*hit.t)),point:hit.point};
 };
 const cancel=()=>{drag.current=null;cameraDrag.current=null;setDraft(null);setSnap(null);};
 useEffect(()=>{const el=editHost.current!;const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(el);return()=>observer.disconnect();},[]);
 useEffect(()=>{drag.current=null;setDraft(null);setSnap(null);},[view]);
 useEffect(()=>{cancel();},[tool,stored]);
 useEffect(()=>{setRegionHover(null);},[tool,view,selected,stored]);
 useEffect(()=>{setBackgroundMoving(false);},[selected]);
 useEffect(()=>{useRecording.getState().set({first:null});},[stored]);
 useEffect(()=>{const blur=()=>cancel(),visibility=()=>{if(document.hidden)cancel();};window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility);return()=>{window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);};},[]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{const el=e.target as HTMLElement;if(el.closest('input,textarea,[contenteditable="true"]'))return;
 if(e.key==='Escape'){cancel();const s=useRecording.getState();s.set(s.first?{first:null}:{tool:'edit',first:null});}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&drag.current){e.preventDefault();e.stopImmediatePropagation();cancel();}
 };window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[]);
 function selectTool(next:RecordingTool){setBackgroundMoving(false);cancel();session.set({tool:next,first:null});setHint('');}
 function createCurve(auxiliary=false){
  cancel();setBackgroundMoving(false);setHint('');
  const id=crypto.randomUUID();
  commit(createRecorded(r,view,id,t(auxiliary?'录制辅助线':'录制曲线')+' '+(r.curves.length+1),undefined,auxiliary));
  setJunctionId(null);session.set({selected:id,tool:'edit',first:null});
 }
 function actMirror(id:string){
  const point=r.points?.find(p=>p.id===id),item=point??r.curves.find(c=>c.id===id);if(!item)return;
  if(!first){
   const status=point?evaluatePoint(point,view).status:derived.get(id)?.status;
   if(status==='frozen'){setHint(t('冻结形状不能作为精确基准'));return;}
   session.set({first:{id}});setHint('');return;
  }
  if(!!point!==!!r.points?.some(p=>p.id===first.id)){setHint(t('镜像源和目标需同为语义点或同为曲线'));return;}
  if(item.locked||id===first.id){setHint(t(point?'请选择另一个未锁定语义点':'请选择另一条未锁定曲线'));return;}
  commit(mirrorEdit(r,first.id,id,view));setJunctionId(null);session.set({tool:'edit',first:null,selected:id});setHint('');
 }
 function actCurve(id:string){setJunctionId(null);
 if(tool==='point'||tool==='semantic')return;
 if(tool==='region'){selectTool('edit');session.set({selected:id});return;}
 if(tool==='mirror')actMirror(id);else session.set({selected:id});
 }
 function actEnd(id:string,end:0|3){const c=r.curves.find(c=>c.id===id)!;
 if(!first){if(derived.get(c.id)?.status==='frozen'){setHint(t('冻结形状不能作为精确基准'));return;}session.set({first:{id,end}});}
 else {if(c.locked||id===first.id){setHint(t('请选择另一条未锁定曲线'));return;}const next=tool==='bind'?bindEndpoints(r,{id:first.id,end:first.end!},{id,end},view,crypto.randomUUID()):mergeEndpoint(r,{id:first.id,end:first.end!},{id,end},view);if(next===r){setHint(t('无法操作：端点已绑定、视角未覆盖或关系形成循环'));return;}commit(next);session.set({tool:'edit',first:null,selected:id});setHint('');}
 }
 function actPoint(id:string){
  if(tool==='region'){selectTool('edit');setJunctionId(null);session.set({selected:id});return;}
  if(tool==='point')return;
  if(tool==='mirror'){actMirror(id);return;}
  if(tool==='semantic'){
   const point=r.points?.find(p=>p.id===id);if(!point||evaluatePoint(point,view).status==='frozen'){setHint(t('请先在当前视角录制此语义点的位置'));return;}
   if(!first){session.set({first:{id}});setHint('');return;}
   if(first.id===id){setHint(t('请选择另一个语义点'));return;}
   const curveId=crypto.randomUUID(),next=createSemanticCurve(r,view,curveId,t('语义曲线')+' '+(r.curves.length+1),first.id,id);
   if(next===r)return;
   commit(next);setJunctionId(null);session.set({selected:curveId,tool:'edit',first:null});setHint('');return;
  }
  if(tool==='edit'||tool==='view'){setJunctionId(null);session.set({selected:id});}
 }
 function startPoint(event:React.PointerEvent,id:string){
  const point=r.points?.find(p=>p.id===id);if(tool!=='edit'||!point||point.locked||event.button!==0)return;
  event.stopPropagation();event.preventDefault();setJunctionId(null);setSnap(null);session.set({selected:id});
  svg.current!.focus({preventScroll:true});
  const position=displayPoint(evaluatePoint(point,view).position,view);
  svg.current!.setPointerCapture(event.pointerId);
  drag.current={id,index:0,base:r,shape:Array.from({length:4},()=>[...position]) as Cubic,start:local(event),pointer:event.pointerId,next:null,point:true,targets:recordingPointSnapTargets(r,view,id)};
 }
 function startHandle(e:React.PointerEvent,id:string,index:number){
  if(tool!=='edit'||r.curves.find(c=>c.id===id)?.locked||((index===0||index===3)&&!canEditEndpoint(r,{id,end:index},derived))||e.button!==0)return;
  e.stopPropagation();e.preventDefault();setSnap(null);svg.current!.setPointerCapture(e.pointerId);
  drag.current={id,index,base:r,shape:structuredClone(displayShape(derived.get(id)!.shape,view)),start:local(e),pointer:e.pointerId,next:null,
   targets:index===0||index===3?recordingSnapTargets(r,view,{id,end:index}):undefined};
 }
 const status=tool==='region'?(first?'在选中曲线上点击区域终点':'在选中曲线上点击区域起点'):tool==='point'?'点击画布放置录制语义点':tool==='semantic'?(first?'请选择第二个语义点':'请选择第一个语义点'):tool==='mirror'?(first?(r.points?.some(p=>p.id===first.id)?'请选择目标语义点':'请选择目标曲线'):'请选择镜像源点或曲线'):tool==='bind'?(first?'请选择跟随端点':'请选择主端点'):tool==='merge'?(first?'请选择要移动的端点':'请选择固定端点'):tool==='view'?'拖动旋转 · 右键平移 · 滚轮缩放':'拖动端点自动吸附曲线 · Alt 暂停吸附 · 首次修改自动建 Key';
 const g=junction?.mode==='SMOOTH'?smoothCoverage(junction):junction?null:curve?coverage(curve):selectedPoint?pointCoverage(selectedPoint):null;
 function selectJunction(id:string){cancel();setJunctionId(id);session.set({selected:null,tool:'edit',first:null});}
 function startSmooth(event:React.PointerEvent,id:string,handle:0|1){const j=r.junctions?.find(j=>j.id===id),tr=smooth.transitions.find(x=>x.id===id);if(event.button!==0||!j||j.mode!=='SMOOTH'||!tr||!smoothEditable(r,j))return;event.stopPropagation();event.preventDefault();svg.current!.setPointerCapture(event.pointerId);const direction=handle===0?tr.ta:tr.tb.map(x=>-x) as Point2;const tangent=displayShape([direction,direction,direction,direction],view)[0];drag.current={id,index:handle+1,base:r,shape:tr.shape,start:local(event),pointer:event.pointerId,next:null,smooth:{handle,tangent,baseLength:tr.baseLength,tension:handle===0?smoothStyle(j,view).tensionA:smoothStyle(j,view).tensionB}};}
 return <main className="recording-room" data-testid="recording-room">
 <aside className="recording-sidebar">
 <div className="recording-create"><button className={tool==='point'?'active':''} onClick={()=>selectTool('point')}>{t('新建录制语义点')}</button><button className={tool==='semantic'?'active':''} disabled={(r.points?.length??0)<2} onClick={()=>selectTool('semantic')}>{t('新建语义曲线')}</button></div>
 <PointPanel recording={r} selected={selected} view={view} onSelect={actPoint} navigate={session.navigate} commit={commit}/>
 <h3>{t('录制曲线')}</h3>
 <div className="recording-create"><button onClick={()=>createCurve()}>{t('新建录制曲线')}</button><button onClick={()=>createCurve(true)}>{t('新建录制辅助线')}</button></div>
 <SortableList items={r.curves} selected={selected} kind="curve" onReorder={(id,target,after)=>commit(reorderRecordedCurve(r,id,target,after))}>{c=><>
 <button className="recording-name" data-recording-list-select onClick={()=>actCurve(c.id)}>{c.name}{c.semantic&&<span className="recording-point-badge">{t('语义曲线')}</span>}{c.auxiliary&&<span className="recording-guide-badge" data-testid="recording-guide-badge">{t('辅助线')}</span>}{!visibleAtView(c,view)&&<span className="recording-hidden-badge" data-testid="recording-frame-hidden">{t('当前帧已隐藏')}</span>}</button>
 <label title={t('显示')}><input type="checkbox" aria-label={t('显示')+' '+c.name} checked={c.visible} onChange={e=>commit(updateCurve(r,c.id,c=>({...c,visible:e.target.checked})))}/></label>
 <button aria-label={t('锁定')+' '+c.name} title={t(c.locked?'解锁':'锁定')} onClick={()=>commit(updateCurve(r,c.id,c=>({...c,locked:!c.locked})))}>{c.locked?'🔒':'🔓'}</button>
 </>}</SortableList>
 {(r.junctions??[]).map(j=><button key={j.id} data-testid="recording-junction-row" onClick={()=>selectJunction(j.id)}>{t('连接点')} · {r.curves.find(c=>c.id===j.masterCurveId)?.name} ↔ {r.curves.find(c=>c.id===j.followerCurveId)?.name}</button>)}
 {junction&&<JunctionInspector key={junction.id} recording={r} junction={junction} view={view} selectView={session.navigate} warning={smooth.warnings.get(junction.id)}/>}
 {curve&&<section className="recording-inspector" key={curve.id}>
 <input key={curve.name} aria-label={t('录制曲线名称')} defaultValue={curve.name} disabled={curve.locked} onBlur={e=>{const name=e.target.value.trim();if(name&&name!==curve.name)commit(updateCurve(r,curve.id,c=>({...c,name})));}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>
 <small className="recording-id">{curve.id}</small>
 {curve.auxiliary&&<span className="recording-guide-badge">{t('辅助线')}</span>}
 {curve.semantic&&<p className="recording-semantic-anchors">{t('端点跟随语义点')}：{[curve.semantic.startPointId,curve.semantic.endPointId].map(id=><button key={id} onClick={()=>{selectTool('edit');session.set({selected:id});}}>{r.points?.find(p=>p.id===id)?.name}</button>)}<small>{t('拖动端点会修改共享语义点；控制柄单独录制。')}</small></p>}
 <p data-testid="recording-status">{t(evaluated?.status==='key'?'当前正式 Key':evaluated?.status==='interpolation'?'有效插值':'未覆盖 · 冻结参考')}</p>
 <p>{t('整体视角镜像')}</p>
 <button onClick={()=>{const id=crypto.randomUUID();commit(duplicate(r,curve.id,view,id,[8/sx,-8/sy]));session.set({selected:id,tool:'edit',first:null});}}>{t('复制当前帧')}</button>
 <FrameVisibility element={curve} recording={r} view={view} commit={commit}/>
 <DrawingRegions recording={r} curve={curve} adding={tool==='region'} onAdd={()=>selectTool(tool==='region'?'edit':'region')} commit={commit}/>
 <details><summary>{t('永久删除')}</summary><button disabled={curve.locked} onClick={()=>{commit(deleteRecordedCurve(r,curve.id));session.set({selected:null,first:null});}}>{t('删除整条曲线及所有关键帧')}</button></details>
 {(r.junctions??[]).filter(j=>j.followerCurveId===curve.id).map(j=><p key={j.id}>{j.followerEndpoint} · {t('已绑定到')} {r.curves.find(c=>c.id===j.masterCurveId)?.name} · {j.masterEndpoint} · {t('拖动任一侧共同编辑，两侧同时建 Key')}</p>)}
 <h4>{t('视角 Keys')}</h4>
 <KeyList key={curve.id} keys={curve.keys} disabled={curve.locked} navigate={session.navigate} onDelete={views=>commit(updateCurve(r,curve.id,c=>({...c,keys:c.keys.filter(k=>!views.some(v=>sameView(v,k)))})))}/>
 </section>}
 </aside>
 <div className="recording-work">
 <nav className="recording-toolbar">{(['view','edit','mirror','merge','bind'] as const).map((value,i)=><button key={value} className={tool===value?'active':''} onClick={()=>selectTool(value)}>{t(['视角导航','编辑曲线','镜像编辑','端点合并','绑定端点'][i])}</button>)}<button onClick={()=>session.set({zoom:1,pan:[0,0]})}>{t('居中')}</button><span>{t('正交投影')} · Yaw {+view.yaw.toFixed(2)}° · Pitch {+view.pitch.toFixed(2)}°</span></nav>
 <div className="recording-panels">
 <section className="recording-edit" ref={editHost}>
 <Background width={size.width} height={size.height} zoom={zoom} pan={pan} moving={backgroundMoving} setMoving={value=>{cancel();if(value)session.set({tool:"edit",first:null});setBackgroundMoving(value);}}/>
 <Reference project={project} view={view} width={size.width} height={size.height} zoom={zoom} pan={pan}/>
 <svg ref={svg} className="recording-overlay" width="100%" height="100%" tabIndex={0} aria-label={t('录制编辑画布')} data-testid="recording-canvas" onContextMenu={e=>e.preventDefault()}
 onClick={event=>{
 if(tool==='region'){
  const hit=regionHit(event);if(!hit||!curve){setHint(t('请点击选中的曲线'));return;}
  if(first?.id!==curve.id||first.t===undefined){session.set({first:{id:curve.id,t:hit.t}});setHint('');return;}
  const next=addDrawingRegion(r,curve.id,crypto.randomUUID(),first.t,hit.t);
  if(next===r){setHint(t('起点和终点需要分开'));return;}
  commit(next);selectTool('edit');return;
 }
 if(tool==='point'){
  const id=crypto.randomUUID();commit(createRecordedPoint(r,view,id,t('语义点')+' '+((r.points?.length??0)+1),local(event)));
  setJunctionId(null);session.set({selected:id,tool:'edit',first:null});setHint('');return;
 }
 if(tool!=='merge'&&tool!=='bind')return;const box=svg.current!.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top;
 const hits=items.flatMap(({c,e})=>([0,3] as const).map(end=>{const p=screen(displayShape(e.shape,view)[end]);return {id:c.id,end,d:Math.hypot(p[0]-x,p[1]-y)};})).filter(h=>h.d<=13&&h.id!==first?.id).sort((a,b)=>a.d-b.d);
 if(hits[0])actEnd(hits[0].id,hits[0].end);}}
 onWheel={e=>{if(drag.current)return;session.set({zoom:Math.max(.2,Math.min(8,zoom*Math.exp(-e.deltaY*.001)))});}}
 onPointerDown={e=>{if(tool!=='view')return;e.preventDefault();svg.current!.setPointerCapture(e.pointerId);cameraDrag.current={start:[e.clientX,e.clientY],view,pan,panMode:e.button===2||e.shiftKey};}}
 onPointerLeave={()=>setRegionHover(null)}
 onPointerMove={e=>{if(tool==='region')setRegionHover(regionHit(e));const d=drag.current;if(d){
  const p=local(e),delta:Point2=[p[0]-d.start[0],p[1]-d.start[1]];
  if(!d.next&&Math.hypot(delta[0]*sx,delta[1]*sy)<.5)return;
  if(d.smooth){const h=d.smooth,value=handleTension([delta[0]*sx,delta[1]*sy],h.tangent,h.baseLength,h.tension,[sx,sy]);d.next=editSmoothStyle(d.base,d.id,view,h.handle===0?{tensionA:value}:{tensionB:value});setDraft(d.next);return;}
  const shape=structuredClone(d.shape);
  shape[d.index]=[shape[d.index][0]+delta[0],shape[d.index][1]+delta[1]];
  if(d.index===0||d.index===3){
   const hit=e.altKey?null:snapRecordingEndpoint(shape[d.index],d.targets??[],[sx,sy]);
   setSnap(hit);
   if(hit)shape[d.index]=hit.point;
   else if(!e.altKey&&canonical(view).yaw<=VIEW_EPS&&Math.abs(shape[d.index][0]*sx)<=6)shape[d.index][0]=0;
   d.next=d.point?editRecordedPoint(d.base,d.id,view,shape[d.index]):editEndpoint(d.base,d.id,d.index,view,shape[d.index]);
  }else d.next=editShape(d.base,d.id,view,()=>shape);
  setDraft(d.next);return;
 }
 const c=cameraDrag.current;if(c){const dx=e.clientX-c.start[0],dy=e.clientY-c.start[1];if(c.panMode)session.set({pan:[c.pan[0]+dx,c.pan[1]+dy]});else {const yaw=((c.view.yaw-dx*.3+180)%360+360)%360-180;session.navigate({yaw,pitch:c.view.pitch+dy*.3});}}}}
 onPointerUp={e=>{const d=drag.current;if(d?.next)commit(d.next);drag.current=null;cameraDrag.current=null;setDraft(null);setSnap(null);if(svg.current!.hasPointerCapture(e.pointerId))svg.current!.releasePointerCapture(e.pointerId);}}
 onPointerCancel={cancel} onLostPointerCapture={()=>{if(drag.current||cameraDrag.current)cancel();}}>
 {canonical(view).yaw<=VIEW_EPS&&<line data-testid="recording-centerline" x1={screen([0,0])[0]} x2={screen([0,0])[0]} y1={0} y2={size.height} stroke="#81a6b5" strokeDasharray="5 5" pointerEvents="none"/>}
 {items.map(({c,e})=>{const pts=displayShape(e.shape,view).map(screen),visiblePts=displayShape(smooth.sources.get(c.id)!,view).map(screen),active=c.id===selected,chosen=first?.id===c.id;return <g key={c.id} data-curve={c.id} data-status={e.status}>
 <path data-testid="recorded-stroke" d={path(visiblePts)} fill="none" stroke={e.status==='frozen'?'#ff7278':chosen?'#ffd07d':active?'#c8f4a1':'#f1f3f5'} strokeWidth={active||chosen?2.8:2} strokeDasharray={c.auxiliary?GUIDE_DASH:undefined} pointerEvents="none"/>
 <path data-testid="recorded-hit" d={path(visiblePts)} fill="none" stroke="transparent" strokeWidth={14} style={{cursor:'pointer'}} pointerEvents={tool==='view'||tool==='merge'||tool==='bind'||tool==='region'?'none':'stroke'} onClick={()=>actCurve(c.id)}/>

 {(tool==='merge'||tool==='bind')&&([0,3] as const).map(end=><g key={end}><circle cx={pts[end][0]} cy={pts[end][1]} r={first?.id===c.id&&first.end===end?8:5} fill={first?.id===c.id&&first.end===end?'#ffd07d':'#c8f4a1'} pointerEvents="none"/><circle data-testid={`merge-end-${end}`} cx={pts[end][0]} cy={pts[end][1]} r={13} fill="transparent" style={{cursor:'crosshair'}} pointerEvents="none"/></g>)}
 </g>;})}
 {smooth.transitions.map(tr=>{const pts=displayShape(tr.shape,view).map(screen);return <g key={tr.id}><path data-testid="smooth-transition" strokeDasharray={transitionDash(tr)} d={path(pts)} fill="none" stroke={junctionId===tr.id?'#ffd479':'#f1f3f5'} strokeWidth="2.5" pointerEvents="none"/><path d={path(pts)} fill="none" stroke="transparent" strokeWidth="14" pointerEvents={tool==='edit'?'stroke':'none'} onClick={()=>selectJunction(tr.id)}/>{junctionId===tr.id&&tool==='edit'&&<><path d={`M ${pts[0]} L ${pts[1]} M ${pts[3]} L ${pts[2]}`} stroke="#ffd479" fill="none" pointerEvents="none"/>{([0,1] as const).map(h=><circle key={h} data-testid={`smooth-handle-${h}`} cx={pts[h+1][0]} cy={pts[h+1][1]} r="6" fill="#ffd479" onPointerDown={e=>startSmooth(e,tr.id,h)}/>)}</>}</g>;})}
 {/* Selected controls stay above every curve hit path after snapping. */}
 {tool==='edit'&&items.filter(({c})=>c.id===selected).map(({c,e})=>{const pts=displayShape(e.shape,view).map(screen);return <g key={c.id}><path d={`M ${pts[0]} L ${pts[1]} M ${pts[3]} L ${pts[2]}`} stroke="#98b99a" fill="none" pointerEvents="none"/>{pts.map((p,i)=><circle key={i} data-testid={`recorded-control-${i}`} cx={p[0]} cy={p[1]} r={i===0||i===3?6:5} fill={i===0||i===3?'#c8f4a1':'#1b2830'} stroke="#c8f4a1" strokeWidth="2" style={{cursor:c.locked||((i===0||i===3)&&!canEditEndpoint(r,{id:c.id,end:i},derived))?'not-allowed':'grab'}} onPointerDown={event=>startHandle(event,c.id,i)}/>)}</g>;})}
 {pointItems.map(({p,e})=>{const xy=screen(displayPoint(e.position,view)),active=p.id===selected,chosen=(tool==='semantic'||tool==='mirror')&&first?.id===p.id;
 return <g key={p.id} data-testid="recording-point" data-point={p.id} data-status={e.status}>
  <circle cx={xy[0]} cy={xy[1]} r={active||chosen?7:5} fill={e.status==='frozen'?'#ff7278':chosen?'#ffd479':active?'#c8f4a1':'#83d9e5'} stroke="#16252c" strokeWidth="2" pointerEvents="none"/>
  {(active||chosen)&&<text x={xy[0]+11} y={xy[1]-10} fill="#d4f5f6" fontSize="12" pointerEvents="none">{p.name}</text>}
  <circle data-testid="recording-point-hit" cx={xy[0]} cy={xy[1]} r="10" fill="transparent" style={{cursor:tool==='semantic'||tool==='mirror'?'crosshair':p.locked?'pointer':'grab'}} pointerEvents={tool==='view'||tool==='merge'||tool==='bind'||tool==='region'?'none':'all'} onPointerDown={event=>startPoint(event,p.id)} onClick={event=>{if(tool==='point')return;event.stopPropagation();actPoint(p.id);}}><title>{p.name} · {t('点')}</title></circle>
 </g>;
 })}
 {curve&&curveVisible(curve,view)&&(curve.drawing?.enabled||tool==='region')&&<g data-testid="drawing-region-overlay" pointerEvents="none">
  {curve.drawing?.enabled&&regionPieces.flatMap((p,i)=>pieceIntervals(p,drawingIntervals(curve)).map(([a,b])=><path key={`${i}:${a}`} d={path(displayShape(cubicSpan(p.shape,[a,b]),view).map(screen))} fill="none" stroke="#68d9ea" strokeWidth="4" strokeOpacity=".7" strokeDasharray={curve.auxiliary?GUIDE_DASH:undefined}/>))}
  {curve.drawing?.enabled&&curve.drawing.regions.flatMap((region,i)=>([region.start,region.end]).map((value,end)=>{const p=pointOnDrawingCurve(regionPieces,value);if(!p)return null;const q=screen(displayPoint(p,view));return <g key={`${region.id}:${end}`}><circle cx={q[0]} cy={q[1]} r="4" fill="#68d9ea" stroke="#192328"/><text x={q[0]+7} y={q[1]-7} fill="#68d9ea" fontSize="11">{i+1}{end?'B':'A'}</text></g>;}))}
  {tool==='region'&&first?.t!==undefined&&first.id===curve.id&&(()=>{const p=pointOnDrawingCurve(regionPieces,first.t);if(!p)return null;const q=screen(displayPoint(p,view));return <circle data-testid="drawing-region-first" cx={q[0]} cy={q[1]} r="6" fill="#ffd479"/>;})()}
  {tool==='region'&&regionHover&&<circle cx={screen(regionHover.point)[0]} cy={screen(regionHover.point)[1]} r="8" fill="none" stroke="#ffd479" strokeWidth="2"/>}
  {tool==='region'&&regionHover&&first?.t!==undefined&&regionPieces.flatMap((p,i)=>pieceIntervals(p,[[Math.min(first.t!,regionHover.t),Math.max(first.t!,regionHover.t)]]).map(([a,b])=><path key={`${i}:${a}`} d={path(displayShape(cubicSpan(p.shape,[a,b]),view).map(screen))} fill="none" stroke="#ffd479" strokeWidth="4"/>))}
 </g>}
 {snap&&<g data-testid="recording-snap" data-target={snap.target.id} pointerEvents="none">
  <path d={path(snap.target.shape.map(screen))} fill="none" stroke="#ffd479" strokeWidth="4" strokeOpacity=".65" strokeDasharray={snap.target.auxiliary?GUIDE_DASH:undefined}/>
  <circle cx={screen(snap.point)[0]} cy={screen(snap.point)[1]} r="9" fill="none" stroke="#ffd479" strokeWidth="2"/>
  <circle cx={screen(snap.point)[0]} cy={screen(snap.point)[1]} r="2" fill="#ffd479"/>
 </g>}
 </svg>
 <div className="recording-hud">{t(backgroundMoving?"拖动平移背景 · 图片缩放在背景设置中调整":status)}{first&&<span> · {r.curves.find(c=>c.id===first.id)?.name??r.points?.find(p=>p.id===first.id)?.name}</span>}{snap&&<p>{t(snap.endpoint?'已吸附端点':'已吸附曲线')} · {snap.target.name}</p>}{hint&&<p role="status">{hint}</p>}</div>
 </section>
 <section className="recording-final"><span>{t('最终录制预览')}</span><svg width="100%" height="100%" viewBox={`0 0 ${size.width} ${size.height}`} data-testid="recording-final">{finalStrokes.map(stroke=><path key={`${stroke.kind}:${stroke.id}:${stroke.interval[0]}`} data-curve={stroke.kind==='source'?stroke.id:undefined} data-testid={stroke.kind==='transition'?'smooth-final':'recorded-final-stroke'} strokeDasharray={stroke.kind==='source'?(guideIds.has(stroke.id)?GUIDE_DASH:undefined):transitionDash(smooth.transitions.find(tr=>tr.id===stroke.id)!)} d={path(displayShape(stroke.shape,view).map(screen))} stroke="#000" strokeWidth="2" fill="none"/>)}</svg></section>
 </div>
 <div className="recording-navigation">
 <div><NumericSlider label="Recording Yaw" value={view.yaw} min={-180} max={180} step={.25} formatValue={v=>`${+v.toFixed(2)}°`} onChange={yaw=>session.navigate({...view,yaw})}/><NumericSlider label="Recording Pitch" value={view.pitch} min={-89} max={89} step={.25} formatValue={v=>`${+v.toFixed(2)}°`} onChange={pitch=>session.navigate({...view,pitch})}/></div>
 <svg className="recording-map" data-testid="recording-map" viewBox="-8 -97 196 194" onClick={e=>{const svg=e.currentTarget,p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(svg.getScreenCTM()!.inverse());session.navigate({yaw:Math.max(0,Math.min(180,q.x)),pitch:Math.max(-89,Math.min(89,-q.y))});}}>
 <rect x="0" y="-89" width="180" height="178" fill="#18232c" stroke="#71828a"/>
 <path d="M 0 0 H 180 M 90 -89 V 89" stroke="#394b55"/>
 <g fill="#b5c4cb" fontSize="5" pointerEvents="none"><text x="0" y="96">0°</text><text x="87" y="96">90°</text><text x="167" y="96">180°</text><text x="0" y="-92">Pitch +89°</text><text x="132" y="-92">Yaw →</text></g>
 {g&&<><polygon points={g.hull.map(i=>`${g.points[i][0]},${-g.points[i][1]}`).join(' ')} fill="#97c67d30" stroke="#88b76b"/>{g.triangles.map((tri,i)=><polygon key={i} points={tri.map(i=>`${g.points[i][0]},${-g.points[i][1]}`).join(' ')} fill="none" stroke="#789468" strokeWidth=".5"/>)}{g.points.map((p,i)=><circle data-testid="recording-key-marker" key={i} cx={p[0]} cy={-p[1]} r={3} fill="#bce293" onClick={e=>{e.stopPropagation();session.navigate({yaw:p[0],pitch:p[1]});}}/>)}</>}
 <circle cx={canonical(view).yaw} cy={-view.pitch} r={3} fill="#ffd479" stroke="#fff" strokeWidth=".7" pointerEvents="none"/>
 </svg><p>{t('视角地图 · 点击导航，不创建 Key')}<br/>{t('红线仅为未覆盖视角的编辑参考')}</p>
 </div>
 </div></main>;
}
