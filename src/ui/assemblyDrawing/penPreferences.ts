import {create} from 'zustand';
import {DEFAULT_PEN_TAPER_SCALE,MAX_PEN_TAPER_SCALE} from '../../domain/drawing/model';

const storageKey='contour.assembly-drawing-pen-taper';
const valid=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=MAX_PEN_TAPER_SCALE;
function readScale(){
 try{const stored=localStorage.getItem(storageKey);if(stored!==null){const value=JSON.parse(stored);if(valid(value))return value;}}catch{/* Use the initial default when storage is unavailable or invalid. */}
 return DEFAULT_PEN_TAPER_SCALE;
}
/** Tool preference only: existing artwork and document Undo are unaffected. */
export const usePenPreferences=create<{taperScale:number;setTaperScale:(value:number)=>void}>(set=>({
 taperScale:readScale(),
 setTaperScale(value){if(!valid(value))return;set({taperScale:value});try{localStorage.setItem(storageKey,JSON.stringify(value));}catch{/* Still usable for this session. */}}
}));
