import {useShallow} from 'zustand/react/shallow';
import {useEditor} from '../../app/store';
const project=(s:ReturnType<typeof useEditor.getState>)=>({creating:s.tool.kind==='surfacePoint',centerline:s.tool.kind==='surfacePoint'&&s.tool.centerline});
/** Legacy UI adapter. ToolSession is the only writable authority. */
export const useSurfaceTool=Object.assign(function<T=ReturnType<typeof project>>(selector?:(s:ReturnType<typeof project>)=>T){return useEditor(useShallow(s=>selector?selector(project(s)):project(s) as T));},{
 getState:()=>project(useEditor.getState()),
 setState:(patch:Partial<ReturnType<typeof project>>)=>{const s=useEditor.getState(),v={...project(s),...patch};if(v.creating)s.setTool({kind:'surfacePoint',centerline:v.centerline});else if(s.tool.kind==='surfacePoint')s.cancelTool();},
 subscribe:(fn:()=>void)=>useEditor.subscribe(fn)
});
