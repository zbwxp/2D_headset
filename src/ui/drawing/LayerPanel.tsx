import {useState,useEffect,useRef} from 'react';
import {Eye,EyeOff,LockKeyhole,Unlock,Plus,Copy,Trash2,ChevronRight,ChevronDown,ChevronsDownUp,Scissors,ClipboardPaste} from 'lucide-react';
import {curveById,objectById,layerFor,groupFor,type DrawingDocument} from '../../domain/drawing/model';
import {addLayer,layerChange,curveChange,duplicateLayer,deleteLayer,reorderLayers,setStrokeState} from '../../domain/drawing/commands';
import {objectState,setObjectState} from '../../domain/drawing/objectState';
import {strokeFor,strokeIds,layerTree,strokeName} from '../../domain/drawing/strokes';
import {groupTree,groupObjectIds,selectedGroup,changeGroup,groupToLayer} from '../../domain/drawing/groups';
import {roundedJoins} from '../../domain/drawing/roundedJoin';
import {changePaint,dropPaint} from '../../domain/drawing/paintCommands';
import {fillGeometry,offsetGeometry} from '../../domain/drawing/appearance';
import {selectedObjects,type DrawingSelection,type DrawingTool} from './session';
import {drawingListRows,selectListRows} from './listSelection';
import {reorderCurveMember} from '../../domain/drawing/depth';
import {uiText as t} from '../i18n';
interface Props {document:DrawingDocument;active:string|null;selection:DrawingSelection;run:(fn:()=>DrawingDocument)=>void;choose:(selection:DrawingSelection,mode?:DrawingTool)=>void;setLayer:(id:string)=>void;upload:()=>void;deleteSelected:()=>void;cutSelected:()=>void;pasteSelected:()=>void;canPaste:boolean}
export default function LayerPanel({document:d,active,selection,run,choose,setLayer,upload,deleteSelected,cutSelected,pasteSelected,canPaste}:Props){
 const [closed,setClosed]=useState<string[]>([]),[drop,setDrop]=useState<{id:string;after:boolean;inside:boolean}|null>(null);
 const dragging=useRef<{type:'layer'|'stroke'|'curve';id:string}|null>(null);
 const panel=useRef<HTMLElement>(null),anchor=useRef<string|null>(null),ownSelection=useRef<DrawingSelection|null>(null);
 const rows=drawingListRows(d,closed),objects=selectedObjects(selection);
 const allItems=d.layers.flatMap(l=>l.items),allState=objectState(d,allItems);
 useEffect(()=>{if(selection!==ownSelection.current)anchor.current=null;},[selection]);
 useEffect(()=>{if(selection===ownSelection.current)return;const id=selection.paint??selection.ids[0];if(!id)return;const layer=layerFor(d,id);if(!layer)return;const chain=layerTree(d,layer.id).find(item=>item.stroke?.segments.some(x=>x.id===id)||item.fills.includes(id));const parent=groupFor(d,id);setClosed(c=>c.filter(id=>id!==layer.id&&id!==chain?.id&&(selection.group===parent?.id||id!==parent?.id)));const timer=setTimeout(()=>panel.current?.querySelector('.drawing-object-row.selected')?.scrollIntoView({block:'nearest'}),0);return()=>clearTimeout(timer);},[selection]);
 const pick=(key:string,e:React.MouseEvent)=>{
  const toggle=e.ctrlKey||e.metaKey,result=selectListRows(rows,anchor.current,key,objects,{shift:e.shiftKey,toggle});anchor.current=result.anchor;
  const ids=result.ids.filter(id=>curveById(d,id)),paintIds=result.ids.filter(id=>!curveById(d,id));
  const group=selectedGroup(d,ids)?.id,layer=!e.shiftKey&&!toggle&&key.startsWith('layer:')?key.slice(6):undefined;
  const next:DrawingSelection={ids,paintIds,group,layer,paint:!ids.length&&paintIds.length===1?paintIds[0]:undefined};
  ownSelection.current=next;if(layer)setLayer(layer);choose(next,!group&&ids.some(id=>!!groupFor(d,id))?'direct':undefined);
 };
 const toggle=(id:string)=>setClosed(a=>a.includes(id)?a.filter(x=>x!==id):[...a,id]);
 const collapseAll=()=>setClosed([...d.layers.flatMap(l=>[l.id,...layerTree(d,l.id).filter(item=>item.stroke).map(item=>item.id)]),...(d.groups??[]).map(g=>g.id)]);
 const drag=(e:React.DragEvent,type:'layer'|'stroke'|'curve',id:string)=>{e.stopPropagation();dragging.current={type,id};e.dataTransfer.setData('application/x-drawing',JSON.stringify({type,id}));e.dataTransfer.effectAllowed='move';};
 const endDrag=()=>{dragging.current=null;setDrop(null);};
 const over=(e:React.DragEvent,id:string,type:'layer'|'stroke'|'curve')=>{if(!dragging.current||dragging.current.type==='layer'&&type!=='layer')return;if(dragging.current.type==='curve'&&(type!=='curve'||strokeFor(d,dragging.current.id)!==strokeFor(d,id)))return;if(type==='curve'&&dragging.current.type!=='curve')return;e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='move';const r=e.currentTarget.getBoundingClientRect();setDrop({id,after:e.clientY>r.top+r.height/2,inside:type==='layer'&&dragging.current.type==='stroke'});};
 const dropped=(e:React.DragEvent,type:'layer'|'stroke'|'curve',id:string)=>{e.preventDefault();e.stopPropagation();let from=dragging.current;try{from=JSON.parse(e.dataTransfer.getData('application/x-drawing'));}catch{}endDrag();if(!from||!['layer','stroke','curve'].includes(from.type))return;
  const source=from,after=e.clientY>e.currentTarget.getBoundingClientRect().top+e.currentTarget.getBoundingClientRect().height/2;
  if(source.type==='curve'){if(type==='curve')run(()=>reorderCurveMember(d,source.id,id,after));return;}
  if(source.type==='layer'){if(type==='layer')run(()=>reorderLayers(d,source.id,id,after));return;}
  const target=type==='layer'?id:layerFor(d,d.groups?.find(g=>g.id===id)?.curveIds[0]??id)?.id;if(!target)return;
  run(()=>{const n=dropPaint(d,source.id,target,type==='stroke'?id:undefined,after);if(n!==d){setLayer(target);setClosed(c=>c.filter(x=>x!==target));}return n;});
 };
 const promoteDrop=(e:React.DragEvent)=>{e.preventDefault();e.stopPropagation();const from=dragging.current;endDrag();if(from?.type!=='stroke'||!d.groups?.some(g=>g.id===from.id))return;
  run(()=>{const result=groupToLayer(d,from.id);setLayer(result.layerId);choose({ids:d.groups!.find(g=>g.id===from.id)!.curveIds,layer:result.layerId});return result.document;});
 };
 const promoteOver=(e:React.DragEvent)=>{const from=dragging.current;if(from?.type!=='stroke'||!d.groups?.some(g=>g.id===from.id))return;e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='move';setDrop({id:'new-layer',inside:true,after:false});};
 const dropClass=(id:string)=>drop?.id===id?(drop.inside?' drop-inside':drop.after?' drop-after':' drop-before'):'';
 const curveRow=(id:string,nested=false)=>{const c=curveById(d,id);return <div draggable={nested?true:undefined} onDragStart={nested?e=>drag(e,'curve',id):undefined} onDragOver={nested?e=>over(e,id,'curve'):undefined} onDrop={nested?e=>dropped(e,'curve',id):undefined} onDragEnd={nested?endDrag:undefined} className={`drawing-object-row ${selection.ids.includes(id)?'selected':''}${dropClass(id)}`} data-testid="drawing-curve-row" data-id={id} key={id}>
  <button className="drawing-object-name" onClick={e=>pick(`curve:${id}`,e)}>{c.name}{!!c.depthOffset&&<small>{t('深度')} {c.depthOffset>0?'+':''}{c.depthOffset}</small>}{d.joins.filter(j=>j.mode==='ARC'&&[j.a.curveId,j.b.curveId].includes(id)).map(j=><small key={j.id} className={roundedJoins(d).get(j.id)?.error?'drawing-invalid':''}>{t(roundedJoins(d).get(j.id)?.error?'圆弧无效':'圆弧')}</small>)}</button>
  <button title={t(c.visible?'隐藏':'显示')} aria-label={t(c.visible?'隐藏':'显示')+' '+c.name} onClick={()=>run(()=>curveChange(d,id,{visible:!c.visible}))}>{c.visible?<Eye size={13}/>:<EyeOff size={13}/>}</button>
  <button title={t(c.locked?'解锁':'锁定')} aria-label={t(c.locked?'解锁':'锁定')+' '+c.name} onClick={()=>run(()=>curveChange(d,id,{locked:!c.locked}))}>{c.locked?<LockKeyhole size={13}/>:<Unlock size={13}/>}</button>
 </div>;};
 const paintRow=(id:string)=>{const o=objectById(d,id)!,f=d.fills.find(f=>f.id===id),error=f?fillGeometry(d,f).error:offsetGeometry(d,d.offsets.find(o=>o.id===id)!).error;return <div key={id} className={`drawing-object-row ${objects.includes(id)?'selected':''}${dropClass(id)}`} data-testid="drawing-paint-row" data-id={id} draggable onDragStart={e=>drag(e,'stroke',id)} onDragOver={e=>over(e,id,'stroke')} onDrop={e=>dropped(e,'stroke',id)} onDragEnd={endDrag}>
  <button className="drawing-object-name" onClick={e=>pick(`paint:${id}`,e)}>{o.name}<small className={error?'drawing-invalid':''}>{t(error?'无效':f?(f.color==='transparent'?'透明挖空':f.mist?.enabled?'雾化填充':'填充'):'偏移')}</small></button>
  <button aria-label={t(o.visible?'隐藏':'显示')+' '+o.name} onClick={()=>run(()=>changePaint(d,id,{visible:!o.visible}))}>{o.visible?<Eye size={13}/>:<EyeOff size={13}/>}</button>
  <button aria-label={t(o.locked?'解锁':'锁定')+' '+o.name} onClick={()=>run(()=>changePaint(d,id,{locked:!o.locked}))}>{o.locked?<LockKeyhole size={13}/>:<Unlock size={13}/>}</button>
 </div>;};
 const stateButtons=(ids:string[],kind:'layer'|'group'|'chain',name:string,change:(state:{visible?:boolean;locked?:boolean})=>DrawingDocument)=>{
  const state=objectState(d,ids),{anyVisible,allVisible,anyLocked,allLocked}=state;
  const visibility=t(kind==='group'?(anyVisible?'隐藏整组':'显示整组'):kind==='chain'?(anyVisible?'隐藏整笔':'显示整笔'):(anyVisible?'隐藏':'显示'));
  const locking=t(kind==='group'?(allLocked?'解锁整组':'锁定整组'):kind==='chain'?(allLocked?'解锁整笔':'锁定整笔'):(allLocked?'解锁':'锁定'));
  const suffix=kind==='group'?'':' '+name;
  return <>
   <button data-testid={`drawing-${kind}-visibility`} disabled={!state.count} aria-label={visibility+suffix} aria-pressed={anyVisible&&!allVisible?'mixed':allVisible} title={(anyVisible&&!allVisible?t('部分显示')+' · ':'')+visibility+' · '+t('批量设置当前成员，之后可单独调整')} onClick={()=>run(()=>change({visible:!anyVisible}))}>{anyVisible?<Eye size={13}/>:<EyeOff size={13}/>}</button>
   <button data-testid={`drawing-${kind}-lock`} disabled={!state.count} aria-label={locking+suffix} aria-pressed={anyLocked&&!allLocked?'mixed':allLocked} title={(anyLocked&&!allLocked?t('部分锁定')+' · ':'')+locking+' · '+t('批量设置当前成员，之后可单独调整')} onClick={()=>run(()=>change({locked:!allLocked}))}>{allLocked?<LockKeyhole size={13}/>:<Unlock size={13}/>}</button>
  </>;
 };
 const renderItem=(item:ReturnType<typeof layerTree>[number],l:DrawingDocument['layers'][number])=>{const s=item.stroke??{id:item.id,segments:[],closed:false},name=item.stroke?strokeName(d,s):'';return <div key={s.id} className={'drawing-stroke-row'+dropClass(s.id)} data-testid="drawing-stroke-row" data-id={s.id} draggable onDragStart={e=>drag(e,'stroke',s.id)} onDragOver={e=>over(e,s.id,'stroke')} onDrop={e=>dropped(e,'stroke',s.id)} onDragEnd={endDrag}>
   {!item.stroke?paintRow(item.id):s.segments.length===1&&!curveById(d,s.id).strokeName&&!item.fills.length?curveRow(s.id):<><div className={`drawing-chain-row ${s.segments.every(x=>selection.ids.includes(x.id))?'selected':''}`}><button aria-label={t('展开笔画')} aria-expanded={!closed.includes(s.id)} onClick={()=>toggle(s.id)}>{closed.includes(s.id)?<ChevronRight size={12}/>:<ChevronDown size={12}/>}</button><button className="drawing-object-name" data-testid="drawing-chain-select" onClick={e=>pick(`stroke:${s.id}`,e)}>{t(s.closed?'闭合笔画':'连续笔画')} · {strokeName(d,s)}<small>{s.segments.length}</small></button>
    {stateButtons([...strokeIds(s),...item.fills],'chain',name,change=>setStrokeState(d,s.id,change))}
   </div>{!closed.includes(s.id)&&<div className="drawing-segments">{l.items.filter(id=>s.segments.some(x=>x.id===id)).map(id=>curveRow(id,true))}{item.fills.map(paintRow)}</div>}</>}
  </div>;};
 return <section ref={panel} className="drawing-layers" aria-label={t('绘图图层')}>
 <header><strong>{t('图层')}</strong>
 <button data-testid="drawing-show-all" aria-label={t('显示全部图层')} title={t('显示全部图层')+' · '+t('批量设置当前成员，之后可单独调整')} disabled={!allState.count||allState.allVisible} onClick={()=>run(()=>setObjectState(d,allItems,{visible:true}))}><Eye size={16}/></button>
 <button data-testid="drawing-hide-all" aria-label={t('隐藏全部图层')} title={t('隐藏全部图层')+' · '+t('批量设置当前成员，之后可单独调整')} disabled={!allState.anyVisible} onClick={()=>run(()=>setObjectState(d,allItems,{visible:false}))}><EyeOff size={16}/></button>
 <button data-testid="drawing-collapse-all" aria-label={t('全部收起')} title={t('全部收起')} disabled={!d.layers.length} onClick={collapseAll}><ChevronsDownUp size={16}/></button><button data-testid="drawing-new-layer" className={drop?.id==='new-layer'?'drawing-new-layer-drop':''} aria-label={t('新建图层')} title={t('新建图层；拖入组合可转为图层')} onDragOver={promoteOver} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setDrop(null);}} onDrop={promoteDrop} onClick={()=>run(()=>{const n=addLayer(d,t('图层')+(d.layers.length+1)),id=n.layers[0].id;setLayer(id);return active?reorderLayers(n,id,active):n;})}><Plus size={16}/></button><button aria-label={t('复制图层')} title={t('复制图层')} disabled={!active} onClick={()=>run(()=>{const n=duplicateLayer(d,active!);setLayer(n.layers[0].id);return n;})}><Copy size={14}/></button><button aria-label={t('删除图层')} title={t('删除图层')} disabled={!active} onClick={()=>run(()=>deleteLayer(d,active!))}><Trash2 size={14}/></button></header>
 <div className="drawing-layer-list">
 {d.layers.map(l=><div className="drawing-layer" key={l.id} data-testid="drawing-layer" data-id={l.id}>
  <div draggable onDragStart={e=>drag(e,'layer',l.id)} onDragOver={e=>over(e,l.id,'layer')} onDrop={e=>dropped(e,'layer',l.id)} onDragEnd={endDrag} className={`drawing-layer-row ${active===l.id?'active':''}${dropClass(l.id)}`}>
   <button aria-label={t(closed.includes(l.id)?'展开':'收起')+' '+l.name} onClick={()=>toggle(l.id)}>{closed.includes(l.id)?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button>
   <button className="drawing-object-name" onClick={e=>pick(`layer:${l.id}`,e)}>{l.name}</button>
   {stateButtons(l.items,'layer',l.name,change=>layerChange(d,l.id,change))}
  </div>
  {!closed.includes(l.id)&&groupTree(d,l.id).map(entry=>entry.group?<div key={entry.id} className="drawing-object-group" data-testid="drawing-group-row" data-id={entry.id}>
   <div className={`drawing-chain-row ${selection.group===entry.id?'selected':''}${dropClass(entry.id)}`} draggable onDragStart={e=>drag(e,'stroke',entry.id)} onDragOver={e=>over(e,entry.id,'stroke')} onDrop={e=>dropped(e,'stroke',entry.id)} onDragEnd={endDrag}>
    <button aria-label={t(closed.includes(entry.id)?'展开':'收起')+' '+entry.group.name} aria-expanded={!closed.includes(entry.id)} onClick={()=>toggle(entry.id)}>{closed.includes(entry.id)?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button>
    <button className="drawing-object-name" data-testid="drawing-group-select" onClick={e=>pick(`group:${entry.id}`,e)}>{entry.group.name}<small>{t('组合')} · {entry.group.curveIds.length}</small></button>
    {stateButtons(groupObjectIds(d,entry.group),'group',entry.group.name,change=>changeGroup(d,entry.id,change))}
   </div>
   {!closed.includes(entry.id)&&<div className="drawing-group-members">{entry.children.map(item=>renderItem(item,l))}</div>}
  </div>:renderItem(entry.item!,l))}
 </div>)}
 {!d.layers.length&&<p className="drawing-empty">{t('新建图层，开始绘制。')}</p>}
 </div>
 {(objects.length>0||canPaste)&&<div className="drawing-list-actions"><span>{objects.length} {t('个对象已选择')}</span><div className="drawing-clipboard-actions">
  <button data-testid="drawing-cut-selection" aria-label={t('剪切所选')} title={t('剪切所选')+' · Ctrl/Cmd+X'} disabled={!objects.length} onClick={cutSelected}><Scissors size={14}/></button>
  <button data-testid="drawing-paste-selection" aria-label={t('粘贴到当前图层')} title={t('粘贴到当前图层')+' · Ctrl/Cmd+V'} disabled={!canPaste} onClick={pasteSelected}><ClipboardPaste size={14}/></button>
  <button data-testid="drawing-delete-selection" disabled={!objects.length} onClick={deleteSelected}><Trash2 size={14}/>{t('删除所选')}</button>
 </div></div>}
 <div className="drawing-reference-row"><button onClick={()=>d.reference?choose({ids:[],reference:true}):upload()}>{t('参考图')}{d.reference?' · '+d.reference.name:' ＋'}</button>{d.reference&&<><button aria-label={t('显示参考图')} onClick={()=>run(()=>({...d,reference:{...d.reference!,visible:!d.reference!.visible}}))}>{d.reference.visible?<Eye size={13}/>:<EyeOff size={13}/>}</button><button aria-label={t('锁定参考图')} onClick={()=>run(()=>({...d,reference:{...d.reference!,locked:!d.reference!.locked}}))}>{d.reference.locked?<LockKeyhole size={13}/>:<Unlock size={13}/>}</button></>}</div>
 </section>;
}
