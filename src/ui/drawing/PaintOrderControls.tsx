import type {DrawingDocument} from '../../domain/drawing/model';
import {layerFor} from '../../domain/drawing/model';
import {reorderLayers} from '../../domain/drawing/commands';
import {reorderPaint} from '../../domain/drawing/paintCommands';
import {groupTree,selectedGroup} from '../../domain/drawing/groups';
import {strokeFor} from '../../domain/drawing/strokes';
import type {DrawingSelection} from './session';
import {uiText as t} from '../i18n';
export type PaintOrderDirection='up'|'down'|'top'|'bottom';
export default function PaintOrderControls({disabled=false,onReorder}:{disabled?:boolean;onReorder:(direction:PaintOrderDirection)=>void}){return <div className="drawing-property-actions">{(['top','up','down','bottom'] as const).map((direction,index)=><button key={direction} disabled={disabled} onClick={()=>onReorder(direction)}>{t(['置顶','上移一层','下移一层','置底'][index])}</button>)}</div>;}
/** Both property panels use the same selected group/layer order command. */
export function reorderDrawingSelection(d:DrawingDocument,selection:DrawingSelection,where:PaintOrderDirection):DrawingDocument{
 const layer=d.layers.find(layer=>layer.id===selection.layer),ids=selection.ids.filter(id=>d.curves.some(curve=>curve.id===id));
 if(layer){const index=d.layers.indexOf(layer),target=d.layers[where==='top'?0:where==='bottom'?d.layers.length-1:where==='up'?index-1:index+1];return target?reorderLayers(d,layer.id,target.id,where==='down'||where==='bottom'):d;}
 if(!ids.length)return d;const id=ids[0],list=groupTree(d,layerFor(d,id)!.id),current=(!selection.node&&!selection.handle?selectedGroup(d,ids):undefined)??strokeFor(d,id),index=list.findIndex(item=>item.id===current.id),target=list[where==='top'?0:where==='bottom'?list.length-1:where==='up'?index-1:index+1];return target?reorderPaint(d,id,target.id,where==='down'||where==='bottom'):d;
}
