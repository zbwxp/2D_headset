import {useShallow} from 'zustand/react/shallow';
import {useEditor} from '../../app/store';
import {useUI} from '../session';
import {boundaryGeometry,eligibleAnchors} from '../../domain/patches/boundary';
import {pointPosition} from '../../domain/geometry/evaluation';
import {worldToSvg,type OrthographicViewState} from '../../rendering/orthographic';
import {providerPath} from '../curves/CurveInteractionOverlay';
import {loopCorrespondence,authoringBoundaries} from './authoring';
export default function BoundaryAuthoringOverlay({view,zoom}:{view:OrthographicViewState;zoom:number}){
 const s=useEditor(useShallow(s=>({project:s.project,patchCreation:s.patchCreation,selectedPatchId:s.selectedPatchId,pickPatchAnchor:s.pickPatchAnchor,hoverPatchAnchor:s.hoverPatchAnchor}))),t=s.patchCreation;
 const hover=useUI(s=>s.continuityHover);let hovered;try{if(hover)hovered=boundaryGeometry(s.project,hover);}catch{}
 return <g data-testid="boundary-authoring-overlay">
 {loopCorrespondence(s.project,t).map(([a,b],i)=>{const A=worldToSvg(a,view),B=worldToSvg(b,view);return <line key={'loop'+i} x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke="#ffcf70" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" pointerEvents="none"/>;})}
 {hovered&&<path data-testid="continuity-span-highlight" d={providerPath(hovered,view)} fill="none" stroke="#ffcf70" strokeWidth={5} vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
 {authoringBoundaries(s.project,t,s.selectedPatchId).map(({geometry},i)=><path key={i} d={providerPath(geometry,view)} fill="none" stroke="#ffcf70" strokeWidth={4} vectorEffect="non-scaling-stroke" pointerEvents="none"/>)}
 {t?.host&&eligibleAnchors(s.project,t.host).map(l=>{const q=worldToSvg(pointPosition(s.project,l.id),view),active=t.start===l.id;return <g key={l.id}>
 <circle cx={q[0]} cy={q[1]} r={(active?8:6)/zoom} stroke="#ffcf70" strokeWidth={2} vectorEffect="non-scaling-stroke" fill={active?'#ffcf70':'#253037'} pointerEvents="none"/>
 <circle data-testid={`span-anchor-${l.id}`} aria-label={`区间定位点 ${l.name}`} role="button" tabIndex={0} cx={q[0]} cy={q[1]} r={13/zoom} fill="transparent" style={{cursor:'pointer'}} onPointerDown={e=>{if(e.button!==0||e.shiftKey)return;e.preventDefault();e.stopPropagation();s.pickPatchAnchor(l.id);}} onPointerEnter={()=>s.hoverPatchAnchor(l.id)} onPointerLeave={()=>s.hoverPatchAnchor(undefined)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();s.pickPatchAnchor(l.id);}}}><title>{l.name}</title></circle>
 </g>;})}</g>;
}
