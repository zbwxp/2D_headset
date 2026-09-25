import {create} from 'zustand';
import type {Point2,Endpoint} from '../../domain/drawing/model';
export type DrawingTool='select'|'direct'|'pen'|'ellipse'|'split'|'mirror'|'merge'|'link'|'bind'|'smooth'|'cusp'|'arc'|'hand'|'zoom';
export interface DrawingSelection {ids:string[];group?:string;displayInterval?:{track:string;range:string;end:0|1};paint?:string;paintIds?:string[];inkEnd?:{id:string;end:0|1};node?:string;handle?:Endpoint;layer?:string;reference?:boolean;mirrorAxis?:boolean}
export const selectedObjects=(s:DrawingSelection)=>[...new Set([...s.ids,...(s.paintIds??[]),...(s.paint?[s.paint]:[])])];
interface Session {room:boolean;tool:DrawingTool;selection:DrawingSelection;layerId:string|null;zoom:number;pan:Point2;preview:boolean;sidebar:boolean;width:number;penJoin:'POSITION'|'SMOOTH'|'CUSP';showFills:boolean;set:(p:Partial<Session>)=>void}
export const useDrawing=create<Session>(set=>({room:false,tool:'select',selection:{ids:[]},layerId:null,zoom:1,pan:[0,0],preview:false,sidebar:true,width:.008,penJoin:'POSITION',showFills:true,set:p=>set(p)}));
