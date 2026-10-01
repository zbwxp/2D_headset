import {uid,curveById,objectById,layerFor,groupFor,editable,type DrawingDocument as Doc,type DrawingGroup} from './model';
import {setObjectState} from './objectState';
import {strokeIds,strokeFor,strokeObjectIds,layerTree} from './strokes';

/** Complete containers include hidden geometry. Visibility never becomes an inherited edit lock. */
export const transformable=(d:Doc,id:string,ids:string[])=>{
 if(editable(d,id))return true;const c=curveById(d,id);if(!c||c.locked)return false;
 const g=groupFor(d,id),layer=layerFor(d,id),members=layer?.items.filter(id=>curveById(d,id));
 return !!g&&g.curveIds.every(id=>ids.includes(id))||!!members?.length&&members.every(id=>ids.includes(id));
};
/** V selection operates on a group, or on one continuous stroke when ungrouped. */
export const selectionUnit=(d:Doc,id:string)=>groupFor(d,id)?.curveIds??strokeIds(strokeFor(d,id));
export const expandGroups=(d:Doc,ids:string[])=>[...new Set(ids.flatMap(id=>selectionUnit(d,id)))];
export const selectedGroup=(d:Doc,ids:string[])=>d.groups?.find(g=>g.curveIds.length===ids.length&&g.curveIds.every(id=>ids.includes(id)));
export const groupObjectIds=(d:Doc,g:DrawingGroup)=>{const ids=new Set([...new Set(g.curveIds.map(id=>strokeFor(d,id)))].flatMap(s=>strokeObjectIds(d,s)));return d.layers.flatMap(l=>l.items).filter(id=>ids.has(id)||groupFor(d,id)?.id===g.id);};
export function groupingIssue(d:Doc,ids:string[]):string|undefined{
 if(!ids.length)return '请在同一图层选择至少两条独立笔画。';
 const members=expandGroups(d,ids),layer=layerFor(d,members[0]);
 if(members.some(id=>layerFor(d,id)?.id!==layer?.id))return '组合仅支持同一图层。';
 // Grouping organizes objects without editing geometry; visibility is not an edit lock.
 if(members.some(id=>curveById(d,id).locked))return '对象已锁定。';
 const units=new Set(ids.map(id=>groupFor(d,id)?.id??strokeFor(d,id).id));
 if(units.size<2)return '请在同一图层选择至少两条独立笔画。';
}
export function createGroup(d:Doc,ids:string[],name?:string):Doc{
 const error=groupingIssue(d,ids);if(error)throw Error(error);const curveIds=expandGroups(d,ids);
 let index=1;while(d.groups?.some(g=>g.name===`组合 ${index}`))index++;
 const g:DrawingGroup={id:uid(),name:name?.trim()||`组合 ${index}`,curveIds,visible:true,locked:false};
 // Flatten existing containers without changing member state.
 const base=ungroup(d,curveIds);
 return orderGroups({...base,groups:[...(base.groups??[]),g]});
}
export function ungroup(d:Doc,ids:string[]):Doc{
 const groups=(d.groups??[]).filter(g=>g.curveIds.every(id=>ids.includes(id)));if(!groups.length)return d;
 if(groups.some(g=>groupObjectIds(d,g).some(id=>objectById(d,id)?.locked)))throw Error('对象已锁定。');
 return {...d,groups:d.groups!.filter(g=>!groups.includes(g))};
}
export function changeGroup(d:Doc,id:string,change:Partial<Pick<DrawingGroup,'name'|'visible'|'locked'>>):Doc{
 const g=d.groups?.find(g=>g.id===id);if(!g)return d;
 if(change.name!==undefined){const name=change.name.trim();if(!name)return d;change={...change,name};}
 const n=setObjectState(d,groupObjectIds(d,g),{visible:change.visible,locked:change.locked});
 return change.name!==undefined&&change.name!==g.name?{...n,groups:n.groups!.map(x=>x.id===id?{...x,name:change.name!}:x)}:n;
}
/** Promote the container, preserving member geometry/flags and internal paint order. */
export function groupToLayer(d:Doc,id:string):{document:Doc;layerId:string}{
 const g=d.groups?.find(g=>g.id===id),source=g&&layerFor(d,g.curveIds[0]);
 if(!g||!source)throw Error('组合不存在。');
 const items=groupObjectIds(d,g),moving=new Set(items);
 if(items.some(id=>objectById(d,id)?.locked))throw Error('对象已锁定。');
 const layerId=uid(),layer={id:layerId,name:g.name,visible:true,locked:false,items};
 // A promoted layer sits immediately above its former owner, not above unrelated layers.
 const layers=d.layers.flatMap(l=>l===source?[layer,{...l,items:l.items.filter(id=>!moving.has(id))}]:[l]);
 return {document:{...d,layers,groups:d.groups!.filter(x=>x.id!==id)},layerId};
}
/** Keep group members contiguous in the existing flat z-order, at their foremost member. */
export function orderGroups(d:Doc):Doc{
 if(!d.groups?.length)return d;const objects=new Map(d.groups.map(g=>[g.id,groupObjectIds(d,g)])),owner=new Map([...objects].flatMap(([gid,ids])=>ids.map(id=>[id,gid] as const)));
 return {...d,layers:d.layers.map(l=>{const seen=new Set<string>();return {...l,items:l.items.flatMap(id=>{const gid=owner.get(id);if(!gid)return [id];if(seen.has(gid))return [];seen.add(gid);return objects.get(gid)!;})};})};
}
/** Topology edits keep complete strokes in a group; connecting two groups combines their containers. */
export function reconcileGroups(d:Doc):Doc{
 if(!d.groups)return d;let groups:DrawingGroup[]=[];
 for(const old of d.groups){const alive=old.curveIds.filter(id=>curveById(d,id));if(!alive.length)continue;
  // A partial cross-layer move detaches those members; a whole-group move keeps the group.
  const layer=layerFor(d,alive[0])?.id,ids=[...new Set(alive.filter(id=>layerFor(d,id)?.id===layer).flatMap(id=>strokeIds(strokeFor(d,id))))];
  const overlaps=groups.filter(g=>g.curveIds.some(id=>ids.includes(id))),base=overlaps[0]??old;
  groups=groups.filter(g=>!overlaps.includes(g));groups.push({...base,curveIds:[...new Set([...overlaps.flatMap(g=>g.curveIds),...ids])]});
 }
 return orderGroups({...d,groups});
}
export interface GroupTreeEntry {id:string;item?:ReturnType<typeof layerTree>[number];group?:DrawingGroup;children:ReturnType<typeof layerTree>}
export function groupTree(d:Doc,layerId:string):GroupTreeEntry[]{
 const entries=layerTree(d,layerId),seen=new Set<string>();return entries.flatMap<GroupTreeEntry>(item=>{
  const group=groupFor(d,item.id);if(!group)return [{id:item.id,item,group:undefined,children:[]}];
  if(seen.has(group.id))return [];seen.add(group.id);return [{id:group.id,item:undefined,group,children:entries.filter(e=>groupFor(d,e.id)?.id===group.id)}];
 });
}
