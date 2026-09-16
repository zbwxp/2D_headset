import {create} from 'zustand';
export const useSurfaceTool=create<{creating:boolean;centerline:boolean}>(()=>({creating:false,centerline:false}));
