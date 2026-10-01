import {useDrawingWorkspace} from './workspace';
import {useEffect,useMemo,useRef,useState} from 'react';
import {restoreSnapshotLayer} from '../../domain/drawing/snapshotLayers';
import {uiText as t} from '../i18n';

export default function LayerSnapshotDialog({layerId,close,restored}:{layerId:string;close:()=>void;restored:()=>void}){
 const {editor:useEditor,commitDrawing,id:workspaceId}=useDrawingWorkspace();
 const d=useEditor(s=>s.project.drawing)!,library=useEditor(s=>s.project.drawingSnapshots);
 const candidates=library?.items.filter(s=>s.drawing.layers.some(l=>l.id===layerId))??[];
 const [sourceId,setSourceId]=useState(()=>candidates.find(s=>s.id!==library?.activeId)?.id??candidates[0]?.id??''),[error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),layer=d.layers.find(l=>l.id===layerId),source=library?.items.find(s=>s.id===sourceId);
 const plan=useMemo(()=>{if(!source)return null;try{return restoreSnapshotLayer(d,source.drawing,layerId);}catch(e){return {error:(e as Error).message};}},[d,source,layerId]);
 useEffect(()=>{const el=dialog.current!;el.showModal();return()=>el.close();},[]);
 return <dialog ref={dialog} role="dialog" aria-label={t('从快照恢复图层')} className="drawing-pen-settings drawing-layer-snapshot-dialog" onCancel={e=>{e.preventDefault();close();}}>
  <form onSubmit={e=>{e.preventDefault();try{
   const p=useEditor.getState().project,s=p.drawingSnapshots?.items.find(s=>s.id===sourceId);
   if(!s)throw Error('快照不存在。');
   commitDrawing(restoreSnapshotLayer(p.drawing!,s.drawing,layerId).document);restored();close();
  }catch(e){setError((e as Error).message);}}}>
   <strong>{t('从快照恢复图层')} · {layer?.name}</strong>
   <p>{t('替换此图层的全部内容与属性，保留图层位置、其他图层及背景；可以撤销。')}</p>
   <label className="drawing-field">{t('来源快照')}<select autoFocus aria-label={t('来源快照')} value={sourceId} onChange={e=>{setSourceId(e.target.value);setError('');}}>
    {!candidates.length&&<option value="">{t('没有包含此图层的快照')}</option>}
    {library?.items.map(s=><option key={s.id} value={s.id} disabled={!s.drawing.layers.some(l=>l.id===layerId)}>{s.name}{!s.drawing.layers.some(l=>l.id===layerId)?` · ${t('不含此图层')}`:''}</option>)}
   </select></label>
   {source&&<p>{t('恢复图层')}：{source.drawing.layers.find(l=>l.id===layerId)?.name}</p>}
   <p>{t(workspaceId!=='drawing'?'恢复后仍是发型画布的修改；更新快照才会保存。':'恢复后仍是当前画布的修改；点击「更新当前快照」才会保存并同步录制间。')}</p>
   {plan&&'document'in plan&&plan.detachedLinks>0&&<p role="status">{t('不再重合的跨层端点联动将解除，其他图层不会移动。')} ({plan.detachedLinks})</p>}
   {plan&&'document'in plan&&plan.affectedPaint>0&&<p role="status">{t('其他图层有填充或偏移依赖将被移除的曲线，恢复后会标为无效。')} ({plan.affectedPaint})</p>}
   {(error||plan&&'error'in plan)&&<p role="alert">{t(error||(plan as {error:string}).error)}</p>}
   <footer><button type="button" onClick={close}>{t('取消')}</button><button type="submit" disabled={!plan||'error'in plan}>{t('恢复此图层')}</button></footer>
  </form>
 </dialog>;
}
