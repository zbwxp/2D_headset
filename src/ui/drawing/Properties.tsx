import type {ReactNode} from 'react';
import type {DrawingCommandRun} from './endpointInteraction';
import {currentDrawingPresentation} from './snapshotPresentation';
import EndpointLinkBrushInfo from './EndpointLinkBrushInfo';
import {displayRouteFor} from '../../domain/drawing/displayIntervals';
import MirrorEditingControls from './MirrorEditingControls';
import {ChevronDown,ChevronRight} from 'lucide-react';
import PanelSection from '../shared/PanelSection';
import {curveById,layerFor,nodeAt,members,joinAt,type DrawingDocument,type Endpoint,type Point2} from '../../domain/drawing/model';
import {curveChange,layerChange,moveHandle,moveNode,connect,removeJoin,unbind,moveToLayer,widthChange,reorderLayers,duplicateCurves,deleteObjects,renameStroke,unlinkEndpoints,setMirrorAxis} from '../../domain/drawing/commands';
import {strokeFor,strokeName} from '../../domain/drawing/strokes';
import {linksAtNode} from '../../domain/drawing/endpointLinks';
import ArcControls from './ArcControls';
import DepthControls from './DepthControls';
import DisplayIntervalControls from './DisplayIntervalControls';
import AppearanceControls from './AppearanceControls';
import {groupTree,selectedGroup,changeGroup,groupToLayer} from '../../domain/drawing/groups';
import {reorderPaint} from '../../domain/drawing/paintCommands';
import {selectionBounds} from './geometry';
import {selectedObjects,selectedLayers,type DrawingSelection} from './session';
import {NumberField,NameField} from './Field';
import DrawingReferenceControls from '../shared/DrawingReferenceControls';
import {useDrawingWorkspace} from './workspace';
import {uiText as t} from '../i18n';
interface Props {domainControls?:ReactNode;open:boolean;setOpen:(open:boolean)=>void;document:DrawingDocument;selection:DrawingSelection;active:string|null;run:DrawingCommandRun;choose:(s:DrawingSelection)=>void;tool:(t:'merge'|'link'|'bind'|'smooth'|'cusp'|'arc')=>void;transform:(kind:'moveX'|'moveY'|'rotate'|'scale'|'mirror'|'mirrorAxis',value:number)=>void;upload:()=>void;moveReference:()=>void;preview:(d:DrawingDocument|null)=>void}
export default function Properties({domainControls,open,setOpen,document:d,selection:s,active,run,choose,tool,transform,upload,moveReference,preview}:Props){
 const {editor,id:workspaceId}=useDrawingWorkspace();
 s={...s,handle:s.handle&&d.curves.some(c=>c.id===s.handle!.curveId)?s.handle:undefined,node:s.node&&d.nodes.some(n=>n.id===s.node)?s.node:undefined};
 const layerIds=selectedLayers(s),multiLayer=layerIds.length>1;
 const ids=s.ids.filter(id=>d.curves.some(c=>c.id===id)),c=ids.length===1?curveById(d,ids[0]):undefined,layer=s.layer?d.layers.find(l=>l.id===s.layer):undefined;
 const endpoint=s.handle??(s.node?members(d,s.node).find(e=>ids.includes(e.curveId)):undefined),node=s.node?d.nodes.find(n=>n.id===s.node):undefined,j=endpoint?joinAt(d,endpoint):undefined;
 const point=s.handle?curveById(d,s.handle.curveId).handles[s.handle.end]:node?.position,bounds=ids.length?selectionBounds(d,ids):null;
 const group=ids.length&&!s.layer?strokeFor(d,ids[0]):undefined,oneGroup=group&&ids.every(id=>group.segments.some(x=>x.id===id));
 const route=ids.length?displayRouteFor(d,ids[0]):undefined,sharedRoute=!!route&&ids.every(id=>JSON.stringify(displayRouteFor(d,id))===JSON.stringify(route));
 const container=!s.node&&!s.handle&&!s.layer?selectedGroup(d,ids):undefined;
 const disabled=ids.some(id=>curveById(d,id).locked),ref=d.reference;
 function reorder(where:'up'|'down'|'top'|'bottom'){
  if(layer){const index=d.layers.indexOf(layer),target=d.layers[where==='top'?0:where==='bottom'?d.layers.length-1:where==='up'?index-1:index+1];if(target)run(()=>reorderLayers(d,layer.id,target.id,where==='down'||where==='bottom'));return;}
  if(!ids.length)return;const id=ids[0],list=groupTree(d,layerFor(d,id)!.id),current=container??strokeFor(d,id),index=list.findIndex(x=>x.id===current.id),target=list[where==='top'?0:where==='bottom'?list.length-1:where==='up'?index-1:index+1];if(target)run(()=>reorderPaint(d,id,target.id,where==='down'||where==='bottom'));
 }
 return <section className="drawing-properties" aria-label={t('绘图属性')}><header><button className="drawing-properties-toggle" aria-expanded={open} aria-controls="drawing-properties-body" onClick={()=>setOpen(!open)}>{open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}<strong>{t('属性')}</strong><span>{t(s.mirrorAxis?'镜像轴':s.displayInterval?'显示区间':s.inkEnd?'笔触端点':s.paint?(d.fills.some(f=>f.id===s.paint)?'填充区域':'偏移跟随'):s.reference?'参考图':s.handle?'控制柄':s.node?'共享端点':multiLayer?'图层多选':layer?'图层':container?'组合':oneGroup&&ids.length>1?'连续笔画':ids.length>1?'多选':'曲线')}</span></button></header>
 <div id="drawing-properties-body" className="drawing-properties-content" hidden={!open}>
 <MirrorEditingControls d={d} ids={ids} nodeId={s.node} run={run}/>
 {domainControls}
 {sharedRoute&&!oneGroup&&<DisplayIntervalControls d={d} id={ids[0]} selection={s} run={run} choose={choose}/>}
 {multiLayer?<>
 <p>{layerIds.length} {t('个图层已选择')}</p>
 <p className="drawing-muted">{d.layers.filter(l=>layerIds.includes(l.id)).map(l=>l.name).join(' · ')}</p>
 {bounds&&<><div className="drawing-fields"><NumberField label="位置 X" value={bounds.center[0]} disabled={disabled} onChange={v=>transform('moveX',v-bounds.center[0])}/><NumberField label="位置 Y" value={bounds.center[1]} disabled={disabled} onChange={v=>transform('moveY',v-bounds.center[1])}/></div><div className="drawing-fields"><NumberField label="旋转增量 °" value={0} disabled={disabled} onChange={v=>transform('rotate',v)}/><NumberField label="缩放 %" value={100} min={1} max={1000} disabled={disabled} onChange={v=>transform('scale',v/100)}/></div></>}
 </>:s.mirrorAxis?<NumberField label="镜像轴 X" value={d.mirrorAxisX??0} onChange={x=>run(()=>setMirrorAxis(d,x))}/>:s.paint?<AppearanceControls d={d} selection={s} run={run} choose={choose} preview={preview}/>:s.reference&&ref?<DrawingReferenceControls document={d} current={()=>currentDrawingPresentation(editor.getState().project,workspaceId)} run={run} preview={preview} upload={upload} moveReference={moveReference}/>:<>
 {container?<><NameField label="组合名称" value={container.name} disabled={disabled} onChange={name=>run(()=>changeGroup(d,container.id,{name}))}/><p className="drawing-muted">{t('V 选择整组；A 单独编辑成员。列表 Shift 选范围，Ctrl/Cmd 增减选择。')}</p><button data-testid="drawing-group-to-layer" disabled={disabled} onClick={()=>run(()=>{const n=groupToLayer(d,container.id);choose({ids:container.curveIds,layer:n.layerId});return n.document;})}>{t('组合转为图层')}</button></>:layer?<NameField label="图层名称" value={layer.name} onChange={name=>run(()=>layerChange(d,layer.id,{name}))}/>:c?<NameField label="曲线名称" value={c.name} disabled={disabled} onChange={name=>run(()=>curveChange(d,c.id,{name}))}/>:<p>{ids.length?`${ids.length} ${t('条曲线')}`:t('选择或绘制曲线，查看属性。')}</p>}
 {c&&<div className="drawing-control-select" aria-label={t('选择曲线控制点')}>{([0,1] as const).map(end=><div key={end} className="drawing-property-actions">
  <button aria-label={`P${end} ${t('端点')}`} aria-pressed={s.node===c.nodes[end]&&!s.handle} disabled={disabled} onClick={()=>choose({ids:[c.id],node:c.nodes[end]})}>P{end} {t('端点')}</button>
  <button aria-label={`P${end} ${t('控制柄')}`} aria-pressed={s.handle?.curveId===c.id&&s.handle.end===end} disabled={disabled} onClick={()=>choose({ids:[c.id],handle:{curveId:c.id,end}})}>P{end} {t('控制柄')}</button>
 </div>)}</div>}
 {oneGroup&&group&&<label className="drawing-stroke-name">{t('笔画名称')}<NameField label="笔画名称" value={strokeName(d,group)} disabled={group.segments.some(x=>!curveById(d,x.id).visible||curveById(d,x.id).locked)} onChange={name=>run(()=>renameStroke(d,group.id,name))}/></label>}
 {d.joins.filter(j=>j.mode==='ARC'&&[j.a,j.b].some(e=>ids.includes(e.curveId))&&(!s.node||nodeAt(d,j.a).id===s.node)).map(j=><ArcControls key={j.id} d={d} join={j} run={run} preview={preview}/>)}
 {point&&<><div className="drawing-fields">{(['X','Y'] as const).map((axis,i)=><NumberField key={axis} label={'节点 '+axis} value={point[i]} disabled={disabled} onChange={value=>run(()=>{const p=point.map((x,k)=>k===i?value:x) as Point2;return s.handle?moveHandle(d,s.handle,p):moveNode(d,s.node!,p);})}/>)}</div>
 {s.handle&&<NumberField label="控制柄长度" value={Math.hypot(point[0]-nodeAt(d,s.handle).position[0],point[1]-nodeAt(d,s.handle).position[1])} min={.000001} disabled={disabled} onChange={v=>run(()=>{const p=nodeAt(d,s.handle!).position,len=Math.hypot(point[0]-p[0],point[1]-p[1]);if(len<1e-7)throw Error('请先拉出有效 handle，再建立方向约束。');return moveHandle(d,s.handle!,[p[0]+(point[0]-p[0])*v/len,p[1]+(point[1]-p[1])*v/len]);})}/>}</>}
 {layer&&!ids.length&&<div className="drawing-property-actions">{(['top','up','down','bottom'] as const).map((dir,i)=><button key={dir} onClick={()=>reorder(dir)}>{t(['置顶','上移一层','下移一层','置底'][i])}</button>)}</div>}
 {ids.length>0&&<>
 <NumberField label="线宽" value={curveById(d,ids[0]).width*250} min={.25} max={40} disabled={disabled} onChange={v=>run(()=>widthChange(d,ids,v/250))}/>
 <AppearanceControls d={d} selection={s} run={run} choose={choose} preview={preview}/>
 {oneGroup&&<DisplayIntervalControls d={d} id={ids[0]} selection={s} run={run} choose={choose}/>}
 {!point&&bounds&&<><div className="drawing-fields"><NumberField label="位置 X" value={bounds.center[0]} disabled={disabled} onChange={v=>transform('moveX',v-bounds.center[0])}/><NumberField label="位置 Y" value={bounds.center[1]} disabled={disabled} onChange={v=>transform('moveY',v-bounds.center[1])}/></div><div className="drawing-fields"><NumberField label="旋转增量 °" value={0} disabled={disabled} onChange={v=>transform('rotate',v)}/><NumberField label="缩放 %" value={100} min={1} max={1000} disabled={disabled} onChange={v=>transform('scale',v/100)}/></div></>}
 <div className="drawing-property-actions"><button disabled={disabled} onClick={()=>run(()=>{const result=duplicateCurves(d,ids,undefined,[0,0]);choose({ids:result.ids,group:selectedGroup(result.document,result.ids)?.id});return result.document;})} title={t('复制新对象到原位，保留原镜像对应。')}>{t('原位复制')}</button><button disabled={disabled} onClick={()=>transform('mirror',1)}>{t('原地水平翻转')}</button><button data-testid="drawing-mirror-place" disabled={disabled} onClick={()=>transform('mirrorAxis',1)}>{t('按镜像轴移到对侧')}</button><button disabled={disabled} onClick={()=>run(()=>{const n=deleteObjects(d,selectedObjects(s));choose({ids:[]});return n;})}>{t('删除')}</button></div>
 {c&&!s.layer&&!s.group&&<DepthControls d={d} id={c.id} run={run}/>}
 <label className="drawing-field">{t('移动到图层')}<select aria-label={t('移动到图层')} value="" disabled={disabled} onChange={e=>run(()=>moveToLayer(d,ids,e.target.value))}><option value="">—</option>{d.layers.filter(l=>l.id!==layerFor(d,ids[0])?.id).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
 {(!c||s.layer||s.group)&&<div className="drawing-property-actions">{(['top','up','down','bottom'] as const).map((dir,i)=><button key={dir} disabled={disabled} onClick={()=>reorder(dir)}>{t(['置顶','上移一层','下移一层','置底'][i])}</button>)}</div>}
 </>}
 {node&&<PanelSection id="drawing.connection-members" title="连接成员" className="drawing-relations">{members(d,node.id).map(e=><button key={`${e.curveId}:${e.end}`} onClick={()=>choose({ids:[e.curveId],node:node.id})}>{curveById(d,e.curveId).name} · {e.end?'P1':'P0'}</button>)}</PanelSection>}
 {endpoint&&<PanelSection id="drawing.endpoint-links" title="端点联动" className="drawing-relations" testId="drawing-endpoint-link-properties">
 <p className="drawing-muted">{t('几何端点联动只约束位置；下列末端笔触属于列出的实际轮廓。')}</p>
 {linksAtNode(d,nodeAt(d,endpoint).id).map(link=>{const other=nodeAt(d,link.a).id===nodeAt(d,endpoint).id?link.b:link.a;return <div key={link.id} className="drawing-endpoint-link-card" data-testid="drawing-endpoint-link" data-link-id={link.id}><EndpointLinkBrushInfo d={d} link={link}/><div className="drawing-property-actions"><button onClick={()=>choose({ids:[other.curveId],node:nodeAt(d,other).id})}>{curveById(d,other.curveId).name} · P{other.end}</button><button disabled={[link.a,link.b].some(e=>curveById(d,e.curveId).locked)} onClick={()=>run(()=>unlinkEndpoints(d,link.id),{kind:'relation-authoring'})}>{t('解除联动')}</button></div></div>;})}
 <button disabled={disabled} onClick={()=>tool('link')}>{t('联动另一个端点')}</button></PanelSection>}
 {endpoint&&<PanelSection id="drawing.joins" title="本层连接" className="drawing-relations"><span>{t(j?(j.mode==='ARC'?'圆弧接笔':j.mode==='SMOOTH'?'平滑接笔':'尖点接笔'):members(d,nodeAt(d,endpoint).id).length>1?'仅绑定':'未绑定')}</span>
 {linksAtNode(d,nodeAt(d,endpoint).id).length>0&&<p className="drawing-muted">{t('这里只描述本层共享端点的连接；关联末端笔触见上方端点联动。')}</p>}
 {j?.mode==='CUSP'&&<p className="drawing-muted">{t('尖点只影响描边尖角，两侧控制柄独立编辑。')}</p>}
 {j?<><button disabled={disabled} onClick={()=>run(()=>connect(d,j.a,j.b,j.mode==='SMOOTH'?'CUSP':'SMOOTH'))}>{t(j.mode==='SMOOTH'?'改为尖点':'改为平滑')}</button>{j.mode!=='ARC'&&<button disabled={disabled} onClick={()=>run(()=>connect(d,j.a,j.b,'ARC'))}>{t('改为圆弧')}</button>}<button disabled={disabled} onClick={()=>run(()=>removeJoin(d,j.id))}>{t('仅绑定')}</button></>:<div className="drawing-property-actions"><button onClick={()=>tool('smooth')}>{t('平滑接笔')}</button><button onClick={()=>tool('cusp')}>{t('尖点接笔')}</button><button onClick={()=>tool('arc')}>{t('圆弧接笔')}</button></div>}
 {members(d,nodeAt(d,endpoint).id).length>1&&<button disabled={disabled} onClick={()=>run(()=>unbind(d,endpoint),{kind:'node-unbind',endpoint})}>{t('解除此端点绑定')}</button>}
 </PanelSection>}
 {!ids.length&&!layer&&<><p>{t('当前绘制层')}：{d.layers.find(l=>l.id===active)?.name??'—'}</p><button onClick={upload}>{t('插入背景图')}</button><p className="drawing-muted">{t('P 连续绘线 · V 选择整笔 · A 编辑节点')}</p></>}
 </>}
 </div>
 </section>;
}
