import {useShallow} from 'zustand/react/shallow';
import {useEditor} from '../../app/store';
const empty={ids:[] as string[],preview:false,active:false};
const project=(s:ReturnType<typeof useEditor.getState>)=>s.tool.kind==='region'?{ids:s.tool.ids,preview:s.tool.preview,active:true}:empty;
export const useRegionTool=Object.assign(function<T=ReturnType<typeof project>>(selector?:(s:ReturnType<typeof project>)=>T){return useEditor(useShallow(s=>selector?selector(project(s)):project(s) as T));},{
 getState:()=>project(useEditor.getState()),
 setState:(patch:Partial<ReturnType<typeof project>>)=>{const s=useEditor.getState(),v={...project(s),...patch};if(v.active)s.setTool({kind:'region',ids:v.ids,preview:v.preview});else if(s.tool.kind==='region')s.cancelTool();},
 subscribe:(fn:()=>void)=>useEditor.subscribe(fn)
});
export const cancelRegionTool=()=>{if(useEditor.getState().tool.kind==='region')useEditor.getState().cancelTool();};
