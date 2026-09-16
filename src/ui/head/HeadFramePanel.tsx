import {HelmetCard,RimRow} from './ScaffoldControls';
import {HELMET} from '../../domain/head/scaffold';
import LoomisLock from './LoomisLock';
import {isLoomisLocked} from '../../domain/head/locks';
import {useSurfaceTool} from './surfaceTool';
import {SectionRows,LoomisPointRows,RegionRows} from './LoomisRows';
import {selectRegion,useLoomisUI} from './loomisUI';
import {regionCandidates} from '../../domain/head/regions';
import {useEffect,useState} from 'react';
import {isAnalytic} from '../../domain/curves/model';
import {useRegionTool,cancelRegionTool} from './regionTool';
import {useWindows} from '../windows/state';
import {useShallow} from 'zustand/react/shallow';
import {useEditor} from '../../app/store';
import NumericSlider from '../shared/NumericSlider';
import {formatNumeric} from '../shared/numericSliderMath';
export default function HeadFramePanel(){
 const project=useEditor(s=>s.project),selection=useEditor(s=>s.selectedPatchId??s.selectedCurveId??s.selectedId),selectionTick=useEditor(s=>s.selectionTick),tool=useRegionTool(),surfaceTool=useSurfaceTool();
 const regionId=useLoomisUI(s=>s.regionId);
 useEffect(()=>{if(regionId)setOpen(true);},[regionId]);
 const open=useLoomisUI(s=>s.open),setOpen=(open:boolean)=>useLoomisUI.setState({open});
 useEffect(()=>{if(!selection)return;const point=project.landmarks.find(l=>l.id===selection);setOpen(selection===HELMET||(point?.placement.kind==='ON_LOOMIS_SURFACE'||(point?.placement.kind==="LOOMIS_SCAFFOLD"||point?.placement.kind==='ON_SECTION_CAP'))||project.curves.some(c=>isAnalytic(c)&&(c.id===selection||(point?.placement.kind==='ON_CURVE'&&point.placement.hostCurveId===c.id))));},[selection,selectionTick]);
 useEffect(()=>{const f=(e:KeyboardEvent)=>{if(e.key==='Escape'){cancelRegionTool();useSurfaceTool.setState({creating:false});}};window.addEventListener('keydown',f);return()=>window.removeEventListener('keydown',f);},[]);
 const s=useEditor(useShallow(s=>({frame:s.project.headFrame,locked:!!s.project.lockedViews?.length||s.project.landmarks.some(l=>Object.keys(l.viewLocks).length),set:s.setHeadRadius,begin:s.beginEdit,end:s.endEdit,undo:s.undo,redo:s.redo})));
 if(!s.frame)return null;
 const stop=()=>{cancelRegionTool();useSurfaceTool.setState({creating:false});useEditor.getState().cancelCurve();useEditor.getState().cancelPatch();};
 const create=(center=false,side=false)=>{stop();useEditor.getState().createLoomisSection(center,side);if(side)useLoomisUI.setState(u=>({sidePresets:[...u.sidePresets,useEditor.getState().selectedCurveId!]}));};
 const preview=()=>{try{const candidates=regionCandidates(project,tool.ids);if(!candidates.length){useEditor.getState().notify('没有可显示的候选区域');return;}if(candidates.length===1){const c=candidates[0],id=crypto.randomUUID();useEditor.getState().addLoomisRegion({id,name:'Loomis 球面区域',cuts:c.cuts,seed:c.seed});cancelRegionTool();selectRegion(id);return;}useRegionTool.setState({preview:true});if(!useWindows.getState().visible.threeD)useWindows.getState().toggle('threeD');}catch(e){useEditor.getState().notify((e as Error).message);}};
 return <section className={`head-frame-panel ${open?'loomis-open':''}`}><button className="loomis-heading" aria-expanded={open} onClick={()=>setOpen(!open)}>Loomis Set</button>{open&&<div className="loomis-body">
 <div className="loomis-toolbar" data-ui-keyboard>

 <button aria-pressed={surfaceTool.creating} onClick={()=>{const next=!surfaceTool.creating;stop();useSurfaceTool.setState({creating:next});if(next&&!useWindows.getState().visible.threeD)useWindows.getState().toggle('threeD');}}>{surfaceTool.creating?'结束球面取点':' + 球面定位点'}</button>
 {surfaceTool.creating&&<div><button aria-pressed={!surfaceTool.centerline} onClick={()=>useSurfaceTool.setState({centerline:false})}>成对点</button><button aria-pressed={surfaceTool.centerline} onClick={()=>useSurfaceTool.setState({centerline:true})}>中线点</button><small>3D 连续点击创建 · Esc 退出</small></div>}
 <button aria-pressed={tool.active} onClick={()=>{const next=!tool.active;stop();useRegionTool.setState({active:next});}}>+ 球面区域</button>
 {tool.active&&<div><small>{tool.preview?'3D 点击彩色区域 · Esc 取消':'在 SECTIONS 中勾选参与剖面'}</small><button disabled={!tool.ids.length} onClick={preview}>预览区域</button><button onClick={cancelRegionTool}>取消</button></div>}
 </div><div className="loomis-object-scroll">
 <details className="loomis-frame"><summary>基础椭球 · 系统<LoomisLock id="frame:head"/></summary>{s.locked&&<small>调整尺寸前请先 Unlock 视图锁。</small>}
 {([['Width','radiusX'],['Height','radiusY'],['Depth','radiusZ']] as const).map(([label,axis])=><NumericSlider key={axis} label={label} value={s.frame![axis]*2} min={.2} max={6} disabled={s.locked||isLoomisLocked(project,"frame:head")} formatValue={v=>formatNumeric(v)} onEditStart={()=>s.begin(true)} onEditEnd={s.end} onUndo={s.undo} onRedo={s.redo} onChange={v=>s.set(axis,v/2)}/>)}</details>
 <h4>LOOMIS DEFAULT</h4><HelmetCard/><SectionRows/><RimRow/><LoomisPointRows/><RegionRows/>
 </div></div>}</section>;
}
