import {ownerOf,type GeometryModule} from '../../domain/modules/ownership';
import {isChin} from '../../domain/curves/model';
import {pointId} from '../../domain/chin/model';
import {gazeGuide} from '../../domain/eyes/tracking';
import {create} from 'zustand';
import {useEditor} from '../../app/store';
import {resolveObject,type UIObject} from './objects';
/** Local project display preference, outside geometry JSON/history. Reveal stays transient. */
const storageKey='contour.hidden-system-objects.v1';
const projectKey=()=>String(useEditor.getState().project.meta.createdAt);
function readHidden():Record<string,number>{
 try{const ids=JSON.parse(localStorage.getItem(storageKey)??'{}')[projectKey()];
  if(Array.isArray(ids))return Object.fromEntries(ids.filter(id=>typeof id==='string').map(id=>[id,useEditor.getState().selectionTick]));
 }catch{}return {};
}
export const useObjectVisibility=create<{hidden:Record<string,number>;chinGuides:boolean}>(()=>({hidden:readHidden(),chinGuides:false}));
export const setChinGuides=(chinGuides:boolean)=>useObjectVisibility.setState({chinGuides});
useEditor.subscribe((s,previous)=>{if(s.project.meta.createdAt!==previous.project.meta.createdAt)useObjectVisibility.setState({hidden:readHidden()});});
function saveHidden(hidden:Record<string,number>){
 try{const all=JSON.parse(localStorage.getItem(storageKey)??'{}');localStorage.setItem(storageKey,JSON.stringify({...all,[projectKey()]:Object.keys(hidden)}));}catch{}
}
export function toggleObjectHidden(o:UIObject){
 if(!o.system||o.ref.kind==='frame')return;
 const hidden={...useObjectVisibility.getState().hidden},ids=[o.ref.id,...(o.mirror?[o.mirror.id]:[])];
 if(hidden[o.ref.id]!==undefined)ids.forEach(id=>delete hidden[id]);
 else ids.forEach(id=>hidden[id]=useEditor.getState().selectionTick);
 useObjectVisibility.setState({hidden});saveHidden(hidden);
}
export const moduleHidden=(module:GeometryModule)=>useObjectVisibility.getState().hidden['module:'+module]!==undefined;
export function toggleModuleHidden(module:GeometryModule){
 const s=useEditor.getState();s.endEdit();
 const hidden={...useObjectVisibility.getState().hidden},key='module:'+module;
 if(hidden[key]===undefined)hidden[key]=s.selectionTick;else delete hidden[key];
 useObjectVisibility.setState({hidden});saveHidden(hidden);
 if(hidden[key]!==undefined){s.selectObject(null);s.cancelTool();}
}
export function objectHidden(id:string,includeDerived=true){
 if(moduleHidden(ownerOf(useEditor.getState().project,id)))return true;
 if(includeDerived&&gazeGuide(useEditor.getState().project,id))return true;
 const editor=useEditor.getState();
 if(!useObjectVisibility.getState().chinGuides&&editor.selection?.id!==id){
  const c=editor.project.curves.find(c=>c.id===id),l=editor.project.landmarks.find(l=>l.id===id);
  if(c&&isChin(c)||l?.systemRole?.startsWith('CHIN_')&&id!==pointId('CHIN_M'))return true;
 }
 const hidden=useObjectVisibility.getState().hidden,at=hidden[id];if(at===undefined)return false;
 const s=useEditor.getState(),selected=s.selection?resolveObject(s.project,s.selection):undefined;
 return !(s.selectionTick!==at&&(selected?.ref.id===id||selected?.mirror?.id===id));
}
export function useVisibility(){useObjectVisibility(s=>s.hidden);useObjectVisibility(s=>s.chinGuides);useEditor(s=>s.selectionTick);return objectHidden;}
