import {curveById,nodeAt,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {moveHandle,moveNode,widthChange,renameStroke} from '../../domain/drawing/commands';
import {strokeFor,strokeName} from '../../domain/drawing/strokes';
import type {DrawingSelection} from './session';
import type {DrawingCommandRun} from './endpointInteraction';
import {NumberField,NameField} from './Field';
import {uiText as t} from '../i18n';

/** Common property widgets consume Drawing's actual selection and commands.
 * A host can route final-space control positions to its own Snapshot authority. */
export function CurveControlSelection({d,selection,choose,disabled=false}:{d:DrawingDocument;selection:DrawingSelection;choose:(next:DrawingSelection)=>void;disabled?:boolean}){
 const curve=selection.ids.length===1?d.curves.find(curve=>curve.id===selection.ids[0]):undefined;
 if(!curve)return null;
 return <div className="drawing-control-select" aria-label={t('选择曲线控制点')}>{([0,1] as const).map(end=><div key={end} className="drawing-property-actions">
  <button aria-label={`P${end} ${t('端点')}`} aria-pressed={selection.node===curve.nodes[end]&&!selection.handle} disabled={disabled} onClick={()=>choose({ids:[curve.id],node:curve.nodes[end]})}>P{end} {t('端点')}</button>
  <button aria-label={`P${end} ${t('控制柄')}`} aria-pressed={selection.handle?.curveId===curve.id&&selection.handle.end===end} disabled={disabled} onClick={()=>choose({ids:[curve.id],handle:{curveId:curve.id,end}})}>P{end} {t('控制柄')}</button>
 </div>)}</div>;
}
export function CurvePointControls({d,selection,run,disabled=false,onPosition}:{d:DrawingDocument;selection:DrawingSelection;run:DrawingCommandRun;disabled?:boolean;onPosition?:(position:Point2)=>void}){
 const handle=selection.handle,point=handle?d.curves.find(curve=>curve.id===handle.curveId)?.handles[handle.end]:d.nodes.find(node=>node.id===selection.node)?.position;
 if(!point)return null;
 const change=(position:Point2)=>onPosition?onPosition(position):run(()=>handle?moveHandle(d,handle,position):moveNode(d,selection.node!,position));
 const anchor=handle?nodeAt(d,handle).position:undefined,length=anchor?Math.hypot(point[0]-anchor[0],point[1]-anchor[1]):0;
 return <><div className="drawing-fields">{(['X','Y'] as const).map((axis,index)=><NumberField key={axis} label={'节点 '+axis} value={point[index]} disabled={disabled} onChange={value=>change(point.map((n,k)=>k===index?value:n) as Point2)}/>)}</div>
 {anchor&&<NumberField label="控制柄长度" value={length} min={.000001} disabled={disabled||length<1e-7} onChange={value=>change([anchor[0]+(point[0]-anchor[0])*value/length,anchor[1]+(point[1]-anchor[1])*value/length])}/>}</>;
}
export function CurveWidthControl({d,ids,run,disabled=false}:{d:DrawingDocument;ids:string[];run:DrawingCommandRun;disabled?:boolean}){
 const curve=d.curves.find(curve=>curve.id===ids[0]);if(!curve)return null;
 return <NumberField label="线宽" value={curve.width*250} min={.25} max={40} disabled={disabled} onChange={value=>run(()=>widthChange(d,ids,value/250))}/>;
}
export function StrokeNameControl({d,ids,run,disabled=false}:{d:DrawingDocument;ids:string[];run:DrawingCommandRun;disabled?:boolean}){
 if(!ids.length)return null;const stroke=strokeFor(d,ids[0]);if(!ids.every(id=>stroke.segments.some(segment=>segment.id===id)))return null;
 return <label className="drawing-stroke-name">{t('笔画名称')}<NameField label="笔画名称" value={strokeName(d,stroke)} disabled={disabled||stroke.segments.some(segment=>{const curve=curveById(d,segment.id);return !curve.visible||curve.locked;})} onChange={name=>run(()=>renameStroke(d,stroke.id,name))}/></label>;
}
