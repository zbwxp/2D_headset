import {useEffect} from 'react';
import {useEditor} from '../../app/store';
import {useUI} from '../session';
/** Scroll only sidebar containers; never move the page, camera or keyboard focus. */
function reveal(row:HTMLElement,sidebar:HTMLElement){
 for(let parent=row.parentElement;parent;parent=parent.parentElement){
  if(/auto|scroll/.test(getComputedStyle(parent).overflowY)&&parent.scrollHeight>parent.clientHeight){
   const r=row.getBoundingClientRect(),box=parent.getBoundingClientRect();
   if(r.top<box.top)parent.scrollTop+=r.top-box.top;
   else if(r.bottom>box.bottom)parent.scrollTop+=r.bottom-box.bottom;
  }
  if(parent===sidebar)break;
 }
}
export default function useSidebarSelection(){
 const s=useEditor(),kind=s.patchCreation?'patch':s.curveCreation?'curve':s.selectedPatchId?'patch':s.selectedCurveId?'curve':s.selectedId?'landmark':null;
 const id=kind==='patch'?s.selectedPatchId:kind==='curve'?s.selectedCurveId:s.selectedId;
 const creating=!!s.patchCreation||!!s.curveCreation;
 useEffect(()=>{
  if(!kind)return;
  useUI.setState({landmarkCollapsed:kind!=='landmark',curveCollapsed:kind!=='curve',patchCollapsed:kind!=='patch'});
  let second=0;
  const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{
   if(!id||creating)return;
   const sidebar=document.querySelector<HTMLElement>('.point-sidebar');
   const row=sidebar?.querySelector<HTMLElement>(`[data-pair-primary="${CSS.escape(id)}"], [data-pair-mirror="${CSS.escape(id)}"]`);
   if(row&&sidebar)reveal(row.closest<HTMLElement>('[data-patch-card]')??row,sidebar);
  });});
  return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);};
 },[kind,id,creating,s.selectionTick]);
}
