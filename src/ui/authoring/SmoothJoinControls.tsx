import {useState} from 'react';
import {useEditor} from '../../app/store';
import {incidentFreeEndpoints,endpointKey,joinOccurrences,JOIN_RADIUS} from '../../domain/curves/smoothJoin/model';
import {resolveJoin} from '../../domain/curves/smoothJoin/geometry';
import {evaluationContext} from '../../domain/geometry/evaluation';
import NumericSlider from '../shared/NumericSlider';
import {uiText} from '../i18n';
import type {ObjectRef} from './state';
export default function SmoothJoinControls({objectRef:r}:{objectRef:ObjectRef}){
 const s=useEditor(),p=s.project,[adding,setAdding]=useState(false),[a,setA]=useState(''),[b,setB]=useState(''),[radius,setRadius]=useState<number>(JOIN_RADIUS.default);
 if(r.kind!=='point'&&r.kind!=='curve')return null;
 const all=(p.curveSmoothJoins??[]).flatMap(j=>joinOccurrences(p,j));
 const rows=all.filter(j=>r.kind==='point'?j.pointId===r.id:j.a.curveId===r.id||j.b.curveId===r.id);
 const candidates=r.kind==='point'?incidentFreeEndpoints(p,r.id):[],occupied=new Set(all.flatMap(j=>[endpointKey(j.a),endpointKey(j.b)]));
 if(!rows.length&&!candidates.length)return null;
 const name=(id:string)=>p.curves.find(c=>c.id===id)?.name??id;
 const choices=candidates.map(e=>({key:endpointKey(e),e,label:`${name(e.curveId)} · ${uiText(e.endpoint)}`}));
 const start=()=>{const free=choices.filter(x=>!occupied.has(x.key));setA(free[0]?.key??'');setB(free[1]?.key??'');setAdding(true);};
 const link=(kind:'point'|'curve',id:string,label:string)=><button type="button" onClick={()=>s.selectObject({kind,id})}>{label} →</button>;
 return <div className="smooth-joins"><h4>{uiText('Smooth Joins')}</h4>{rows.map(j=>{const result=resolveJoin(p,j,id=>evaluationContext(p).sourceCurve(id));return <div key={j.id} className="smooth-join">
 <div>{name(j.a.curveId)} ↔ {name(j.b.curveId)}</div>
 {r.kind==='curve'&&<div>{link('point',j.pointId,p.landmarks.find(l=>l.id===j.pointId)?.name??j.pointId)}{link('curve',j.a.curveId===r.id?j.b.curveId:j.a.curveId,uiText('Partner'))}</div>}
 <NumericSlider label={uiText('Smooth Radius')} value={j.radiusRatio} min={0} max={JOIN_RADIUS.max} onChange={v=>s.setJoinRadius(j.id,v)} onEditStart={()=>s.beginEdit(true)} onEditEnd={s.endEdit}/>
 {result.warning&&<p role="status">⚠ {uiText(result.warning)}</p>}
 <button type="button" onClick={()=>s.removeSmoothJoin(j.id)}>{uiText('Remove Smooth Join')}</button></div>;})}
 {r.kind==='point'&&!adding&&<button type="button" disabled={choices.filter(x=>!occupied.has(x.key)).length<2} onClick={start}>{uiText('+ Add Smooth Join')}</button>}
 {r.kind==='point'&&adding&&<div>{[a,b].map((value,i)=><label key={i}>{uiText(i===0?'Curve A':'Curve B')}<select aria-label={uiText(i===0?'Curve A':'Curve B')} value={value} onChange={e=>(i===0?setA:setB)(e.target.value)}><option value="">—</option>{choices.map(x=><option key={x.key} value={x.key} disabled={occupied.has(x.key)||x.key===(i===0?b:a)}>{x.label}{occupied.has(x.key)?` (${uiText('Endpoint already joined')})`:''}</option>)}</select></label>)}
 <NumericSlider label={uiText('Smooth Radius')} min={0} max={JOIN_RADIUS.max} value={radius} onChange={setRadius}/>
 <button type="button" disabled={!a||!b||a===b} onClick={()=>{s.addSmoothJoin(r.id,choices.find(x=>x.key===a)!.e,choices.find(x=>x.key===b)!.e,radius);if(useEditor.getState().project!==p)setAdding(false);}}>{uiText('Create Smooth Join')}</button>
 <button type="button" onClick={()=>setAdding(false)}>{uiText('Cancel')}</button></div>}
 </div>;
}
