import type {DrawingDocument,Point2} from '../../domain/drawing/model';
import {duplicateCurves,deleteObjects,moveToLayer} from '../../domain/drawing/commands';
import {layerFor} from '../../domain/drawing/model';
import {selectedGroup} from '../../domain/drawing/groups';
import {selectedObjects,type DrawingSelection} from './session';
import type {DrawingCommandRun} from './endpointInteraction';
import {NumberField} from './Field';
import {uiText as t} from '../i18n';
export type DrawingPropertyTransform=(kind:'moveX'|'moveY'|'rotate'|'scale'|'mirror'|'mirrorAxis',value:number)=>void;
export function SelectionTransformControls({center,disabled=false,transform}:{center:Point2;disabled?:boolean;transform:DrawingPropertyTransform}){
 return <><div className="drawing-fields"><NumberField label="位置 X" value={center[0]} disabled={disabled} onChange={value=>transform('moveX',value-center[0])}/><NumberField label="位置 Y" value={center[1]} disabled={disabled} onChange={value=>transform('moveY',value-center[1])}/></div><div className="drawing-fields"><NumberField label="旋转增量 °" value={0} disabled={disabled} onChange={value=>transform('rotate',value)}/><NumberField label="缩放 %" value={100} min={1} max={1000} disabled={disabled} onChange={value=>transform('scale',value/100)}/></div></>;
}
export function CurveObjectActions({d,selection,run,choose,transform,disabled=false,topologyEditable=true}:{d:DrawingDocument;selection:DrawingSelection;run:DrawingCommandRun;choose:(selection:DrawingSelection)=>void;transform:DrawingPropertyTransform;disabled?:boolean;topologyEditable?:boolean}){
 const ids=selection.ids;if(!ids.length)return null;
 return <div className="drawing-property-actions"><button disabled={disabled||!topologyEditable} onClick={()=>run(()=>{const result=duplicateCurves(d,ids,undefined,[0,0]);choose({ids:result.ids,group:selectedGroup(result.document,result.ids)?.id});return result.document;})} title={t('复制新对象到原位，保留原镜像对应。')}>{t('原位复制')}</button><button disabled={disabled} onClick={()=>transform('mirror',1)}>{t('原地水平翻转')}</button><button data-testid="drawing-mirror-place" disabled={disabled} onClick={()=>transform('mirrorAxis',1)}>{t('按镜像轴移到对侧')}</button><button disabled={disabled||!topologyEditable} onClick={()=>run(()=>{const next=deleteObjects(d,selectedObjects(selection));choose({ids:[]});return next;})}>{t('删除')}</button></div>;
}
export function CurveLayerControl({d,ids,run,disabled=false}:{d:DrawingDocument;ids:string[];run:DrawingCommandRun;disabled?:boolean}){
 if(!ids.length)return null;
 return <label className="drawing-field">{t('移动到图层')}<select aria-label={t('移动到图层')} value="" disabled={disabled} onChange={event=>run(()=>moveToLayer(d,ids,event.target.value))}><option value="">—</option>{d.layers.filter(layer=>layer.id!==layerFor(d,ids[0])?.id).map(layer=><option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label>;
}
