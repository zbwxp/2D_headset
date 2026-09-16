import {HELMET} from '../../domain/head/scaffold';
import {useSurfaceTool} from '../head/surfaceTool';
import {useRegionTool} from '../head/regionTool';
import {useLoomisUI} from '../head/loomisUI';
import {isAnalytic} from '../../domain/curves/model';
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
 const surfaceCreating=useSurfaceTool(s=>s.creating),regionCreating=useRegionTool(s=>s.active);
 const regionId=useLoomisUI(s=>s.regionId);
 const s=useEditor(),kind=regionId?'region':s.patchCreation?'patch':s.curveCreation?'curve':s.selectedPatchId?'patch':s.selectedCurveId?'curve':s.selectedId?'landmark':null;
 const id=kind==='region'?regionId:kind==='patch'?s.selectedPatchId:kind==='curve'?s.selectedCurveId:s.selectedId;
 const creating=!!s.patchCreation||!!s.curveCreation;
 useEffect(()=>{
  if(!kind)return;
  const point=s.project.landmarks.find(l=>l.id===id),loomis=id===HELMET||!!regionId||(point?.placement.kind==='ON_LOOMIS_SURFACE'||(point?.placement.kind==="LOOMIS_SCAFFOLD"||point?.placement.kind==='ON_SECTION_CAP'))||!!s.project.curves.find(c=>isAnalytic(c)&&(c.id===id||(point?.placement.kind==='ON_CURVE'&&point.placement.hostCurveId===c.id)));
  useUI.setState({landmarkCollapsed:loomis||kind!=='landmark',curveCollapsed:loomis||kind!=='curve',patchCollapsed:loomis||kind!=='patch'});
  let second=0;
  const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{
   if(!id||creating)return;
   const sidebar=document.querySelector<HTMLElement>('.point-sidebar');
   const row=sidebar?.querySelector<HTMLElement>(`[data-system-id="${CSS.escape(id)}"], [data-region-id="${CSS.escape(id)}"], [data-pair-primary="${CSS.escape(id)}"], [data-pair-mirror="${CSS.escape(id)}"]`);
   if(row&&sidebar)reveal(row.closest<HTMLElement>('[data-loomis-card], [data-patch-card]')??row,sidebar);
  });});
  return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);};
 },[kind,id,creating,s.selectionTick,surfaceCreating,regionCreating]);
}
