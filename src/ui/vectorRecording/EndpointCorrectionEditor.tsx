import {useEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import type {DrawingDocument,Point2} from '../../domain/drawing/model';
import type {SnapshotRecording,RecordingSnapshot,SnapshotControlResponse} from '../../domain/recordingSnapshot/model';
import type {SnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {evaluateEndpointResponse,invertEndpointPairCoordinate} from '../../domain/recordingSnapshot/endpointPair';
import type {RecordingCurveEdit} from './SceneCurveEditOverlay';
import './interpolationWeight.css';

export type CorrectionControl={layerId:string;nodeId:string}|{layerId:string;curveId:string;end:0|1};
export const correctionControlKey=(control:CorrectionControl)=>'nodeId' in control?`node:${control.nodeId}`:`handle:${control.curveId}:${control.end}`;
/** Only t is ordered. Signed, decreasing and overshooting responses are valid. */
export function moveCorrectionKnot(points:readonly Point2[],index:number,next:Point2):Point2[]{
 if(index<0||index>=points.length||!next.every(Number.isFinite))return points.map(p=>[...p]);
 const before=points[index-1]?.[0]??0,after=points[index+1]?.[0]??1,gap=Math.min(.001,(after-before)/4);
 return points.map((p,i)=>i===index?[Math.max(before+gap,Math.min(after-gap,next[0])),next[1]]:[...p]);
}
export function insertCorrectionKnot(points:readonly Point2[],next:Point2):{points:Point2[];index:number}{
 const t=Math.max(.000001,Math.min(.999999,next[0])),near=points.findIndex(p=>Math.abs(p[0]-t)<1e-6);
 if(near>=0)return {points:points.map((p,i)=>i===near?[p[0],next[1]]:[...p]),index:near};
 const nextPoints=[...points.map(p=>[...p] as Point2),[t,next[1]] as Point2].sort((a,b)=>a[0]-b[0]);return {points:nextPoints,index:nextPoints.findIndex(p=>p[0]===t)};
}
export const correctionResponseAt=(points:readonly Point2[],t:number):number=>evaluateEndpointResponse(points,t);
export function selectedCorrectionControls(drawing:DrawingDocument,curveIds:string[]):{control:CorrectionControl;label:string}[]{
 const seen=new Set<string>(),result:{control:CorrectionControl;label:string}[]=[];
 for(const curve of drawing.curves.filter(c=>curveIds.includes(c.id))){const layer=drawing.layers.find(l=>l.items.includes(curve.id));if(!layer)continue;const name=curve.name??`${layer.name} · ${drawing.curves.indexOf(curve)+1}`;
  for(const end of [0,1] as const){const nodeId=curve.nodes[end];if(!seen.has(nodeId)){seen.add(nodeId);result.push({control:{layerId:layer.id,nodeId},label:`${name} · P${end===0?0:3}`});}result.push({control:{layerId:layer.id,curveId:curve.id,end},label:`${name} · H${end+1}`});}
 }return result;
}
interface Props{recording:SnapshotRecording;views:RecordingSnapshot[];drawing:DrawingDocument;curveIds:string[];selected:RecordingCurveEdit|null;nodeAuthorities?:Record<string,string>;basisStart?:DrawingDocument;basisEnd?:DrawingDocument;zh:boolean;preview:(commands:SnapshotCommand[]|null)=>void;commit:(commands:SnapshotCommand[])=>unknown}
export default function EndpointCorrectionEditor(p:Props){
 const txt=(cn:string,en:string)=>p.zh?cn:en,pair=p.recording.endpointPair!;
 const choices=selectedCorrectionControls(p.drawing,p.curveIds),[selectedKey,setSelectedKey]=useState(''),[axis,setAxis]=useState<'x'|'y'>('x'),[local,setLocal]=useState<Point2[]|null>(null),[active,setActive]=useState<number|null>(null);
 const svg=useRef<SVGSVGElement>(null),drag=useRef<{pointerId:number;index:number;points:Point2[];min:number;max:number;changed:boolean}|null>(null);
 const chosen=choices.find(c=>correctionControlKey(c.control)===selectedKey)??choices[0],control=chosen?.control;
 const source=pair.draft?.responses??pair.responses,authority=control&&'nodeId' in control?(p.nodeAuthorities?.[control.nodeId]??control.nodeId):undefined;
 const response:SnapshotControlResponse|undefined=control?('nodeId' in control?source?.nodes[authority!]:source?.handles[control.curveId]?.[control.end]):undefined;
 const basisValue=(drawing:DrawingDocument|undefined)=>{if(!drawing||!control)return undefined;const index=axis==='x'?0:1;if('nodeId' in control)return drawing.nodes.find(n=>n.id===authority)?.position[index];const curve=drawing.curves.find(c=>c.id===control.curveId),node=curve&&drawing.nodes.find(n=>n.id===curve.nodes[control.end]);return curve&&node?curve.handles[control.end][index]-node.position[index]:undefined;};
 const first=basisValue(p.basisStart),last=basisValue(p.basisEnd),axisUnavailable=first!==undefined&&last!==undefined&&!invertEndpointPairCoordinate(first,last,first).available,axisSensitive=!axisUnavailable&&first!==undefined&&last!==undefined&&Math.abs(last-first)<1e-8*Math.max(1,Math.abs(first),Math.abs(last)),graphEditable=!pair.draft&&!axisUnavailable;
 const saved=response?.[axis]??[],points=local??saved,key=control?correctionControlKey(control):'',savedKey=JSON.stringify(saved);
 useEffect(()=>{const selected=p.selected;if(!selected)return;const hit=choices.find(({control:c})=>selected.kind==='node'?'nodeId' in c&&c.nodeId===selected.nodeId:'curveId' in c&&c.curveId===selected.curveId&&c.end===selected.end);if(hit)setSelectedKey(correctionControlKey(hit.control));},[p.selected&&JSON.stringify(p.selected.kind==='node'?['node',p.selected.nodeId]:['handle',p.selected.curveId,p.selected.end]),p.curveIds.join('|')]);
 useEffect(()=>{setLocal(null);setActive(null);drag.current=null;},[key,axis,savedKey]);
 const start=p.views.find(v=>v.id===pair.startSnapshotId),end=p.views.find(v=>v.id===pair.endSnapshotId),progress=start&&end?(p.recording.angle.x-start.angle.x)/(end.angle.x-start.angle.x):NaN;
 const extrema=[0,1,...points.map(k=>k[1])],min=drag.current?.min??Math.min(-.25,...extrema.map(v=>v-.15)),max=drag.current?.max??Math.max(1.25,...extrema.map(v=>v+.15));
 const displayY=(w:number)=>100-(w-min)/(max-min)*100;
 const command=(knots:Point2[]):SnapshotCommand=>({op:'setControlResponse',targets:[control!],axis,points:knots});
 const preview=(knots:Point2[])=>{setLocal(knots);p.preview([command(knots)]);};
 const commit=(knots:Point2[])=>{p.commit([command(knots)]);p.preview(null);setLocal(null);};
 const point=(event:ReactPointerEvent):Point2=>{const r=svg.current!.getBoundingClientRect(),frame=drag.current??{min,max};return [(event.clientX-r.left)/r.width,frame.max-(event.clientY-r.top)/r.height*(frame.max-frame.min)];};
 const finish=(event:ReactPointerEvent,cancel=false)=>{const d=drag.current;if(!d||d.pointerId!==event.pointerId)return;drag.current=null;if(svg.current?.hasPointerCapture(event.pointerId))svg.current.releasePointerCapture(event.pointerId);if(cancel||!d.changed){setLocal(null);p.preview(null);}else commit(d.points);};
 const guides=start&&end?[-60,-30,30,60].flatMap(angle=>{const t=(angle-start.angle.x)/(end.angle.x-start.angle.x);return t>0&&t<1?[{angle,t}]:[];}):[];
 const path:Point2[]=[[0,0],...points,[1,1]],activePoint=active===null?null:points[active];
 return <section className="vr-section interpolation-weight-editor endpoint-correction-editor" data-testid="endpoint-correction-editor" data-ui-keyboard>
  <h3>{txt('控制点反推响应','Control-point inverse response')}</h3>
  <small>{txt('中间角拖端点或柄只写响应约束；两端修改后重新生成，不建立中间形状键。','Intermediate drags write response constraints. Endpoint edits regenerate the result without middle shape keys.')}</small>
  {pair.draft&&<p className="weight-notice">{txt('先保存或放弃上方的反推修正，再编辑响应图。','Save or discard the correction draft above before editing this graph.')}</p>}
  {axisUnavailable&&<p className="weight-notice" data-testid="correction-axis-unavailable">{axis.toUpperCase()} {txt('两端值相同或接近数值精度，无法由权重产生新位移。请先修改一个基础端点。','Endpoint values are equal or numerically indistinguishable. Edit a basis endpoint before adding movement on this axis.')}</p>}
  {axisSensitive&&<p className="weight-notice">{axis.toUpperCase()} {txt('两端差值很小；反推响应会对基础端点改动非常敏感。','The endpoint difference is tiny; the inverse response is highly sensitive to basis changes.')}</p>}
  {!control?<p>{txt('选择一条线，再点画布上的端点或控制柄。','Select a curve, then a canvas endpoint or handle.')}</p>:<>
   <select aria-label="Correction control" value={key} onChange={e=>setSelectedKey(e.target.value)}>{choices.map(c=><option key={correctionControlKey(c.control)} value={correctionControlKey(c.control)}>{c.label}</option>)}</select>
   <div className="weight-scope">{(['x','y'] as const).map(value=><button key={value} aria-pressed={axis===value} onClick={()=>setAxis(value)}>{value.toUpperCase()} {txt('响应','response')}</button>)}</div>
   <small>{'nodeId' in control?txt('共用端点只有一份位置响应，关联线同时跟随。','Shared endpoints have one position response. Linked curves follow it.'):txt('柄响应作用于相对端点的 H−P 向量。平滑联动仍是几何约束。','Handle response controls the relative H−P vector. Smooth links remain geometric constraints.')}</small>
   <svg ref={svg} className="weight-graph" viewBox="0 0 100 100" role="group" aria-label="Control response curve" data-testid="control-response-graph" aria-disabled={!graphEditable} onPointerDown={e=>{if(!graphEditable||e.button!==0)return;e.preventDefault();e.stopPropagation();const target=(e.target as Element).closest('[data-correction-index]'),index=target?Number(target.getAttribute('data-correction-index')):-1;const next=index>=0?{points:points.map(k=>[...k] as Point2),index}:insertCorrectionKnot(points,point(e));setActive(next.index);drag.current={pointerId:e.pointerId,index:next.index,points:next.points,min,max,changed:index<0};e.currentTarget.setPointerCapture(e.pointerId);if(index<0)preview(next.points);}} onPointerMove={e=>{const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;d.points=moveCorrectionKnot(d.points,d.index,point(e));d.changed=true;preview(d.points);}} onPointerUp={e=>finish(e)} onPointerCancel={e=>finish(e,true)} onLostPointerCapture={e=>{if(drag.current)finish(e,true);}}>
    {[0,1].map(w=><line key={w} className="weight-key-guide" x1={0} x2={100} y1={displayY(w)} y2={displayY(w)}/>)}<path className="weight-linear" d={`M0 ${displayY(0)}L100 ${displayY(1)}`}/>
    <path className="weight-response" d={path.map(([t,w],i)=>`${i?'L':'M'}${t*100} ${displayY(w)}`).join(' ')}/>
    {guides.map(g=><g className={`weight-angle-guide weight-angle-${Math.abs(g.angle)}`} key={g.angle}><line x1={g.t*100} x2={g.t*100} y1={100} y2={0}/><text x={g.t*100+2} y={96}>{g.angle}°</text></g>)}
    {Number.isFinite(progress)&&progress>=0&&progress<=1&&<circle className="weight-cursor" cx={progress*100} cy={displayY(correctionResponseAt(points,progress))} r={1.6}/>}
    {points.map(([t,w],i)=><circle key={i} data-correction-index={i} cx={t*100} cy={displayY(w)} r={2.6} className={active===i?'active':''} tabIndex={graphEditable?0:-1} role="slider" aria-label={`Correction point ${i}`} aria-valuenow={w*100} onDoubleClick={e=>{e.stopPropagation();if(!graphEditable)return;commit(points.filter((_,j)=>j!==i));setActive(null);}} onKeyDown={e=>{if(!graphEditable)return;if(['Delete','Backspace'].includes(e.key)){e.preventDefault();e.stopPropagation();commit(points.filter((_,j)=>j!==i));setActive(null);}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();const step=e.altKey?.001:e.shiftKey?.1:.01;commit(moveCorrectionKnot(points,i,[t+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),w+(e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0)]));}}}/>)}
   </svg>
   <div className="weight-readout">{activePoint?`${txt('进度','Progress')} ${(activePoint[0]*100).toFixed(1)}% → ${axis.toUpperCase()} ${(activePoint[1]*100).toFixed(1)}%`:txt('可回退或越过两端；端点权重固定为 0 和 1。','Responses may reverse or overshoot. Endpoint weights stay at 0 and 1.')}</div>
   {activePoint&&<label>{axis.toUpperCase()} % <input aria-label="Correction weight percent" disabled={!graphEditable} key={`${key}/${axis}/${active}/${activePoint[1]}`} type="number" defaultValue={+(activePoint[1]*100).toFixed(4)} onBlur={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&n!==activePoint[1]*100)commit(moveCorrectionKnot(points,active!,[activePoint[0],n/100]));}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>}
   <div className="weight-actions"><button data-testid="correction-reset-axis" disabled={!graphEditable} onClick={()=>{p.commit([{op:'resetControlResponse',targets:[control],axis}]);p.preview(null);setLocal(null);}}>{txt('恢复此轴线性','Reset axis to linear')}</button></div>
   <small>{txt('两端某轴没有位移时，权重不能产生该轴的新位移；请修改基础端点。很小的差值或超范围响应可能放大端点改动。','An unchanged endpoint axis cannot gain movement through a weight. Edit a basis endpoint. Tiny differences or overshoot can amplify endpoint edits.')}</small>
  </>}
 </section>;
}
