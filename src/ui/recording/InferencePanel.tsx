import {useEffect,useMemo,useState} from 'react';
import {WandSparkles,Check,Trash2} from 'lucide-react';
import {useEditor} from '../../app/store';
import {inferPoseCurves,discardPoseInference,applyPoseInference,inferenceProblem} from '../../domain/recording/poseInference';
import {curveById} from '../../domain/drawing/model';
import type {PoseRecording,RecordedPose} from '../../domain/recording/poses';
import {uiText as t} from '../i18n';

export default function InferencePanel({recording:r,curveId,commit,selectPose,onError}:{recording:PoseRecording;curveId?:string;commit:(r:PoseRecording)=>void;selectPose:(p:RecordedPose,curveId:string)=>void;onError:(s:string)=>void}){
 const sources=r.poses.filter(p=>curveId&&curveById(p.drawing,curveId)),[source,setSource]=useState(''),[targets,setTargets]=useState<string[]>([]);
 const selectedSource=sources.find(p=>p.id===source)??sources.at(-1),curve=selectedSource&&curveById(selectedSource.drawing,curveId!);
 const [notice,setNotice]=useState<{id:string;text:string}>(),problems=useMemo(()=>new Map((r.inferences??[]).map(i=>[i.id,inferenceProblem(r,i)])),[r]);
 useEffect(()=>{setTargets([]);setSource('');},[curveId]);
 const run=(fn:()=>void)=>{try{fn();onError('');}catch(e){onError((e as Error).message);}};
 return <>
 {notice&&!r.inferences?.some(i=>i.id===notice.id)&&<p className="pose-inference-notice" role="status">{notice.text}</p>}
 {curve&&<section className="pose-inference" data-testid="pose-inference-panel"><strong><WandSparkles size={15}/> {t('推断缺失姿态')} · {curve.name}</strong>
  <label>{t('源录制姿态')}<select aria-label={t('源录制姿态')} value={selectedSource!.id} onChange={e=>setSource(e.target.value)}>{sources.map(p=><option key={p.id} value={p.id}>{p.name} · {p.yaw}° / {p.pitch}°</option>)}</select></label>
  <span>{t('推断到以下姿态')}</span>
  <div className="pose-inference-targets">{r.poses.map(p=>{const exists=!!curveById(p.drawing,curveId!),pending=r.inferences?.some(i=>i.targetPoseId===p.id&&i.curve.id===curveId);return <label key={p.id}><input type="checkbox" aria-label={`${t('推断到')} ${p.name}`} disabled={exists||pending} checked={!exists&&!pending&&targets.includes(p.id)} onChange={e=>setTargets(e.target.checked?[...targets,p.id]:targets.filter(id=>id!==p.id))}/><span>{p.name}<small>{p.yaw}° / {p.pitch}° · {t(exists?'已有曲线':pending?'已有草稿':'未覆盖')}</small></span></label>;})}</div>
  <button className="pose-primary" data-testid="pose-infer" disabled={!targets.length} onClick={()=>run(()=>{const next=inferPoseCurves(r,curveId!,selectedSource!.id,targets);commit(next);selectPose(next.poses.find(p=>p.id===targets[0])!,curveId!);setTargets([]);})}><WandSparkles size={15}/>{t('生成推断草稿')}</button>
  <small>{t('按同图层变形趋势补齐整条线，先用断线区间完全隐藏。')}</small>
 </section>}
 {!!r.inferences?.length&&<section className="pose-inference-drafts" data-testid="pose-inference-drafts"><strong>{t('推断草稿')} · {r.inferences.length}</strong>{r.inferences.map(item=>{
  const p=r.poses.find(p=>p.id===item.targetPoseId),problem=problems.get(item.id);return <div key={item.id} className="pose-inference-card" data-testid="pose-inference-draft" data-id={item.id}>
   <button className="pose-inference-preview" onClick={()=>p&&selectPose(p,item.curve.id)}>{item.curve.name} → {p?.name??t('姿态已删除')}</button>
   <small>{t('参考曲线')}：{item.supportCount} · {t('尚未写入快照')}</small>
   <label>{t('显现方向')}<select aria-label={`${t('草稿显现方向')} ${item.curve.name}`} value={item.revealFrom} onChange={e=>commit({...r,inferences:r.inferences!.map(i=>i.id===item.id?{...i,revealFrom:+e.target.value as 0|1}:i)})}><option value={0}>{t('从端点 A 显现')}</option><option value={1}>{t('从端点 B 显现')}</option></select></label>
   {problem&&<small role="alert">{t(problem)}</small>}
   <div className="pose-inference-actions"><button data-testid="pose-inference-apply" disabled={!!problem} onClick={()=>run(()=>{
    const editor=useEditor.getState(),next=applyPoseInference({...editor.project,poseRecording:r},item.id);
    editor.beginEdit();try{editor.setDrawingSnapshotState(next);editor.setPoseRecording(next.poseRecording!);}finally{editor.endEdit();}
    setNotice({id:item.id,text:`${t('已应用到快照')}：${p?.name}。${t('在绘制间切换到该快照即可精修。')}`});
   })}><Check size={14}/>{t('应用到快照')}</button><button aria-label={t('删除推断草稿')} onClick={()=>commit(discardPoseInference(r,item.id))}><Trash2 size={14}/></button></div>
  </div>;
 })}</section>}
 </>;
}
