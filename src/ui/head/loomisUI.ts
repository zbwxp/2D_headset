import {create} from 'zustand';
import {useEditor} from '../../app/store';
export const useLoomisUI=create<{open:boolean;sidePresets:string[]}>(()=>({open:false,sidePresets:[]}));
export const regionSelection=(s:ReturnType<typeof useEditor.getState>)=>s.selection?.kind==='surface'&&s.selection.source==='REGION'?s.selection.id:null;
export function selectRegion(id:string){useEditor.getState().selectObject({kind:'surface',source:'REGION',id});}
