import {useState,useEffect,useSyncExternalStore} from 'react';
import {useEditor} from '../../app/store';
import {useUI} from '../session';
import {patchRows} from '../shared/pairRows';
import {relations,type BoundaryRelation} from '../../domain/continuity/model';
import {subscribeSmooth,smoothVersion,getSmoothResult} from '../../domain/continuity/evaluation';
import {curveLocationOfLandmark} from '../../domain/patches/boundary';
import {evaluationContext} from '../../domain/geometry/evaluation';
/** Legacy component export names retained for layout only; no old Smooth controls. */
export function SmoothControls(){
 useSyncExternalStore(subscribeSmooth,smoothVersion);const p=useEditor(s=>s.project),r=getSmoothResult(p),pairs=relations(p).filter(r=>r.pair).length;
 return <div className="smooth-controls" data-testid="continuity-status" data-state={!pairs?'natural':!r?'pending':r.diagnostics.warnings.length?'warning':'ready'}>
 <small>Surface Continuity · {pairs} 条配对边界</small>
 {pairs>0&&!r&&<small>求解中 · 边界保持 Source</small>}
 {r&&<details><summary>连续性诊断</summary><small>数值 G1-like；端点允许衰减</small>{Object.entries(r.diagnostics.angles).map(([key,a])=><div key={key}>中段最大法向夹角 {a.before.toFixed(2)}° → {a.after.toFixed(2)}°</div>)}{r.diagnostics.warnings.map((w,i)=><small key={i}>⚠ {w}</small>)}</details>}
 </div>;
}
function BoundaryRow({r}:{r:BoundaryRelation}){
 const s=useEditor(),p=s.project,[open,setOpen]=useState(false),[a,setA]=useState(r.pair?.[0]??r.patchIds[0]),[b,setB]=useState(r.pair?.[1]??r.patchIds[1]??'');
 useSyncExternalStore(subscribeSmooth,smoothVersion);const result=getSmoothResult(p);
 const name=(id:string)=>{const row=patchRows(p).find(r=>r.primary.id===id||r.mirror?.id===id),side=row?.mirror?(row.primary.id===id?' · 右':' · 左'):'';return (p.patches?.find(x=>x.id===id)?.name??`Patch ${p.patches!.findIndex(x=>x.id===id)+1}`)+side;};
 const point=(id:string|undefined)=>p.landmarks.find(l=>l.id===id)?.name??id;
 const errors=r.pair?.map(id=>{const q=p.patches!.find(x=>x.id===id)!;return result?.patches[q.canonicalId??id]?.error;}).filter(Boolean);
 return <div className="continuity-boundary" data-boundary-key={r.key} onMouseEnter={()=>useUI.setState({continuityHover:r.use})} onMouseLeave={()=>useUI.setState({continuityHover:null})}>
 <button className="continuity-boundary-title" onClick={()=>setOpen(!open)} aria-expanded={open}>{r.use.kind==='closed'?'完整闭环':`${point(r.use.startLandmarkId)} ↔ ${point(r.use.endLandmarkId)}`}<small>{r.patchIds.length} surfaces · {r.mode==='auto'?'Auto':r.mode==='crease'?'Crease':r.mode==='manual'?'Manual Pair':'Natural'}</small></button>
 {open&&<div data-ui-keyboard>
 {r.pair&&<small>配对：{r.pair.map(name).join(' ↔ ')}</small>}
 {!!errors?.length&&<small>⚠ 配对暂时失效：{errors.join('；')}</small>}
 {r.patchIds.length>=3&&<><small>未配对：{r.patchIds.filter(id=>!r.pair?.includes(id)).map(name).join('、')}</small><label>曲面 A<select aria-label="配对曲面 A" value={a} onChange={e=>setA(e.target.value)}>{r.patchIds.map(id=><option key={id} value={id}>{name(id)}</option>)}</select></label><label>曲面 B<select aria-label="配对曲面 B" value={b} onChange={e=>setB(e.target.value)}>{r.patchIds.map(id=><option key={id} value={id}>{name(id)}</option>)}</select></label><button disabled={!a||!b||a===b} onClick={()=>s.setContinuity(r.key,{mode:'manual',patchIds:[a,b]})}>{r.mode==='manual'?'Change Pair':'Set Pair'}</button></>}
 {r.mode==='manual'&&<button onClick={()=>s.setContinuity(r.key,undefined)}>Clear Pair</button>}
 {r.mode==='crease'?<button onClick={()=>s.setContinuity(r.key,undefined)}>Restore Auto</button>:r.patchIds.length>=2&&<button onClick={()=>s.setContinuity(r.key,{mode:'crease'})}>Crease</button>}
 </div>}
 </div>;
}
export function SmoothEdgeControl({id}:{id:string}){
 const p=useEditor(s=>s.project);useEffect(()=>()=>useUI.setState({continuityHover:null}),[id]);const ctx=evaluationContext(p);
 const start=(r:BoundaryRelation)=>{try{if(r.use.kind==='closed')return 0;return Math.min(curveLocationOfLandmark(id,r.use.startLandmarkId,ctx),curveLocationOfLandmark(id,r.use.endLandmarkId,ctx));}catch{return 0;}};
 const rows=relations(p).filter(r=>r.use.curveId===id).sort((a,b)=>start(a)-start(b)||a.key.localeCompare(b.key));
 return rows.length?<section className="surface-continuity" data-testid="surface-continuity"><strong>Surface Continuity</strong>{rows.map(r=><BoundaryRow key={r.key} r={r}/>)}</section>:null;
}
