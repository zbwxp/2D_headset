import {useEffect,useRef} from 'react';

export interface TrackedPointer {pointerId:number;button:number;pointerType:string}
interface Callbacks {
 active:()=>TrackedPointer|null;
 move:(event:PointerEvent)=>void;
 finish:(event:PointerEvent|MouseEvent|undefined,interrupted:boolean)=>void;
}
/** Pointer capture is an optimization, not ownership of the editing transaction.
 * Track the initiating pointer at window level so losing native capture cannot
 * discard a valid preview or swallow release outside the canvas. Explicit
 * Escape/Undo cancellation remains the editor's responsibility. */
export function usePointerDragTracking(callbacks:Callbacks){
 const latest=useRef(callbacks);latest.current=callbacks;
 useEffect(()=>{
  const matches=(e:PointerEvent)=>{const p=latest.current.active();return p&&p.pointerId===e.pointerId?p:null;};
  const move=(e:PointerEvent)=>{
   const p=matches(e);if(!p)return;
   const mask=p.button===1?4:p.button===2?2:1;
   // A release outside the browser may not deliver pointerup. Do not apply the
   // re-entry location as another drag sample after the button was released.
   if(!(e.buttons&mask)){latest.current.finish(undefined,false);return;}
   latest.current.move(e);
  };
  const up=(e:PointerEvent)=>{const p=matches(e);if(p&&e.button===p.button)latest.current.finish(e,false);};
  const mouseUp=(e:MouseEvent)=>{const p=latest.current.active();if(p?.pointerType==='mouse'&&e.button===p.button)latest.current.finish(e,false);};
  const cancel=(e:PointerEvent)=>{if(matches(e))latest.current.finish(undefined,true);};
  const blur=()=>{if(latest.current.active())latest.current.finish(undefined,true);};
  const hidden=()=>{if(document.hidden)blur();};
  window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',up,true);
  window.addEventListener('mouseup',mouseUp,true);window.addEventListener('pointercancel',cancel,true);
  window.addEventListener('blur',blur);document.addEventListener('visibilitychange',hidden);
  return()=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('mouseup',mouseUp,true);window.removeEventListener('pointercancel',cancel,true);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',hidden);};
 },[]);
}
