import {create} from 'zustand';
const storageKey='contour.assembly-drawing-direct-follow';
const valid=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100;
function readStrength(){
 try{const stored=localStorage.getItem(storageKey);if(stored!==null){const value=JSON.parse(stored);if(valid(value))return value;}}catch{/* Storage may be unavailable. */}
 return 40;
}
/** Local tool preference, excluded from artwork, snapshots and Undo. */
export const useDirectPreferences=create<{followPercent:number;setFollowPercent:(value:number)=>void}>(set=>({
 followPercent:readStrength(),
 setFollowPercent(value){if(!valid(value))return;set({followPercent:value});try{localStorage.setItem(storageKey,JSON.stringify(value));}catch{/* Retain the setting for this session. */}}
}));
