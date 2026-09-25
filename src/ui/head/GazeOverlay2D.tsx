import {objectHidden,useVisibility,moduleHidden} from '../authoring/visibility';
import {Vector3} from 'three';
import {eyePerspectiveMatrix} from '../../domain/eyes/perspective';
import {useEditor} from '../../app/store';
import {gazePose} from '../../domain/eyes/tracking';
import {irisRims} from '../../domain/eyes/gaze';
import {evaluationContext} from '../../domain/geometry/evaluation';
import {worldToSvg,type OrthographicViewState} from '../../rendering/orthographic';
export default function GazeOverlay2D({view}:{view:OrthographicViewState}){
 useVisibility();
 const s=useEditor(),p=s.project;if(!p.eyeScaffold||moduleHidden('EYES'))return null;
 const path=(line:readonly (readonly number[])[])=>'M'+line.map(v=>worldToSvg(v,view).slice(0,2).join(',')).join('L');
 return <g data-testid="gaze-overlay-2d" data-facing={view.forward.join(',')}>
 {(['left','right'] as const).map(side=>{const pose=gazePose(p,side,view.forward),eye=p.eyeScaffold![side],warp=eyePerspectiveMatrix(p,side,view.forward),transform=(v:import('../../domain/project/types').Vec3,ball:boolean)=>new Vector3(...(ball?pose.transform(v):v)).applyMatrix4(warp).toArray();return <g key={side} data-eye-side={side}>
 {eye.curveIds.map((id,index)=>(!p.curves.some(c=>c.id===id)||objectHidden(id,false))?null:<path key={id} d={path(evaluationContext(p).curve(id).sample(32).map(v=>transform(v,index>=12&&index<24)))} fill="none" stroke={s.selectedCurveId===id?'#ffcf70':'#ab9fdd'} strokeWidth={1.5/view.zoom} onPointerDown={e=>{if(s.activeModule==='EYES'){e.stopPropagation();if(s.tool.kind==='patch')s.pickPatchEdge(id);else s.selectCurve(id);}}}/>)}
 </g>;})}
 {irisRims(p,view.forward).map((line,i)=><path key={i} data-gaze-rim d={path(line)} fill="none" stroke="#edc981" strokeWidth={1.5/view.zoom} onPointerDown={e=>{if(s.activeModule==='EYES'){e.stopPropagation();s.selectObject({kind:'surface',source:'IRIS',id:i===0?p.gazeEyeball!.leftId:p.gazeEyeball!.rightId});}}}/>)}
 </g>;
}
