import {Matrix4,Quaternion,Vector3} from "three";
import {create} from 'zustand';
import type {Vec3} from '../../domain/project/types';
export type PanelId='viewport'|'contour'|'threeD';
export const panelNames:Record<PanelId,string>={viewport:'2D 视角',contour:'Contour',threeD:'3D · 空间检查'};
type Layout={contents:Record<PanelId,PanelId>;viewIds:Partial<Record<PanelId,string>>;visible:Record<PanelId,boolean>;ratios:Record<PanelId,number>};
const defaults:Layout={contents:{viewport:'viewport',contour:'contour',threeD:'threeD'},viewIds:{},visible:{viewport:true,contour:false,threeD:true},ratios:{viewport:1.25,contour:1,threeD:1}};
const key='contour.window-layout.v0415';
function initial():Layout{
 try{const x=JSON.parse(localStorage.getItem(key)??'null');if(x&&Object.keys(panelNames).every(k=>typeof x.visible?.[k]==='boolean'&&Number.isFinite(x.ratios?.[k])&&x.ratios[k]>=.5&&x.ratios[k]<=3)&&Object.values(x.visible).some(Boolean))return {...x,contents:Object.fromEntries(Object.keys(panelNames).map(k=>[k,Object.keys(panelNames).includes(x.contents?.[k])?x.contents[k]:k])) as Record<PanelId,PanelId>,viewIds:x.viewIds??{}};}catch{}
 return structuredClone(defaults);
}
export const useWindows=create<Layout & {setContent:(id:PanelId,content:PanelId)=>void;setView:(id:PanelId,view:string)=>void;toggle:(id:PanelId)=>void;ratio:(id:PanelId,n:number)=>void}>(()=>({
 ...initial(),
 setContent(id,content){useWindows.setState(s=>({contents:{...s.contents,[id]:content}}));save();},
 setView(id,view){useWindows.setState(s=>({viewIds:{...s.viewIds,[id]:view}}));save();},
 toggle(id){const s=useWindows.getState();if(s.visible[id]&&Object.values(s.visible).filter(Boolean).length===1)return;const visible={...s.visible,[id]:!s.visible[id]};useWindows.setState({visible});save();},
 ratio(id,n){if(!Number.isFinite(n))return;useWindows.setState(s=>({ratios:{...s.ratios,[id]:Math.max(.5,Math.min(3,n))}}));save();}
}));
function save(){const {visible,ratios,contents,viewIds}=useWindows.getState();try{localStorage.setItem(key,JSON.stringify({visible,ratios,contents,viewIds}));}catch{}}
// Camera pose is display-only, survives hiding/remounting 3D, and never enters geometry history.
export const useInspectionCamera=create<{perspective:boolean;contourPerspective:boolean;fov:number;position:Vec3;target:Vec3;quaternion:[number,number,number,number]}>(()=>({
 perspective:true,contourPerspective:false,fov:34,position:[3,1.25,4.6],target:[0,0,0],quaternion:new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(3,1.25,4.6),new Vector3(),new Vector3(0,1,0))).toArray()
}));
