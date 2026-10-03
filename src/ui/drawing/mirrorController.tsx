import {mirrorEdit,setMirrorAxis} from '../../domain/drawing/commands';
import {setMirrorEditingEnabled} from '../../domain/drawing/mirrorCommands';
import {mirrorWritesForCurves,type MirrorAuthoredWrites} from '../../domain/drawing/mirrorEditing';
import {finalizeGeometryEdit,markFinalizedGeometry} from '../../domain/drawing/geometryEdit';
import {shapeOf,type Cubic,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {snapMirrorAxis} from './geometry';
import {NumberField} from './Field';
import type {DrawingCommandRun} from './endpointInteraction';
import {uiText as t} from '../i18n';

export function drawingMirrorPreview(drawing:DrawingDocument,source:string):Cubic {
 return shapeOf(drawing,source).map(([x,y])=>[2*(drawing.mirrorAxisX??0)-x,y]) as Cubic;
}
/** One-shot placement keeps the source fixed even if continuous editing is on.
 * Existing pairs describe later edit propagation and are never rewritten. */
export function applyDrawingMirrorTool(drawing:DrawingDocument,source:string,target:string,allowRelated=false,finalize:(before:DrawingDocument,after:DrawingDocument,writes?:MirrorAuthoredWrites)=>DrawingDocument=finalizeGeometryEdit):DrawingDocument {
 const next=mirrorEdit(drawing,source,target,allowRelated);
 return markFinalizedGeometry(finalize(drawing,next,mirrorWritesForCurves(next,[source,target])));
}
export function DrawingMirrorAxisControls({drawing,run,disabled=false}:{drawing:DrawingDocument;run:DrawingCommandRun;disabled?:boolean}){
 return <fieldset disabled={disabled} style={{display:'contents'}}><NumberField label="镜像轴 X" value={drawing.mirrorAxisX??0} onChange={x=>run(()=>setMirrorAxis(drawing,x),{kind:'mirror-authoring'})}/><button onClick={()=>run(()=>setMirrorAxis(drawing,0),{kind:'mirror-authoring'})}>{t('镜像轴归中')}</button></fieldset>;
}
export function DrawingMirrorToggle({drawing,run,disabled=false,testId='drawing-mirror-toggle'}:{drawing:DrawingDocument;run:DrawingCommandRun;disabled?:boolean;testId?:string}){
 return <button data-testid={testId} disabled={disabled} aria-pressed={!!drawing.mirrorEditing?.enabled} title={t('开启后镜像传播本次编辑；关闭后自由编辑。不锁定已有形状。')} onClick={()=>run(()=>setMirrorEditingEnabled(drawing,!drawing.mirrorEditing?.enabled),{kind:'mirror-authoring'})}>{t('持续镜像')} · {t(drawing.mirrorEditing?.enabled?'开':'关')}</button>;
}

export function updateDrawingMirrorAxis(drawing:DrawingDocument,start:Point2,point:Point2,unit:number,targets:DrawingDocument['nodes']) {
 const snapped=snapMirrorAxis(targets,(drawing.mirrorAxisX??0)+point[0]-start[0],point[1],unit);
 return {drawing:setMirrorAxis(drawing,snapped?.position[0]??(drawing.mirrorAxisX??0)+point[0]-start[0]),snap:snapped?.position??null};
}
