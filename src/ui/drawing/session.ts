import {create} from 'zustand';
import type {Point2,Endpoint} from '../../domain/drawing/model';
export type DrawingTool='deform'|'select'|'direct'|'pen'|'ellipse'|'split'|'mirror'|'merge'|'link'|'bind'|'smooth'|'cusp'|'arc'|'hand'|'zoom';
export interface DrawingSelection {ids:string[];group?:string;displayInterval?:{track:string;range:string;end:0|1};paint?:string;paintIds?:string[];inkEnd?:{id:string;end:0|1};node?:string;handle?:Endpoint;layer?:string;layers?:string[];reference?:boolean;mirrorAxis?:boolean}
export const selectedLayers=(s:DrawingSelection)=>s.layers??(s.layer?[s.layer]:[]);
export const selectedObjects=(s:DrawingSelection)=>[...new Set([...s.ids,...(s.paintIds??[]),...(s.paint?[s.paint]:[])])];
interface Session {panelHeight:number;closedLayers:string[];room:boolean;tool:DrawingTool;selection:DrawingSelection;layerId:string|null;zoom:number;pan:Point2;preview:boolean;sidebar:boolean;width:number;penJoin:'POSITION'|'SMOOTH'|'CUSP';showFills:boolean;fillVisibility:Record<string,boolean>;set:(p:Partial<Session>)=>void}
export const createDrawingSession=()=>create<Session>(set=>({panelHeight:65,closedLayers:[],room:false,tool:'select',selection:{ids:[]},layerId:null,zoom:1,pan:[0,0],preview:false,sidebar:true,width:.008,penJoin:'POSITION',showFills:true,fillVisibility:{},set:p=>set(p)}));

export const useDrawing=createDrawingSession();
