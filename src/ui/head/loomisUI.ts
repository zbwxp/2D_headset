import {create} from 'zustand';
import {useEditor} from '../../app/store';
export const useLoomisUI=create<{open:boolean;regionId:string|null;sidePresets:string[]}>(()=>({open:false,regionId:null,sidePresets:[]}));
export function selectRegion(id:string){
 if(!useEditor.getState().project.loomisRegions?.some(r=>r.id===id))return;
 useEditor.setState(s=>({selectedId:null,selectedCurveId:null,selectedPatchId:null,selectionTick:s.selectionTick+1}));
 useLoomisUI.setState({regionId:id.replace(/:mirror$/,'')});
}
useEditor.subscribe((s,previous)=>{
 if(s.selectionTick!==previous.selectionTick||!s.project.loomisRegions?.some(r=>r.id===useLoomisUI.getState().regionId))useLoomisUI.setState({regionId:null});
});
