import {currentDrawingPresentation} from './snapshotPresentation';
import {useDrawingWorkspace} from './workspace';
import PanelSection from '../shared/PanelSection';
import {useRef} from 'react';
import {curveById,type DrawingDocument as Doc,type TangentJoin} from '../../domain/drawing/model';
import {setArcRadius} from '../../domain/drawing/commands';
import {roundedJoins} from '../../domain/drawing/roundedJoin';
import NumericSlider from '../shared/NumericSlider';
import {NumberField} from './Field';
import {uiText as t} from '../i18n';
export default function ArcControls({d,join,run,preview}:{d:Doc;join:TangentJoin;run:(f:()=>Doc)=>void;preview:(d:Doc|null)=>void}){
 const {editor:useEditor,id:workspaceId}=useDrawingWorkspace();
 const base=useRef<Doc|null>(null),next=useRef<Doc|null>(null),g=roundedJoins(d).get(join.id),disabled=[join.a,join.b].some(e=>curveById(d,e.curveId).locked||!curveById(d,e.curveId).visible);
 const end=()=>{const n=next.current,b=base.current;next.current=null;base.current=null;preview(null);if(n&&currentDrawingPresentation(useEditor.getState().project,workspaceId)===b)run(()=>n);};
 return <PanelSection id="drawing.arc" title="圆弧接笔" className="drawing-arc-controls" testId="drawing-arc-controls">
 <NumberField label="影响范围 px" value={join.radius!*250} min={.25} max={500} disabled={disabled} onChange={r=>run(()=>setArcRadius(d,join.id,r/250))}/>
 <NumericSlider label={t('圆弧范围')} min={.001} max={Math.max(.4,join.radius!)} value={join.radius!} disabled={disabled} inputScale={250} formatValue={r=>(r*250).toFixed(1)+' px'} onEditStart={()=>{base.current=currentDrawingPresentation(useEditor.getState().project,workspaceId);next.current=null;}} onChange={r=>{const n=setArcRadius(base.current??d,join.id,r);next.current=n;preview(n);}} onEditEnd={end} onUndo={()=>useEditor.getState().undo()} onRedo={()=>useEditor.getState().redo()}/>
 <p className={g?.error?'drawing-invalid':'drawing-muted'} data-testid="drawing-arc-status">{t(g?.error??(g?.clamped?'已按可用线长缩小范围，避免两端过渡重叠。':'两侧各截取这一长度，圆弧随切向夹角自动更新。'))}</p>
 </PanelSection>;
}
