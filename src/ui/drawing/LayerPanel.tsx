import {useDrawingWorkspace} from './workspace';
import PanelSection from '../shared/PanelSection';
import {useState,useEffect,useRef,type ReactNode} from 'react';
import {Eye,EyeOff,PaintBucket,LockKeyhole,Unlock,Plus,Copy,Trash2,ChevronRight,ChevronDown,ChevronsDownUp,ChevronsUpDown,X,Scissors,ClipboardPaste,RotateCcw} from 'lucide-react';
import {curveById,objectById,layerFor,groupFor,type DrawingDocument} from '../../domain/drawing/model';
import {addLayer,layerChange,curveChange,duplicateLayer,deleteLayers,reorderLayers,setStrokeState} from '../../domain/drawing/commands';
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
export interface LayerPanelSection {id:string;name:string;layerIds:string[]}
interface Props {layerSections?:LayerPanelSection[];poseMode?:boolean;structuralReadOnly?:boolean;editEnabled?:boolean;headerActions?:ReactNode;onVisibilityChange?:(ids:string[],visible:boolean)=>void;onLayerReorder?:(id:string,target:string,after:boolean)=>void;openProperties:()=>void;closeProperties:()=>void;document:DrawingDocument;active:string|null;selection:DrawingSelection;run:(fn:()=>DrawingDocument)=>void;choose:(selection:DrawingSelection,mode?:DrawingTool)=>void;setLayer:(id:string)=>void;upload:()=>void;deleteSelected:()=>void;cutSelected:()=>void;pasteSelected:()=>void;canPaste:boolean;restoreLayer?:(id:string)=>void}
export default function LayerPanel({openProperties,closeProperties,document:d,active,selection,run,choose,setLayer,upload,deleteSelected,cutSelected,pasteSelected,canPaste,restoreLayer,layerSections,poseMode=false,structuralReadOnly=poseMode,editEnabled=true,headerActions,onVisibilityChange,onLayerReorder}:Props){
 const {session:useDrawing}=useDrawingWorkspace();
 const zh=useLanguage(s=>s.language)==='zh',sourceOnlyHint=zh?'结构与锁定请在 Drawing 绘制中编辑；此处只记录显隐和图层排序。':'Edit structure and locks in Drawing; Recording changes visibility and layer order.',memberOrderHint=zh?'成员排序属于源结构，请在 Drawing 绘制中调整。':'Edit source member order in Drawing.';
 const [closedSections,setClosedSections]=useState<string[]>([]);
 const sectionFor=new Map((layerSections??[]).flatMap(section=>section.layerIds.map(id=>[id,section] as const)));
 const visibleLayers=d.layers.filter(layer=>!closedSections.includes(sectionFor.get(layer.id)?.id??''));
 const layerDragEnabled=editEnabled&&(!structuralReadOnly||!!onLayerReorder),memberDragEnabled=editEnabled&&!structuralReadOnly;
 const visibilityEnabled=editEnabled&&(!poseMode||!!onVisibilityChange);
 const changeVisibility=(ids:string[],visible:boolean,fallback:()=>DrawingDocument)=>{if(!visibilityEnabled)return;if(onVisibilityChange)onVisibilityChange(ids,visible);else run(fallback);};
 const closed=useDrawing(s=>s.closedLayers),setClosed=(value:string[]|((ids:string[])=>string[]))=>useDrawing.getState().set({closedLayers:typeof value==='function'?value(useDrawing.getState().closedLayers):value});
 const [drop,setDrop]=useState<{id:string;after:boolean;inside:boolean}|null>(null);
 const showFills=useDrawing(s=>s.showFills),fillVisibility=useDrawing(s=>s.fillVisibility),[lastVisibility,setLastVisibility]=useState<{scope:string;reveal:boolean}|null>(null);
 const dragging=useRef<{type:'layer'|'stroke'|'curve';id:string}|null>(null);
 const panel=useRef<HTMLElement>(null),anchor=useRef<string|null>(null),ownSelection=useRef<DrawingSelection|null>(null);
 const rows=drawingListRows(closedSections.length?{...d,layers:visibleLayers}:d,closed),objects=selectedObjects(selection);
 const batch=layerBatchScope(d,selectedLayers(selection)),scoped=batch.selected.length>0;
 const allItems=batch.items,allState=objectState(d,allItems),scopeKey=scoped?batch.selected.join('|'):'*';
 // A partial state after hide-all can be restored in one click, per selection scope.
 const revealAll=!allState.anyVisible||!allState.allVisible&&lastVisibility?.scope===scopeKey&&!lastVisibility.reveal;
 const fillLayers=batch.layers.filter(l=>d.fills.some(f=>l.items.includes(f.id)));
 const allFills=fillLayers.every(l=>fillVisibility[l.id]??showFills),anyFills=fillLayers.some(l=>fillVisibility[l.id]??showFills);
 const allClosed=batch.layers.length>0&&batch.layers.every(l=>closed.includes(l.id));
 const visibilityLabel=t(scoped?(revealAll?'显示所选图层':'隐藏所选图层'):(revealAll?'显示全部图层':'隐藏全部图层'));
 const fillLabel=t(scoped?(allFills?'隐藏所选图层填充':'显示所选图层填充'):(allFills?'隐藏全部填充':'显示全部填充'));
 const foldLabel=t(scoped?(allClosed?'展开所选图层':'收起所选图层'):(allClosed?'全部展开':'全部收起'));
 const actionLayers=scoped?batch.selected:active?[active]:[];
 useEffect(()=>{if(selection!==ownSelection.current)anchor.current=null;},[selection]);
 useEffect(()=>{if(selection===ownSelection.current||selectedLayers(selection).length)return;const id=selection.paint??selection.ids[0];if(!id)return;const layer=layerFor(d,id);if(!layer)return;const chain=layerTree(d,layer.id).find(item=>item.stroke?.segments.some(x=>x.id===id)||item.fills.includes(id));const parent=groupFor(d,id);setClosedSections(ids=>ids.filter(id=>id!==sectionFor.get(layer.id)?.id));setClosed(c=>c.filter(id=>id!==layer.id&&id!==chain?.id&&(selection.group===parent?.id||id!==parent?.id)));const timer=setTimeout(()=>panel.current?.querySelector('.drawing-object-row.selected')?.scrollIntoView({block:'nearest'}),0);return()=>clearTimeout(timer);},[selection]);
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
 const foldBatch=()=>{
  if(!allClosed)closeProperties();
  setClosed(a=>allClosed?a.filter(id=>!batch.foldIds.includes(id)):[...new Set([...a,...batch.foldIds])]);
 };
 const duplicateBatch=()=>run(()=>{
  let n=d;const created:string[]=[];
  for(const id of actionLayers){n=duplicateLayer(n,id);const copy=n.layers[0].id;created.push(copy);n=reorderLayers(n,copy,id);}
  const items=n.layers.filter(l=>created.includes(l.id)).flatMap(l=>l.items);
  if(created.length){setLayer(created[0]);choose({layers:created,layer:created.length===1?created[0]:undefined,ids:items.filter(id=>!!curveById(n,id)),paintIds:items.filter(id=>!curveById(n,id))});}
  return n;
 });
 const deleteBatch=()=>run(()=>{const n=deleteLayers(d,actionLayers);choose({ids:[]});return n;});
 const drag=(e:React.DragEvent,type:'layer'|'stroke'|'curve',id:string)=>{e.stopPropagation();if(type==='layer'?!layerDragEnabled:!memberDragEnabled){e.preventDefault();return;}dragging.current={type,id};e.dataTransfer.setData('application/x-drawing',JSON.stringify({type,id}));e.dataTransfer.effectAllowed='move';};
 const endDrag=()=>{dragging.current=null;setDrop(null);};
 const over=(e:React.DragEvent,id:string,type:'layer'|'stroke'|'curve')=>{if(type==='layer'?!layerDragEnabled:!memberDragEnabled)return;if(!dragging.current||dragging.current.type==='layer'&&type!=='layer')return;if(dragging.current.type==='curve'&&(type!=='curve'||strokeFor(d,dragging.current.id)!==strokeFor(d,id)))return;if(type==='curve'&&dragging.current.type!=='curve')return;e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='move';const r=e.currentTarget.getBoundingClientRect();setDrop({id,after:e.clientY>r.top+r.height/2,inside:type==='layer'&&dragging.current.type==='stroke'});};
 const dropped=(e:React.DragEvent,type:'layer'|'stroke'|'curve',id:string)=>{e.preventDefault();e.stopPropagation();let from=dragging.current;try{from=JSON.parse(e.dataTransfer.getData('application/x-drawing'));}catch{}endDrag();if(!from||!['layer','stroke','curve'].includes(from.type)||(from.type==='layer'?!layerDragEnabled:!memberDragEnabled))return;
  const source=from,after=e.clientY>e.currentTarget.getBoundingClientRect().top+e.currentTarget.getBoundingClientRect().height/2;
  if(source.type==='curve'){if(type==='curve')run(()=>reorderCurveMember(d,source.id,id,after));return;}
  if(source.type==='layer'){if(type==='layer'){if(onLayerReorder)onLayerReorder(source.id,id,after);else run(()=>reorderLayers(d,source.id,id,after));}return;}
  const target=type==='layer'?id:layerFor(d,d.groups?.find(g=>g.id===id)?.curveIds[0]??id)?.id;if(!target)return;
  run(()=>{const n=dropPaint(d,source.id,target,type==='stroke'?id:undefined,after);if(n!==d){setLayer(target);setClosed(c=>c.filter(x=>x!==target));}return n;});
 };
 const promoteDrop=(e:React.DragEvent)=>{e.preventDefault();e.stopPropagation();const from=dragging.current;endDrag();if(from?.type!=='stroke'||!d.groups?.some(g=>g.id===from.id))return;
  run(()=>{const result=groupToLayer(d,from.id);setLayer(result.layerId);choose({ids:d.groups!.find(g=>g.id===from.id)!.curveIds,layer:result.layerId});return result.document;});
 };
 const promoteOver=(e:React.DragEvent)=>{const from=dragging.current;if(from?.type!=='stroke'||!d.groups?.some(g=>g.id===from.id))return;e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='move';setDrop({id:'new-layer',inside:true,after:false});};
 const dropClass=(id:string)=>drop?.id===id?(drop.inside?' drop-inside':drop.after?' drop-after':' drop-before'):'';
 const curveRow=(id:string,nested=false)=>{const c=curveById(d,id);return <div title={structuralReadOnly?memberOrderHint:undefined} draggable={nested&&memberDragEnabled?true:undefined} onDragStart={nested?e=>drag(e,'curve',id):undefined} onDragOver={nested?e=>over(e,id,'curve'):undefined} onDrop={nested?e=>dropped(e,'curve',id):undefined} onDragEnd={nested?endDrag:undefined} className={`drawing-object-row ${selection.ids.includes(id)?'selected':''}${dropClass(id)}`} data-testid="drawing-curve-row" data-id={id} key={id}>
  <button className="drawing-object-name" onClick={e=>pick(`curve:${id}`,e)}>{c.name}{!!c.depthOffset&&<small>{t('深度')} {c.depthOffset>0?'+':''}{c.depthOffset}</small>}{d.joins.filter(j=>j.mode==='ARC'&&[j.a.curveId,j.b.curveId].includes(id)).map(j=><small key={j.id} className={roundedJoins(d).get(j.id)?.error?'drawing-invalid':''}>{t(roundedJoins(d).get(j.id)?.error?'圆弧无效':'圆弧')}</small>)}</button>
  <button title={t(c.visible?'隐藏':'显示')} aria-label={t(c.visible?'隐藏':'显示')+' '+c.name} disabled={!visibilityEnabled} onClick={()=>changeVisibility([id],!c.visible,()=>curveChange(d,id,{visible:!c.visible}))}>{c.visible?<Eye size={13}/>:<EyeOff size={13}/>}</button>
  <button disabled={structuralReadOnly||!editEnabled} title={structuralReadOnly?sourceOnlyHint:t(c.locked?'解锁':'锁定')} aria-label={t(c.locked?'解锁':'锁定')+' '+c.name} onClick={()=>run(()=>curveChange(d,id,{locked:!c.locked}))}>{c.locked?<LockKeyhole size={13}/>:<Unlock size={13}/>}</button>
 </div>;};
 const paintRow=(id:string)=>{const o=objectById(d,id)!,f=d.fills.find(f=>f.id===id),error=f?fillGeometry(d,f).error:offsetGeometry(d,d.offsets.find(o=>o.id===id)!).error;return <div key={id} className={`drawing-object-row ${objects.includes(id)?'selected':''}${dropClass(id)}`} data-testid="drawing-paint-row" data-id={id} title={structuralReadOnly?memberOrderHint:undefined} draggable={memberDragEnabled} onDragStart={e=>drag(e,'stroke',id)} onDragOver={e=>over(e,id,'stroke')} onDrop={e=>dropped(e,'stroke',id)} onDragEnd={endDrag}>
  <button className="drawing-object-name" onClick={e=>pick(`paint:${id}`,e)}>{o.name}<small className={error?'drawing-invalid':''}>{t(error?'无效':f?(f.color==='transparent'?'透明挖空':f.mist?.enabled?'雾化填充':'填充'):'偏移')}</small></button>
  <button aria-label={t(o.visible?'隐藏':'显示')+' '+o.name} disabled={!visibilityEnabled} onClick={()=>changeVisibility([id],!o.visible,()=>changePaint(d,id,{visible:!o.visible}))}>{o.visible?<Eye size={13}/>:<EyeOff size={13}/>}</button>
  <button disabled={structuralReadOnly||!editEnabled} title={structuralReadOnly?sourceOnlyHint:undefined} aria-label={t(o.locked?'解锁':'锁定')+' '+o.name} onClick={()=>run(()=>changePaint(d,id,{locked:!o.locked}))}>{o.locked?<LockKeyhole size={13}/>:<Unlock size={13}/>}</button>
 </div>;};
 const stateButtons=(ids:string[],kind:'layer'|'group'|'chain',name:string,change:(state:{visible?:boolean;locked?:boolean})=>DrawingDocument,visibilityIds=ids)=>{
  const state=objectState(d,ids),{anyVisible,allVisible,anyLocked,allLocked}=state;
  const visibility=t(kind==='group'?(anyVisible?'隐藏整组':'显示整组'):kind==='chain'?(anyVisible?'隐藏整笔':'显示整笔'):(anyVisible?'隐藏':'显示'));
  const locking=t(kind==='group'?(allLocked?'解锁整组':'锁定整组'):kind==='chain'?(allLocked?'解锁整笔':'锁定整笔'):(allLocked?'解锁':'锁定'));
  const suffix=kind==='group'?'':' '+name;
  const scopeHint=kind==='layer'&&batch.selected.length>1?' · '+t('选中图层的开关会批量应用于所选图层'):'';
  return <>
   <button data-testid={`drawing-${kind}-visibility`} disabled={!state.count||!visibilityEnabled} aria-label={visibility+suffix} aria-pressed={anyVisible&&!allVisible?'mixed':allVisible} title={(anyVisible&&!allVisible?t('部分显示')+' · ':'')+visibility+' · '+t('批量设置当前成员，之后可单独调整')+scopeHint} onClick={()=>changeVisibility(visibilityIds,!anyVisible,()=>change({visible:!anyVisible}))}>{anyVisible?<Eye size={13}/>:<EyeOff size={13}/>}</button>
   <button data-testid={`drawing-${kind}-lock`} disabled={!state.count||structuralReadOnly||!editEnabled} aria-label={locking+suffix} aria-pressed={anyLocked&&!allLocked?'mixed':allLocked} title={structuralReadOnly?sourceOnlyHint:(anyLocked&&!allLocked?t('部分锁定')+' · ':'')+locking+' · '+t('批量设置当前成员，之后可单独调整')+scopeHint} onClick={()=>run(()=>change({locked:!allLocked}))}>{allLocked?<LockKeyhole size={13}/>:<Unlock size={13}/>}</button>
  </>;
 };
 const renderItem=(item:ReturnType<typeof layerTree>[number],l:DrawingDocument['layers'][number])=>{const s=item.stroke??{id:item.id,segments:[],closed:false},name=item.stroke?strokeName(d,s):'';return <div key={s.id} className={'drawing-stroke-row'+dropClass(s.id)} data-testid="drawing-stroke-row" data-id={s.id} title={structuralReadOnly?memberOrderHint:undefined} draggable={memberDragEnabled} onDragStart={e=>drag(e,'stroke',s.id)} onDragOver={e=>over(e,s.id,'stroke')} onDrop={e=>dropped(e,'stroke',s.id)} onDragEnd={endDrag}>
   {!item.stroke?paintRow(item.id):s.segments.length===1&&!curveById(d,s.id).strokeName&&!item.fills.length?curveRow(s.id):<><div className={`drawing-chain-row ${s.segments.every(x=>selection.ids.includes(x.id))?'selected':''}`}><button aria-label={t('展开笔画')} aria-expanded={!closed.includes(s.id)} onClick={()=>toggle(s.id)}>{closed.includes(s.id)?<ChevronRight size={12}/>:<ChevronDown size={12}/>}</button><button className="drawing-object-name" data-testid="drawing-chain-select" onClick={e=>pick(`stroke:${s.id}`,e)}>{t(s.closed?'闭合笔画':'连续笔画')} · {strokeName(d,s)}<small>{s.segments.length}</small></button>
    {stateButtons([...strokeIds(s),...item.fills],'chain',name,change=>setStrokeState(d,s.id,change))}
   </div>{!closed.includes(s.id)&&<div className="drawing-segments">{l.items.filter(id=>s.segments.some(x=>x.id===id)).map(id=>curveRow(id,true))}{item.fills.map(paintRow)}</div>}</>}
  </div>;};
 const renderLayer=(l:DrawingDocument['layers'][number])=><div className="drawing-layer" key={l.id} data-testid="drawing-layer" data-id={l.id}>
  <div draggable={layerDragEnabled} onDragStart={e=>drag(e,'layer',l.id)} onDragOver={e=>over(e,l.id,'layer')} onDrop={e=>dropped(e,'layer',l.id)} onDragEnd={endDrag} className={`drawing-layer-row ${active===l.id?'active':''} ${batch.selected.includes(l.id)?'selected':''}${dropClass(l.id)}`}>
   <button aria-label={t(closed.includes(l.id)?'展开':'收起')+' '+l.name} onClick={()=>toggle(l.id)}>{closed.includes(l.id)?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button>
   <button className="drawing-object-name" data-testid="drawing-layer-select" aria-pressed={batch.selected.includes(l.id)} title={t('Shift 连选图层 · Ctrl/Cmd 增减选择')} onClick={e=>pick(`layer:${l.id}`,e)}>{l.name}</button>
   {restoreLayer&&!structuralReadOnly&&<button data-testid="drawing-restore-layer" aria-label={t('从画稿恢复图层')+' '+l.name} title={t('从画稿恢复图层')} onClick={()=>restoreLayer(l.id)}><RotateCcw size={13}/></button>}
   {stateButtons(l.items,'layer',l.name,change=>batch.selected.includes(l.id)?setObjectState(d,allItems,change):layerChange(d,l.id,change),batch.selected.includes(l.id)?allItems:l.items)}
  </div>
  {!closed.includes(l.id)&&groupTree(d,l.id).map(entry=>entry.group?<div key={entry.id} className="drawing-object-group" data-testid="drawing-group-row" data-id={entry.id}>
   <div className={`drawing-chain-row ${selection.group===entry.id?'selected':''}${dropClass(entry.id)}`} title={structuralReadOnly?memberOrderHint:undefined} draggable={memberDragEnabled} onDragStart={e=>drag(e,'stroke',entry.id)} onDragOver={e=>over(e,entry.id,'stroke')} onDrop={e=>dropped(e,'stroke',entry.id)} onDragEnd={endDrag}>
    <button aria-label={t(closed.includes(entry.id)?'展开':'收起')+' '+entry.group.name} aria-expanded={!closed.includes(entry.id)} onClick={()=>toggle(entry.id)}>{closed.includes(entry.id)?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button>
    <button className="drawing-object-name" data-testid="drawing-group-select" onClick={e=>pick(`group:${entry.id}`,e)}>{entry.group.name}<small>{t('组合')} · {entry.group.curveIds.length}</small></button>
    {stateButtons(groupObjectIds(d,entry.group),'group',entry.group.name,change=>changeGroup(d,entry.id,change))}
   </div>
   {!closed.includes(entry.id)&&<div className="drawing-group-members">{entry.children.map(item=>renderItem(item,l))}</div>}
  </div>:renderItem(entry.item!,l))}
 </div>;
 const sectionRuns:{key:string;section?:LayerPanelSection;layers:DrawingDocument['layers']}[]=[];
 for(const layer of d.layers){const section=sectionFor.get(layer.id),last=sectionRuns.at(-1);if(last&&last.section?.id===section?.id)last.layers.push(layer);else sectionRuns.push({key:`${section?.id??'layers'}:${layer.id}`,section,layers:[layer]});}
 return <section ref={panel} className="drawing-layers" aria-label={t('绘图图层')}>
 <header><strong>{t('图层')}</strong>
 <button data-testid="drawing-toggle-all" aria-label={visibilityLabel} aria-pressed={allState.anyVisible&&!allState.allVisible?'mixed':allState.allVisible} title={visibilityLabel+' · '+t('批量设置当前成员，之后可单独调整')} disabled={!allState.count||!visibilityEnabled} onClick={()=>{changeVisibility(allItems,revealAll,()=>setObjectState(d,allItems,{visible:revealAll}));setLastVisibility({scope:scopeKey,reveal:revealAll});}}>{allState.anyVisible?<Eye size={16}/>:<EyeOff size={16}/>}</button>
 <button data-testid="drawing-toggle-fills" className="drawing-fill-toggle" aria-label={fillLabel} aria-pressed={anyFills&&!allFills?'mixed':allFills} title={fillLabel+' · '+t('临时查看线稿，保留各填充自身的显示设置')} disabled={!fillLayers.length} onClick={()=>useDrawing.getState().set(scoped?{fillVisibility:{...fillVisibility,...Object.fromEntries(batch.selected.map(id=>[id,!allFills]))}}:{showFills:!allFills,fillVisibility:{}})}><PaintBucket size={14}/><span>{t('填充')}</span></button>
 <button data-testid="drawing-collapse-all" aria-label={foldLabel} title={foldLabel} disabled={!batch.layers.length} onClick={foldBatch}>{allClosed?<ChevronsUpDown size={16}/>:<ChevronsDownUp size={16}/>}</button>
 {!structuralReadOnly&&<><button data-testid="drawing-new-layer" className={drop?.id==='new-layer'?'drawing-new-layer-drop':''} aria-label={t('新建图层')} title={t('新建图层；拖入组合可转为图层')} onDragOver={promoteOver} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setDrop(null);}} onDrop={promoteDrop} onClick={()=>run(()=>{const n=addLayer(d,t('图层')+(d.layers.length+1)),id=n.layers[0].id;setLayer(id);choose({ids:[],layer:id,layers:[id]});return active?reorderLayers(n,id,active):n;})}><Plus size={16}/></button>
 <button aria-label={t(scoped?'复制所选图层':'复制图层')} title={t(scoped?'复制所选图层':'复制图层')} disabled={!actionLayers.length} onClick={duplicateBatch}><Copy size={14}/></button>
 <button aria-label={t(scoped?'删除所选图层':'删除图层')} title={t(scoped?'删除所选图层':'删除图层')} disabled={!actionLayers.length} onClick={deleteBatch}><Trash2 size={14}/></button></>}{headerActions}</header>
 {structuralReadOnly&&<p className="drawing-pose-explanation" data-testid="drawing-pose-explanation">{sourceOnlyHint}</p>}
 {scoped&&<div className="drawing-layer-scope" data-testid="drawing-layer-scope"><span>{batch.selected.length} {t('个图层已选择')}</span><button aria-label={t('清除图层选择')} title={t('清除选择，顶部按钮恢复作用于全部图层')} onClick={()=>choose({ids:[]})}><X size={12}/></button></div>}

 <div className="drawing-layer-list">
 {sectionRuns.map(run=>run.section?<div className="drawing-layer-section" key={run.key} data-testid="drawing-layer-section" data-section-id={run.section.id}>
  <button className="drawing-layer-section-heading" data-testid="drawing-layer-section-toggle" aria-expanded={!closedSections.includes(run.section.id)} onClick={()=>setClosedSections(ids=>ids.includes(run.section!.id)?ids.filter(id=>id!==run.section!.id):[...ids,run.section!.id])}>
   {closedSections.includes(run.section.id)?<ChevronRight size={13}/>:<ChevronDown size={13}/>}<strong>{run.section.name}</strong><small>{run.layers.length}</small>
  </button>{!closedSections.includes(run.section.id)&&run.layers.map(renderLayer)}
 </div>:run.layers.map(renderLayer))}
 {!d.layers.length&&<p className="drawing-empty">{t('新建图层，开始绘制。')}</p>}
 </div>
 {!structuralReadOnly&&(objects.length>0||scoped||canPaste)&&<PanelSection id="drawing.selection-actions" title={scoped?`${batch.selected.length} ${t('个图层已选择')}`:`${objects.length} ${t('个对象已选择')}`}  className="drawing-list-actions" initial={false}><div className="drawing-clipboard-actions">
  <button data-testid="drawing-cut-selection" aria-label={t('剪切所选')} title={t('剪切所选')+' · Ctrl/Cmd+X'} disabled={!objects.length} onClick={cutSelected}><Scissors size={14}/></button>
  <button data-testid="drawing-paste-selection" aria-label={t('粘贴到当前图层')} title={t('粘贴到当前图层')+' · Ctrl/Cmd+V'} disabled={!canPaste} onClick={pasteSelected}><ClipboardPaste size={14}/></button>
  <button data-testid="drawing-delete-selection" disabled={!objects.length&&!scoped} onClick={deleteSelected}><Trash2 size={14}/>{t('删除所选')}</button>
 </div></PanelSection>}
 {!structuralReadOnly&&<PanelSection id="drawing.reference-row" title="参考图" className="drawing-reference-panel" initial={false}><div className="drawing-reference-row"><button onClick={()=>{openProperties();d.reference?choose({ids:[],reference:true}):upload();}}>{t('参考图')}{d.reference?' · '+d.reference.name:' ＋'}</button>{d.reference&&<><button aria-label={t('显示参考图')} onClick={()=>run(()=>({...d,reference:{...d.reference!,visible:!d.reference!.visible}}))}>{d.reference.visible?<Eye size={13}/>:<EyeOff size={13}/>}</button><button aria-label={t('锁定参考图')} onClick={()=>run(()=>({...d,reference:{...d.reference!,locked:!d.reference!.locked}}))}>{d.reference.locked?<LockKeyhole size={13}/>:<Unlock size={13}/>}</button></>}</div></PanelSection>}
 </section>;
}
