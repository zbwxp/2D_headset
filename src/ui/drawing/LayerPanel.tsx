import {useDrawingWorkspace} from './workspace';
import PanelSection from '../shared/PanelSection';
import {useState,useEffect,useRef,type ReactNode} from 'react';
import {Eye,EyeOff,PaintBucket,LockKeyhole,Unlock,Plus,Copy,Trash2,ChevronRight,ChevronDown,ChevronsDownUp,ChevronsUpDown,X,Scissors,ClipboardPaste,RotateCcw} from 'lucide-react';
import {curveById,objectById,layerFor,groupFor,type DrawingDocument} from '../../domain/drawing/model';
import {layerChange,curveChange,reorderLayers,setStrokeState} from '../../domain/drawing/commands';
import {objectState,setObjectState} from '../../domain/drawing/objectState';
import {strokeFor,strokeIds,layerTree,strokeName} from '../../domain/drawing/strokes';
import {groupTree,groupObjectIds,selectedGroup,changeGroup,groupToLayer} from '../../domain/drawing/groups';
import {roundedJoins} from '../../domain/drawing/roundedJoin';
import {changePaint,dropPaint} from '../../domain/drawing/paintCommands';
import {fillGeometry,offsetGeometry} from '../../domain/drawing/appearance';
import {selectedObjects,selectedLayers,type DrawingSelection,type DrawingTool} from './session';
import {drawingListRows,selectListRows,selectLayerRows,layerBatchScope} from './listSelection';
import {reorderCurveMember} from '../../domain/drawing/depth';
import {uiText as t,useLanguage} from '../i18n';
import {createDrawingLayer,duplicateDrawingLayers,deleteDrawingSelection} from './layerStructuralCommands';
export interface LayerPanelSection {id:string;name:string;layerIds:string[]}
export function groupedLayerSections(layers:DrawingDocument['layers'],sections:LayerPanelSection[]=[]){
 const remaining=new Set(layers.map(layer=>layer.id));
 const groups:{key:string;section?:LayerPanelSection;layers:DrawingDocument['layers']}[]=[];
 for(const section of sections){const ids=new Set(section.layerIds),members=layers.filter(layer=>remaining.has(layer.id)&&ids.has(layer.id));members.forEach(layer=>remaining.delete(layer.id));groups.push({key:section.id,section,layers:members});}
 const ungrouped=layers.filter(layer=>remaining.has(layer.id));if(ungrouped.length)groups.push({key:'ungrouped',layers:ungrouped});
 return groups;
}
export function layerSectionBatchScope(document:DrawingDocument,section:LayerPanelSection){
 const ids=new Set(section.layerIds);return layerBatchScope({...document,layers:document.layers.filter(layer=>ids.has(layer.id))},[]);
}
export function layerSectionSelectedBatchScope(document:DrawingDocument,section:LayerPanelSection,selectedLayerIds:string[]){
 const ids=new Set(section.layerIds);return layerBatchScope({...document,layers:document.layers.filter(layer=>ids.has(layer.id))},selectedLayerIds.filter(id=>ids.has(id)));
}
export interface LayerPanelCommandAdapter {canEditSection:(section:LayerPanelSection)=>boolean;addLayer:(section:LayerPanelSection)=>void;duplicateLayers:(ids:string[])=>void;deleteLayers:(ids:string[])=>void;deleteSelection:()=>void;canDeleteSelection:boolean;disabledReason?:string}
interface Props {structuralCommands?:LayerPanelCommandAdapter;defaultCollapsedSectionIds?:readonly string[];canEditLayer?:(id:string)=>boolean;fillVisibilityKey?:(id:string)=>string;sectionEmptyContent?:(section:LayerPanelSection)=>ReactNode;emptyContent?:ReactNode;layerSections?:LayerPanelSection[];layerOrder?:Record<string,number>;poseMode?:boolean;structuralReadOnly?:boolean;editEnabled?:boolean;headerActions?:ReactNode;sectionActions?:(section:LayerPanelSection)=>ReactNode;onSectionSelect?:(section:LayerPanelSection,event:React.MouseEvent)=>void;selectedSectionIds?:readonly string[];onVisibilityChange?:(ids:string[],visible:boolean)=>void;onLockChange?:(ids:string[],locked:boolean)=>void;onLayerReorder?:(id:string,target:string,after:boolean)=>void;openProperties:()=>void;closeProperties:()=>void;document:DrawingDocument;active:string|null;selection:DrawingSelection;run:(fn:()=>DrawingDocument)=>void;choose:(selection:DrawingSelection,mode?:DrawingTool)=>void;setLayer:(id:string)=>void;upload:()=>void;deleteSelected:()=>void;cutSelected:()=>void;pasteSelected:()=>void;canPaste:boolean;restoreLayer?:(id:string)=>void}
export default function LayerPanel({openProperties,closeProperties,document:d,active,selection,run,choose,setLayer,upload,deleteSelected,cutSelected,pasteSelected,canPaste,restoreLayer,layerSections,defaultCollapsedSectionIds,layerOrder,poseMode=false,structuralReadOnly=poseMode,editEnabled=true,headerActions,sectionActions,onSectionSelect,selectedSectionIds,onVisibilityChange,onLockChange,onLayerReorder,canEditLayer,fillVisibilityKey=id=>id,sectionEmptyContent,emptyContent,structuralCommands}:Props){
 const {session:useDrawing}=useDrawingWorkspace();
 const zh=useLanguage(s=>s.language)==='zh',sourceOnlyHint=zh?'结构与锁定请在 Drawing 绘制中编辑；此处只记录显隐和图层排序。':'Edit structure and locks in Drawing; Recording changes visibility and layer order.',memberOrderHint=zh?'成员排序属于源结构，请在 Drawing 绘制中调整。':'Edit source member order in Drawing.';
 const [closedSections,setClosedSections]=useState<string[]>(()=>[...(defaultCollapsedSectionIds??[])]),[sectionVisibility,setSectionVisibility]=useState<Record<string,boolean>>({});
 const sections=layerSections??[{id:'$drawing',name:t('图层'),layerIds:d.layers.map(layer=>layer.id)}];
 const seenCollapsedDefaults=useRef(new Set(defaultCollapsedSectionIds??[]));
 useEffect(()=>{const added=(defaultCollapsedSectionIds??[]).filter(id=>!seenCollapsedDefaults.current.has(id));for(const id of added)seenCollapsedDefaults.current.add(id);if(added.length)setClosedSections(ids=>[...new Set([...ids,...added])]);},[defaultCollapsedSectionIds?.join('\0')]);
 const sectionFor=new Map(sections.flatMap(section=>section.layerIds.map(id=>[id,section] as const)));
 const sectionRuns=groupedLayerSections(d.layers,sections);
 const visibleLayers=sectionRuns.flatMap(group=>closedSections.includes(group.section?.id??'')?[]:group.layers);
 const layerDragEnabled=editEnabled&&(!structuralReadOnly||!!onLayerReorder),memberDragEnabled=editEnabled&&!structuralReadOnly;
 const visibilityEnabled=editEnabled&&(!poseMode||!!onVisibilityChange),lockEnabled=editEnabled&&(!structuralReadOnly||!!onLockChange);
 const editableItems=(ids:readonly string[])=>!canEditLayer||ids.every(id=>{const layer=layerFor(d,id);return !!layer&&canEditLayer(layer.id);});
 const editableLayer=(id:string)=>layerDragEnabled&&(!canEditLayer||canEditLayer(id));
 const editableMember=(id:string)=>memberDragEnabled&&editableItems(d.groups?.find(group=>group.id===id)?.curveIds??[id]);
 const changeVisibility=(ids:string[],visible:boolean,fallback:()=>DrawingDocument)=>{if(!visibilityEnabled||!editableItems(ids))return;if(onVisibilityChange)onVisibilityChange(ids,visible);else run(fallback);};
 const changeLocks=(ids:string[],locked:boolean,fallback:()=>DrawingDocument)=>{if(!lockEnabled||!editableItems(ids))return;if(onLockChange)onLockChange(ids,locked);else run(fallback);};
 const closed=useDrawing(s=>s.closedLayers),setClosed=(value:string[]|((ids:string[])=>string[]))=>useDrawing.getState().set({closedLayers:typeof value==='function'?value(useDrawing.getState().closedLayers):value});
 const [drop,setDrop]=useState<{id:string;after:boolean;inside:boolean}|null>(null);
 const showFills=useDrawing(s=>s.showFills),fillVisibility=useDrawing(s=>s.fillVisibility);
 const dragging=useRef<{type:'layer'|'stroke'|'curve';id:string}|null>(null);
 const panel=useRef<HTMLElement>(null),anchor=useRef<string|null>(null),ownSelection=useRef<DrawingSelection|null>(null);
 const rows=drawingListRows({...d,layers:visibleLayers},closed),objects=selectedObjects(selection);
 const batch=layerBatchScope(d,selectedLayers(selection)),scoped=batch.selected.length>0;
 useEffect(()=>{if(selection!==ownSelection.current)anchor.current=null;},[selection]);
 useEffect(()=>{if(selection===ownSelection.current||selectedLayers(selection).length)return;const id=selection.paint??selection.ids[0];if(!id)return;const layer=layerFor(d,id);if(!layer)return;const chain=layerTree(d,layer.id).find(item=>item.stroke?.segments.some(x=>x.id===id)||item.fills.includes(id));const parent=groupFor(d,id);setClosedSections(ids=>ids.filter(id=>id!==sectionFor.get(layer.id)?.id));setClosed(c=>c.filter(id=>id!==layer.id&&id!==chain?.id&&(selection.group===parent?.id||id!==parent?.id)));const timer=setTimeout(()=>{const row=panel.current?.querySelector<HTMLElement>('.drawing-object-row.selected');if(!row)return;const chrome=row.closest('.drawing-layer-section')?.querySelector<HTMLElement>('.drawing-layer-section-chrome');row.style.scrollMarginTop=`${(chrome?.getBoundingClientRect().height??0)+6}px`;row.scrollIntoView({block:'nearest'});},0);return()=>clearTimeout(timer);},[selection]);
 const pick=(key:string,e:React.MouseEvent)=>{
  const toggle=e.ctrlKey||e.metaKey;
  if(key.startsWith('layer:')){
   const id=key.slice(6),result=selectLayerRows(visibleLayers,anchor.current,id,batch.selected,{shift:e.shiftKey,toggle});anchor.current=result.anchor;
   const items=d.layers.filter(l=>result.ids.includes(l.id)).flatMap(l=>l.items);
   const next:DrawingSelection={ids:items.filter(id=>!!curveById(d,id)),paintIds:items.filter(id=>!curveById(d,id)),layers:result.ids,layer:result.ids.length===1?result.ids[0]:undefined};
   ownSelection.current=next;setLayer(id);choose(next);return;
  }
  const result=selectListRows(rows,anchor.current?.startsWith('layer:')?null:anchor.current,key,scoped?[]:objects,{shift:e.shiftKey,toggle});anchor.current=result.anchor;
  const ids=result.ids.filter(id=>curveById(d,id)),paintIds=result.ids.filter(id=>!curveById(d,id)),group=selectedGroup(d,ids)?.id;
  const next:DrawingSelection={ids,paintIds,group,paint:!ids.length&&paintIds.length===1?paintIds[0]:undefined};
  ownSelection.current=next;choose(next,!group&&ids.some(id=>!!groupFor(d,id))?'direct':undefined);
 };
 const toggle=(id:string)=>setClosed(a=>a.includes(id)?a.filter(x=>x!==id):[...a,id]);
 const duplicateBatch=(actionLayers:string[])=>{if(structuralCommands){structuralCommands.duplicateLayers(actionLayers);return;}run(()=>{const result=duplicateDrawingLayers(d,actionLayers);if(result.activeLayerId){setLayer(result.activeLayerId);choose(result.selection);}return result.document;});};
 const deleteBatch=(actionLayers:string[])=>{if(structuralCommands){structuralCommands.deleteLayers(actionLayers);return;}run(()=>{const result=deleteDrawingSelection(d,{ids:[],layers:actionLayers});choose(result.selection);return result.document;});};
 const drag=(e:React.DragEvent,type:'layer'|'stroke'|'curve',id:string)=>{e.stopPropagation();if(type==='layer'?!editableLayer(id):!editableMember(id)){e.preventDefault();return;}dragging.current={type,id};e.dataTransfer.setData('application/x-drawing',JSON.stringify({type,id}));e.dataTransfer.effectAllowed='move';};
 const endDrag=()=>{dragging.current=null;setDrop(null);};
 const over=(e:React.DragEvent,id:string,type:'layer'|'stroke'|'curve')=>{if(type==='layer'?!editableLayer(id):!editableMember(id))return;if(!dragging.current||dragging.current.type==='layer'&&type!=='layer')return;if(dragging.current.type==='curve'&&(type!=='curve'||strokeFor(d,dragging.current.id)!==strokeFor(d,id)))return;if(type==='curve'&&dragging.current.type!=='curve')return;e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='move';const r=e.currentTarget.getBoundingClientRect();setDrop({id,after:e.clientY>r.top+r.height/2,inside:type==='layer'&&dragging.current.type==='stroke'});};
 const dropped=(e:React.DragEvent,type:'layer'|'stroke'|'curve',id:string)=>{e.preventDefault();e.stopPropagation();let from=dragging.current;try{from=JSON.parse(e.dataTransfer.getData('application/x-drawing'));}catch{}endDrag();if(!from||!['layer','stroke','curve'].includes(from.type)||(from.type==='layer'?(!editableLayer(from.id)||!editableLayer(id)):(!editableMember(from.id)||(type==='layer'?!editableLayer(id):!editableMember(id)))))return;
  const source=from,after=e.clientY>e.currentTarget.getBoundingClientRect().top+e.currentTarget.getBoundingClientRect().height/2;
  if(source.type==='curve'){if(type==='curve')run(()=>reorderCurveMember(d,source.id,id,after));return;}
  if(source.type==='layer'){if(type==='layer'){if(onLayerReorder)onLayerReorder(source.id,id,after);else run(()=>reorderLayers(d,source.id,id,after));}return;}
  const target=type==='layer'?id:layerFor(d,d.groups?.find(g=>g.id===id)?.curveIds[0]??id)?.id;if(!target)return;
  run(()=>{const n=dropPaint(d,source.id,target,type==='stroke'?id:undefined,after);if(n!==d){setLayer(target);setClosed(c=>c.filter(x=>x!==target));}return n;});
 };
 const promoteDrop=(e:React.DragEvent)=>{e.preventDefault();e.stopPropagation();const from=dragging.current;endDrag();if(from?.type!=='stroke'||!editableMember(from.id)||!d.groups?.some(g=>g.id===from.id))return;
  run(()=>{const result=groupToLayer(d,from.id);setLayer(result.layerId);choose({ids:d.groups!.find(g=>g.id===from.id)!.curveIds,layer:result.layerId});return result.document;});
 };
 const promoteOver=(e:React.DragEvent)=>{const from=dragging.current;if(from?.type!=='stroke'||!editableMember(from.id)||!d.groups?.some(g=>g.id===from.id))return;e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='move';setDrop({id:'new-layer',inside:true,after:false});};
 const dropClass=(id:string)=>drop?.id===id?(drop.inside?' drop-inside':drop.after?' drop-after':' drop-before'):'';
 const curveRow=(id:string,nested=false)=>{const c=curveById(d,id);return <div title={structuralReadOnly?memberOrderHint:undefined} draggable={nested&&editableMember(id)?true:undefined} onDragStart={nested?e=>drag(e,'curve',id):undefined} onDragOver={nested?e=>over(e,id,'curve'):undefined} onDrop={nested?e=>dropped(e,'curve',id):undefined} onDragEnd={nested?endDrag:undefined} className={`drawing-object-row ${selection.ids.includes(id)?'selected':''}${dropClass(id)}`} data-testid="drawing-curve-row" data-id={id} key={id}>
  <button className="drawing-object-name" onClick={e=>pick(`curve:${id}`,e)}>{c.name}{!!c.depthOffset&&<small>{t('深度')} {c.depthOffset>0?'+':''}{c.depthOffset}</small>}{d.joins.filter(j=>j.mode==='ARC'&&[j.a.curveId,j.b.curveId].includes(id)).map(j=><small key={j.id} className={roundedJoins(d).get(j.id)?.error?'drawing-invalid':''}>{t(roundedJoins(d).get(j.id)?.error?'圆弧无效':'圆弧')}</small>)}</button>
  <button title={t(c.visible?'隐藏':'显示')} aria-label={t(c.visible?'隐藏':'显示')+' '+c.name} disabled={!visibilityEnabled||!editableItems([id])} onClick={()=>changeVisibility([id],!c.visible,()=>curveChange(d,id,{visible:!c.visible}))}>{c.visible?<Eye size={13}/>:<EyeOff size={13}/>}</button>
  <button disabled={!lockEnabled||!editableItems([id])} title={!lockEnabled?sourceOnlyHint:t(c.locked?'解锁':'锁定')} aria-label={t(c.locked?'解锁':'锁定')+' '+c.name} onClick={()=>changeLocks([id],!c.locked,()=>curveChange(d,id,{locked:!c.locked}))}>{c.locked?<LockKeyhole size={13}/>:<Unlock size={13}/>}</button>
 </div>;};
 const paintRow=(id:string)=>{const o=objectById(d,id)!,f=d.fills.find(f=>f.id===id),error=f?fillGeometry(d,f).error:offsetGeometry(d,d.offsets.find(o=>o.id===id)!).error;return <div key={id} className={`drawing-object-row ${objects.includes(id)?'selected':''}${dropClass(id)}`} data-testid="drawing-paint-row" data-id={id} title={structuralReadOnly?memberOrderHint:undefined} draggable={editableMember(id)} onDragStart={e=>drag(e,'stroke',id)} onDragOver={e=>over(e,id,'stroke')} onDrop={e=>dropped(e,'stroke',id)} onDragEnd={endDrag}>
  <button className="drawing-object-name" onClick={e=>pick(`paint:${id}`,e)}>{o.name}<small className={error?'drawing-invalid':''}>{t(error?'无效':f?(f.color==='transparent'?'透明挖空':f.mist?.enabled?'雾化填充':'填充'):'偏移')}</small></button>
  <button aria-label={t(o.visible?'隐藏':'显示')+' '+o.name} disabled={!visibilityEnabled||!editableItems([id])} onClick={()=>changeVisibility([id],!o.visible,()=>changePaint(d,id,{visible:!o.visible}))}>{o.visible?<Eye size={13}/>:<EyeOff size={13}/>}</button>
  <button disabled={!lockEnabled||!editableItems([id])} title={!lockEnabled?sourceOnlyHint:undefined} aria-label={t(o.locked?'解锁':'锁定')+' '+o.name} onClick={()=>changeLocks([id],!o.locked,()=>changePaint(d,id,{locked:!o.locked}))}>{o.locked?<LockKeyhole size={13}/>:<Unlock size={13}/>}</button>
 </div>;};
 const stateButtons=(ids:string[],kind:'layer'|'group'|'chain',name:string,change:(state:{visible?:boolean;locked?:boolean})=>DrawingDocument,visibilityIds=ids,selectedScopeCount=batch.selected.length)=>{
  const state=objectState(d,ids),{anyVisible,allVisible,anyLocked,allLocked}=state;
  const visibility=t(kind==='group'?(anyVisible?'隐藏整组':'显示整组'):kind==='chain'?(anyVisible?'隐藏整笔':'显示整笔'):(anyVisible?'隐藏':'显示'));
  const locking=t(kind==='group'?(allLocked?'解锁整组':'锁定整组'):kind==='chain'?(allLocked?'解锁整笔':'锁定整笔'):(allLocked?'解锁':'锁定'));
  const suffix=kind==='group'?'':' '+name;
  const scopeHint=kind==='layer'&&selectedScopeCount>1?' · '+(zh?'仅批量应用于此快照内所选图层':'Apply only to selected layers in this snapshot'):'';
  return <>
   <button data-testid={`drawing-${kind}-visibility`} disabled={!state.count||!visibilityEnabled||!editableItems(visibilityIds)} aria-label={visibility+suffix} aria-pressed={anyVisible&&!allVisible?'mixed':allVisible} title={(anyVisible&&!allVisible?t('部分显示')+' · ':'')+visibility+' · '+t('批量设置当前成员，之后可单独调整')+scopeHint} onClick={()=>changeVisibility(visibilityIds,!anyVisible,()=>change({visible:!anyVisible}))}>{anyVisible?<Eye size={13}/>:<EyeOff size={13}/>}</button>
   <button data-testid={`drawing-${kind}-lock`} disabled={!state.count||!lockEnabled||!editableItems(visibilityIds)} aria-label={locking+suffix} aria-pressed={anyLocked&&!allLocked?'mixed':allLocked} title={!lockEnabled?sourceOnlyHint:(anyLocked&&!allLocked?t('部分锁定')+' · ':'')+locking+' · '+t('批量设置当前成员，之后可单独调整')+scopeHint} onClick={()=>changeLocks(visibilityIds,!allLocked,()=>change({locked:!allLocked}))}>{allLocked?<LockKeyhole size={13}/>:<Unlock size={13}/>}</button>
  </>;
 };
 const renderItem=(item:ReturnType<typeof layerTree>[number],l:DrawingDocument['layers'][number])=>{const s=item.stroke??{id:item.id,segments:[],closed:false},name=item.stroke?strokeName(d,s):'';return <div key={s.id} className={'drawing-stroke-row'+dropClass(s.id)} data-testid="drawing-stroke-row" data-id={s.id} title={structuralReadOnly?memberOrderHint:undefined} draggable={editableMember(s.id)} onDragStart={e=>drag(e,'stroke',s.id)} onDragOver={e=>over(e,s.id,'stroke')} onDrop={e=>dropped(e,'stroke',s.id)} onDragEnd={endDrag}>
   {!item.stroke?paintRow(item.id):s.segments.length===1&&!curveById(d,s.id).strokeName&&!item.fills.length?curveRow(s.id):<><div className={`drawing-chain-row ${s.segments.every(x=>selection.ids.includes(x.id))?'selected':''}`}><button aria-label={t('展开笔画')} aria-expanded={!closed.includes(s.id)} onClick={()=>toggle(s.id)}>{closed.includes(s.id)?<ChevronRight size={12}/>:<ChevronDown size={12}/>}</button><button className="drawing-object-name" data-testid="drawing-chain-select" onClick={e=>pick(`stroke:${s.id}`,e)}>{t(s.closed?'闭合笔画':'连续笔画')} · {strokeName(d,s)}<small>{s.segments.length}</small></button>
    {stateButtons([...strokeIds(s),...item.fills],'chain',name,change=>setStrokeState(d,s.id,change))}
   </div>{!closed.includes(s.id)&&<div className="drawing-segments">{l.items.filter(id=>s.segments.some(x=>x.id===id)).map(id=>curveRow(id,true))}{item.fills.map(paintRow)}</div>}</>}
  </div>;};
 const renderLayer=(l:DrawingDocument['layers'][number])=>{const section=sectionFor.get(l.id),localBatch=section?layerSectionSelectedBatchScope(d,section,selectedLayers(selection)):batch;return <div className="drawing-layer" key={l.id} data-testid="drawing-layer" data-id={l.id}>
  <div draggable={editableLayer(l.id)} onDragStart={e=>drag(e,'layer',l.id)} onDragOver={e=>over(e,l.id,'layer')} onDrop={e=>dropped(e,'layer',l.id)} onDragEnd={endDrag} className={`drawing-layer-row ${active===l.id?'active':''} ${batch.selected.includes(l.id)?'selected':''}${dropClass(l.id)}`}>
   <button aria-label={t(closed.includes(l.id)?'展开':'收起')+' '+l.name} onClick={()=>toggle(l.id)}>{closed.includes(l.id)?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button>
   <button className="drawing-object-name" data-testid="drawing-layer-select" aria-pressed={batch.selected.includes(l.id)} title={t('Shift 连选图层 · Ctrl/Cmd 增减选择')} onClick={e=>pick(`layer:${l.id}`,e)}>{l.name}</button>{layerOrder?.[l.id]!==undefined&&<small className="drawing-layer-global-order" data-testid="drawing-layer-global-order" title={zh?'场景图层顺序（跨快照）；列表按快照分组。':'Scene layer order across snapshots; this list is grouped by snapshot.'}>{zh?'层序':'Order'} {layerOrder[l.id]}</small>}
   {restoreLayer&&!structuralReadOnly&&<button data-testid="drawing-restore-layer" aria-label={t('从画稿恢复图层')+' '+l.name} title={t('从画稿恢复图层')} onClick={()=>restoreLayer(l.id)}><RotateCcw size={13}/></button>}
   {stateButtons(l.items,'layer',l.name,change=>localBatch.selected.includes(l.id)?setObjectState(d,localBatch.items,change):layerChange(d,l.id,change),localBatch.selected.includes(l.id)?localBatch.items:l.items,localBatch.selected.length)}
  </div>
  {!closed.includes(l.id)&&groupTree(d,l.id).map(entry=>entry.group?<div key={entry.id} className="drawing-object-group" data-testid="drawing-group-row" data-id={entry.id}>
   <div className={`drawing-chain-row ${selection.group===entry.id?'selected':''}${dropClass(entry.id)}`} title={structuralReadOnly?memberOrderHint:undefined} draggable={editableMember(entry.id)} onDragStart={e=>drag(e,'stroke',entry.id)} onDragOver={e=>over(e,entry.id,'stroke')} onDrop={e=>dropped(e,'stroke',entry.id)} onDragEnd={endDrag}>
    <button aria-label={t(closed.includes(entry.id)?'展开':'收起')+' '+entry.group.name} aria-expanded={!closed.includes(entry.id)} onClick={()=>toggle(entry.id)}>{closed.includes(entry.id)?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button>
    <button className="drawing-object-name" data-testid="drawing-group-select" onClick={e=>pick(`group:${entry.id}`,e)}>{entry.group.name}<small>{t('组合')} · {entry.group.curveIds.length}</small></button>
    {stateButtons(groupObjectIds(d,entry.group),'group',entry.group.name,change=>changeGroup(d,entry.id,change))}
   </div>
   {!closed.includes(entry.id)&&<div className="drawing-group-members">{entry.children.map(item=>renderItem(item,l))}</div>}
  </div>:renderItem(entry.item!,l))}
 </div>;};
 const sectionTools=(section:LayerPanelSection)=>{
  const scope=layerSectionSelectedBatchScope(d,section,selectedLayers(selection)),scoped=scope.selected.length>0,state=objectState(d,scope.items),key=`section:${section.id}:${scoped?scope.selected.join('|'):'*'}`;
  const reveal=!state.anyVisible||!state.allVisible&&sectionVisibility[key]===false;
  const fillLayers=scope.layers.filter(layer=>d.fills.some(fill=>layer.items.includes(fill.id))),all=fillLayers.every(layer=>fillVisibility[fillVisibilityKey(layer.id)]??showFills),any=fillLayers.some(layer=>fillVisibility[fillVisibilityKey(layer.id)]??showFills);
  const folded=scope.layers.length>0&&scope.layers.every(layer=>closed.includes(layer.id));
  const visibilityName=t(scoped?(reveal?'显示所选图层':'隐藏所选图层'):(reveal?'显示全部图层':'隐藏全部图层'));
  const fillName=t(scoped?(all?'隐藏所选图层填充':'显示所选图层填充'):(all?'隐藏全部填充':'显示全部填充'));
  const foldName=t(scoped?(folded?'展开所选图层':'收起所选图层'):(folded?'全部展开':'全部收起'));
  const actionLayers=scoped?scope.selected:active&&section.layerIds.includes(active)?[active]:[],structureEnabled=editEnabled&&(!structuralCommands||structuralCommands.canEditSection(section)),structureHint=structureEnabled?undefined:structuralCommands?.disabledReason??sourceOnlyHint;
  return <header className="drawing-layer-section-tools" data-testid="drawing-layer-section-tools" data-section-id={section.id}>
   <button data-testid="drawing-toggle-all" aria-label={visibilityName} aria-pressed={state.anyVisible&&!state.allVisible?'mixed':state.allVisible} title={section.name+' · '+visibilityName+' · '+t('批量设置当前成员，之后可单独调整')} disabled={!state.count||!visibilityEnabled||!editableItems(scope.items)} onClick={()=>{changeVisibility(scope.items,reveal,()=>setObjectState(d,scope.items,{visible:reveal}));setSectionVisibility(value=>({...value,[key]:reveal}));}}>{state.anyVisible?<Eye size={16}/>:<EyeOff size={16}/>}</button>
   <button data-testid="drawing-toggle-fills" className="drawing-fill-toggle" aria-label={fillName} aria-pressed={any&&!all?'mixed':all} title={section.name+' · '+fillName+' · '+t('临时查看线稿，保留各填充自身的显示设置')} disabled={!fillLayers.length} onClick={()=>useDrawing.getState().set(sections.length===1&&!scoped?{showFills:!all,fillVisibility:{}}:{fillVisibility:{...fillVisibility,...Object.fromEntries(scope.layers.map(layer=>[fillVisibilityKey(layer.id),!all]))}})}><PaintBucket size={14}/><span>{t('填充')}</span></button>
   <button data-testid="drawing-collapse-all" aria-label={foldName} title={section.name+' · '+foldName} disabled={!scope.layers.length} onClick={()=>{if(!folded)closeProperties();else setClosedSections(ids=>ids.filter(id=>id!==section.id));setClosed(ids=>folded?ids.filter(id=>!scope.foldIds.includes(id)):[...new Set([...ids,...scope.foldIds])]);}}>{folded?<ChevronsUpDown size={16}/>:<ChevronsDownUp size={16}/>}</button>
   {(!structuralReadOnly||structuralCommands)&&<><button disabled={!structureEnabled} data-testid="drawing-new-layer" className={drop?.id==='new-layer'?'drawing-new-layer-drop':''} aria-label={t('新建图层')} title={structureHint??t('新建图层；拖入组合可转为图层')} onDragOver={structureEnabled?promoteOver:undefined} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setDrop(null);}} onDrop={structureEnabled?promoteDrop:undefined} onClick={()=>{if(!structureEnabled)return;if(structuralCommands){structuralCommands.addLayer(section);return;}run(()=>{const result=createDrawingLayer(d,t('图层')+(d.layers.length+1),active);setLayer(result.activeLayerId!);choose(result.selection);return result.document;});}}><Plus size={16}/></button>
   <button aria-label={t(scoped?'复制所选图层':'复制图层')} title={t(scoped?'复制所选图层':'复制图层')} disabled={!structureEnabled||!actionLayers.length} onClick={()=>duplicateBatch(actionLayers)}><Copy size={14}/></button>
   <button aria-label={t(scoped?'删除所选图层':'删除图层')} title={t(scoped?'删除所选图层':'删除图层')} disabled={!structureEnabled||!actionLayers.length} onClick={()=>deleteBatch(actionLayers)}><Trash2 size={14}/></button></>}
  </header>;
 };
 return <section ref={panel} className="drawing-layers" aria-label={t('绘图图层')}>
 {headerActions&&<div className="drawing-shared-actions" data-testid="drawing-shared-warp-actions"><strong>{t('图层')}</strong>{headerActions}</div>}
 {structuralReadOnly&&<p className="drawing-pose-explanation" data-testid="drawing-pose-explanation">{structuralCommands?(structuralCommands.disabledReason??(zh?'当前真实快照使用绘制工具；来源快照保留独立。':'Drawing tools edit the current real snapshot; source snapshots stay independent.')):sourceOnlyHint}</p>}
 {scoped&&<div className="drawing-layer-scope" data-testid="drawing-layer-scope"><span>{batch.selected.length} {t('个图层已选择')}</span><button aria-label={t('清除图层选择')} title={(zh?'清除选择，各快照工具恢复作用于本快照全部图层':'Clear selection so each snapshot toolbar applies to all of its layers')} onClick={()=>choose({ids:[]})}><X size={12}/></button></div>}

 <div className="drawing-layer-list">
 {sectionRuns.map(run=>run.section?<div className="drawing-layer-section" key={run.key} data-testid="drawing-layer-section" data-section-id={run.section.id}>
  <div className="drawing-layer-section-chrome" data-testid="drawing-layer-section-chrome" data-section-id={run.section.id}>
  <div className={'drawing-layer-section-header'+(selectedSectionIds?.includes(run.section.id)?' selected':'')}><button className={'drawing-layer-section-heading'+(onSectionSelect?' fold-only':'')} data-testid="drawing-layer-section-toggle" aria-label={onSectionSelect?`${closedSections.includes(run.section.id)?(zh?'展开':'Expand'):(zh?'折叠':'Collapse')} ${run.section.name}`:undefined} aria-expanded={!closedSections.includes(run.section.id)} onClick={()=>setClosedSections(ids=>ids.includes(run.section!.id)?ids.filter(id=>id!==run.section!.id):[...ids,run.section!.id])}>
   {closedSections.includes(run.section.id)?<ChevronRight size={13}/>:<ChevronDown size={13}/>} {!onSectionSelect&&<><strong>{run.section.name}</strong><small>{run.layers.length}</small></>}
  </button>{onSectionSelect&&<button className="drawing-layer-section-heading" data-testid="drawing-layer-section-select" data-section-id={run.section.id} aria-pressed={selectedSectionIds?.includes(run.section.id)??false} onClick={event=>onSectionSelect(run.section!,event)}><strong>{run.section.name}</strong><small>{run.layers.length}</small></button>}{sectionActions?.(run.section)}</div>{sectionTools(run.section)}</div>{!closedSections.includes(run.section.id)&&(run.layers.length?run.layers.map(renderLayer):sectionEmptyContent?.(run.section))}
 </div>:run.layers.map(renderLayer))}
 {!d.layers.length&&(emptyContent===undefined?<p className="drawing-empty">{t('新建图层，开始绘制。')}</p>:emptyContent)}
 </div>
 {(!structuralReadOnly||structuralCommands)&&(objects.length>0||scoped||canPaste)&&<PanelSection id="drawing.selection-actions" title={scoped?`${batch.selected.length} ${t('个图层已选择')}`:`${objects.length} ${t('个对象已选择')}`}  className="drawing-list-actions" initial={false}><div className="drawing-clipboard-actions">
  {!structuralReadOnly&&<><button data-testid="drawing-cut-selection" aria-label={t('剪切所选')} title={t('剪切所选')+' · Ctrl/Cmd+X'} disabled={!objects.length} onClick={cutSelected}><Scissors size={14}/></button>
  <button data-testid="drawing-paste-selection" aria-label={t('粘贴到当前图层')} title={t('粘贴到当前图层')+' · Ctrl/Cmd+V'} disabled={!canPaste} onClick={pasteSelected}><ClipboardPaste size={14}/></button></>}
  <button data-testid="drawing-delete-selection" disabled={structuralCommands?!structuralCommands.canDeleteSelection:!objects.length&&!scoped} onClick={structuralCommands?.deleteSelection??deleteSelected}><Trash2 size={14}/>{t('删除所选')}</button>
 </div></PanelSection>}
 {!structuralReadOnly&&<PanelSection id="drawing.reference-row" title="参考图" className="drawing-reference-panel" initial={false}><div className="drawing-reference-row"><button onClick={()=>{openProperties();d.reference?choose({ids:[],reference:true}):upload();}}>{t('参考图')}{d.reference?' · '+d.reference.name:' ＋'}</button>{d.reference&&<><button aria-label={t('显示参考图')} onClick={()=>run(()=>({...d,reference:{...d.reference!,visible:!d.reference!.visible}}))}>{d.reference.visible?<Eye size={13}/>:<EyeOff size={13}/>}</button><button aria-label={t('锁定参考图')} onClick={()=>run(()=>({...d,reference:{...d.reference!,locked:!d.reference!.locked}}))}>{d.reference.locked?<LockKeyhole size={13}/>:<Unlock size={13}/>}</button></>}</div></PanelSection>}
 </section>;
}
