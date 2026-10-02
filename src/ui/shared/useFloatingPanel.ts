import {useLayoutEffect,useRef,useState,type CSSProperties,type PointerEvent as ReactPointerEvent} from 'react';

type Position={left:number;top:number};
type Layout=Position&{maxHeight:number};
type Drag={pointerId:number;element:HTMLElement;clientX:number;clientY:number;start:Position};
const positions=new Map<string,Position>();
const margin=8;
const interactive='button,input,textarea,select,a,[role="button"],[contenteditable]:not([contenteditable="false"])';

function readPosition(key:string):Position|null {
 const memory=positions.get(key);if(memory)return memory;
 try {
  const value:unknown=JSON.parse(window.localStorage.getItem(key)??'null');
  if(value&&typeof value==='object'&&'left' in value&&'top' in value&&typeof value.left==='number'&&typeof value.top==='number'&&Number.isFinite(value.left)&&Number.isFinite(value.top))return {left:value.left,top:value.top};
 } catch {/* Private browsing and corrupt preferences must not block the panel. */}
 return null;
}

function savePosition(key:string,position:Position){
 const value={left:position.left,top:position.top};positions.set(key,value);
 try {window.localStorage.setItem(key,JSON.stringify(value));} catch {/* Keep the preference for this page when storage is unavailable. */}
}

/** A local UI preference shared by mounted or remounted workspace panels. */
export function useFloatingPanel({open,storageKey}:{open:boolean;storageKey:string}){
 const panelRef=useRef<HTMLElement|null>(null),position=useRef<Layout|null>(null),drag=useRef<Drag|null>(null);
 const [layout,setLayout]=useState<Layout|null>(null);
 const place=(next:Position)=>{
  const panel=panelRef.current;if(!panel)return;
  const rect=panel.getBoundingClientRect(),width=window.innerWidth,height=window.innerHeight;
  const headerHeight=panel.querySelector('header')?.getBoundingClientRect().height||48;
  const left=Math.max(margin,Math.min(next.left,Math.max(margin,width-rect.width-margin)));
  const top=Math.max(margin,Math.min(next.top,Math.max(margin,height-headerHeight-margin)));
  const value={left,top,maxHeight:Math.max(0,height-top-margin)};
  position.current=value;positions.set(storageKey,{left,top});setLayout(value);
 };
 const finish=()=>{
  const current=drag.current;if(!current)return;
  drag.current=null;
  if(position.current)savePosition(storageKey,position.current);
  try {if(current.element.hasPointerCapture(current.pointerId))current.element.releasePointerCapture(current.pointerId);} catch {/* The header may already be detached. */}
 };
 useLayoutEffect(()=>{
  if(!open)return;
  const panel=panelRef.current;if(!panel)return;
  const rect=panel.getBoundingClientRect();place(readPosition(storageKey)??{left:rect.left,top:rect.top});
  const resize=()=>{finish();if(position.current){place(position.current);if(position.current)savePosition(storageKey,position.current);}};
  window.addEventListener('resize',resize);window.addEventListener('blur',finish);
  return()=>{finish();window.removeEventListener('resize',resize);window.removeEventListener('blur',finish);};
 },[open,storageKey]);
 const move=(event:ReactPointerEvent<HTMLElement>)=>{
  const current=drag.current;if(!current||current.pointerId!==event.pointerId)return;
  event.preventDefault();event.stopPropagation();
  place({left:current.start.left+event.clientX-current.clientX,top:current.start.top+event.clientY-current.clientY});
 };
 const stop=(event:ReactPointerEvent<HTMLElement>)=>{if(drag.current?.pointerId===event.pointerId){event.stopPropagation();finish();}};
 const style:CSSProperties=layout?{position:'fixed',left:layout.left,top:layout.top,right:'auto',bottom:'auto',maxHeight:layout.maxHeight}:{};
 return {panelRef,style,headerProps:{
  onPointerDown:(event:ReactPointerEvent<HTMLElement>)=>{
   if(!open||drag.current||event.button!==0||event.isPrimary===false)return;
   const control=(event.target as Element).closest?.(interactive);if(control&&control!==event.currentTarget)return;
   const panel=panelRef.current;if(!panel)return;
   const rect=panel.getBoundingClientRect(),start=position.current??{left:rect.left,top:rect.top};
   event.preventDefault();event.stopPropagation();
   drag.current={pointerId:event.pointerId,element:event.currentTarget,clientX:event.clientX,clientY:event.clientY,start:{left:start.left,top:start.top}};
   try {event.currentTarget.setPointerCapture(event.pointerId);} catch {finish();}
  },
  onPointerMove:(event:ReactPointerEvent<HTMLElement>)=>{if(drag.current?.pointerId!==event.pointerId)return;if(event.buttons===0){finish();return;}move(event);},
  onPointerUp:(event:ReactPointerEvent<HTMLElement>)=>{move(event);stop(event);},
  onPointerCancel:stop,
  onLostPointerCapture:stop,
 }};
}
