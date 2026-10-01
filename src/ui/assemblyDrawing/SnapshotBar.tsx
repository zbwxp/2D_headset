import {sameDeformSnapshotFrame} from '../../domain/assembly/deformRecording';
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
 const rig=useEditor(s=>s.project.assembly);
 const dirty=useMemo(()=>!current||!snapshotMatches(drawing,library!,current.id)||!!rig&&!sameDeformSnapshotFrame(rig,rig.frames[current.id]),[drawing,library,current,rig]);
 const dialog=useRef<HTMLDialogElement>(null),valid=name.trim().length>0&&name.trim().length<=80;
 useEffect(()=>{if(!prompt)return;const element=dialog.current!;element.showModal();return()=>element.close();},[prompt]);
 function apply(change:(state:DrawingSnapshotState)=>DrawingSnapshotState,restore=false){
  try{commitDrawingSnapshot(change);setError('');setPrompt(null);if(restore)switched();}catch(e){setError(t((e as Error).message));}
 }
 function open(kind:Prompt['kind'],target?:string){
  prepare();setError('');setName(kind==='rename'?current?.name??'':!library?.items.length?t('正面'):current?`${current.name} ${t('副本')}`:`${t('快照')} ${(library?.items.length??0)+1}`);setPrompt({kind,target});
 }
 function select(id:string){
  if(!id)return;prepare();
  // Read after finishing any pending arrow-key edit.
  const p=useEditor.getState().project,s=p.drawingSnapshots!,doc=p.drawing??EMPTY;
  if(!s.activeId||!snapshotMatches(doc,s,s.activeId)||!!p.assembly&&!sameDeformSnapshotFrame(p.assembly,p.assembly.frames[s.activeId]))open('switch',id);
  else apply(state=>restoreDrawingSnapshot(state,id),true);
 }
 const target=library?.items.find(x=>x.id===prompt?.target);
 return <section className="assembly-drawing-snapshots" aria-label={t('视角快照')} data-testid="assembly-drawing-snapshots">
  <strong>{t('快照')}</strong>
  <select aria-label={t('切换快照')} value={current?.id??''} onChange={e=>select(e.target.value)}>
   <option value="" disabled>{t('当前画布 · 尚未保存快照')}</option>
   {library?.items.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
  </select>
  <span className={dirty?'assembly-drawing-snapshot-dirty':'assembly-drawing-muted'} data-testid="assembly-drawing-snapshot-status">{t(current?(dirty?'有未保存修改':'已保存'):'未存为快照')}</span>
  <button onClick={()=>open('save')}><Camera size={14}/>{t('保存为新快照')}</button>
  <button disabled={!current||!dirty} title={t('用当前画布更新此快照')} onClick={()=>{prepare();apply(s=>saveDrawingSnapshot(s,current!.name,current!.id));}}><RefreshCw size={14}/>{t('更新当前快照')}</button>
  <button disabled={!current} aria-label={t('重命名快照')} title={t('重命名快照')} onClick={()=>open('rename')}><Pencil size={14}/></button>
  <button disabled={!current} aria-label={t('删除快照')} title={t('删除快照')} onClick={()=>open('delete',current!.id)}><Trash2 size={14}/></button>
  {error&&!prompt&&<span role="alert">{error}</span>}
  {prompt&&<dialog ref={dialog} role="dialog" className="assembly-drawing-pen-settings assembly-drawing-snapshot-dialog" aria-label={t(prompt.kind==='switch'?'切换前保存修改':prompt.kind==='rename'?'重命名快照':prompt.kind==='delete'?'删除快照':'保存为新快照')} onCancel={e=>{e.preventDefault();setPrompt(null);}}>
   <form onSubmit={e=>{e.preventDefault();if(!valid&&prompt.kind!=='delete')return;
    if(prompt.kind==='delete')apply(s=>deleteDrawingSnapshot(s,prompt.target!));
    else if(prompt.kind==='rename')apply(s=>renameDrawingSnapshot(s,current!.id,name));
    else if(prompt.kind==='switch')apply(s=>restoreDrawingSnapshot(saveDrawingSnapshot(s,name),prompt.target!),true);
    else apply(s=>saveDrawingSnapshot(s,name));
   }}>
    <strong>{t(prompt.kind==='switch'?'切换前保存修改':prompt.kind==='rename'?'重命名快照':prompt.kind==='delete'?'删除快照':'保存为新快照')}</strong>
    {prompt.kind==='switch'&&<p>{t('当前修改尚未存入快照。可另存后切换，原快照保持不变。')}<br/>{t('切换到')}：{target?.name}</p>}
    {prompt.kind==='save'&&<p>{t('保存完整矢量姿态、遮挡与背景位置；后续编辑不会自动覆盖快照。')}</p>}
    {prompt.kind==='delete'?<p>{target?.name}<br/>{t('只删除快照，当前画布保留；可以撤销。')}</p>:<label className="assembly-drawing-field">{t('快照名称')}<input autoFocus aria-label={t('快照名称')} maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>}
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
