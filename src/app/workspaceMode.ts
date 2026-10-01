import {create} from 'zustand';
/** Source authoring is a capability. Recording tools and automation share this gate. */
export type WorkspaceMode='drawing'|'recording';
const MODE_KEY='contour.vector-workspace.mode.v1';
const initialMode=():WorkspaceMode=>{try{return localStorage.getItem(MODE_KEY)==='recording'?'recording':'drawing';}catch{return 'drawing';}};
export const useWorkspaceMode=create<{mode:WorkspaceMode;setMode:(mode:WorkspaceMode)=>void}>(set=>({
 mode:initialMode(),setMode(mode){if(typeof window!=='undefined')window.dispatchEvent(new Event('contour:cancel-recording-gesture'));set({mode});try{localStorage.setItem(MODE_KEY,mode);}catch{/* The active editor remains usable without storage. */}},
}));
export const canEditSource=()=>useWorkspaceMode.getState().mode==='drawing';
export function assertSourceEditable(){if(!canEditSource())throw Error('录制模式不能修改源画稿。请先返回绘制模式。');}
