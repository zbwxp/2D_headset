import {useEffect,useMemo,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import type {Point2,DrawingDocument} from '../../domain/drawing/model';
import type {RecordingSnapshot,SnapshotRecording,SnapshotInterpolationWeight} from '../../domain/recordingSnapshot/model';
import type {SnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {evaluateSnapshotWeightCurve} from '../../domain/recordingSnapshot/weights';
import './interpolationWeight.css';

type Target=SnapshotInterpolationWeight['target'];
const LINEAR:Point2[]=[[0,0],[1,1]];
const sameTarget=(a:Target,b:Target)=>a.layerId===b.layerId&&a.curveId===b.curveId;
export function weightEditorAsset(recording:SnapshotRecording,start:string,end:string,target:Target){
 const matches=(asset:SnapshotInterpolationWeight)=>asset.startSnapshotId===start&&asset.endSnapshotId===end||asset.startSnapshotId===end&&asset.endSnapshotId===start;
 const direct=recording.interpolationWeights?.find(asset=>matches(asset)&&sameTarget(asset.target,target));
 const asset=direct??(target.curveId?recording.interpolationWeights?.find(asset=>matches(asset)&&sameTarget(asset.target,{layerId:target.layerId})):undefined);
 const points=asset?(asset.startSnapshotId===start?asset.points:asset.points.map(([x,y]):Point2=>[1-x,1-y]).reverse()):LINEAR;
 return {asset,direct,points,inherited:!!asset&&!direct};
}
export function moveWeightEditorPoint(points:readonly Point2[],index:number,point:Point2):Point2[]{
 if(index<=0||index>=points.length-1)return points.map(p=>[...p]);
 const before=points[index-1],after=points[index+1],gap=Math.min(.001,(after[0]-before[0])/4);
 return points.map((p,i)=>i===index?[Math.max(before[0]+gap,Math.min(after[0]-gap,point[0])),Math.max(before[1],Math.min(after[1],point[1]))]:[...p]);
}
export function insertWeightEditorPoint(points:readonly Point2[],point:Point2):{points:Point2[];index:number}{
 const x=Math.max(.002,Math.min(.998,point[0])),near=points.findIndex(p=>Math.abs(p[0]-x)<.003);
 if(near>=0)return {points:points.map(p=>[...p]),index:near};
 if(points.length>=32)return {points:points.map(p=>[...p]),index:-1};
 const index=points.findIndex(p=>p[0]>x),y=Math.max(points[index-1][1],Math.min(points[index][1],point[1]));
 return {points:[...points.slice(0,index).map(p=>[...p] as Point2),[x,y],...points.slice(index).map(p=>[...p] as Point2)],index};
}
interface Props{
 recording:SnapshotRecording;views:RecordingSnapshot[];drawing:DrawingDocument;startSnapshotId:string;endSnapshotId:string;
 layerIds:string[];curveIds:string[];zh:boolean;
 preview:(commands:SnapshotCommand[]|null)=>void;commit:(commands:SnapshotCommand[])=>unknown;
}
/** A relationship asset edit is one undo transaction on pointer release. The
 * graph uses an immutable preview while dragging and never authors pose keys. */
export default function InterpolationWeightEditor(p:Props){
 const text=(cn:string,en:string)=>p.zh?cn:en;
 const [scope,setScope]=useState<'layer'|'curve'>(p.layerIds.length?'layer':'curve'),[local,setLocal]=useState<Point2[]|null>(null),[activePoint,setActivePoint]=useState<number|null>(null);
 const svg=useRef<SVGSVGElement>(null),gesture=useRef<{pointerId:number;index:number;points:Point2[];changed:boolean}|null>(null);
 const selectionKey=JSON.stringify([p.layerIds,p.curveIds]);
 useEffect(()=>{setScope(p.layerIds.length?'layer':'curve');setLocal(null);setActivePoint(null);},[selectionKey]);
 const owners=p.drawing.layers.filter(layer=>layer.items.some(id=>p.curveIds.includes(id))).map(layer=>layer.id);
 const layers=p.layerIds.length?p.layerIds:owners;
 const targets:Target[]=scope==='layer'?layers.map(layerId=>({layerId})):p.curveIds.flatMap(curveId=>{const layer=p.drawing.layers.find(layer=>layer.items.includes(curveId));return layer?[{layerId:layer.id,curveId}]:[];});
 const effective=targets.map(target=>weightEditorAsset(p.recording,p.startSnapshotId,p.endSnapshotId,target)),savedPoints=effective[0]?.points??LINEAR;
 const points=local??savedPoints,pointsKey=JSON.stringify(savedPoints),mixed=effective.some(value=>JSON.stringify(value.points)!==pointsKey);
 const pairKey=JSON.stringify([p.startSnapshotId,p.endSnapshotId,targets]);
 useEffect(()=>{setLocal(null);setActivePoint(null);gesture.current=null;},[pairKey,pointsKey]);
 const start=p.views.find(view=>view.id===p.startSnapshotId),end=p.views.find(view=>view.id===p.endSnapshotId);
 const axisPair=!!start&&!!end&&(start.angle.x===end.angle.x)!==(start.angle.y===end.angle.y);
 const enabled=!!targets.length&&!!start&&!!end&&start.id!==end.id&&axisPair;
 const command=(next:Point2[]):SnapshotCommand=>({op:'setInterpolationWeight',startSnapshotId:p.startSnapshotId,endSnapshotId:p.endSnapshotId,targets,points:next});
 const sendPreview=(next:Point2[])=>{setLocal(next);p.preview([command(next)]);};
 const apply=(next:Point2[])=>{p.commit([command(next)]);p.preview(null);setLocal(null);};
 const pointerPoint=(event:ReactPointerEvent):Point2=>{const rect=svg.current!.getBoundingClientRect();return [Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,1-(event.clientY-rect.top)/rect.height))];};
 const begin=(event:ReactPointerEvent<SVGSVGElement>)=>{
  if(!enabled||event.button!==0)return;event.preventDefault();event.stopPropagation();
  const hit=(event.target as Element).closest('[data-weight-index]'),index=hit?Number(hit.getAttribute('data-weight-index')):-1;
  if(hit instanceof SVGElement)hit.focus();
  const initial=index>=0?{points:points.map(point=>[...point] as Point2),index}:insertWeightEditorPoint(points,pointerPoint(event));
  if(initial.index<=0||initial.index>=initial.points.length-1)return;
  setActivePoint(initial.index);gesture.current={pointerId:event.pointerId,index:initial.index,points:initial.points,changed:index<0};
  event.currentTarget.setPointerCapture(event.pointerId);if(index<0)sendPreview(initial.points);
 };
 const finish=(event:ReactPointerEvent<SVGSVGElement>,cancel=false)=>{const drag=gesture.current;if(!drag||drag.pointerId!==event.pointerId)return;gesture.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);if(cancel||!drag.changed){setLocal(null);p.preview(null);}else apply(drag.points);};
 const path=useMemo(()=>Array.from({length:101},(_,i)=>`${i?'L':'M'}${i},${100-evaluateSnapshotWeightCurve(points,i/100)*100}`).join(' '),[points]);
 const intervals=useMemo(()=>{
  if(!start||!end)return [];
  const dx=end.angle.x-start.angle.x,dy=end.angle.y-start.angle.y,length2=dx*dx+dy*dy;if(!length2)return [];
  const selectedLayers=new Set(targets.map(target=>target.layerId));
  return [...new Set(p.recording.tracks.filter(track=>['placement','shape','relationPosition'].includes(track.channel)&&(selectedLayers.has(track.targetId)||track.channel==='relationPosition')).flatMap(track=>track.keys.flatMap(key=>{const x=key.angle.x-start.angle.x,y=key.angle.y-start.angle.y,t=(x*dx+y*dy)/length2;return t>1e-7&&t<1-1e-7&&Math.abs(x*dy-y*dx)<1e-5?[+t.toFixed(6)]:[];})))].sort((a,b)=>a-b);
 },[p.recording,start,end,pairKey]);
 const at=activePoint===null?null:points[activePoint];
 const guideAxis=start&&end&&start.angle.x===end.angle.x?'y':'x';
 const angleGuides=start&&end?[-60,-30,30,60].flatMap(angle=>{const t=(angle-start.angle[guideAxis])/(end.angle[guideAxis]-start.angle[guideAxis]);return t>0&&t<1?[{angle,t}]:[];}):[];
 const progress=start&&end?((p.recording.angle.x-start.angle.x)*(end.angle.x-start.angle.x)+(p.recording.angle.y-start.angle.y)*(end.angle.y-start.angle.y))/((end.angle.x-start.angle.x)**2+(end.angle.y-start.angle.y)**2):NaN;
 return <section className="vr-section interpolation-weight-editor" data-testid="interpolation-weight-editor" data-ui-keyboard>
  <h3>{text('变形权重曲线','Deformation weight curve')}</h3>
  <p className="weight-pair">{start?.name??'—'} → {end?.name??'—'}</p>
  <small>{text('使用上方两端快照。横轴为角度进度，纵轴为变形比例。','Uses the two snapshots above. Horizontal: angle progress. Vertical: deformation weight.')}</small>
  <div className="weight-scope"><button aria-pressed={scope==='curve'} disabled={!p.curveIds.length} onClick={()=>setScope('curve')}>{text('所选线','Selected curves')} · {p.curveIds.length}</button><button aria-pressed={scope==='layer'} disabled={!layers.length} onClick={()=>setScope('layer')}>{text('所选图层','Selected layers')} · {layers.length}</button></div>
  {!enabled?<small>{start&&end&&start.id!==end.id&&!axisPair?text('请选择同一俯仰下的两个转头视角，或同一转头角度下的两个俯仰视角。','Choose two yaw views at the same pitch, or two pitch views at the same yaw.'):text('在当前视角中选择线或图层，再选择两个不同视角。','Select curves or layers in the current snapshot and choose two different views.')}</small>:<>
   <small data-testid="weight-asset-origin">{mixed?text('多种曲线；编辑会统一所选对象','Mixed responses; editing applies one response to the selection'):effective[0]?.inherited?text('继承图层曲线；编辑后建立线覆盖','Inherited layer response; editing creates a curve override'):effective[0]?.direct?text('已有权重资产','Saved weight asset'):text('默认线性','Default linear')}</small>
   <svg ref={svg} className="weight-graph" viewBox="0 0 100 100" role="group" aria-label="Interpolation weight curve" data-testid="weight-curve-graph" onPointerDown={begin} onPointerMove={event=>{const drag=gesture.current;if(!drag||drag.pointerId!==event.pointerId)return;const next=moveWeightEditorPoint(drag.points,drag.index,pointerPoint(event));drag.points=next;drag.changed=true;sendPreview(next);}} onPointerUp={event=>finish(event)} onPointerCancel={event=>finish(event,true)} onLostPointerCapture={event=>{if(gesture.current)finish(event,true);}} onKeyDown={event=>{if(event.key==='Escape'&&gesture.current){event.preventDefault();event.stopPropagation();gesture.current=null;setLocal(null);p.preview(null);}}}>
    {[25,50,75].map(n=><g key={n} className="weight-grid"><path d={`M${n} 0V100 M0 ${n}H100`}/></g>)}<path className="weight-linear" d="M0 100L100 0"/>
    {intervals.map(t=><line className="weight-key-guide" key={t} x1={t*100} x2={t*100} y1={0} y2={100}/>)}
    <path className="weight-response" d={path}/>
    {angleGuides.map(guide=><g key={guide.angle} className={`weight-angle-guide weight-angle-${Math.abs(guide.angle)}`} data-testid={`weight-angle-guide-${guide.angle}`}><line x1={guide.t*100} x2={guide.t*100} y1={100} y2={100-evaluateSnapshotWeightCurve(points,guide.t)*100}/><circle cx={guide.t*100} cy={100-evaluateSnapshotWeightCurve(points,guide.t)*100} r={1.8}/><text x={guide.t*100+2} y={96}>{guide.angle}°</text></g>)}
    {Number.isFinite(progress)&&progress>=0&&progress<=1&&<circle className="weight-cursor" cx={progress*100} cy={100-evaluateSnapshotWeightCurve(points,progress)*100} r={1.6}/>}
    {points.map(([x,y],index)=><circle key={index} data-weight-index={index} cx={x*100} cy={100-y*100} r={2.6} className={index===activePoint?'active':''} tabIndex={index>0&&index<points.length-1?0:-1} role="slider" aria-label={`Weight point ${index}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(y*100)} onDoubleClick={event=>{event.stopPropagation();if(index>0&&index<points.length-1){apply(points.filter((_,i)=>i!==index));setActivePoint(null);}}} onKeyDown={event=>{if(index<=0||index>=points.length-1)return;if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();event.stopPropagation();apply(points.filter((_,i)=>i!==index));setActivePoint(null);return;}if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();const step=event.altKey?.001:event.shiftKey?.1:.01;apply(moveWeightEditorPoint(points,index,[x+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0),y+(event.key==='ArrowUp'?step:event.key==='ArrowDown'?-step:0)]));}}/>)}
   </svg>
   <div className="weight-readout">{at?`${text('进度','Progress')} ${(at[0]*100).toFixed(1)}% → ${text('变形','Weight')} ${(at[1]*100).toFixed(1)}%`:text('点曲线加点，拖点调形；双击或 Delete 删点','Click to add, drag to adjust; double-click or Delete removes a point')}</div>
   <div className="weight-actions"><button data-testid="weight-set-linear" onClick={()=>apply(LINEAR.map(point=>[...point]))}>{scope==='curve'?text('设为线性覆盖','Linear override'):text('设为线性','Set linear')}</button><button data-testid="weight-reset-inherit" onClick={()=>{p.commit([{op:'resetInterpolationWeight',startSnapshotId:p.startSnapshotId,endSnapshotId:p.endSnapshotId,targets}]);p.preview(null);setLocal(null);}}>{scope==='curve'?text('恢复图层继承','Inherit layer'):text('移除图层曲线','Remove layer response')}</button></div>
   {intervals.length>0&&<small className="weight-notice" data-testid="weight-runtime-segments">{text(`此范围含 ${intervals.length} 个已录中间位置。动画保留各轨道自身关键值，在各相邻关键段内应用此曲线；洋葱皮仍只混合所选两端。`,`This range includes ${intervals.length} authored intermediate positions. Animation preserves each track’s own keys and applies the response within its adjacent key segments; onion skin still blends only the two selected endpoints.`)}</small>}
   <details><summary>{text('作用范围','Response scope')}</summary><small>{text('图层曲线控制该层放置与局部形状。线覆盖控制独有端点和柄；共用端点与跨层联动按统一权威保持连接。显隐、层序与既有共享 Warp 时序不变。水平平台若覆盖整个关键段，该段沿线性推进以保留两端键。','Layer responses control placement and shape. Curve overrides affect exclusive endpoints and handles; shared and linked points keep a common authority. Visibility, order and existing shared Warp timing are unchanged. A flat response across an entire key segment falls back to linear to preserve its two keys.')}</small></details>
  </>}
 </section>;
}
