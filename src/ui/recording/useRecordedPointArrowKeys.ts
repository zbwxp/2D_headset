import {useEffect,useRef} from 'react';
import {useEditor} from '../../app/store';
import {displayPoint,editRecordedPoint,evaluatePoint} from '../../domain/recording/points';
import type {Point2} from '../../domain/recording/model';
import {useRecording} from './session';

const arrows:Record<string,Point2>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};
/** Repeats share one history entry. Text fields/sliders keep their native keys. */
export function useRecordedPointArrowKeys(blocked:()=>boolean){
 const latest=useRef(blocked);latest.current=blocked;
 useEffect(()=>{
  let held:{key:string;id:string;modifier:number}|null=null,writing=false;
  let timer:ReturnType<typeof setTimeout>|undefined,interval:ReturnType<typeof setInterval>|undefined;
  const end=()=>{clearTimeout(timer);clearInterval(interval);if(held){held=null;useEditor.getState().endEdit();}};
  const move=()=>{
   if(!held||latest.current()){end();return;}
   const s=useRecording.getState(),r=useEditor.getState().project.recording,p=r?.points?.find(p=>p.id===held!.id);
   if(!r||!p||p.locked||s.selected!==p.id||s.tool!=='edit'){end();return;}
   const at=displayPoint(evaluatePoint(p,s.view).position,s.view),axis=arrows[held.key],step=.005*held.modifier;
   const next=editRecordedPoint(r,p.id,s.view,[at[0]+axis[0]*step,at[1]+axis[1]*step]);
   writing=true;try{useEditor.getState().setRecording(next);}finally{writing=false;}
  };
  const down=(e:KeyboardEvent)=>{
   if(held)held.modifier=e.altKey?.2:e.shiftKey?5:1;
   if(e.ctrlKey||e.metaKey||e.key==='Escape'){end();return;}
   if(!arrows[e.key])return;
   const target=e.target instanceof Element?e.target:null,s=useRecording.getState();
   const p=useEditor.getState().project.recording?.points?.find(p=>p.id===s.selected);
   if(e.defaultPrevented||e.isComposing||!target?.closest('[data-testid="recording-room"]')||target.closest('input,textarea,select,[role="slider"],[data-ui-keyboard],[contenteditable]:not([contenteditable="false"]),[role="dialog"],button:not([data-recording-point-select])')||document.querySelector('[aria-modal="true"]')||s.tool!=='edit'||!p||p.locked||latest.current()){end();return;}
   e.preventDefault();
   if(held?.key===e.key||e.repeat&&!held)return;
   end();held={key:e.key,id:p.id,modifier:e.altKey?.2:e.shiftKey?5:1};
   useEditor.getState().beginEdit(true);move();
   timer=setTimeout(()=>{if(held)interval=setInterval(move,60);},300);
  };
  const up=(e:KeyboardEvent)=>{if(e.key===held?.key)end();else if(held)held.modifier=e.altKey?.2:e.shiftKey?5:1;};
  const visibility=()=>{if(document.hidden)end();};
  const unsubscribeSession=useRecording.subscribe((s,prev)=>{if(s.selected!==prev.selected||s.tool!==prev.tool||s.room!==prev.room||s.view!==prev.view)end();});
  const unsubscribeProject=useEditor.subscribe((s,prev)=>{if(!writing&&s.project!==prev.project)end();});
  window.addEventListener('keydown',down,true);window.addEventListener('keyup',up,true);window.addEventListener('blur',end);
  document.addEventListener('focusin',end);document.addEventListener('pointerdown',end,true);document.addEventListener('dragstart',end);document.addEventListener('visibilitychange',visibility);
  return()=>{end();unsubscribeSession();unsubscribeProject();window.removeEventListener('keydown',down,true);window.removeEventListener('keyup',up,true);window.removeEventListener('blur',end);document.removeEventListener('focusin',end);document.removeEventListener('pointerdown',end,true);document.removeEventListener('dragstart',end);document.removeEventListener('visibilitychange',visibility);};
 },[]);
}
