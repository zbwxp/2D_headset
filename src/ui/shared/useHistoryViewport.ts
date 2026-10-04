import {useEffect,useRef,useState} from 'react';
import {useEditor} from '../../app/store';
import {readHistoryViewport,restoreHistoryViewport,subscribeHistoryViewport,writeHistoryViewport,type EditorHistoryContext,type HistoryViewport} from '../../app/editorHistory';

/** A canvas gesture publishes previews synchronously but contributes one entry
 * only on release. Cancel and history restoration cannot record themselves. */
export function useHistoryViewport(key:string,fitBounds:()=>NonNullable<HistoryViewport['bounds']>){
 const [value,setValue]=useState<HistoryViewport>(()=>readHistoryViewport(key)??{zoom:1,pan:[0,0],bounds:fitBounds()});
 const latest=useRef(value),gesture=useRef<{before:HistoryViewport;context:EditorHistoryContext}|null>(null);
 const update=(patch:Partial<HistoryViewport>)=>{const next={...latest.current,...patch};latest.current=next;writeHistoryViewport(key,next);setValue(next);};
 useEffect(()=>{
  const restored=readHistoryViewport(key);if(restored){latest.current=restored;setValue(restored);}else writeHistoryViewport(key,latest.current);
  return subscribeHistoryViewport(key,next=>{gesture.current=null;latest.current=next;setValue(next);});
 },[key]);
 function begin(){gesture.current={before:latest.current,context:useEditor.getState().captureHistoryContext()};}
 function finish(){
  const current=gesture.current;gesture.current=null;if(!current)return;
  const after=latest.current;
  if(JSON.stringify(current.before)===JSON.stringify(after))return;
  useEditor.getState().commitWorkspaceEdit({kind:'viewport',undo:()=>restoreHistoryViewport(key,current.before),redo:()=>restoreHistoryViewport(key,after)},current.context);
 }
 function cancel(){const current=gesture.current;gesture.current=null;if(current)restoreHistoryViewport(key,current.before);}
 return {...value,bounds:value.bounds!,setPan:(pan:HistoryViewport['pan'])=>update({pan}),setZoom:(zoom:number)=>update({zoom}),setBounds:(bounds:HistoryViewport['bounds'])=>update({bounds}),
  beginViewportGesture:begin,commitViewportGesture:finish,cancelViewportGesture:cancel,
  commitViewportChange:(change:()=>void)=>{begin();change();finish();}};
}
