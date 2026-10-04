import {useEffect,useMemo,useState} from 'react';
import {useEditor} from '../../app/store';
import {serializeProject} from '../../app/autosave';
import {useWorkspaceMode} from '../../app/workspaceMode';
import type {LandmarkProject} from '../../domain/landmarks/model';
import type {Point2} from '../../domain/drawing/model';
import {recordingSceneSources} from '../../domain/recordingScene/sources';
import {recordingRetirementStatus} from '../../domain/recordingSnapshot/retirement';
import PaintScene from '../drawing/PaintScene';
import {useDrawing} from '../drawing/session';
import {useLanguage} from '../i18n';

const noop=()=>{};
export default function LegacyRecordingReview(){
 const project=useEditor(s=>s.project),zh=useLanguage(s=>s.language)==='zh',text=(cn:string,en:string)=>zh?cn:en;
 const status=recordingRetirementStatus(project),sources=useMemo(()=>Object.entries(recordingSceneSources(project)),[project]);
 const [selected,setSelected]=useState(''),[reviewed,setReviewed]=useState<LandmarkProject|null>(null),[error,setError]=useState('');
 useEffect(()=>{setReviewed(null);setError('');},[project]);
 const source=sources.find(([id])=>id===selected)??sources[0],drawing=source?.[1];
 const points=drawing?[...drawing.nodes.map(node=>node.position),...drawing.curves.flatMap(curve=>curve.handles)]:[];
 const min:Point2=points.length?[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))]:[-1,-1],max:Point2=points.length?[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]:[1,1];
 const unit=Math.min(720/Math.max(.1,max[0]-min[0]),400/Math.max(.1,max[1]-min[1])),screen=(p:Point2):Point2=>[400+(p[0]-(min[0]+max[0])/2)*unit,230-(p[1]-(min[1]+max[1])/2)*unit];
 const exportOriginal=()=>{const url=URL.createObjectURL(new Blob([serializeProject(project)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`${project.meta.name}-original.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 if(!status)return null;
 return <section className="vr-legacy-review" data-testid="legacy-recording-review">
  <h2>{text('旧录制已停用 · 源画稿只读','Legacy recordings retired · Source artworks are read-only')}</h2>
  <p>{text('文件中的画稿和录制数据仍保留。现在可以查看源画稿和导出原档；清空录制关系后，才能继续绘制和建立新的录制。','The file’s artworks and recording data are retained. View source artworks or export the original file. Clear recording relationships to resume drawing and create new recordings.')}</p>
  <p>{text(`将清空 ${status.recordingCount} 个录制记录、${status.snapshotCount} 个非源稿快照：`,`Clearing removes ${status.recordingCount} recording records and ${status.snapshotCount} non-source snapshots:`)}</p>
  <ul>{status.recordings.map((recording,index)=><li key={`${recording.kind}/${recording.id}/${index}`}>{recording.name}</li>)}</ul>
  {status.newRecordingCount>0&&<p role="note">{text(`这是新旧录制混合文件。清空动作也会删除其中 ${status.newRecordingCount} 个新录制及其引用关系。`,`This file mixes old and new recordings. Clearing also removes its ${status.newRecordingCount} new recordings and their references.`)}</p>}
  <p>{text('所有录制角度、响应、快照中的局部修改和引用关系都会清空；仅保留原始源画稿及其线条、图层和普通属性。先导出原档即可另存备份。','All recording angles, responses, local snapshot edits and references will be cleared. Original source artworks, curves, layers and ordinary properties are retained. Export the original file first to keep a backup.')}</p>
  <div className="vr-legacy-actions"><button data-testid="legacy-export-original" onClick={exportOriginal}>{text('导出原档','Export original file')}</button><button data-testid="legacy-review-reset" onClick={()=>setReviewed(project)}>{text('仅保留画稿、清空录制后开始','Keep artworks and clear recordings to start')}</button></div>
  {reviewed&&<section role="dialog" aria-modal="true" aria-label={text('确认清空全部录制关系','Confirm clearing all recording relationships')} className="vr-legacy-confirm" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setReviewed(null);}}}>
   <h3>{text('确认清空全部录制关系？','Clear all recording relationships?')}</h3><p>{text(`将删除上列 ${status.recordingCount} 个录制记录及全部录制角度、响应和快照引用。原始画稿保留；可撤销。`,`This removes the ${status.recordingCount} records listed above and all recording angles, responses and snapshot references. Original artworks remain. You can undo this action.`)}</p>
   <button data-testid="legacy-cancel-reset" autoFocus onClick={()=>setReviewed(null)}>{text('取消，保留原档','Cancel and keep original')}</button><button data-testid="legacy-confirm-reset" onClick={()=>{try{useEditor.getState().clearRecordingRelationships(reviewed);useWorkspaceMode.getState().setMode('drawing');useDrawing.getState().set({room:true,tool:'select',selection:{ids:[]},layerId:null});}catch(e){setError((e as Error).message);}}}>{text('确认清空，开始编辑画稿','Confirm clear and edit artworks')}</button>
  </section>}
  {error&&<p role="alert">{error}</p>}
  <label>{text('查看源画稿','View source artwork')} <select aria-label="Source artwork preview" value={source?.[0]??''} onChange={e=>setSelected(e.target.value)}>{sources.map(([id])=><option key={id} value={id}>{project.drawingSnapshots?.items.find(item=>item.id===id)?.name??text('当前画稿','Current artwork')}</option>)}</select></label>
  {drawing?<><p>{text(`${drawing.layers.length} 个图层 · ${drawing.curves.length} 条曲线 · 仅显示源画稿，不播放旧录制`,`${drawing.layers.length} layers · ${drawing.curves.length} curves · Source artwork preview; retired recordings do not play`)}</p><svg data-testid="legacy-source-preview" viewBox="0 0 800 460" aria-label={text('源画稿只读预览','Read-only source artwork preview')}><PaintScene d={drawing} screen={screen} unit={unit} preview showFills referenceMoving={false} tool="select" curveDown={noop} paintDown={noop} arcDown={noop}/></svg></>:<p>{text('此文件没有可查看的源画稿。请先导出原档，再决定是否清空。','This file has no source artworks to preview. Export the original before deciding whether to clear recordings.')}</p>}
 </section>;
}
