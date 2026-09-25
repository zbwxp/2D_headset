import {mergePointReason} from '../../domain/landmarks/merge';
import ChinConstruction from '../head/ChinConstruction';
import {CHIN,pointId} from '../../domain/chin/model';
import {ScaffoldShapeControls} from '../head/ScaffoldControls';
import GazeEyeball from '../head/GazeEyeball';
import EyeConstruction from '../head/EyeConstruction';
import {eyeSide} from '../../domain/eyes/scaffold';
import {ownerOf,canEditModule} from '../../domain/modules/ownership';
import {useObjectVisibility,toggleObjectHidden,toggleModuleHidden} from './visibility';
import SmoothJoinControls from './SmoothJoinControls';
import {uiText} from "../i18n";
import {useEffect,useRef,useState} from 'react';
import {useEditor} from '../../app/store';
import {useUI} from '../session';
import {isSection,isOnPatch} from '../../domain/curves/model';
import {pointPosition} from '../../domain/geometry/evaluation';
import {isLoomisLocked} from '../../domain/head/locks';
import {HELMET} from '../../domain/head/scaffold';
import {capabilities,descriptorRegistry,objectRows,objectRelations,resolveObject,type UIObject,type ObjectRowData} from './objects';
import type {ObjectRef} from './state';
import SymmetricPairListItem from '../shared/SymmetricPairListItem';
import InlineName from '../shared/InlineName';
import NumericSlider from '../shared/NumericSlider';
import {formatNumeric} from '../shared/numericSliderMath';
import {PlaneControl,SectionControl} from '../curves/CurvePanel';
import OnCurveInspector from '../edit2d/OnCurveInspector';
import SurfacePointInspector from '../head/SurfacePointInspector';
import OffsetControls from '../head/OffsetControls';
import SpatialPointControls from '../head/SpatialPointControls';
import {RimHeightControl,HelmetLoopControls} from '../head/ScaffoldControls';
import LoomisLock from '../head/LoomisLock';
import {FullnessControl} from '../patches/PatchPanel';
import {SmoothControls,SmoothEdgeControl,ShapeProtectionStatus} from '../smooth/SmoothControls';
import {defaultDisplay,patchQualityLevels,type PatchQuality} from '../../domain/patches/model';
import {EDIT_OPACITY_PRESETS,editSurfaceOpacity} from '../../rendering/edit2d/types';
export function ObjectLink({objectRef,label}:{objectRef:ObjectRef;label?:string}){const s=useEditor(),o=resolveObject(s.project,objectRef);return o?<button className="object-link" onClick={()=>s.selectObject(objectRef)}>{uiText(label&&<small>{uiText(label)} </small>)} {o.name} →</button>:null;}
function SourceFields({o}:{o:UIObject}){
 const s=useEditor(),p=s.project,session={onEditStart:()=>s.beginEdit(true),onEditEnd:s.endEdit};
 const field=descriptorRegistry[o.source as keyof typeof descriptorRegistry];
 if(field==='onPatch'&&o.ref.kind==='point')return <SurfacePointInspector fieldsOnly/>;
 if(field==='onPatch'){const c=p.curves.find(x=>x.id===o.ref.id)!;return isOnPatch(c)?<><ObjectLink objectRef={{kind:'surface',source:'PATCH',id:c.hostPatchId}} label={uiText("Host Surface")}/><small>{uiText("Path: Surface Bézier · canonical winding")}{uiText(c.role==='canonical'?c.path.winding:'mirror')}{uiText("· 拖动两个贴面控制柄调整弯曲；曲线始终附着宿主面")}</small></>:null;}
 if(field==='chin'||field==='chinPoint'||field==='chinCurve')return <button onClick={()=>s.selectObject({kind:'point',id:pointId('CHIN_M')})}>{uiText('调整下巴连接点')}</button>;
 if(field==='section')return <SectionControl id={o.ref.id}/>;
 if(field==='bezier')return <PlaneControl key={o.ref.id} id={o.ref.id}/>;
 if(field==='rim')return <RimHeightControl/>;
 if(field==='helmetLoop')return <HelmetLoopControls/>;
 if(field==='onCurvePoint')return <><OnCurveInspector unified/><OffsetControls/></>;
 if(field==='surfacePoint')return <><SurfacePointInspector fieldsOnly/><OffsetControls/></>;
 if(field==='systemPoint'){const l=p.landmarks.find(l=>l.id===o.ref.id)!,q=l.placement;return <><small>{uiText("系统派生位置 · 通过宿主参数调整")}</small>{q.kind==='LOOMIS_SCAFFOLD'&&q.role.startsWith('APEX')&&<NumericSlider label={uiText("Apex Height")} min={0} max={1} value={p.loomisScaffold!.apexHeight} {...session} onChange={v=>s.setScaffold('apexHeight',v)}/>}<OffsetControls/></>;}
 if(field==='controlPoints')return <small>{uiText('拖动眼角与控制点调整三维眼睑；不随视线旋转。')}</small>;
 if(field==='eyeLocalPoint')return <><small>{uiText('模型坐标：X 左右 / Y 上下 / Z 前后')}</small><SpatialPointControls id={o.ref.id}/></>;
 if(field==='spatialPoint'){const xyz=pointPosition(p,o.ref.id);return <><small>{uiText("2D 拖动 / 方向键移动 · View Lock 约束")}</small><code>{uiText(xyz.map(v=>formatNumeric(v)).join(' / '))}</code><SpatialPointControls id={o.ref.id}/><div>{p.views.map(v=><button key={v.id} onClick={()=>s.setViewLock(v.id,!p.landmarks.find(l=>l.id===o.ref.id)!.viewLocks[v.id])}>{uiText(v.shortLabel)} {uiText(p.landmarks.find(l=>l.id===o.ref.id)!.viewLocks[v.id]?'🔒':'锁定')}</button>)}</div></>;}
 if(field==='patch'){const patch=p.patches!.find(x=>x.id===o.ref.id)!;return <><ShapeProtectionStatus id={patch.id}/><FullnessControl id={patch.canonicalId??patch.id}/></>;}
 if(field==='helmet')return <><label><input type="checkbox" checked={p.loomisScaffold!.visible} onChange={e=>s.setScaffold('visible',e.target.checked)}/>{uiText("显示 Helmet")}</label><NumericSlider label={uiText("Side Shell Roundness")} min={0} max={1} value={p.loomisScaffold!.roundness} {...session} onChange={v=>s.setScaffold('roundness',v)}/></>;
 if(field==='cap')return <small>{uiText("严格平面 · 随 Host Section 变化 · 无 Fullness")}</small>;
 if(field==='region')return <small>{uiText("解析 Loomis 区域 · 由 Source Sections 定义")}</small>;
 return null;
}
export function InlineInspectorHost({object,rename}:{object:UIObject;rename:()=>void}){
 const hidden=useObjectVisibility(s=>s.hidden);
 const s=useEditor(),o=object,c=capabilities(o),relations=objectRelations(s.project,o),ref=o.ref;
 const remove=()=>{if(!c.delete.enabled)return;if(ref.kind==='point')useUI.setState({deleteTarget:{kind:'landmark',id:ref.id}});else if(ref.kind==='curve')useUI.setState({deleteTarget:{kind:'curve',id:ref.id}});else if(ref.kind==='surface'){if(ref.source==='PATCH')useUI.setState({deleteTarget:{kind:'patch',id:ref.id}});else if(ref.source==='CAP')s.deleteCap(ref.id);else if(ref.source==='REGION')s.deleteLoomisRegion(ref.id);}};
 if(!canEditModule(s.project,ref.id,s.activeModule))return <div className="inline-inspector"><strong>{o.name}</strong><p>{uiText('HeadSet 参考对象 · 切回头壳模块编辑')}</p></div>;
 return <div className="inline-inspector" data-testid="inline-inspector" data-ui-keyboard>
 <section><h4>{uiText("Identity")}</h4><strong>{o.name}</strong><small>{uiText(o.source==='CHIN_SURFACE'&&s.project.chinScaffold?.version===3?'语义下巴点':o.source)}{uiText(o.system?' · System':'')}</small>{!o.source.startsWith('CHIN')&&o.source!=='FREE'&&o.source!=='PATCH'&&o.source!=='ON_PATCH'&&<LoomisLock id={ref.id}/>}</section>
 <section><h4>{uiText("Source")}</h4><fieldset disabled={o.locked}><SourceFields o={o}/></fieldset></section>
 {ref.kind==='curve'&&<section><h4>{uiText("Contour")}</h4><label><input type="checkbox" checked={s.project.curves.find(c=>c.id===ref.id)?.contourRole==='OPEN_EDGE'} onChange={e=>s.setContourRole(ref.id,e.target.checked?'OPEN_EDGE':'NONE')}/>{uiText("显示在 Contour 中")}</label></section>}
 {(!!relations.length||ref.kind==='point'||ref.kind==='curve')&&<section><h4>{uiText("Relations")}</h4>{relations.map((r,i)=><ObjectLink key={i} objectRef={r.ref} label={uiText(r.label)}/>)}<SmoothJoinControls key={ref.kind+ref.id} objectRef={ref}/>{ref.kind==='curve'&&<SmoothEdgeControl id={ref.id}/>}</section>}
 <section><h4>{uiText("Operations")}</h4>{o.system&&ref.kind!=='frame'&&<button onClick={()=>toggleObjectHidden(o)}>{uiText(hidden[ref.id]!==undefined?"解除隐藏":"隐藏")}</button>}<button disabled={!c.rename} onClick={rename}>{uiText("Rename")}</button>{c.onCurve&&<button onClick={()=>s.addOnCurvePoint(ref.id)}>{uiText("Add On-Curve Point")}</button>}{c.duplicate&&<button onClick={()=>ref.kind==='point'?useUI.setState({duplicateId:ref.id}):s.duplicateRing(ref.id)}>{uiText("Duplicate")}</button>}{o.source==='LOOMIS_SECTION'&&<button onClick={()=>s.closeSection(ref.id)}>{uiText("封闭为 Loomis 面")}</button>}{ref.kind==='point'&&o.source==='ON_CURVE'&&<button disabled={!!mergePointReason(s.project,ref.id)} title={uiText(mergePointReason(s.project,ref.id))} onClick={()=>s.startPointMerge(ref.id)}>{uiText('合并曲线定位点')}</button>}<button disabled={!c.delete.enabled} title={uiText(c.delete.reason)} onClick={remove}>{uiText("Delete")}</button>{!c.delete.enabled&&<small>{uiText(c.delete.reason)}</small>}</section>
 </div>;
}
export function ObjectRow({row}:{row:ObjectRowData}){
 const hidden=useObjectVisibility(s=>s.hidden);
 const s=useEditor(),active=s.selection?.kind===row.primary.ref.kind&&(s.selection.id===row.primary.ref.id||s.selection.id===row.mirror?.ref.id),o=active&&s.selection?.id===row.mirror?.ref.id?row.mirror:row.primary;
 const [renaming,setRenaming]=useState(false),[name,setName]=useState(''),renameDone=useRef(false);
 // Collapse only this selection event; a viewport/Relations selection reopens details.
 const [collapsedTick,setCollapsedTick]=useState<number|null>(null),expanded=active&&collapsedTick!==s.selectionTick;
 const selected=o!,ref=selected.ref,entity=ref.kind==='point'?{kind:'landmark' as const,id:ref.id}:ref.kind==='curve'?{kind:'curve' as const,id:ref.id}:ref.kind==='surface'&&ref.source==='PATCH'?{kind:'patch' as const,id:ref.id}:null;
 const rename=()=>{if(!capabilities(selected).rename)return;if(entity)useUI.setState({renameTarget:entity});else{renameDone.current=false;setName(selected.name);setRenaming(true);}};
 const finish=()=>{if(renameDone.current)return;renameDone.current=true;if(renaming&&name.trim()&&name.trim()!==selected.name){if(ref.kind==='surface'&&ref.source==='REGION')s.renameLoomisRegion(ref.id,name);else if(ref.kind==='surface'&&ref.source==='CAP')s.renameCap(ref.id,name);}setRenaming(false);};
 const select=(id:string)=>{const target=id===row.mirror?.ref.id?row.mirror:row.primary;s.selectObject(target!.ref);setCollapsedTick(expanded?useEditor.getState().selectionTick:null);};
 const center=ref.kind==='point'&&s.project.centerlineOrder.includes(ref.id);
 const article=useRef<HTMLElement>(null);
 useEffect(()=>{if(!active)return;const raf=requestAnimationFrame(()=>{const row=article.current,list=row?.closest('.object-list');if(row&&list){const a=row.getBoundingClientRect(),b=list.getBoundingClientRect();if(a.top<b.top)list.scrollTop+=a.top-b.top;else if(a.bottom>b.bottom)list.scrollTop+=Math.min(a.top-b.top,a.bottom-b.bottom);}});return()=>cancelAnimationFrame(raf);},[active,s.selectionTick]);
 return <article ref={article} className="object-card" data-object-id={ref.id} data-selected={active}>
 <SymmetricPairListItem primaryId={row.primary.ref.id} mirrorId={row.mirror?.ref.id} selectedId={active?s.selection!.id:null} displayName={row.name} aria-expanded={expanded} onSelect={select} onRename={()=>rename()} onContextMenu={e=>{e.preventDefault();s.selectObject(ref);if(entity)useUI.setState({menu:{target:entity,x:e.clientX,y:e.clientY}});}} draggable={center} onDragStart={e=>e.dataTransfer.setData('text/point-id',ref.id)} onDragOver={e=>{if(center)e.preventDefault();}} onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData('text/point-id');if(center&&id)s.reorderCenterline(id,ref.id,e.clientY>e.currentTarget.getBoundingClientRect().top+e.currentTarget.clientHeight/2);}} onKeyDown={e=>{if(center&&e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const order=s.project.centerlineOrder,target=order[order.indexOf(ref.id)+(e.key==='ArrowDown'?1:-1)];if(target)s.reorderCenterline(ref.id,target,e.key==='ArrowDown');}}}>
 {()=> <><span>{uiText(ref.kind==='point'?'●':ref.kind==='curve'?'─':'▰')}</span>{entity?<InlineName target={entity} name={row.name} baseName={row.name}/>:renaming?<input autoFocus value={name} onChange={e=>setName(e.target.value)} onBlur={finish} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter')finish();if(e.key==='Escape'){renameDone.current=true;setRenaming(false);}}}/>:<span>{row.name}</span>}<small>{hidden[ref.id]!==undefined&&<span>{uiText("已隐藏")} · </span>}{uiText(selected.source)}{uiText(selected.system?' · System':'')}</small></>}
 </SymmetricPairListItem>{expanded&&<InlineInspectorHost object={selected} rename={rename}/>}
 </article>;
}
function Construction(){const s=useEditor(),[open,setOpen]=useState(false);useEffect(()=>{setOpen(s.selection?.kind==='frame');},[s.selection,s.selectionTick]);const f=s.project.headFrame;if(!f)return null;return <section className="construction-panel"><button className="section-heading" aria-expanded={open} onClick={()=>setOpen(!open)}>{uiText("Construction")}</button>{open&&<div className="inline-inspector"><button onClick={()=>s.selectObject({kind:'frame',id:'head'})}>{uiText("HeadFrame · System")}</button><fieldset disabled={s.activeModule!=='HEADSET'}><LoomisLock id="frame:head"/></fieldset>{(['radiusX','radiusY','radiusZ'] as const).map((key,i)=><NumericSlider key={key} label={uiText(['Width','Height','Depth'][i])} min={.2} max={6} value={2*f[key]} disabled={s.activeModule!=='HEADSET'||isLoomisLocked(s.project,'frame:head')} onEditStart={()=>s.beginEdit(true)} onEditEnd={s.endEdit} onChange={v=>s.setHeadRadius(key,v/2)}/>)}<ScaffoldShapeControls/>{s.activeModule==='HEADSET'&&<section data-testid="head-perspective"><h4>{uiText("头壳透视")}</h4>{(['x','y'] as const).map(axis=><NumericSlider key={axis} label={uiText(axis==='x'?'X 方向透视强度':'Y 方向透视强度')} min={0} max={1} value={s.project.headPerspective?.[axis]??0} onEditStart={()=>s.beginEdit(true)} onEditEnd={s.endEdit} onChange={v=>s.setHeadPerspective(axis,v)}/>)}</section>}</div>}</section>;}
function SurfaceDisplay(){const s=useEditor(),d={...defaultDisplay,...s.project.patchDisplay};return <details className="surface-display" data-ui-keyboard><summary>{uiText("全局面显示")}</summary><label><input type="checkbox" checked={d.visible!==false} onChange={e=>s.setPatchVisible(e.target.checked)}/>{uiText("显示 Surfaces")}</label><label>{uiText("显示精度")}<select value={d.quality==='ultra'?'high':d.quality??'high'} onChange={e=>s.setPatchQuality(e.target.value as PatchQuality)}>{Object.entries(patchQualityLevels).map(([k,v])=><option key={k} value={k}>{uiText(v.label)}</option>)}</select></label><label>{uiText("2D 不透明度")}<select value={editSurfaceOpacity(d.opacity2d)} onChange={e=>s.setPatchDisplay('opacity2d',+e.target.value)}>{EDIT_OPACITY_PRESETS.map(v=><option key={v} value={v}>{v*100}%</option>)}</select></label><NumericSlider label={uiText("3D Patch 不透明度")} min={0} max={100} value={d.opacity3d*100} onEditStart={s.beginDisplayEdit} onEditEnd={s.endEdit} onChange={v=>s.setPatchDisplay('opacity3d',v/100)}/>{s.activeModule==='HEADSET'&&<SmoothControls/>}</details>;}
export default function ObjectSidebar(){const moduleVisibility=useObjectVisibility(s=>s.hidden),chinGuides=useObjectVisibility(s=>s.chinGuides);const s=useEditor(),[open,setOpen]=useState<Record<string,boolean>>({point:true,curve:false,surface:false});useEffect(()=>{if(s.selection&&s.selection.kind!=='frame')setOpen({point:s.selection.kind==='point',curve:s.selection.kind==='curve',surface:s.selection.kind==='surface'});},[s.selection?.kind,s.selectionTick]);return <><nav className="geometry-modules" data-testid="geometry-modules">{(['HEADSET','EYES'] as const).map(m=><div key={m} className="geometry-module-tab"><button aria-pressed={s.activeModule===m} onClick={()=>s.setActiveModule(m)}>{uiText(m==='HEADSET'?'HeadSet / 头壳':'Eyes / 眼睛')}</button><button data-testid={'module-visibility-'+m} aria-pressed={moduleVisibility['module:'+m]===undefined} onClick={()=>toggleModuleHidden(m)}>{uiText(moduleVisibility['module:'+m]===undefined?'隐藏整组':'显示整组')}</button></div>)}</nav><Construction/><ChinConstruction/><EyeConstruction/><GazeEyeball/>{s.activeModule==='EYES'&&<p>{uiText('头壳保留为参考，仅 Default Scaffold 可选。')}</p>}{(['point','curve','surface'] as const).map(kind=>{const rows=objectRows(s.project,kind).filter(row=>chinGuides||!(row.primary.source==='CHIN_SEAM'||row.primary.source==='CHIN_SURFACE'&&row.primary.system&&s.project.landmarks.find(l=>l.id===row.primary.ref.id)?.systemRole!=='CHIN_M')).filter(row=>ownerOf(s.project,row.primary.ref.id)===s.activeModule&&!eyeSide(s.project,row.primary.ref.id));return <section className={'object-category '+(open[kind]?'expanded':'')} aria-label={uiText({point:'Points',curve:'Curves',surface:'Surfaces'}[kind])} key={kind}><button className="section-heading" aria-expanded={open[kind]} onClick={()=>setOpen({...open,[kind]:!open[kind]})}>{uiText(open[kind]?'▾':'▸')} {uiText({point:'Points',curve:'Curves',surface:'Surfaces'}[kind])} <small>{rows.length}{uiText("行")}</small></button>{open[kind]&&<div className="object-list">{rows.map(row=><ObjectRow key={row.primary.ref.id} row={row}/>)}</div>}</section>})}{s.activeModule==='EYES'&&s.selection&&ownerOf(s.project,s.selection.id)==='HEADSET'&&resolveObject(s.project,s.selection)&&<InlineInspectorHost object={resolveObject(s.project,s.selection)!} rename={()=>{}}/>}<SurfaceDisplay/></>;}
