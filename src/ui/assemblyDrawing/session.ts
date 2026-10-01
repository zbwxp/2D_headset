import type {Dispatch,SetStateAction} from 'react';
import {create} from 'zustand';
import type {Point2,Endpoint} from '../../domain/drawing/model';
import {panAssemblyView} from './view';
export type DrawingTool='deform'|'select'|'direct'|'pen'|'ellipse'|'split'|'mirror'|'merge'|'link'|'bind'|'smooth'|'cusp'|'arc'|'hand'|'zoom';
export interface DrawingSelection {ids:string[];group?:string;displayInterval?:{track:string;range:string;end:0|1};paint?:string;paintIds?:string[];inkEnd?:{id:string;end:0|1};node?:string;handle?:Endpoint;layer?:string;layers?:string[];reference?:boolean;mirrorAxis?:boolean}
export const selectedLayers=(s:DrawingSelection)=>s.layers??(s.layer?[s.layer]:[]);
export const selectedObjects=(s:DrawingSelection)=>[...new Set([...s.ids,...(s.paintIds??[]),...(s.paint?[s.paint]:[])])];
export const assemblyViewDefaults={locatorId:'',planeId:'',overlay:true,folded:false,perspectiveEditing:false,trajectoryMode:'selected' as 'selected'|'all'|'off',trajectoryRequested:false,trajectoryPitch:null as number|null,trajectoryScope:'recorded' as 'recorded'|'full'};
interface Session {viewOptions:typeof assemblyViewDefaults;panelHeight:number;closedLayers:string[];room:boolean;tool:DrawingTool;selection:DrawingSelection;layerId:string|null;zoom:number;pan:Point2;rigPan:Point2;rigViewLocked:boolean;preview:boolean;sidebar:boolean;width:number;penJoin:'POSITION'|'SMOOTH'|'CUSP';showFills:boolean;fillVisibility:Record<string,boolean>;set:(p:Partial<Session>)=>void}
export const createDrawingSession=()=>create<Session>(set=>({viewOptions:assemblyViewDefaults,panelHeight:65,closedLayers:[],room:false,tool:'select',selection:{ids:[]},layerId:null,zoom:1,pan:[0,0],rigPan:[0,0],rigViewLocked:false,preview:false,sidebar:true,width:.008,penJoin:'POSITION',showFills:true,fillVisibility:{},set:p=>set(s=>{
 // Zoom, gesture cancellation and import explicitly supply both origins.
 // Plain viewport pans share their delta only while the alignment is locked.
 return p.pan&&!p.rigPan?{...p,...panAssemblyView(s,p.pan,p.rigViewLocked??s.rigViewLocked)}:p;
})}));

export const useDrawing=createDrawingSession();

export function useAssemblyViewOption<K extends keyof typeof assemblyViewDefaults>(key:K):[typeof assemblyViewDefaults[K],Dispatch<SetStateAction<typeof assemblyViewDefaults[K]>>]{
 const value=useDrawing(s=>s.viewOptions[key]);
 return [value,next=>{const s=useDrawing.getState();s.set({viewOptions:{...s.viewOptions,[key]:typeof next==='function'?next(s.viewOptions[key]):next}});}];
}
