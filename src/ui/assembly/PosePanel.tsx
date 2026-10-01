import {useDrawing} from '../assemblyDrawing/session';
import {beginRefinementFrame} from '../../domain/assembly/refinement';
import {useEffect,useState} from 'react';
import {Trash2,RotateCcw,Plus,Check} from 'lucide-react';
import type {AssemblyDocument} from '../../domain/assembly/model';
import {sameAngle,placementName} from '../../domain/assembly/placement';
import {poseRows,savePose,discardPose,visitPose,deletePose,setTimelineStage,setBaseEditing,setTimelineLoop,setBaseAngle,layerPoseStatus,deleteLayerPose,deleteSharedPose,pinLayerPose,type PoseChannel,type AssemblyStage} from '../../domain/assembly/timeline';
import {uiText as t} from '../i18n';
type Props={a:AssemblyDocument;change:(fn:(a:AssemblyDocument)=>AssemblyDocument)=>void};
const channelLabels:Record<PoseChannel,string>={placement:'图层定位偏移',perspective:'四角透视',intervals:'显示区间',bend:'区域变形',refine:'单线微调'};
const statuses={draft:'待保存',key:'已设关键帧',interpolated:'插值',outside:'沿用最近记录',base:'基准值',zero:'未微调 · 偏移 0'};

export function PoseToolbar({a,change}:{a:AssemblyDocument}&Props){
 const timeline=a.timeline!,rows=poseRows(a),current=rows.find(r=>sameAngle(r,a.pose));
 return <div className="assembly-pose-bar" data-testid="assembly-pose-toolbar" data-ui-keyboard>
  <div className="assembly-stage-selector" role="group" aria-label={t('变形阶段')}>
   {(['BASE','PLACEMENT','BEND','REFINE'] as AssemblyStage[]).map((stage,i)=><button key={stage} data-testid={`assembly-stage-${stage.toLowerCase()}`} aria-pressed={!timeline.editingBase&&(timeline.stage===stage||stage==='BEND'&&timeline.stage==='PERSPECTIVE')} title={t(['查看基准原稿','应用定位轨迹与远近缩放','应用定位与区域变形（四角透视＋曲边）','应用完整变形，再编辑当前角度的单线修正'][i])} onClick={()=>{change(a=>{const next=setTimelineStage(a,stage);if(stage!=='REFINE')return next;const s=useDrawing.getState(),ids=s.selection.layers??[s.selection.layer??s.layerId??a.drawing.layers[0]?.id];return beginRefinementFrame(next,ids.filter((id):id is string=>!!id));});if(stage==='REFINE')useDrawing.getState().set({tool:'direct'});}}>{t(['原稿','定位','区域变形','单线微调'][i])}</button>)}
  </div>
  <label className="assembly-apply-intervals" title={t('仅控制整体预览；区间随角度启停请在属性中设置。')}><input type="checkbox" data-testid="assembly-apply-intervals" checked={timeline.applyIntervals} onChange={e=>{const applyIntervals=e.target.checked;change(a=>({...a,timeline:{...a.timeline!,applyIntervals}}));}}/>{t('显示区间')}</label>
  <button className="assembly-base-edit" data-testid="assembly-base-edit" aria-pressed={timeline.editingBase} title={t('编辑共用原稿；角度姿态中的定位、透视和区间记录保留')} onClick={()=>change(a=>setBaseEditing(a,!a.timeline!.editingBase))}>{t(timeline.editingBase?'完成原稿编辑':'编辑原稿')}</button>
  <div className="assembly-pose-navigation">
   <select aria-label={t('角度姿态')} data-testid="assembly-pose-select" value={current?`${current.yaw}:${current.pitch}`:''} onChange={e=>{const [yaw,pitch]=e.target.value.split(':').map(Number);change(a=>visitPose(a,{yaw,pitch}));}}>
    {!current&&<option value="">{placementName(a.pose)} · {t('插值预览')}</option>}
    {rows.map(r=><option key={`${r.yaw}:${r.pitch}`} value={`${r.yaw}:${r.pitch}`}>{r.name===placementName(r)?r.name:`${r.name} · ${r.yaw}° / ${r.pitch}°`}{r.dirty?' *':''}</option>)}
   </select>
   <span role="status" data-testid="assembly-pose-status" data-dirty={!!current?.dirty}>{t(timeline.editingBase?'原稿编辑 · 影响共用资产':current?.dirty?'有未保存修改':current?.saved?'已录制':'插值预览')}</span>
   <button className="assembly-pose-save" data-testid="assembly-pose-save" disabled={timeline.editingBase} onClick={()=>change(a=>savePose(a))}><Check size={13}/>{t(current?.saved?'更新此姿态':'保存此姿态')}</button>
   {current?.dirty&&<button data-testid="assembly-pose-discard" title={t('撤回当前角度所有未保存修改')} aria-label={t('撤回姿态草稿')} onClick={()=>change(discardPose)}><RotateCcw size={14}/></button>}
  </div>
 </div>;
}

export function PoseDetails({a,change,layerIds}:{layerIds:string[]}&Props){
 const rows=poseRows(a),current=rows.find(r=>sameAngle(r,a.pose)),timeline=a.timeline!;
 const [name,setName]=useState(current?.name??placementName(a.pose));
 useEffect(()=>{setName(current?.name??placementName(a.pose));},[a.pose.yaw,a.pose.pitch,current?.name]);
 const shared=[...a.locators.map(l=>({id:l.id,kind:'locators' as const,name:l.name})),...a.planes.map(p=>({id:p.id,kind:'planes' as const,name:p.name}))].filter(x=>[...a.placement?.keys??[],...a.placement?.drafts??[]].some(k=>sameAngle(k,a.pose)&&k.values[x.kind][x.id]!==undefined));
 return <details className="assembly-pose-details" open data-testid="assembly-pose-details"><summary>{t('姿态记录')} <span>{rows.filter(r=>r.saved).length} {t('个角度')}</span></summary>
  <p className="assembly-pose-angle">{placementName(a.pose)}</p>
  {layerIds.length?<div className="assembly-layer-keys">{layerIds.map(id=>{const layer=a.drawing.layers.find(l=>l.id===id);if(!layer)return null;
   return <div key={id} className="assembly-layer-key" data-testid="assembly-layer-key" data-layer={id}><strong title={layer.name}>{layer.name}</strong>
    {(['placement','bend','refine','intervals'] as PoseChannel[]).map(channel=>{const statusesFor=channel==='bend'?[layerPoseStatus(a,id,'bend'),layerPoseStatus(a,id,'perspective')]:[layerPoseStatus(a,id,channel)],status=statusesFor.includes('draft')?'draft':statusesFor.includes('key')?'key':statusesFor.includes('interpolated')?'interpolated':statusesFor.includes('outside')?'outside':statusesFor.includes('zero')?'zero':'base',key=status==='key'||status==='draft';return <div className="assembly-channel-key" key={channel} data-channel={channel} data-status={status}>
     <span>{t(channelLabels[channel])}</span><small>{t(statuses[status])}</small>
     {key?<button title={t(channel==='refine'?'删除微调；此图层仍有姿态记录时偏移归零':'删除此角度记录，恢复插值')} aria-label={`${t('删除')}${t(channelLabels[channel])} · ${layer.name}`} onClick={()=>change(a=>channel==='bend'?deleteLayerPose(deleteLayerPose(a,id,'perspective'),id,'bend'):deleteLayerPose(a,id,channel))}><Trash2 size={12}/></button>:channel!=='placement'&&channel!=='refine'?<button disabled={timeline.editingBase||(channel==='perspective'&&!a.perspectives?.some(p=>p.layerId===id)||channel==='bend'&&!a.perspectives?.some(p=>p.layerId===id))} title={t('只在当前图层固定这一项的当前值')} aria-label={`${t('固定')}${t(channelLabels[channel])} · ${layer.name}`} onClick={()=>change(a=>channel==='bend'?pinLayerPose(pinLayerPose(a,id,'perspective'),id,'bend'):pinLayerPose(a,id,channel))}><Plus size={12}/></button>:null}
    </div>;})}
    {(['placement','bend','refine','intervals'] as PoseChannel[]).some(c=>['key','draft'].includes(layerPoseStatus(a,id,c)))&&<button className="assembly-remove-layer-key" onClick={()=>change(a=>deleteLayerPose(a,id))}>{t('删除此图层当前角度记录')}</button>}
   </div>;
  })}</div>:<small>{t('选择图层，查看各项记录。未设关键帧的项目自动插值。')}</small>}
  {!!shared.length&&<details><summary>{t('共享定位点与平面')} · {shared.length}</summary><small>{t('这些定位记录会影响所有挂接图层。')}</small>{shared.map(x=><div className="assembly-shared-key" key={x.id}><span>{x.name}</span><button title={t('删除此角度的共享定位记录')} aria-label={`${t('删除定位记录')} · ${x.name}`} onClick={()=>change(a=>deleteSharedPose(a,x.kind,x.id))}><Trash2 size={12}/></button></div>)}</details>}
  <details><summary>{t('姿态管理')}</summary>
   <label>{t('姿态名称')}<input aria-label={t('姿态名称')} value={name} maxLength={80} onChange={e=>setName(e.target.value)} onBlur={()=>{if(name.trim()&&name!==current?.name&&current?.saved)change(a=>({...a,timeline:{...a.timeline!,labels:[...a.timeline!.labels.filter(l=>!sameAngle(l,a.pose)),{yaw:current.yaw,pitch:current.pitch,name:name.trim()}]}}));}}/></label>
   <label className="assembly-placement-option"><input type="checkbox" data-testid="assembly-pose-loop" checked={timeline.loop} onChange={e=>{const loop=e.target.checked;change(a=>setTimelineLoop(a,loop));}}/>{t('整圈循环插值')}</label>
   <small>{t('未覆盖范围沿用最近记录；保存姿态只记录修改过的项目。')}</small>
   <button className="assembly-delete" data-testid="assembly-pose-delete" disabled={!current?.saved} onClick={()=>change(deletePose)}>{t('删除当前角度的所有记录')}</button>
  </details>
  <details><summary>{t('原稿基准角度')} · {timeline.base.yaw}° / {timeline.base.pitch}°</summary>
   <small>{t('原稿可以从侧面开始绘制；在录制其他角度前设置。')}</small>
   <button data-testid="assembly-set-base-angle" disabled={rows.some(r=>r.saved&&!sameAngle(r,timeline.base))} onClick={()=>change(a=>setBaseAngle(a,a.pose))}>{t('以当前角度作为原稿基准')}</button>
  </details>
 </details>;
}
