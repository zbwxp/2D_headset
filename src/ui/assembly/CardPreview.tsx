import {useMemo} from 'react';
import {refinementApplied,refinementProjector} from '../../domain/assembly/refinement';
import {transformDrawing,layerTransform,type AssemblyDocument} from '../../domain/assembly/model';
import {evaluatedIntervalDrawing} from '../../domain/assembly/timeline';
import {layerProjection} from '../../domain/assembly/projection';
import {vectorProjection} from '../../domain/assembly/vectorProjection';
import type {DrawingDocument,Point2} from '../../domain/drawing/model';
import type {DrawingUnderlay} from '../assemblyDrawing/DrawingRoom';
import PaintScene from '../assemblyDrawing/PaintScene';
const noop=()=>{};
export default function CardPreview({a,drawing,view,showFills,fillVisibility,applyIntervals=true}:{applyIntervals?:boolean;drawing?:DrawingDocument;a:AssemblyDocument;view:DrawingUnderlay;showFills:boolean;fillVisibility:Record<string,boolean>}){
 const {width,height,unit,pan}=view,screen=(p:Point2):Point2=>[width/2+pan[0]+p[0]*unit,height/2+pan[1]-p[1]*unit];
 // A drag preview is expressed in placed coordinates; restore the canonical
 // centerline before projecting. Width is never scaled in either direction.
 const evaluated=useMemo(()=>drawing?transformDrawing(drawing,a,true):evaluatedIntervalDrawing(a),[drawing,a]),d=useMemo(()=>applyIntervals?evaluated:{...evaluated,displayIntervals:[]},[evaluated,applyIntervals]);
 const projections=useMemo(()=>new Map(d.layers.flatMap(l=>{const transform=layerTransform(a,l.id);const p=layerProjection(a,l.id,view);if(!refinementApplied(a)&&!p.active&&transform.scale===1&&transform.translation.every(n=>n===0))return [];return [[l.id,vectorProjection(refinementProjector(a,q=>{const r=p.mapCanonical(q);return [(r[0]-width/2-pan[0])/unit,-(r[1]-height/2-pan[1])/unit];}),.15/unit)] as const];})),[a,d,width,height,unit,pan[0],pan[1]]);
 return <g data-testid="assembly-card-preview" pointerEvents="none"><PaintScene d={d} screen={screen} unit={unit} preview showFills={showFills} fillVisibility={fillVisibility} referenceMoving={false} tool="select" curveDown={noop} paintDown={noop} arcDown={noop} geometryProjection={projections}/></g>;
}
