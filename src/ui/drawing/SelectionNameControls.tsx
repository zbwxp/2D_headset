import {curveById,type DrawingDocument} from '../../domain/drawing/model';
import {curveChange,layerChange} from '../../domain/drawing/commands';
import {selectedGroup,changeGroup,groupToLayer} from '../../domain/drawing/groups';
import type {DrawingSelection} from './session';
import type {DrawingCommandRun} from './endpointInteraction';
import {NameField} from './Field';
import {uiText as t} from '../i18n';
export default function SelectionNameControls({d,selection:s,run,choose,disabled=false,topologyEditable=true}:{d:DrawingDocument;selection:DrawingSelection;run:DrawingCommandRun;choose:(selection:DrawingSelection)=>void;disabled?:boolean;topologyEditable?:boolean}){
 const ids=s.ids,curve=ids.length===1?curveById(d,ids[0]):undefined,layer=d.layers.find(layer=>layer.id===s.layer),container=!s.node&&!s.handle&&!s.layer?selectedGroup(d,ids):undefined;
 return container?<><NameField label="组合名称" value={container.name} disabled={disabled} onChange={name=>run(()=>changeGroup(d,container.id,{name}))}/><p className="drawing-muted">{t('V 选择整组；A 单独编辑成员。列表 Shift 选范围，Ctrl/Cmd 增减选择。')}</p><button data-testid="drawing-group-to-layer" disabled={disabled||!topologyEditable} onClick={()=>run(()=>{const next=groupToLayer(d,container.id);choose({ids:container.curveIds,layer:next.layerId});return next.document;})}>{t('组合转为图层')}</button></>:layer?<NameField label="图层名称" value={layer.name} onChange={name=>run(()=>layerChange(d,layer.id,{name}))}/>:curve?<NameField label="曲线名称" value={curve.name} disabled={disabled} onChange={name=>run(()=>curveChange(d,curve.id,{name}))}/>:<p>{ids.length?`${ids.length} ${t('条曲线')}`:t('选择或绘制曲线，查看属性。')}</p>;
}
