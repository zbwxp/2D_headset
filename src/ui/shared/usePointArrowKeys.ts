import {useEffect} from 'react';
import {useEditor} from '../../app/store';
import {arrowAxis} from '../../domain/landmarks/nudge';
import {activeSelection} from '../session';
export function usePointArrowKeys(){useEffect(()=>{
 let held='',timer:ReturnType<typeof setTimeout>|undefined,interval:ReturnType<typeof setInterval>|undefined,mod=1;
 const end=()=>{clearTimeout(timer);clearInterval(interval);if(held){held='';useEditor.getState().endEdit();}};
 const down=(e:KeyboardEvent)=>{
  const t=e.target as HTMLElement,s=useEditor.getState();
  if(e.defaultPrevented||e.isComposing||e.ctrlKey||e.metaKey||!t.closest('[data-authoring-focus="2d"]')||t.closest('input,textarea,button,select,[role="slider"],[contenteditable]:not([contenteditable="false"]),[data-ui-keyboard],[role="dialog"]')||document.querySelector('[aria-modal="true"]')||s.tool.kind!=='select')return;
  const entity=activeSelection(),a=arrowAxis(s.viewId,e.key);if(entity?.kind!=='landmark'||!a)return;
  e.preventDefault();mod=e.altKey?.2:e.shiftKey?5:1;if(held===e.key)return;end();held=e.key;s.beginEdit(true);
  const id=entity.id,view=s.viewId,move=()=>{const current=useEditor.getState();if(current.selectedId!==id||current.viewId!==view){end();return;}current.nudgePoint(id,a.axis,a.sign*.005*mod);};move();timer=setTimeout(()=>{if(held)interval=setInterval(move,60);},300);
 };
 const focus=()=>end();
 const up=(e:KeyboardEvent)=>{if(e.key===held)end();};const visibility=()=>{if(document.hidden)end();};
 document.addEventListener('focusin',focus);window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',end);document.addEventListener('visibilitychange',visibility);
 return()=>{end();document.removeEventListener('focusin',focus);window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',end);document.removeEventListener('visibilitychange',visibility);};
 },[]);}
