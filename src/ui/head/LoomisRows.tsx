import {uiText} from "../i18n";
import {SystemPointInspector} from './ScaffoldControls';
import LoomisLock from './LoomisLock';
import {isLoomisLocked} from '../../domain/head/locks';
import OffsetControls from './OffsetControls';
import {regionMesh} from '../../domain/head/regions';
import {SmoothEdgeControl} from '../smooth/SmoothControls';
import {useState,useRef} from 'react';
import {useEditor} from '../../app/store';
import {useUI,type Entity} from '../session';
import {curveRows,curveBaseName,landmarkRows} from '../shared/pairRows';
import {landmarkBaseName} from '../../domain/landmarks/management';
import {isSection,isDerived} from '../../domain/curves/model';
import SymmetricPairListItem from '../shared/SymmetricPairListItem';
import InlineName from '../shared/InlineName';
import {SectionControl} from '../curves/CurvePanel';
import SurfacePointInspector from './SurfacePointInspector';
import OnCurveInspector from '../edit2d/OnCurveInspector';
import {useRegionTool} from './regionTool';
import {selectRegion,useLoomisUI} from './loomisUI';
function Actions({target}:{target:Entity}){const p=useEditor(s=>s.project),system=target.kind==='landmark'?p.landmarks.find(l=>l.id===target.id)?.systemRole:target.kind==='curve'?p.curves.find(c=>c.id===target.id)&&'systemRole' in p.curves.find(c=>c.id===target.id)!&&(p.curves.find(c=>c.id===target.id) as any).systemRole:false;return <div className="loomis-actions"><button onClick={()=>useUI.setState({renameTarget:target})}>{uiText("Rename")}</button><button disabled={!!system} title={uiText(system?"系统对象不可删除":undefined)} onClick={()=>useUI.setState({deleteTarget:target})}>{uiText("Delete")}</button></div>;}
export function SectionRows(){
 const s=useEditor(),tool=useRegionTool(),ui=useLoomisUI();
 return <section aria-label={uiText("SECTIONS")}><h4>{uiText("SECTIONS · 剖面线")}</h4>{curveRows(s.project).filter(r=>isSection(r.primary)).map(({primary,mirror})=>{
 const active=[primary.id,mirror?.id].includes(s.selectedCurveId??''),id=active?s.selectedCurveId!:primary.id;
 const c=s.project.curves.find(c=>c.id===id)!,name=curveBaseName(primary,!!mirror);
 const check=(id:string)=>useRegionTool.setState({preview:false,ids:tool.ids.includes(id)?tool.ids.filter(x=>x!==id):[...tool.ids,id]});
 return <article className="loomis-card" data-loomis-card key={primary.id}><LoomisLock id={primary.id}/>{uiText(("systemRole" in primary)&&primary.systemRole&&<small className="system-badge">{uiText("系统")}</small>)}
 {tool.active?<div className="loomis-region-choices">{[primary,mirror].filter(Boolean).map(c=><label key={c!.id}><input type="checkbox" checked={tool.ids.includes(c!.id)} onChange={()=>check(c!.id)}/>{c!.name}</label>)}</div>:<SymmetricPairListItem primaryId={primary.id} mirrorId={mirror?.id} selectedId={s.selectedCurveId} displayName={name} onSelect={s.selectCurve} onRename={id=>useUI.setState({renameTarget:{kind:'curve',id}})} onContextMenu={e=>{e.preventDefault();s.selectCurve(id);useUI.setState({menu:{target:{kind:'curve',id},x:e.clientX,y:e.clientY}});}}>{()=> <InlineName target={{kind:'curve',id}} name={name} baseName={curveBaseName(c,!!mirror)}/>}</SymmetricPairListItem>}
 {active&&!tool.active&&<div className="loomis-inline" data-ui-keyboard><fieldset disabled={isLoomisLocked(s.project,id)}><SectionControl id={id} compact={ui.sidePresets.includes(primary.id)||(isSection(primary)&&primary.role==='canonical'&&Math.abs(primary.section.planeNormal[0])>1-1e-10)}/></fieldset>{s.project.loomisCaps?.some(c=>c.hostSectionCurveId===id)?<div><small>{uiText("Loomis 面：已封闭")}</small><LoomisLock id={s.project.loomisCaps!.find(c=>c.hostSectionCurveId===id)!.id}/><button onClick={()=>s.deleteCap(s.project.loomisCaps!.find(c=>c.hostSectionCurveId===id)!.id)}>{uiText("删除封闭面")}</button></div>:<button onClick={()=>s.closeSection(id)}>{uiText("封闭为 Loomis 面")}</button>}<button onClick={()=>s.duplicateRing(id)}>{uiText("复制 Ring")}</button><button onClick={()=>s.addOnCurvePoint(id)}>{uiText("+ 添加在线定位点")}</button><Actions target={{kind:'curve',id}}/><SmoothEdgeControl id={id}/></div>}
 </article>;
 })}</section>;
}
export function LoomisPointRows(){
 const s=useEditor(),selected=s.selectedCurveId||s.selectedPatchId?null:s.selectedId;
 return <section aria-label={uiText("LANDMARKS")}><h4>{uiText("LANDMARKS · 定位点")}</h4>{landmarkRows(s.project).filter(({primary:p})=>(p.placement.kind==='LOOMIS_SCAFFOLD'||p.placement.kind==='ON_LOOMIS_SURFACE'||p.placement.kind==='ON_SECTION_CAP')||p.placement.kind==='ON_CURVE'&&s.project.curves.some(c=>c.id===(p.placement.kind==='ON_CURVE'?p.placement.hostCurveId:'')&&isDerived(c))).map(({primary,mirror})=>{
 const active=selected===primary.id||!!mirror&&selected===mirror.id,id=active?selected!:primary.id,p=s.project.landmarks.find(p=>p.id===id)!,name=mirror?landmarkBaseName(primary):primary.name;
 return <article className="loomis-card" data-loomis-card key={primary.id}><LoomisLock id={primary.id}/>{("systemRole" in primary)&&primary.systemRole&&<small className="system-badge">{uiText("系统")}</small>}<SymmetricPairListItem primaryId={primary.id} mirrorId={mirror?.id} selectedId={selected} displayName={name} onSelect={s.selectLandmark} onRename={id=>useUI.setState({renameTarget:{kind:'landmark',id}})} onContextMenu={e=>{e.preventDefault();s.selectLandmark(id);useUI.setState({menu:{target:{kind:'landmark',id},x:e.clientX,y:e.clientY}});}}>{()=> <InlineName target={{kind:'landmark',id}} name={name} baseName={landmarkBaseName(p)}/>}</SymmetricPairListItem>{active&&<div className="loomis-inline" data-ui-keyboard><fieldset disabled={isLoomisLocked(s.project,id)}>{p.placement.kind==='LOOMIS_SCAFFOLD'?<SystemPointInspector id={id}/>: (p.placement.kind==='ON_LOOMIS_SURFACE'||p.placement.kind==='ON_SECTION_CAP')?<SurfacePointInspector/>:<OnCurveInspector loomis/>}<OffsetControls/></fieldset><Actions target={{kind:'landmark',id}}/></div>}</article>;
 })}</section>;
}
export function RegionRows(){const s=useEditor(),selected=useEditor(s=>s.selection?.kind==='surface'&&s.selection.source==='REGION'?s.selection.id:null);return <section aria-label={uiText("REGIONS")}><h4>{uiText("REGIONS · 球面区域")}</h4>{s.project.loomisRegions?.filter(r=>!r.id.endsWith(':mirror')).map(r=><RegionRow key={r.id} id={r.id} active={selected===r.id}/>)}</section>;}
function RegionRow({id,active}:{id:string;active:boolean}){
 const s=useEditor(),r=s.project.loomisRegions!.find(r=>r.id===id)!,[editing,setEditing]=useState(false),[name,setName]=useState(r.name);
 const done=useRef(false);const rename=()=>{done.current=false;setName(r.name);setEditing(true);};const save=()=>{if(done.current)return;done.current=true;if(name.trim()&&name.trim()!==r.name)s.renameLoomisRegion(id,name);setEditing(false);};
 return <article className="loomis-card" data-loomis-card data-region-id={id}><LoomisLock id={id}/><div role="button" tabIndex={0} className={`symmetric-pair-row ${active?'active':''}`} aria-label={r.name} aria-pressed={active} onClick={()=>selectRegion(id)} onDoubleClick={rename} onContextMenu={e=>{e.preventDefault();selectRegion(id);}} onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(e.key==='Enter'||e.key==='F2'){e.preventDefault();rename();}if(e.key==='Delete'){e.preventDefault();s.deleteLoomisRegion(id);}}}>{editing?<input aria-label={uiText("Region 名称")} autoFocus value={name} onChange={e=>setName(e.target.value)} onBlur={save} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter')save();if(e.key==='Escape'){done.current=true;setEditing(false);}}}/>:r.name}</div>{active&&<div className="loomis-inline" data-ui-keyboard>{uiText(regionMesh(s.project,r).invalid&&<small>⚠ {uiText(regionMesh(s.project,r).invalid)}</small>)}<small>{uiText("Source Sections")}</small>{r.cuts.map((cut,i)=><button className="loomis-source" key={i} onClick={()=>s.selectCurve(cut.curveId)}>{uiText(s.project.curves.find(c=>c.id===cut.curveId)?.name??'缺失 Section')} →</button>)}<div className="loomis-actions"><button onClick={rename}>{uiText("Rename")}</button><button onClick={()=>s.deleteLoomisRegion(id)}>{uiText("Delete")}</button></div></div>}</article>;
}
