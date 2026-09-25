import {useState,type ReactNode} from 'react';
import {uiText as t} from '../i18n';

/** One drag session per list; point and curve rows cannot be mixed. */
export default function SortableList<T extends {id:string}>({items,selected,kind,onReorder,children}:{items:T[];selected:string|null;kind:'point'|'curve';onReorder:(id:string,target:string,after:boolean)=>void;children:(item:T)=>ReactNode}){
 const [dragging,setDragging]=useState<string|null>(null),[drop,setDrop]=useState<{id:string;after:boolean}|null>(null);
 const clear=()=>{setDragging(null);setDrop(null);};
 return <div className="recording-list">{items.map(item=><div key={item.id}
  className={[item.id===selected?'active':'',item.id===dragging?'recording-row-dragging':'',drop?.id===item.id?(drop.after?'recording-drop-after':'recording-drop-before'):''].join(' ')}
  data-testid={kind==='point'?'recording-point-row':'recording-row'} data-point-id={kind==='point'?item.id:undefined} data-curve-id={kind==='curve'?item.id:undefined} draggable
  onDragStart={e=>{if((e.target as Element).closest('input,label,button:not([data-recording-list-select])')){e.preventDefault();return;}setDragging(item.id);e.dataTransfer.setData(`application/x-recording-${kind}-id`,item.id);e.dataTransfer.effectAllowed='move';}}
  onDragOver={e=>{if(!dragging)return;e.preventDefault();e.dataTransfer.dropEffect='move';const rect=e.currentTarget.getBoundingClientRect();setDrop(dragging===item.id?null:{id:item.id,after:e.clientY>rect.top+rect.height/2});}}
  onDragLeave={e=>{if(!(e.relatedTarget instanceof Node)||!e.currentTarget.contains(e.relatedTarget))setDrop(null);}}
  onDrop={e=>{if(!dragging)return;e.preventDefault();const rect=e.currentTarget.getBoundingClientRect();onReorder(dragging,item.id,e.clientY>rect.top+rect.height/2);clear();}} onDragEnd={clear}>
  <span className="recording-list-grip" title={t('拖动排序')} aria-hidden="true">⠿</span>
  {children(item)}
 </div>)}</div>;
}
