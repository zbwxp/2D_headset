import {create} from 'zustand';
import type {View,Point2} from '../../domain/recording/model';
export type RecordingTool='view'|'edit'|'mirror'|'merge'|'bind'|'point'|'semantic'|'region';
interface Session {room:boolean;view:View;selected:string|null;tool:RecordingTool;first:{id:string;end?:0|3;t?:number}|null;zoom:number;pan:Point2;set:(p:Partial<Session>)=>void;navigate:(v:View)=>void}
export const useRecording=create<Session>(set=>({room:false,view:{yaw:0,pitch:0},selected:null,tool:'edit',first:null,zoom:1,pan:[0,0],set:p=>set(p),navigate:v=>set({view:{yaw:Math.max(-180,Math.min(180,v.yaw)),pitch:Math.max(-89,Math.min(89,v.pitch))},first:null})}));
