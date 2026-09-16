import {create} from 'zustand';
export const useRegionTool=create<{ids:string[];preview:boolean;active:boolean}>(()=>({ids:[],preview:false,active:false}));
export const cancelRegionTool=()=>useRegionTool.setState({ids:[],preview:false,active:false});
