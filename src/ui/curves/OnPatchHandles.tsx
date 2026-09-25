import {useRef} from 'react';
import {useEditor} from '../../app/store';
import {isOnPatch} from '../../domain/curves/model';
import {clampSurfaceHandle,onPatchControls} from '../../domain/curves/onPatch';
import {evaluator} from '../../domain/patches/geometry';
import {displayPoint} from '../../rendering/moduleDisplay';
import {worldToSvg,worldToScreen,type OrthographicViewState} from '../../rendering/orthographic';
import {modulePickable} from '../authoring/moduleAccess';
/** Controls live in the host chart. Screen dragging minimizes projected distance locally,
 * retaining the current chart branch even when the surface overlaps itself in projection. */
export default function OnPatchHandles({view}:{view:OrthographicViewState}){
 const s=useEditor(),drag=useRef<{index:0|1;uv:[number,number];start:[number,number];recorded:boolean}|null>(null);
 const c=s.project.curves.find(x=>x.id===s.selectedCurveId);
 if(!c||!isOnPatch(c)||s.tool.kind!=='select'||!modulePickable(c.id))return null;
 const {controls}=onPatchControls(s.project,c),host=s.project.patches!.find(x=>x.id===c.hostPatchId)!,surface=evaluator(s.project,host);
 const world=(uv:[number,number])=>displayPoint(s.project,c.id,surface(host.type==='loop'?(uv[0]%1+1)%1:uv[0],uv[1]),view.forward);
 const coords=controls.map(q=>worldToSvg(world(q),view));
 const finish=()=>{if(drag.current?.recorded)useEditor.getState().endEdit();drag.current=null;};
 return <g data-testid="on-patch-handles">{([0,1] as const).map(index=>{const anchor=controls[index===0?0:3],handle=controls[index+1],q=coords[index+1];
 const line=Array.from({length:25},(_,i)=>worldToSvg(world([anchor[0]+(handle[0]-anchor[0])*i/24,anchor[1]+(handle[1]-anchor[1])*i/24]),view).slice(0,2).join(','));
 return <g key={index}><path d={'M'+line.join('L')} fill="none" stroke="#d3b5ee" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" pointerEvents="none"/>
 <circle data-testid={`on-patch-handle-${index+1}`} data-curve-id={c.id} data-handle-index={index+1} cx={q[0]} cy={q[1]} r={6/view.zoom} stroke="#ffe0ff" fill="#543b64" vectorEffect="non-scaling-stroke" style={{cursor:'grab'}}
 onPointerDown={e=>{if(e.button!==0||e.shiftKey)return;e.preventDefault();e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);drag.current={index,uv:[...handle],start:[e.clientX,e.clientY],recorded:false};}}
 onPointerMove={e=>{const d=drag.current;if(!d)return;e.stopPropagation();if(!d.recorded&&Math.hypot(e.clientX-d.start[0],e.clientY-d.start[1])<2)return;
 const rect=e.currentTarget.ownerSVGElement!.getBoundingClientRect(),target=[e.clientX-rect.left,e.clientY-rect.top],cost=(uv:[number,number])=>{const p=worldToScreen(world(uv),view);return (p[0]-target[0])**2+(p[1]-target[1])**2;};let best=d.uv,score=cost(best);
 for(let step=.15;step>1e-5;step*=.5){for(let repeat=0;repeat<3;repeat++){let next=best;for(const x of [-1,0,1])for(const y of [-1,0,1]){const uv=clampSurfaceHandle(host.type,[best[0]+x*step,best[1]+y*step]),v=cost(uv);if(v<score){score=v;next=uv;}}best=next;}}
 if(!d.recorded){s.beginEdit(true);d.recorded=true;}d.uv=best;useEditor.getState().setOnPatchHandle(c.id,index,best);
 }} onPointerUp={e=>{e.stopPropagation();finish();}} onPointerCancel={finish} onLostPointerCapture={finish}/></g>;})}</g>;
}
