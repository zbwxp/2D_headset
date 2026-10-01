import RefinementOverlay from './RefinementOverlay';
import {deleteCurveRefinement} from '../../domain/assembly/refinement';
import {useEffect,useRef,useState,useCallback,useMemo} from 'react';
import {Lock,Unlock} from 'lucide-react';
import {useEditor} from '../../app/store';
import DrawingRoom,{type DrawingUnderlay} from '../assemblyDrawing/DrawingRoom';
import {useDrawing as useAssembly,selectedLayers,useAssemblyViewOption} from '../assemblyDrawing/session';
import {rigPointInDrawing} from '../assemblyDrawing/view';
import {createAssembly,assemblyDrawing,frameOf,bindLayers,unbindLayer,locatorProjection,layerTransform,worldPoint,projectWorld,type AssemblyDocument,type Vec3} from '../../domain/assembly/model';
import {locatorYawOrbits,type LocatorYawOrbit} from '../../domain/assembly/trajectories';
import ViewSlots from './ViewSlots';
import {PoseToolbar,PoseDetails} from './PosePanel';
import {ensureTimeline,setTimelineStage,setBaseEditing} from '../../domain/assembly/timeline';
import ProjectedIntervals from './ProjectedIntervals';
import {resolvedPerspectives,writeLayerPerspective} from '../../domain/assembly/deformRecording';
import YawTrajectories,{type TrajectoryScope} from './YawTrajectories';
import {resolvePlacement,setPlacementPoint,setPlacementPlane,setPlacementOffset} from '../../domain/assembly/placement';
import CardPreview from './CardPreview';
import BendCage from './BendCage';
import {bendEvaluation,writeBend,neutralBend,type BendValue} from '../../domain/assembly/bending';
import PerspectiveCage from './PerspectiveCage';
import {createPerspective,neutralQuad,requirePerspectiveLayer,type LayerPerspective} from '../../domain/assembly/perspective';
import type {Quad} from '../../domain/drawing/deform';
import {snapshotDrawing} from '../../domain/drawing/snapshots';
import type {DrawingDocument,Point2} from '../../domain/drawing/model';
import NumericSlider from '../shared/NumericSlider';
import {uiText as t} from '../i18n';
import './assembly.css';
export function commitAssembly(next:AssemblyDocument){const e=useEditor.getState();if(next===e.project.assembly)return;e.beginEdit();try{e.setAssembly(next);}finally{e.endEdit();}}
// Fixed oblique inspection camera, independent of the rig's rotation convention.
function inspectionPoint([x,y,z]:Vec3):Point2 {
 const pitch=24*Math.PI/180,yaw=-30*Math.PI/180;
 return [x*Math.cos(yaw)+(y*Math.sin(pitch)+z*Math.cos(pitch))*Math.sin(yaw),y*Math.cos(pitch)-z*Math.sin(pitch)];
}
function RigLines({a,screen,inspection=false,selected,onSelect,pointsOnly=false,points=true,orbits=[],trajectoryMode='all',trajectoryScope='recorded'}:{orbits?:LocatorYawOrbit[];trajectoryMode?:'all'|'selected'|'off';trajectoryScope?:TrajectoryScope;pointsOnly?:boolean;points?:boolean;a:AssemblyDocument;screen:(p:Point2)=>Point2;inspection?:boolean;selected?:string;onSelect?:(id:string)=>void}){
 const frame=resolvePlacement(a);
 const projectPosition=(world:Vec3)=>screen(inspection?inspectionPoint(world):projectWorld(world,a.pose).point);
 const project=(v:Vec3)=>projectPosition(worldPoint(v,a.pose));
 const line=(p:Vec3,q:Vec3)=>{const x=project(p),y=project(q);return `M${x}L${y}`;};
 return <g data-testid="assembly-rig-lines" style={{pointerEvents:inspection?'auto':'none'}}>
  {!pointsOnly&&<g>{frame.planes.map(p=>{const corners:Vec3[]=[[-1.1,p.height,-1.1],[1.1,p.height,-1.1],[1.1,p.height,1.1],[-1.1,p.height,1.1]];return <g key={p.id}><path d={corners.map((q,i)=>(i?'L':'M')+project(q)).join('')+'Z'} fill="#5da7b6" fillOpacity=".065" stroke="#69a6b5" strokeOpacity=".4"/><path d={line([-1.1,p.height,0],[1.1,p.height,0])+line([0,p.height,-1.1],[0,p.height,1.1])} stroke="#85b6bc" strokeOpacity=".35"/></g>;})}
  <path data-testid="assembly-main-axis" d={line([0,-1.4,0],[0,1.5,0])} stroke="#be9be4" strokeWidth="2"/>
  <path d={line([0,1.5,0],[0,1.5,.6])+line([0,1.5,.6],[-.12,1.5,.4])+line([0,1.5,.6],[.12,1.5,.4])} stroke="#e3b865" strokeWidth="2" fill="none"/>
  <text x={project([0,1.5,.6])[0]+7} y={project([0,1.5,.6])[1]} fill="#e3b865" fontSize="11">{t('正面')}</text></g>}
  <YawTrajectories orbits={orbits} mode={trajectoryMode} scope={trajectoryScope} selected={selected} project={projectPosition} inspection={inspection}/>
  {points&&frame.locators.map(l=>{const p=frame.planes.find(p=>p.id===l.planeId);if(!p)return null;const q=project([l.x,p.height,l.z]);return <g key={l.id} data-testid="assembly-locator" data-id={l.id} data-selected={selected===l.id} aria-label={l.name} onPointerDown={e=>{if(inspection){e.stopPropagation();onSelect?.(l.id);}}} style={{cursor:inspection?'pointer':undefined}}><circle cx={q[0]} cy={q[1]} r={selected===l.id?5:3.5} fill={selected===l.id?'#ffd086':'#66c6d7'}/>{selected===l.id&&<text data-testid="assembly-locator-label" x={q[0]+7} y={q[1]-6} pointerEvents="none" fill={inspection?'#c5e5e5':'#227b97'} fontSize="11">{l.name}</text>}</g>;})}
 </g>;
}
export default function AssemblyRoom(){
 const storedAssembly=useEditor(s=>s.project.assembly)!,a=useMemo(()=>ensureTimeline(storedAssembly),[storedAssembly]),library=useEditor(s=>s.project.drawingSnapshots),source=useEditor(s=>s.project.drawing),projectId=useEditor(s=>s.project.meta.createdAt);
 useEffect(()=>{if(!storedAssembly.timeline)useEditor.getState().setAssembly(a);},[storedAssembly,a]);
 const evaluated=resolvePlacement(a);
 const session=useAssembly(),layer=a.drawing.layers.find(l=>l.id===(session.selection.layer??session.layerId))??a.drawing.layers[0];
 const selectedLayerIds=selectedLayers(session.selection),targetLayers=selectedLayerIds.length?a.drawing.layers.filter(l=>selectedLayerIds.includes(l.id)):layer?[layer]:[];
 const chooseLayer=(id:string)=>session.set({layerId:id,selection:{ids:[],layer:id,layers:[id]}});
 const [locatorId,setLocatorId]=useAssemblyViewOption('locatorId'),[planeId,setPlaneId]=useAssemblyViewOption('planeId'),[overlay,setOverlay]=useAssemblyViewOption('overlay'),[folded,setFolded]=useAssemblyViewOption('folded'),[error,setError]=useState(''),[importing,setImporting]=useState(false),[sourceId,setSourceId]=useState('current');
 const [perspectiveEditing,setPerspectiveEditing]=useAssemblyViewOption('perspectiveEditing'),[projectionVisible,setProjectionVisible]=useState(true),[perspectiveClipboard,setPerspectiveClipboard]=useState<Quad|null>(null),[perspectiveDraft,setPerspectiveDraft]=useState<{base:AssemblyDocument;value:LayerPerspective}|null>(null);
 const [bendDraft,setBendDraft]=useState<{base:AssemblyDocument;value:BendValue;layerId:string}|null>(null),[bendClipboard,setBendClipboard]=useState<BendValue|null>(null);
 const [refinePreview,setRefinePreview]=useState<AssemblyDocument|null>(null);
 const [intervalPreview,setIntervalPreview]=useState<{base:AssemblyDocument;drawing:DrawingDocument}|null>(null);
 const perspectives=resolvedPerspectives(a),perspective=perspectives.find(p=>p.layerId===layer?.id);
 const perspectivePreview=perspectiveDraft?.base===a?{...a,deformRecording:undefined,perspectives:perspectives.map(p=>p.layerId===perspectiveDraft.value.layerId?perspectiveDraft.value:p)}:a;
 const previewAssembly=refinePreview??(bendDraft?.base===a?writeBend(perspectivePreview,bendDraft.layerId,bendDraft.value):perspectivePreview);
 const bending=['BEND','REFINE'].includes(a.timeline!.stage),bend=layer?bendEvaluation(a,layer.id):undefined;
 const paintDocument=useMemo(()=>assemblyDrawing(a),[a]);
 const showProjection=projectionVisible&&!a.timeline!.editingBase;
 useEffect(()=>{if(a.timeline!.editingBase||['BASE','PLACEMENT','REFINE'].includes(a.timeline!.stage))setPerspectiveEditing(false);},[a.timeline!.stage,a.timeline!.editingBase]);
 useEffect(()=>{if(session.selection.ids.length)setPerspectiveEditing(false);},[session.selection.ids.join('|'),session.tool]);
 const [trajectoryMode,setTrajectoryMode]=useAssemblyViewOption('trajectoryMode');
 const [trajectoryRequested,setTrajectoryRequested]=useAssemblyViewOption('trajectoryRequested'),[trajectoryPitch,setTrajectoryPitch]=useAssemblyViewOption('trajectoryPitch');
 const [trajectoryScope,setTrajectoryScope]=useAssemblyViewOption('trajectoryScope');
 const trajectoryPitches=[...new Set(a.placement?.enabled?a.placement.keys.map(k=>k.pitch):[])].sort((a,b)=>a-b);
 const referencePitch=trajectoryPitch??a.pose.pitch;
 const sourcePitch=trajectoryPitches.length?trajectoryPitches.reduce((best,p)=>Math.abs(p-referencePitch)<Math.abs(best-referencePitch)?p:best):referencePitch;
 const shownTrajectoryMode=trajectoryMode==='selected'&&!trajectoryRequested?'off':trajectoryMode;
 const orbits=useMemo(()=>locatorYawOrbits(a,{sourcePitch}),[a.planes,a.locators,a.pose.pitch,a.pose.roll,a.pose.position,a.placement?.enabled,a.placement?.loop,a.placement?.keys,a.placement?.base,sourcePitch]);
 const view=useRef<DrawingUnderlay|null>(null),onViewChange=useCallback((v:DrawingUnderlay)=>{view.current=v;},[]);
 const modal=useRef<HTMLDialogElement>(null),drag=useRef<{x:number;y:number;yaw:number;pitch:number}|null>(null);
 const locator=evaluated.locators.find(l=>l.id===locatorId),plane=evaluated.planes.find(p=>p.id===(locator?.planeId??planeId))??evaluated.planes[0],binding=evaluated.bindings.find(b=>b.layerId===layer?.id);
 useEffect(()=>{if(!a.locators.some(l=>l.id===locatorId))setLocatorId(a.locators[0]?.id??'');if(!a.planes.some(p=>p.id===planeId))setPlaneId(a.planes[0]?.id??'');},[a.locators,a.planes,locatorId,planeId]);
 const attachedLayers=a.drawing.layers.filter(l=>a.bindings.some(b=>b.layerId===l.id&&b.locatorId===locator?.id));
 useEffect(()=>{if(!importing)return;const d=modal.current!;d.showModal();return()=>d.close();},[importing]);
 useEffect(()=>{setError('');setBendDraft(null);setPerspectiveDraft(null);setProjectionVisible(true);},[projectId]);
 const change=(f:(a:AssemblyDocument)=>AssemblyDocument)=>{try{const current=useEditor.getState().project.assembly!;commitAssembly(f(current));setError('');}catch(e){setError((e as Error).message);}};
 const live=(f:(a:AssemblyDocument)=>AssemblyDocument)=>{const e=useEditor.getState();e.setAssembly(f(e.project.assembly!));};
 const slider=(label:string,value:number,min:number,max:number,f:(a:AssemblyDocument,v:number)=>AssemblyDocument)=><NumericSlider key={label} label={label} value={value} min={min} max={max} step={(max-min)/400} onEditStart={()=>useEditor.getState().beginEdit(true)} onEditEnd={()=>useEditor.getState().endEdit()} onChange={v=>live(a=>f(a,v))} onUndo={()=>useEditor.getState().undo()} onRedo={()=>useEditor.getState().redo()}/>;
 const poseSlider=(label:string,key:'yaw'|'pitch'|'roll',min:number,max:number)=>slider(label,a.pose[key],min,max,(a,v)=>({...a,pose:{...a.pose,[key]:v}}));
 const positionSlider=(label:string,index:number)=>slider(label,a.pose.position[index],-3,3,(a,v)=>({...a,pose:{...a.pose,position:a.pose.position.map((n,i)=>i===index?v:n) as Vec3}}));
 const selectLocator=(id:string)=>{setLocatorId(id);setTrajectoryRequested(!!id);setTrajectoryMode('selected');setTrajectoryPitch(p=>p??sourcePitch);const l=a.locators.find(l=>l.id===id);if(l)setPlaneId(l.planeId);};
 const stopCardPreview=()=>{setPerspectiveDraft(null);setPerspectiveEditing(false);change(a=>setBaseEditing(a,true));};
 const writePerspective=(p:LayerPerspective)=>change(a=>{requirePerspectiveLayer(a.drawing,p.layerId);return writeLayerPerspective(setTimelineStage(a,'BEND'),p);});
 const openBend=()=>{if(!layer)return;try{requirePerspectiveLayer(a.drawing,layer.id);change(a=>{const next=setTimelineStage(a,'BEND');return next.perspectives?.some(p=>p.layerId===layer.id)?next:{...next,perspectives:[...next.perspectives??[],{...createPerspective(next.drawing,layer.id),enabled:false}]};});setProjectionVisible(true);setPerspectiveEditing(true);}catch(e){setError((e as Error).message);}};
 const changeBend=(value:BendValue|null,commit=false)=>{if(!value){setBendDraft(null);return;}if(commit){setBendDraft(null);if(useEditor.getState().project.assembly===a)change(a=>{requirePerspectiveLayer(a.drawing,layer!.id);return writeBend(a,layer!.id,value);});}else setBendDraft({base:a,value,layerId:layer!.id});};
 const cageChange=(p:LayerPerspective|null,commit=false)=>{
  if(!p){setPerspectiveDraft(null);return;}
  if(commit){setPerspectiveDraft(null);if(useEditor.getState().project.assembly===a)writePerspective(p);}
  else setPerspectiveDraft({base:a,value:p});
 };

 const finish=()=>{if(drag.current){drag.current=null;useEditor.getState().endEdit();}};
 const underlay=(v:DrawingUnderlay)=><>{overlay&&<RigLines a={a} points={false} selected={locator?.id} screen={p=>[v.width/2+v.rigPan[0]+p[0]*v.unit,v.height/2+v.rigPan[1]-p[1]*v.unit]}/>}</>;
 return <section className="assembly-room" data-testid="assembly-room">
  <header className="assembly-header"><strong>{t('组装间')}</strong><button onClick={()=>setImporting(true)} data-testid="assembly-import">{t('载入原稿')}</button><button onClick={()=>setFolded(!folded)}>{t(folded?'展开 3D 定位':'收起 3D 定位')}</button><label><input type="checkbox" checked={overlay} onChange={e=>setOverlay(e.target.checked)}/>{t('显示定位参考')}</label>
   <button className="assembly-view-lock" data-testid="assembly-view-lock" aria-label={t('锁定主轴与视口')} aria-pressed={session.rigViewLocked} title={t(session.rigViewLocked?'已锁定：平移视口时主轴一起移动，保持当前对齐；点击解锁。':'未锁定：平移视口时主轴保持独立；点击锁定当前对齐。')} onClick={()=>session.set({rigViewLocked:!session.rigViewLocked})}>
    {session.rigViewLocked?<Lock size={14}/>:<Unlock size={14}/>}<span>{t(session.rigViewLocked?'主轴与视口 · 已锁定':'主轴与视口 · 未锁定')}</span>
   </button>
  </header>
  <PoseToolbar a={a} change={change}/>
  <div hidden={a.timeline!.editingBase||!['PERSPECTIVE','BEND','REFINE'].includes(a.timeline!.stage)} className="assembly-perspective-bar" data-ui-keyboard data-testid="assembly-perspective-controls">
   {a.timeline!.stage==='REFINE'?<>
    <strong className="assembly-refine-label">{t('单线微调 · 当前角度')}</strong><span>{t('A 拖端点或控制柄；新姿态偏移从 0 开始，姿态之间自动插值。')}</span>
    <button disabled={!session.selection.ids.length} data-testid="assembly-refine-delete" title="共享接头的关联修正一起移除，保持连接" onClick={()=>change(a=>session.selection.ids.reduce((next,id)=>deleteCurveRefinement(next,id),a))}>{t('删除所选线当前角度微调')}</button>
   </>:<>
    <button data-testid="assembly-perspective-edit" disabled={!layer||targetLayers.length>1} aria-pressed={perspectiveEditing} onClick={openBend}>{t('编辑区域变形器')}</button><span>{layer?.name??t('先选择图层')}</span>
    {perspective&&layer&&bend&&<><label><input type="checkbox" data-testid="assembly-perspective-enabled" checked={perspective.enabled||bend.value.enabled} onChange={e=>{const enabled=e.target.checked;change(a=>writeBend(writeLayerPerspective(a,{...perspective,enabled}),layer.id,{...bend.value,enabled}));}}/>{t('启用')}</label>
    <button data-testid="assembly-perspective-reset" onClick={()=>change(a=>writeBend(writeLayerPerspective(a,{...perspective,quad:neutralQuad()}),layer.id,neutralBend()))}>{t('重置变形')}</button>
    <button data-testid="assembly-perspective-copy" onClick={()=>{setPerspectiveClipboard(structuredClone(perspective.quad));setBendClipboard(structuredClone(bend.value));}}>{t('复制变形')}</button></>}
    <button data-testid="assembly-perspective-paste" disabled={!perspectiveClipboard||!layer||targetLayers.length>1} onClick={()=>{try{const p=perspective??createPerspective(a.drawing,layer!.id);change(a=>writeBend(writeLayerPerspective(setTimelineStage(a,'BEND'),{...p,quad:perspectiveClipboard!,enabled:true}),layer!.id,bendClipboard??neutralBend()));setPerspectiveEditing(true);}catch(e){setError((e as Error).message);}}}>{t('套用变形')}</button>
    {perspectiveEditing&&<button onClick={()=>setPerspectiveEditing(false)}>{t('收起变形框')}</button>}
    <small>{t(perspectiveEditing?'四角调透视 · 边与控制柄调弯曲 · V / A 返回选择':'V 选整笔与显示区间 · A 查看单段与接头')}</small>
   </>}
   {bend?.issue&&<span role="status">{t('此角度曲边发生折叠，暂用最近有效记录')}</span>}
   {error&&<span role="alert">{t(error)}</span>}
  </div>
  <div className="assembly-body">
  {!folded&&<aside className="assembly-controls" data-ui-keyboard>
   <div className="assembly-inspection">
    <svg viewBox="0 0 290 265" data-testid="assembly-3d" onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);useEditor.getState().beginEdit(true);drag.current={x:e.clientX,y:e.clientY,yaw:a.pose.yaw,pitch:a.pose.pitch};}} onPointerMove={e=>{const d=drag.current;if(d)live(a=>({...a,pose:{...a.pose,yaw:Math.max(-180,Math.min(180,d.yaw+(e.clientX-d.x)*.5)),pitch:Math.max(-90,Math.min(90,d.pitch+(e.clientY-d.y)*.5))}}));}} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
     <RigLines a={a} inspection orbits={orbits} trajectoryMode={shownTrajectoryMode} trajectoryScope={trajectoryScope} selected={locator?.id} onSelect={selectLocator} screen={p=>[145+p[0]*65,140-p[1]*65]}/>
    </svg>
    <div><span>Yaw {a.pose.yaw.toFixed(1)}° · Pitch {a.pose.pitch.toFixed(1)}° · Roll {a.pose.roll.toFixed(1)}°</span></div>
    <div className="assembly-view-shortcuts">{[0,-90,90].map(yaw=><button key={yaw} data-testid="assembly-view-shortcut" data-yaw={yaw} onClick={()=>change(a=>({...a,pose:{...a.pose,yaw,pitch:0,roll:0}}))}>{t(yaw===0?'回到正脸':yaw<0?'侧脸 −90°':'侧脸 +90°')}</button>)}</div>
    <label className="assembly-trajectory-control">{t('Yaw 轨迹')}<select aria-label={t('轨迹显示')} value={trajectoryMode} onChange={e=>{setTrajectoryMode(e.target.value as typeof trajectoryMode);setTrajectoryRequested(true);setTrajectoryPitch(p=>p??sourcePitch);}}><option value="selected">{t('仅选中点')}</option><option value="all">{t('所有定位点')}</option><option value="off">{t('隐藏轨迹')}</option></select></label>
    {trajectoryMode!=='off'&&<>
     {!!a.placement?.enabled&&a.placement.keys.length>1&&<label className="assembly-trajectory-control">{t('显示范围')}<select aria-label={t('轨迹范围')} value={trajectoryScope} onChange={e=>setTrajectoryScope(e.target.value as TrajectoryScope)}><option value="recorded">{t('已录制角度段')}</option><option value="full">{t('全部插值范围')}</option></select></label>}
     <label className="assembly-trajectory-control">{t('检查定位点')}<select aria-label={t('检查定位点')} value={trajectoryRequested?locator?.id??'':''} onChange={e=>selectLocator(e.target.value)}><option value="">{t('选择定位点')}</option>{a.locators.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
     {trajectoryPitches.length>1&&<label className="assembly-trajectory-control">{t('轨迹俯仰')}<select aria-label={t('轨迹俯仰')} value={sourcePitch} onChange={e=>setTrajectoryPitch(Number(e.target.value))}>{trajectoryPitches.map(p=><option key={p} value={p}>Pitch {p}°</option>)}</select></label>}
     {trajectoryRequested&&!!trajectoryPitches.length&&<small data-testid="assembly-trajectory-reference">{t('轨迹基准')} Pitch {sourcePitch}° · {t('转动主轴可从不同方向查看同一条轨迹')}</small>}
     {!!a.placement?.enabled&&<small>{t('空心点为已录制角度；选中点显示角度标签。')}</small>}
    </>}
    <small>{t(a.placement?.enabled?'轨迹显示已保存定位；草稿在保存后进入轨迹。':'轨迹只读：Yaw 绕当前主轴转动。')}</small>
   </div>
   <PoseDetails a={a} change={change} layerIds={targetLayers.map(l=>l.id)}/>
   <ViewSlots a={a} change={change}/>
   <details open><summary>{t('主轴姿态')}</summary>
    {poseSlider('左右转头 Yaw','yaw',-180,180)}{poseSlider('俯仰 Pitch','pitch',-90,90)}{poseSlider('歪头 Roll','roll',-180,180)}
    <details><summary>{t('主轴位置与透视')}</summary><label className="assembly-placement-option"><input type="checkbox" data-testid="assembly-follow-axis" checked={!!a.followAxisRotation} onChange={e=>{const checked=e.target.checked;change(a=>({...a,followAxisRotation:checked}));}}/>{t('图层随主轴旋转')}</label>{positionSlider('主轴 X',0)}{positionSlider('主轴 Y',1)}{positionSlider('主轴 Z',2)}{slider('相机距离',a.pose.distance,4,20,(a,v)=>({...a,pose:{...a.pose,distance:v}}))}</details>
   </details>
   <details open><summary>{t('定位平面与语义点')}</summary>
    <div className="assembly-row"><select aria-label={t('定位平面')} value={plane?.id??''} onChange={e=>{setPlaneId(e.target.value);selectLocator(a.locators.find(l=>l.planeId===e.target.value)?.id??'');}}>{a.planes.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><button disabled={!a.timeline!.editingBase} aria-label={t('添加定位面')} onClick={()=>{const id=crypto.randomUUID();change(a=>({...a,planes:[...a.planes,{id,name:`定位面 ${a.planes.length+1}`,height:0}]}));setPlaneId(id);setLocatorId('');}}>＋</button></div>
    {plane&&<><input aria-label={t('定位面名称')} value={plane.name} onChange={e=>{const name=e.target.value;if(name.trim())change(a=>({...a,planes:a.planes.map(p=>p.id===plane.id?{...p,name}:p)}));}}/>{slider('平面轴向高度',plane.height,-2,2,(a,v)=>setPlacementPlane(a,plane.id,v))}</>}
    <div className="assembly-row"><select aria-label={t('语义定位点')} value={locator?.id??''} onChange={e=>selectLocator(e.target.value)}><option value="">{t('选择定位点')}</option>{a.locators.filter(l=>l.planeId===plane?.id).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select><button aria-label={t('添加定位点')} disabled={!plane||!a.timeline!.editingBase} onClick={()=>{const id=crypto.randomUUID();change(a=>({...a,locators:[...a.locators,{id,name:`定位点 ${a.locators.length+1}`,planeId:plane!.id,x:0,z:.7}]}));setLocatorId(id);}}>＋</button></div>
    {locator&&<><input aria-label={t('定位点名称')} value={locator.name} onChange={e=>{const name=e.target.value;if(name.trim())change(a=>({...a,locators:a.locators.map(l=>l.id===locator.id?{...l,name}:l)}));}}/>{slider('点 X · 平面左右',locator.x,-2,2,(a,v)=>setPlacementPoint(a,locator.id,'x',v))}{slider('点 Z · 平面前后',locator.z,-2,2,(a,v)=>setPlacementPoint(a,locator.id,'z',v))}
    <small>{t(!a.timeline!.editingBase?'修正写入当前角度草稿；在顶部更新姿态。':'定位点随平面移动，始终留在平面内。')}</small>
    <button className="assembly-delete" disabled={!a.timeline!.editingBase} onClick={()=>change(a=>{let next=a;for(const b of a.bindings.filter(b=>b.locatorId===locator.id))next=unbindLayer(next,b.layerId);return {...next,locators:next.locators.filter(l=>l.id!==locator.id)};})}>{t('删除定位点')}</button></>}
    {plane&&<button className="assembly-delete" disabled={!a.timeline!.editingBase} onClick={()=>{change(a=>{const ids=new Set(a.locators.filter(l=>l.planeId===plane.id).map(l=>l.id));let next=a;for(const b of a.bindings.filter(b=>ids.has(b.locatorId)))next=unbindLayer(next,b.layerId);return {...next,planes:next.planes.filter(p=>p.id!==plane.id),locators:next.locators.filter(l=>!ids.has(l.id))};});setLocatorId('');setPlaneId('');}}>{t('删除定位面')}</button>}
   </details>
   <details open><summary>{t('图层挂接')}</summary>
    <select aria-label={t('挂接图层')} value={layer?.id??''} onChange={e=>chooseLayer(e.target.value)}><option value="" disabled>{t('先载入或绘制图层')}</option>{a.drawing.layers.map(l=><option key={l.id} value={l.id}>{l.name}{a.bindings.some(b=>b.layerId===l.id)?' · 已挂接':''}</option>)}</select>
    <p>{targetLayers.length>1?`${targetLayers.length} ${t('个图层已选择')}`:binding?`${t('已挂接')}：${a.locators.find(l=>l.id===binding.locatorId)?.name}`:t('未挂接的图层保持原位。')}</p>
    <small>{t('一个定位点可挂多个图层；右侧 Shift 连选，Ctrl/Cmd 增减选择。')}</small>
    <button data-testid="assembly-bind" disabled={!targetLayers.length||!locator} onClick={()=>change(a=>bindLayers(a,targetLayers.map(l=>l.id),locator!.id,view.current?rigPointInDrawing(locatorProjection(a,locator!.id).point,view.current):undefined))}>{locator?`${t('挂接到')}「${locator.name}」${targetLayers.length>1?` · ${targetLayers.length} ${t('个图层')}`:''}`:t('先选择定位点')}</button>
    {targetLayers.length===1&&binding&&layer&&<><button onClick={()=>change(a=>unbindLayer(a,layer.id))}>{t('解除挂接 · 保持画面')}</button><p data-testid="assembly-layer-scale">{t('当前等比缩放')}：{(layerTransform(a,layer.id).scale*100).toFixed(1)}%<br/>{t('定位点深度')}：{locatorProjection(a,binding.locatorId).depth.toFixed(3)}</p>
    {([0,1] as const).map(i=>slider(i===0?'图层偏移 X':'图层偏移 Y',binding.offset[i],-3,3,(a,v)=>setPlacementOffset(a,layer.id,i,v)))}
    <small>{t('图层偏移保存到当前角度姿态。')}</small></>}
    {locator&&<details open className="assembly-attachments" data-testid="assembly-attachments"><summary>{t('此定位点已挂接')} · {attachedLayers.length}</summary>
     {attachedLayers.length?<ul>{attachedLayers.map(l=><li key={l.id} data-testid="assembly-attached-layer" data-id={l.id}>
      <button className="assembly-attached-name" aria-pressed={targetLayers.some(x=>x.id===l.id)} onClick={()=>chooseLayer(l.id)}>{l.name}</button>
      <button aria-label={`${t('解除挂接')} ${l.name}`} title={t('解除挂接 · 保持画面')} onClick={()=>change(a=>unbindLayer(a,l.id))}>{t('解除挂接')}</button>
     </li>)}</ul>:<small>{t('尚未挂接图层')}</small>}
    </details>}
   </details>
   {error&&<p role="alert">{error}</p>}
  </aside>}
  <DrawingRoom key={projectId} onTool={tool=>{if(tool==='deform'&&!a.timeline!.editingBase){openBend();return true;}if(['select','direct','hand','zoom'].includes(tool))setPerspectiveEditing(false);if(!['select','direct','hand','zoom','deform'].includes(tool)&&!a.timeline!.editingBase)change(a=>setBaseEditing(a,true));return false;}} applyIntervals={a.timeline!.applyIntervals} artworkPreview={showProjection?{allowSelection:true,label:a.timeline!.stage==='REFINE'?'单线微调 · 当前角度':'角度姿态',hint:t(a.timeline!.stage==='REFINE'?'A 拖端点与控制柄微调；修改后更新姿态':'V 选整笔和区间 · A 查看单段结构 · 微调请进入单线微调'),edit:stopCardPreview,beforeCommit:()=>{},onSnapshotChange:()=>{setPerspectiveDraft(null);setPerspectiveEditing(false);},render:v=><CardPreview a={previewAssembly} applyIntervals={a.timeline!.applyIntervals} drawing={intervalPreview?.base===a?intervalPreview.drawing:undefined} view={v} showFills={session.showFills} fillVisibility={session.fillVisibility}/>} : undefined} onViewChange={onViewChange} underlay={underlay} overlay={v=><>
   {overlay&&<g data-testid="assembly-rig-overlay"><RigLines a={a} pointsOnly orbits={orbits} trajectoryMode={shownTrajectoryMode} trajectoryScope={trajectoryScope} selected={locator?.id} screen={p=>[v.width/2+v.rigPan[0]+p[0]*v.unit,v.height/2+v.rigPan[1]-p[1]*v.unit]}/></g>}
   {showProjection&&<ProjectedIntervals a={previewAssembly} view={v} drawing={paintDocument} applyIntervals={a.timeline!.applyIntervals} preview={d=>setIntervalPreview(d?{base:a,drawing:d}:null)}/>}
   {showProjection&&<RefinementOverlay a={previewAssembly} view={v} preview={setRefinePreview}/>}
   {perspectiveEditing&&a.timeline!.stage!=='REFINE'&&showProjection&&perspective&&(perspective.enabled||bending)&&<PerspectiveCage curved={bending} key={`perspective:${layer!.id}`} a={previewAssembly} p={resolvedPerspectives(previewAssembly).find(p=>p.layerId===layer!.id)!} view={v} change={cageChange} error={setError}/>}
   {perspectiveEditing&&a.timeline!.stage!=='REFINE'&&showProjection&&bending&&perspective&&<BendCage key={`bend:${layer!.id}`} a={previewAssembly} p={resolvedPerspectives(previewAssembly).find(p=>p.layerId===layer!.id)!} value={bendEvaluation(previewAssembly,layer!.id).value} view={v} change={changeBend} error={setError}/>}
  </>}/>

  </div>
  {importing&&<dialog ref={modal} className="assembly-dialog" aria-label={t('载入绘制间快照')} onCancel={()=>setImporting(false)}><form onSubmit={e=>{e.preventDefault();try{const d=sourceId==='current'?source:library&&snapshotDrawing(library,sourceId);if(!d)return;change(a=>ensureTimeline({...createAssembly(d),...frameOf(a),bindings:[],perspectives:undefined,...(a.placement?{placement:a.placement}:{}),...(a.followAxisRotation===undefined?{}:{followAxisRotation:a.followAxisRotation}),...(a.viewSlots?{viewSlots:a.viewSlots,activeViewSlotId:a.activeViewSlotId}:{})},a.pose));setPerspectiveEditing(false);setPerspectiveDraft(null);setProjectionVisible(true);session.set({layerId:null,selection:{ids:[]},tool:'select',zoom:1,pan:[0,0],rigPan:[0,0]});setImporting(false);}catch(e){setError((e as Error).message);}}}>
   <h3>{t('载入绘制间快照')}</h3><p>{t('复制到组装间。替换这里的画布和挂接关系，可撤销。原绘制间保持不变。')}</p><select aria-label={t('来源快照')} value={sourceId} onChange={e=>setSourceId(e.target.value)}><option value="current" disabled={!source}>{t('绘制间当前画布')}</option>{library?.items.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><footer><button type="button" onClick={()=>setImporting(false)}>{t('取消')}</button><button type="submit" disabled={sourceId==='current'&&!source}>{t('载入副本')}</button></footer>
  </form></dialog>}
 </section>;
}
