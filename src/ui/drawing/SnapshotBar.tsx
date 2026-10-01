import ImportArtworkDialog from './ImportArtworkDialog';
import {useDrawingWorkspace} from './workspace';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Camera,RefreshCw,Pencil,Trash2} from 'lucide-react';
import {emptyDrawing} from '../../domain/drawing/model';
import {saveDrawingSnapshot,restoreDrawingSnapshot,renameDrawingSnapshot,deleteDrawingSnapshot,snapshotMatches,type DrawingSnapshotState} from '../../domain/drawing/snapshots';
import {uiText as t} from '../i18n';

const EMPTY=emptyDrawing();
type Prompt={kind:'save'|'rename'|'switch'|'delete';target?:string};
export default function SnapshotBar({prepare,switched}:{prepare:()=>void;switched:()=>void}){
 const {editor:useEditor,commitDrawingSnapshot}=useDrawingWorkspace();
 const drawing=useEditor(s=>s.project.drawing)??EMPTY,library=useEditor(s=>s.project.drawingSnapshots);
 const current=library?.items.find(x=>x.id===library.activeId),[prompt,setPrompt]=useState<Prompt|null>(null),[name,setName]=useState(''),[error,setError]=useState('');
 const dirty=useMemo(()=>!current||!snapshotMatches(drawing,library!,current.id),[drawing,library,current]);
 const [importing,setImporting]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),valid=name.trim().length>0&&name.trim().length<=80;
 useEffect(()=>{if(!prompt)return;const element=dialog.current!;element.showModal();return()=>element.close();},[prompt]);
 function apply(change:(state:DrawingSnapshotState)=>DrawingSnapshotState,restore=false){
  try{commitDrawingSnapshot(change);setError('');setPrompt(null);if(restore)switched();}catch(e){setError(t((e as Error).message));}
 }
 function open(kind:Prompt['kind'],target?:string){
  prepare();setError('');setName(kind==='rename'?current?.name??'':!library?.items.length?t('正面'):current?`${current.name} ${t('副本')}`:`${t('画稿')} ${(library?.items.length??0)+1}`);setPrompt({kind,target});
 }
 function select(id:string){
  if(!id)return;prepare();
  // Read after finishing any pending arrow-key edit.
  const p=useEditor.getState().project,s=p.drawingSnapshots!,doc=p.drawing??EMPTY;
  if(!s.activeId||!snapshotMatches(doc,s,s.activeId))open('switch',id);
  else apply(state=>restoreDrawingSnapshot(state,id),true);
 }
 const target=library?.items.find(x=>x.id===prompt?.target);
 return <section className="drawing-snapshots" aria-label={t('画稿库')} data-testid="drawing-snapshots">
  <strong>{t('画稿')}</strong>
  <select aria-label={t('切换画稿')} value={current?.id??''} onChange={e=>select(e.target.value)}>
   <option value="" disabled>{t('当前画布 · 尚未保存画稿')}</option>
   {library?.items.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
  </select>
  <span className={dirty?'drawing-snapshot-dirty':'drawing-muted'} data-testid="drawing-snapshot-status">{t(current?(dirty?'有未保存修改':'已保存'):'未存为画稿')}</span>
  <button onClick={()=>open('save')}><Camera size={14}/>{t('保存为新画稿')}</button>
  <button disabled={!current||!dirty} title={t('用当前画布更新此画稿')} onClick={()=>{prepare();apply(s=>saveDrawingSnapshot(s,current!.name,current!.id));}}><RefreshCw size={14}/>{t('更新当前画稿')}</button>
  <button disabled={!current} aria-label={t('重命名画稿')} title={t('重命名画稿')} onClick={()=>open('rename')}><Pencil size={14}/></button>
  <button disabled={!current} aria-label={t('删除画稿')} title={t('删除画稿')} onClick={()=>open('delete',current!.id)}><Trash2 size={14}/></button>
  <button data-testid="import-artwork-layers" onClick={()=>{prepare();setImporting(true);}}>{t('从画稿导入图层')}</button>
  {importing&&<ImportArtworkDialog close={()=>setImporting(false)}/>}
  {error&&!prompt&&<span role="alert">{error}</span>}
  {prompt&&<dialog ref={dialog} role="dialog" className="drawing-pen-settings drawing-snapshot-dialog" aria-label={t(prompt.kind==='switch'?'切换前保存修改':prompt.kind==='rename'?'重命名画稿':prompt.kind==='delete'?'删除画稿':'保存为新画稿')} onCancel={e=>{e.preventDefault();setPrompt(null);}}>
   <form onSubmit={e=>{e.preventDefault();if(!valid&&prompt.kind!=='delete')return;
    if(prompt.kind==='delete')apply(s=>deleteDrawingSnapshot(s,prompt.target!));
    else if(prompt.kind==='rename')apply(s=>renameDrawingSnapshot(s,current!.id,name));
    else if(prompt.kind==='switch')apply(s=>restoreDrawingSnapshot(saveDrawingSnapshot(s,name),prompt.target!),true);
    else apply(s=>saveDrawingSnapshot(s,name));
   }}>
    <strong>{t(prompt.kind==='switch'?'切换前保存修改':prompt.kind==='rename'?'重命名画稿':prompt.kind==='delete'?'删除画稿':'保存为新画稿')}</strong>
    {prompt.kind==='switch'&&<p>{t('当前修改尚未存入画稿。可另存后切换，原画稿保持不变。')}<br/>{t('切换到')}：{target?.name}</p>}
    {prompt.kind==='save'&&<p>{t('保存独立矢量画稿、遮挡与参考图；角度关键形在录制模式单独保存。')}</p>}
    {prompt.kind==='delete'?<p>{target?.name}<br/>{t('只删除画稿，当前画布保留；可以撤销。')}</p>:<label className="drawing-field">{t('画稿名称')}<input autoFocus aria-label={t('画稿名称')} maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>}
    {error&&<p role="alert">{error}</p>}
    <footer>
     <button type="button" onClick={()=>setPrompt(null)}>{t('取消')}</button>
     {prompt.kind==='switch'&&<button type="button" onClick={()=>apply(s=>restoreDrawingSnapshot(s,prompt.target!),true)}>{t('不保存并切换')}</button>}
     <button type="submit" disabled={!valid&&prompt.kind!=='delete'}>{t(prompt.kind==='switch'?'另存并切换':prompt.kind==='delete'?'删除':prompt.kind==='rename'?'确定':'保存')}</button>
    </footer>
   </form>
  </dialog>}
 </section>;
}
