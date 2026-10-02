import {useEffect,useRef,useState} from 'react';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
import {getWorkspaceView,replaceWorkspaceView} from '../../app/workspaceView';
import {useDrawing} from '../drawing/session';
import {useLanguage} from '../i18n';
import {planArtworkCleanup} from '../../app/artworkCleanup';
import {listArtworkCleanupBackups} from '../../app/artworkCleanupBackups';
import {applyArtworkCleanupPlan,restoreArtworkCleanupProject} from '../../app/artworkCleanupActions';
import type {LandmarkProject} from '../../domain/landmarks/model';

type Plan=Awaited<ReturnType<typeof planArtworkCleanup>>;
type Backup=Awaited<ReturnType<typeof listArtworkCleanupBackups>>[number];
export default function ArtworkCleanupDialog({close}:{close:()=>void}){
 const {language}=useLanguage(),zh=language==='zh',t=(cn:string,en:string)=>zh?cn:en;
 const dialog=useRef<HTMLDialogElement>(null),[plan,setPlan]=useState<Plan>(),[before,setBefore]=useState<LandmarkProject>(),[backups,setBackups]=useState<Backup[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[restoreId,setRestoreId]=useState('');
 async function refresh(){
  setError('');setBusy(true);setPlan(undefined);
  const project=useEditor.getState().project;setBefore(project);
  try{setPlan(await planArtworkCleanup(project));}catch(e){setError((e as Error).message);}
  try{setBackups(await listArtworkCleanupBackups());}catch(e){setError(old=>[old,(e as Error).message].filter(Boolean).join(' '));}
  setBusy(false);
 }
 useEffect(()=>{dialog.current?.showModal();void refresh();return()=>dialog.current?.close();},[]);
 const host={getProject:()=>useEditor.getState().project,commit:(expected:LandmarkProject,next:LandmarkProject)=>{useWorkspaceMode.getState().setMode('drawing');useEditor.getState().commitArtworkCleanup(expected,next);},restore:(p:LandmarkProject)=>{useWorkspaceMode.getState().setMode('drawing');useEditor.getState().load(p);useEditor.getState().endEdit();}};
 async function organize(){
  if(!plan||!before)return;setBusy(true);setError('');
  try{
   await applyArtworkCleanupPlan(host,before,plan.project);
   const view=getWorkspaceView(),reference=view.reference;if(reference&&!plan.kept.some(item=>item.id===reference.artworkId)){const mapped=plan.mappings.find(item=>item.fromArtworkId===reference.artworkId);if(mapped)replaceWorkspaceView({...view,reference:{...reference,artworkId:mapped.toArtworkId}});else{const {reference:removed,...rest}=view;void removed;replaceWorkspaceView(rest);}}
   useDrawing.getState().set({selection:{ids:[]},layerId:null,tool:'select'});
   setNotice(t('已整理为5份画稿，原工程已保存到本机恢复备份；可撤销。','Kept the five artworks. The original project is backed up in this browser; Undo is available.'));
   await refresh();
  }catch(e){setError((e as Error).message);setBusy(false);}
 }
 async function restore(){
  if(!restoreId)return;setBusy(true);setError('');
  try{
   await restoreArtworkCleanupProject(host,restoreId);
   useDrawing.getState().set({selection:{ids:[]},layerId:null,tool:'select'});setRestoreId('');
   setNotice(t('已恢复所选备份的完整工程；恢复前的工程也已另存恢复备份。','Restored the complete project. The project from before restoration is also backed up.'));await refresh();
  }catch(e){setError((e as Error).message);setBusy(false);}
 }
 return <dialog ref={dialog} className="drawing-pen-settings artwork-cleanup-dialog" data-testid="artwork-cleanup-dialog" style={{width:'min(720px,90vw)',maxHeight:'85vh',overflow:'auto'}} onCancel={e=>{e.preventDefault();if(!busy)close();}} onKeyDown={e=>e.stopPropagation()}>
  <h2>{t('整理画稿库 · 保留5份','Organize artworks · keep five')}</h2>
  <p>{t('保留原正面、微侧、稍侧，以及对称双半脸和90°侧脸。其他画稿与依赖它们的旧录制收进恢复备份；不永久删除。','Keep the original front, slight and intermediate views, the symmetric two-half face, and the 90° profile. Other artworks and dependent old recordings go into a recovery backup.')}</p>
  {notice&&<p role="status">{notice}</p>}
  {error&&<p role="alert" style={{color:'var(--danger,#c44)'}}>{error}</p>}
  {plan&&<>
   <h3>{t('保留','Keep')} · {plan.kept.length}</h3>
   <ul>{plan.kept.map(item=><li key={item.id}>{item.name}</li>)}</ul>
   <h3>{t('移入恢复备份','Archive to recovery')} · {plan.removed.length}</h3>
   {plan.removed.length?<ul style={{maxHeight:180,overflow:'auto'}}>{plan.removed.map(item=><li key={item.id}>{item.name}</li>)}</ul>:<p>{t('没有其他画稿需要整理。','No additional artworks to archive.')}</p>}
   {plan.archivedScenes.length>0&&<p>{t('一并归档旧录制场景：','Recording scenes archived with their sources: ')}{plan.archivedScenes.map(s=>s.name).join('、')}</p>}
  </>}
  <div style={{display:'flex',gap:8,flexWrap:'wrap',margin:'16px 0'}}>
   <button disabled={busy} onClick={()=>void refresh()}>{t('重新检查','Refresh list')}</button>
   <button data-testid="apply-artwork-cleanup" disabled={busy||!plan||plan.project===before} onClick={()=>void organize()}>{busy?t('处理中…','Working…'):t('整理并保留恢复备份','Organize and keep recovery backup')}</button>
  </div>
  <details open={!!restoreId}><summary>{t('恢复已整理的画稿','Restore an earlier backup')} · {backups.length}</summary>
   <p>{t('恢复会载入该备份的完整工程。操作前会再备份当前工程，后来做的修改也可找回。备份保存在这个浏览器，刷新后仍可用。','Restoration loads the complete project from that backup. The current project is backed up first, so newer work remains recoverable. Backups survive refresh in this browser.')}</p>
   <select aria-label={t('选择恢复备份','Choose recovery backup')} value={restoreId} disabled={busy} onChange={e=>setRestoreId(e.target.value)}><option value="">{t('选择备份…','Choose backup…')}</option>{backups.map(b=><option key={b.id} value={b.id}>{new Date(b.createdAt).toLocaleString()} · {b.projectName} · {b.artworkCount}{t('稿',' artworks')}</option>)}</select>
   <button data-testid="restore-artwork-cleanup" disabled={busy||!restoreId} onClick={()=>void restore()}>{t('恢复此备份的完整工程','Restore this complete project')}</button>
  </details>
  <footer style={{marginTop:16}}><button disabled={busy} onClick={close}>{t('关闭','Close')}</button></footer>
 </dialog>;
}
