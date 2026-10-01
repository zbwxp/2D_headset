import {useEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import type {Point2} from '../../domain/drawing/model';
import {useHairstyle} from './session';
export const clampHairZoom=(z:number)=>Math.max(.1,Math.min(12,z));
type Gesture={pointer:number;element:HTMLElement;startY:number;zoom:number;pan:Point2;anchor:Point2;moved:boolean};
/** Both viewports share navigation. panScale converts viewport pixels to the
 * orbit viewport's pan units so the initial pointer anchor stays stationary. */
export function useHairZoom(enabled:boolean,panScale=1){
 const gesture=useRef<Gesture|null>(null),pending=useRef<{zoom:number;pan:Point2}|null>(null),raf=useRef(0),[out,setOut]=useState(false);
 const flush=()=>{cancelAnimationFrame(raf.current);raf.current=0;if(pending.current){useHairstyle.getState().set(pending.current);pending.current=null;}};
 const finish=(cancel=false)=>{const g=gesture.current;if(!g)return;gesture.current=null;if(cancel){cancelAnimationFrame(raf.current);raf.current=0;pending.current=null;useHairstyle.getState().set({zoom:g.zoom,pan:g.pan});}else flush();if(g.element.hasPointerCapture(g.pointer))g.element.releasePointerCapture(g.pointer);};
 const queue=(g:Gesture,z:number)=>{const zoom=clampHairZoom(z),ratio=zoom/g.zoom;pending.current={zoom,pan:g.anchor.map((v,i)=>v+(g.pan[i]-v)*ratio) as Point2};if(!raf.current)raf.current=requestAnimationFrame(flush);};
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{setOut(e.ctrlKey||e.altKey);if(!gesture.current)return;if(e.key==='Escape'||(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){finish(true);if(e.key!=='Escape'){e.preventDefault();e.stopPropagation();}}};
  const blur=()=>{finish();setOut(false);};
  window.addEventListener('keydown',key,true);window.addEventListener('keyup',key,true);window.addEventListener('blur',blur);
  return()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('keyup',key,true);window.removeEventListener('blur',blur);finish();};
 },[]);
 useEffect(()=>{if(!enabled)finish();},[enabled]);
 const move=(e:ReactPointerEvent<HTMLElement>)=>{const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;e.preventDefault();e.stopPropagation();const dy=g.startY-e.clientY;if(!g.moved&&Math.abs(dy)<2)return;g.moved=true;setOut(dy<0);queue(g,g.zoom*Math.exp(dy*.008));};
 return {out,handlers:{
  onPointerDownCapture:(e:ReactPointerEvent<HTMLElement>)=>{
   if(!enabled||gesture.current||e.button!==0&&!(e.button===2&&e.ctrlKey)||(e.target as Element).closest('button'))return;
   e.preventDefault();e.stopPropagation();const element=e.currentTarget,r=element.getBoundingClientRect(),s=useHairstyle.getState();element.focus({preventScroll:true});element.setPointerCapture(e.pointerId);
   gesture.current={pointer:e.pointerId,element,startY:e.clientY,zoom:s.zoom,pan:[...s.pan],anchor:[(e.clientX-r.left-r.width/2)/panScale,(e.clientY-r.top-r.height/2)/panScale],moved:false};setOut(e.ctrlKey||e.altKey);
  },
  onPointerMoveCapture:move,
  onPointerUpCapture:(e:ReactPointerEvent<HTMLElement>)=>{const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;move(e);if(!g.moved)queue(g,g.zoom*((e.ctrlKey||e.altKey)?1/1.3:1.3));finish();setOut(e.ctrlKey||e.altKey);},
  onPointerCancelCapture:(e:ReactPointerEvent<HTMLElement>)=>{if(gesture.current?.pointer!==e.pointerId)return;e.stopPropagation();finish(true);},
  onLostPointerCaptureCapture:()=>finish()
 }};
}
