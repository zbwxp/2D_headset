import PaintOrderControls,{reorderDrawingSelection} from '../drawing/PaintOrderControls';
import DepthControls from '../drawing/DepthControls';
import MirrorEditingControls from '../drawing/MirrorEditingControls';
import SelectionNameControls from '../drawing/SelectionNameControls';
import {SelectionTransformControls,CurveObjectActions,CurveLayerControl,type DrawingPropertyTransform} from '../drawing/SelectionPropertyControls';
import {selectionBounds} from '../drawing/geometry';
import EndpointPropertyControls,{endpointPropertyTracks} from '../drawing/EndpointPropertyControls';
import {useState} from 'react';
import {ChevronDown,ChevronRight} from 'lucide-react';
import type {DrawingDocument,Point2} from '../../domain/drawing/model';
import type {DrawingSelection} from '../drawing/session';
import type {DrawingCommandRun,DrawingEndpointTool} from '../drawing/endpointInteraction';
import {CurveControlSelection,CurvePointControls,CurveWidthControl,StrokeNameControl} from '../drawing/CurvePropertyControls';
import AppearanceControls from '../drawing/AppearanceControls';
import ArcControls from '../drawing/ArcControls';
import DisplayIntervalControls from '../drawing/DisplayIntervalControls';
import {DrawingPropertySessionProvider,type DrawingPropertySession} from '../drawing/propertySession';
import {displayPath,pathTracks} from '../../domain/drawing/displayIntervals';
import {uiText as t} from '../i18n';

export interface SnapshotDrawingPropertiesProps {
 drawing:DrawingDocument;selection:DrawingSelection;choose:(selection:DrawingSelection)=>void;run:DrawingCommandRun;preview:(drawing:DrawingDocument|null)=>void;session:DrawingPropertySession;
 transform:DrawingPropertyTransform;tool:(tool:DrawingEndpointTool)=>void;propertiesEditable:boolean;topologyEditable:boolean;geometryEditable:boolean;mirrorEditable?:boolean;transformEditable?:boolean;intervalEditable:boolean;onPosition:(position:Point2)=>void;translationEditable?:boolean;disabledReason?:string;
}
/** Recording composes Drawing's property widgets. Only its transaction and
 * geometry-position adapters know about snapshots or response coordinates. */
export default function SnapshotDrawingProperties({drawing:d,selection,choose,run,preview,session,tool,transform,propertiesEditable,topologyEditable,geometryEditable,mirrorEditable=geometryEditable,transformEditable=geometryEditable,intervalEditable,onPosition,translationEditable=true,disabledReason}:SnapshotDrawingPropertiesProps){
 const [open,setOpen]=useState(true),ids=selection.ids.filter(id=>d.curves.some(curve=>curve.id===id)),paint=d.fills.find(value=>value.id===selection.paint)??d.offsets.find(value=>value.id===selection.paint),disabled=ids.some(id=>d.curves.find(curve=>curve.id===id)!.locked),intervalIds:string[]=[],seenTracks=new Set<string>(),bounds=selectionBounds(d,ids);
 for(const id of ids){const path=displayPath(d,id),tracks=pathTracks(d,path);if(tracks.length){if(tracks.some(track=>!seenTracks.has(track.id))){intervalIds.push(id);tracks.forEach(track=>seenTracks.add(track.id));}}else if(ids.length===1)intervalIds.push(id);}
 if(!ids.length&&!paint&&!selection.layer)return null;
 return <DrawingPropertySessionProvider session={session}><section className="drawing-properties snapshot-drawing-properties" data-testid="snapshot-drawing-properties" aria-label={t('绘图属性')}><header><button className="drawing-properties-toggle" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}<strong>{t('属性')}</strong></button></header><div className="drawing-properties-content" hidden={!open}>
 <MirrorEditingControls d={d} ids={ids} nodeId={selection.node} run={run} editable={mirrorEditable} pairEditable={propertiesEditable}/>
 {!propertiesEditable&&disabledReason&&<p className="drawing-muted" data-testid="snapshot-property-ownership">{disabledReason}</p>}
 {!paint&&<><CurveControlSelection d={d} selection={selection} choose={choose}/><CurvePointControls d={d} selection={selection} run={run} disabled={disabled||!geometryEditable} onPosition={onPosition}/></>}
 <fieldset disabled={!propertiesEditable} className="snapshot-properties-fields">
 {!paint&&<SelectionNameControls d={d} selection={{...selection,ids}} run={run} choose={choose} disabled={disabled} topologyEditable={topologyEditable}/>}
 {!paint&&<><StrokeNameControl d={d} ids={ids} run={run} disabled={disabled}/><CurveWidthControl d={d} ids={ids} run={run} disabled={disabled}/></>}
 {d.joins.filter(join=>join.mode==='ARC'&&[join.a,join.b].some(endpoint=>ids.includes(endpoint.curveId))).map(join=><ArcControls key={join.id} d={d} join={join} run={run} preview={preview}/>)}
 <AppearanceControls d={d} selection={{...selection,ids}} run={run} choose={choose} preview={preview} capabilities={{create:topologyEditable,remove:topologyEditable,detach:topologyEditable,reorder:topologyEditable,move:topologyEditable,translation:translationEditable}}/>
 {!paint&&ids.length===1&&!selection.layer&&!selection.group&&<DepthControls d={d} id={ids[0]} run={run}/>}
 </fieldset>
 {!paint&&bounds&&!selection.node&&!selection.handle&&<SelectionTransformControls center={bounds.center} transform={transform} disabled={disabled||!transformEditable}/> }
 {!paint&&<CurveObjectActions d={d} selection={{...selection,ids}} run={run} choose={choose} transform={transform} disabled={disabled||!transformEditable} topologyEditable={topologyEditable}/> }
 {!paint&&<CurveLayerControl d={d} ids={ids} run={run} disabled={disabled||!topologyEditable}/>}
 {!paint&&(ids.length!==1||selection.layer||selection.group)&&<PaintOrderControls disabled={disabled||!topologyEditable} onReorder={direction=>run(()=>reorderDrawingSelection(d,{...selection,ids},direction))}/>}
 {!paint&&intervalIds.map(id=><DisplayIntervalControls key={id} d={d} id={id} selection={selection} run={run} choose={choose} editable={intervalEditable} structureEditable={topologyEditable} appearanceEditable={propertiesEditable} handledRouteTrackIds={endpointPropertyTracks(d,selection).map(track=>track.id)}/>)}
 {!paint&&<EndpointPropertyControls d={d} selection={selection} run={run} choose={choose} tool={tool} editable={topologyEditable}/> }
 </div></section></DrawingPropertySessionProvider>;
}
