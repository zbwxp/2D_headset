import {useSyncExternalStore} from 'react';
import {useEditor} from './store';
/** Heavy consumers publish at most one latest source snapshot per animation frame. */
let snapshot=useEditor.getState().project,frame=0,unsubscribe:(()=>void)|undefined;
const listeners=new Set<()=>void>();
function subscribe(fn:()=>void){listeners.add(fn);if(!unsubscribe){snapshot=useEditor.getState().project;unsubscribe=useEditor.subscribe(s=>{if(s.project===snapshot||frame)return;frame=requestAnimationFrame(()=>{frame=0;snapshot=useEditor.getState().project;listeners.forEach(f=>f());});});}return()=>{listeners.delete(fn);if(!listeners.size){unsubscribe?.();unsubscribe=undefined;cancelAnimationFrame(frame);frame=0;}};}
export const useFrameProject=()=>useSyncExternalStore(subscribe,()=>snapshot);
