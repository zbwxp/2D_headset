import type {AssemblyDocument} from '../../domain/assembly/model';
import {deformTrack,deformEvaluation,saveLayerDeform,discardLayerDeform,visitLayerDeform,deleteLayerDeformKey} from '../../domain/assembly/deformRecording';
import {sameAngle,placementName} from '../../domain/assembly/placement';
import {uiText as t} from '../i18n';
interface Props {a:AssemblyDocument;layerId?:string;change:(f:(a:AssemblyDocument)=>AssemblyDocument)=>void;preview:()=>void}
export default function DeformRecordingPanel({a,layerId,change,preview}:Props){
 const r=a.deformRecording,track=layerId?deformTrack(a,layerId):undefined,e=layerId?deformEvaluation(a,layerId):undefined;
 const key=track?.keys.find(k=>sameAngle(k,a.pose)),draft=track?.drafts.find(k=>sameAngle(k,a.pose));
 const rows=[...track?.keys??[],...(track?.drafts??[]).filter(d=>!track?.keys.some(k=>sameAngle(k,d)))].sort((a,b)=>a.pitch-b.pitch||a.yaw-b.yaw);
 const active=rows.find(k=>sameAngle(k,a.pose));
 const action=(f:(a:AssemblyDocument)=>AssemblyDocument)=>{change(f);preview();};
 const status=e?.issue?'变形过于极端，请补充过渡关键帧。':track&&!r?.enabled?'变形录制已暂停':draft?'当前图层有未保存变形':key?'当前角度已录制变形':track?.keys.length?e?.covered?'变形插值预览':'范围外：沿用最近变形':'当前图层尚未录制变形';
 return <div className="assembly-deform-recording" data-testid="assembly-deform-recording" data-ui-keyboard>
  <strong>{t('图层变形录制')}</strong><span>{placementName(a.pose)}</span>
  {r&&<label><input type="checkbox" data-testid="assembly-deform-enabled" checked={r.enabled} onChange={ev=>{const enabled=ev.target.checked;action(a=>({...a,deformRecording:{...a.deformRecording!,enabled}}));}}/>{t('使用变形录制')}</label>}
  <button data-testid="assembly-deform-save" disabled={!layerId||!e?.value||!!track&&!r?.enabled} onClick={()=>action(a=>saveLayerDeform(a,layerId!))}>{t(key?'更新当前角度变形':'保存当前图层变形')}</button>
  {draft&&<button data-testid="assembly-deform-discard" onClick={()=>action(a=>discardLayerDeform(a,layerId!))}>{t('撤回变形草稿')}</button>}
  {!!rows.length&&<><select aria-label={t('已录制变形角度')} value={active?.id??''} onChange={ev=>action(a=>visitLayerDeform(a,layerId!,ev.target.value))}><option value="" disabled>{t('选择录制角度')}</option>{rows.map(k=><option key={k.id} value={k.id}>{placementName(k)}{track?.drafts.some(d=>sameAngle(k,d))?' · '+t('待保存'):''}</option>)}</select>
   <button data-testid="assembly-deform-delete" disabled={!key} onClick={()=>action(a=>deleteLayerDeformKey(a,layerId!,key!.id))}>{t('删除当前变形帧')}</button></>}
  {r&&<label><input type="checkbox" data-testid="assembly-deform-loop" checked={r.loop} onChange={ev=>{const loop=ev.target.checked;change(a=>({...a,deformRecording:{...a.deformRecording!,loop}}));}}/>{t('变形整圈循环')}</label>}
  <small data-testid="assembly-deform-status" role="status">{t(status)}</small>
  {!track&&<small>{t('首次从侧面录制会补一个未变形的正面基准。')}</small>}
 </div>;
}
