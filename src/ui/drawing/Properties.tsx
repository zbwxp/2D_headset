import PaintOrderControls,{reorderDrawingSelection} from './PaintOrderControls';
import SelectionNameControls from './SelectionNameControls';
import {SelectionTransformControls,CurveObjectActions,CurveLayerControl} from './SelectionPropertyControls';
import EndpointPropertyControls,{endpointPropertyTracks} from './EndpointPropertyControls';
import {CurveControlSelection,CurvePointControls,CurveWidthControl,StrokeNameControl} from './CurvePropertyControls';
import type {ReactNode} from 'react';
import type {DrawingCommandRun} from './endpointInteraction';
import {currentDrawingPresentation} from './snapshotPresentation';
import {displayRouteFor} from '../../domain/drawing/displayIntervals';
import MirrorEditingControls from './MirrorEditingControls';
import {ChevronDown,ChevronRight} from 'lucide-react';
import {curveById,layerFor,nodeAt,type DrawingDocument} from '../../domain/drawing/model';
import {setMirrorAxis} from '../../domain/drawing/commands';
import {strokeFor} from '../../domain/drawing/strokes';
import ArcControls from './ArcControls';
import DepthControls from './DepthControls';
import DisplayIntervalControls from './DisplayIntervalControls';
import AppearanceControls from './AppearanceControls';
import {selectedGroup} from '../../domain/drawing/groups';
import {selectionBounds} from './geometry';
import {selectedLayers,type DrawingSelection} from './session';
import {NumberField} from './Field';
import DrawingReferenceControls from '../shared/DrawingReferenceControls';
import {useDrawingWorkspace} from './workspace';
import {uiText as t} from '../i18n';
interface Props {domainControls?:ReactNode;open:boolean;setOpen:(open:boolean)=>void;document:DrawingDocument;selection:DrawingSelection;active:string|null;run:DrawingCommandRun;choose:(s:DrawingSelection)=>void;tool:(t:'merge'|'link'|'bind'|'smooth'|'cusp'|'arc')=>void;transform:(kind:'moveX'|'moveY'|'rotate'|'scale'|'mirror'|'mirrorAxis',value:number)=>void;upload:()=>void;moveReference:()=>void;preview:(d:DrawingDocument|null)=>void}
export default function Properties({domainControls,open,setOpen,document:d,selection:s,active,run,choose,tool,transform,upload,moveReference,preview}:Props){
 const {editor,id:workspaceId}=useDrawingWorkspace();
 s={...s,handle:s.handle&&d.curves.some(c=>c.id===s.handle!.curveId)?s.handle:undefined,node:s.node&&d.nodes.some(n=>n.id===s.node)?s.node:undefined};
 const layerIds=selectedLayers(s),multiLayer=layerIds.length>1;
 const ids=s.ids.filter(id=>d.curves.some(c=>c.id===id)),c=ids.length===1?curveById(d,ids[0]):undefined,layer=s.layer?d.layers.find(l=>l.id===s.layer):undefined;
 const node=s.node?d.nodes.find(n=>n.id===s.node):undefined;
 const point=s.handle?curveById(d,s.handle.curveId).handles[s.handle.end]:node?.position,bounds=ids.length?selectionBounds(d,ids):null;
 const group=ids.length&&!s.layer?strokeFor(d,ids[0]):undefined,oneGroup=group&&ids.every(id=>group.segments.some(x=>x.id===id));
 const route=ids.length?displayRouteFor(d,ids[0]):undefined,sharedRoute=!!route&&ids.every(id=>JSON.stringify(displayRouteFor(d,id))===JSON.stringify(route));
 const container=!s.node&&!s.handle&&!s.layer?selectedGroup(d,ids):undefined;
 const disabled=ids.some(id=>curveById(d,id).locked),ref=d.reference;
 const reorder=(where:'up'|'down'|'top'|'bottom')=>run(()=>reorderDrawingSelection(d,{...s,ids},where));
 return <section className="drawing-properties" aria-label={t('绘图属性')}><header><button className="drawing-properties-toggle" aria-expanded={open} aria-controls="drawing-properties-body" onClick={()=>setOpen(!open)}>{open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}<strong>{t('属性')}</strong><span>{t(s.mirrorAxis?'镜像轴':s.displayInterval?'显示区间':s.inkEnd?'笔触端点':s.paint?(d.fills.some(f=>f.id===s.paint)?'填充区域':'偏移跟随'):s.reference?'参考图':s.handle?'控制柄':s.node?'共享端点':multiLayer?'图层多选':layer?'图层':container?'组合':oneGroup&&ids.length>1?'连续笔画':ids.length>1?'多选':'曲线')}</span></button></header>
 <div id="drawing-properties-body" className="drawing-properties-content" hidden={!open}>
 <MirrorEditingControls d={d} ids={ids} nodeId={s.node} run={run}/>
 {domainControls}
 {sharedRoute&&!oneGroup&&<DisplayIntervalControls d={d} id={ids[0]} selection={s} run={run} choose={choose} handledRouteTrackIds={endpointPropertyTracks(d,s).map(track=>track.id)}/>}
 {multiLayer?<>
 <p>{layerIds.length} {t('个图层已选择')}</p>
 <p className="drawing-muted">{d.layers.filter(l=>layerIds.includes(l.id)).map(l=>l.name).join(' · ')}</p>
 {bounds&&<SelectionTransformControls center={bounds.center} disabled={disabled} transform={transform}/>}
 </>:s.mirrorAxis?<NumberField label="镜像轴 X" value={d.mirrorAxisX??0} onChange={x=>run(()=>setMirrorAxis(d,x))}/>:s.paint?<AppearanceControls d={d} selection={s} run={run} choose={choose} preview={preview}/>:s.reference&&ref?<DrawingReferenceControls document={d} current={()=>currentDrawingPresentation(editor.getState().project,workspaceId)} run={run} preview={preview} upload={upload} moveReference={moveReference}/>:<>
 <SelectionNameControls d={d} selection={{...s,ids}} run={run} choose={choose} disabled={disabled}/>
 <CurveControlSelection d={d} selection={s} choose={choose} disabled={disabled}/>
 {oneGroup&&<StrokeNameControl d={d} ids={ids} run={run} disabled={disabled}/>}
 {d.joins.filter(j=>j.mode==='ARC'&&[j.a,j.b].some(e=>ids.includes(e.curveId))&&(!s.node||nodeAt(d,j.a).id===s.node)).map(j=><ArcControls key={j.id} d={d} join={j} run={run} preview={preview}/>)}
 <CurvePointControls d={d} selection={s} run={run} disabled={disabled}/>
 {layer&&!ids.length&&<PaintOrderControls onReorder={reorder}/>}
 {ids.length>0&&<>
 <CurveWidthControl d={d} ids={ids} run={run} disabled={disabled}/>
 <AppearanceControls d={d} selection={s} run={run} choose={choose} preview={preview}/>
 {oneGroup&&<DisplayIntervalControls d={d} id={ids[0]} selection={s} run={run} choose={choose} handledRouteTrackIds={endpointPropertyTracks(d,s).map(track=>track.id)}/>}
 {!point&&bounds&&<SelectionTransformControls center={bounds.center} disabled={disabled} transform={transform}/>}
 <CurveObjectActions d={d} selection={{...s,ids}} run={run} choose={choose} transform={transform} disabled={disabled}/>
 {c&&!s.layer&&!s.group&&<DepthControls d={d} id={c.id} run={run}/>}
 <CurveLayerControl d={d} ids={ids} run={run} disabled={disabled}/>
 {(!c||s.layer||s.group)&&<PaintOrderControls disabled={disabled} onReorder={reorder}/>}
 </>}
 <EndpointPropertyControls d={d} selection={s} run={run} choose={choose} tool={tool}/>
 {!ids.length&&!layer&&<><p>{t('当前绘制层')}：{d.layers.find(l=>l.id===active)?.name??'—'}</p><button onClick={upload}>{t('插入背景图')}</button><p className="drawing-muted">{t('P 连续绘线 · V 选择整笔 · A 编辑节点')}</p></>}
 </>}
 </div>
 </section>;
}
