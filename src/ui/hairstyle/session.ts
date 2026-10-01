import {create} from 'zustand';
import type {HairView} from '../../domain/hairstyle/projection';
interface Session {room:boolean;workspaceMode:'studio'|'strands';view:HairView;zoom:number;pan:[number,number];mode:'LINE'|'FILL'|'BOTH';guides:boolean;netOverlay:boolean;netOpacity:number;set:(value:Partial<Session>)=>void}
export const useHairstyle=create<Session>(set=>({room:false,workspaceMode:'studio',view:{yaw:0,pitch:0},zoom:1,pan:[0,0],mode:'BOTH',guides:true,netOverlay:true,netOpacity:.45,set:value=>set(value)}));
