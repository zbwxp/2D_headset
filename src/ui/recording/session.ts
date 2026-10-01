import {create} from 'zustand';
import type {View,Point2} from '../../domain/recording/model';
interface Session {room:boolean;view:View;zoom:number;pan:Point2;set:(p:Partial<Session>)=>void;navigate:(v:View)=>void}
export const useRecording=create<Session>(set=>({room:false,view:{yaw:0,pitch:0},zoom:1,pan:[0,0],set:p=>set(p),navigate:v=>set(s=>{const yaw=Math.max(-180,Math.min(180,v.yaw)),pitch=Math.max(-89,Math.min(89,v.pitch));return yaw===s.view.yaw&&pitch===s.view.pitch?s:{view:{yaw,pitch}};})}));
