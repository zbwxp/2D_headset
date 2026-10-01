import {create} from 'zustand';

const storageKey='contour.panel-layout.v1';
function read():Record<string,boolean>{
 try{const value=JSON.parse(localStorage.getItem(storageKey)??'{}');
  return Object.fromEntries(Object.entries(value).filter((entry):entry is [string,boolean]=>typeof entry[1]==='boolean'));
 }catch{return {};}
}
// Workspace preferences never enter the project, snapshots or document history.
const usePanels=create<{open:Record<string,boolean>;setOpen:(id:string,value:boolean)=>void}>(set=>({
 open:read(),setOpen(id,value){set(state=>{const open={...state.open,[id]:value};
  try{localStorage.setItem(storageKey,JSON.stringify(open));}catch{/* Session-only when storage is unavailable. */}
  return {open};
 });}
}));
export function usePanelOpen(id:string,initial=true):[boolean,(value:boolean)=>void]{
 const open=usePanels(s=>s.open[id]??initial),set=usePanels(s=>s.setOpen);
 return [open,value=>set(id,value)];
}
