import {curveById,layerFor,type DrawingDocument as Doc} from '../../domain/drawing/model';
import {groupTree,groupObjectIds} from '../../domain/drawing/groups';
import {layerTree,strokeIds} from '../../domain/drawing/strokes';

export interface ListRow {key:string;ids:string[];kind:'layer'|'group'|'stroke'|'curve'|'paint'}
/** Same row order as the expanded sidebar, independent of curve creation order. */
export function drawingListRows(d:Doc,closed:readonly string[]):ListRow[]{
 const rows:ListRow[]=[];
 const item=(entry:ReturnType<typeof layerTree>[number])=>{
  const s=entry.stroke;
  if(!s){rows.push({key:`paint:${entry.id}`,ids:[entry.id],kind:'paint'});return;}
  const single=s.segments.length===1&&!curveById(d,s.id).strokeName&&!entry.fills.length;
  if(single){rows.push({key:`curve:${s.id}`,ids:[s.id],kind:'curve'});return;}
  rows.push({key:`stroke:${s.id}`,ids:[...strokeIds(s),...entry.fills],kind:'stroke'});
  if(!closed.includes(s.id)){
   rows.push(...layerFor(d,s.id)!.items.filter(id=>s.segments.some(x=>x.id===id)).map(id=>({key:`curve:${id}`,ids:[id],kind:'curve' as const})));
   rows.push(...entry.fills.map(id=>({key:`paint:${id}`,ids:[id],kind:'paint' as const})));
  }
 };
 for(const layer of d.layers){
  rows.push({key:`layer:${layer.id}`,ids:layer.items,kind:'layer'});if(closed.includes(layer.id))continue;
  for(const entry of groupTree(d,layer.id)){
   if(entry.group){rows.push({key:`group:${entry.id}`,ids:groupObjectIds(d,entry.group),kind:'group'});if(!closed.includes(entry.id))entry.children.forEach(item);}
   else item(entry.item!);
  }
 }
 return rows;
}
/** Shift replaces the anchored range; Ctrl/Cmd toggles; Ctrl/Cmd+Shift adds a range. */
export function selectListRows(rows:ListRow[],anchor:string|null,key:string,current:string[],mod:{shift:boolean;toggle:boolean}){
 const at=rows.findIndex(r=>r.key===key),from=rows.findIndex(r=>r.key===anchor);if(at<0)return {ids:current,anchor};
 if(mod.shift&&from>=0){const range=rows.slice(Math.min(from,at),Math.max(from,at)+1).flatMap(r=>r.ids);return {ids:[...new Set([...(mod.toggle?current:[]),...range])],anchor};}
 const ids=rows[at].ids,remove=ids.every(id=>current.includes(id));
 return {ids:mod.toggle?(remove?current.filter(id=>!ids.includes(id)):[...new Set([...current,...ids])]):[...ids],anchor:key};
}

/** Layers have their own selection domain, including empty/hidden layers. */
export function selectLayerRows(layers:Doc['layers'],anchor:string|null,id:string,current:string[],mod:{shift:boolean;toggle:boolean}){
 const rows:ListRow[]=layers.map(l=>({key:`layer:${l.id}`,ids:[l.id],kind:'layer'}));
 const result=selectListRows(rows,anchor,`layer:${id}`,current,mod);
 return {...result,ids:layers.filter(l=>result.ids.includes(l.id)).map(l=>l.id)};
}

export function layerBatchScope(d:Doc,selected:readonly string[]){
 const selectedIds=selected.filter(id=>d.layers.some(l=>l.id===id));
 const layers=selectedIds.length?d.layers.filter(l=>selectedIds.includes(l.id)):d.layers;
 return {selected:selectedIds,layers,items:layers.flatMap(l=>l.items),foldIds:layers.flatMap(l=>[
  l.id,...layerTree(d,l.id).filter(item=>item.stroke).map(item=>item.id),
  ...groupTree(d,l.id).filter(entry=>entry.group).map(entry=>entry.id),
 ])};
}
