import {ScaffoldShapeControls} from '../head/ScaffoldControls';
import {uiText} from "../i18n";
import {useLoomisUI} from '../head/loomisUI';
import {isFree3DShape,isSection,isDerived} from '../../domain/curves/model';
import {sectionFromAngles,sectionAngles} from '../../domain/curves/section';
import {count} from '../../domain/geometry/diagnostics';
import {useShallow} from 'zustand/react/shallow';
import SymmetricPairListItem from "../shared/SymmetricPairListItem";
import {curveRows,curveBaseName} from "../shared/pairRows";
import NumericSlider from '../shared/NumericSlider';
import Free3DHandleControls from './Free3DHandleControls';
import {formatNumeric} from '../shared/numericSliderMath';
import {SmoothEdgeControl} from "../smooth/SmoothControls";
import InlineName from "../shared/InlineName";
import { useUI } from "../session";
import { useRef } from "react";
import {dot,cross} from "../../domain/geometry/core";
import { useEditor } from "../../app/store";
import {
  canonical,
  frame,
  isCenterCurve,
  rotate,
  perpendicular,
  CURVE_EPS,
} from "../../domain/curves/geometry";
export default function CurvePanel({loomis=false}:{loomis?:boolean}) {
 count('renderCurvePanel');
  const s = useEditor(useShallow(s=>({addOnCurvePoint:s.addOnCurvePoint,beginEdit:s.beginEdit,cancelCurve:s.cancelCurve,curveCreation:s.curveCreation,endEdit:s.endEdit,project:s.project,selectCurve:s.selectCurve,selectedCurveId:s.selectedCurveId,setCurveShape:s.setCurveShape,startCurve:s.startCurve}))),
    ui = useUI(),
    c = s.project.curves.find((c) => c.id === s.selectedCurveId && isDerived(c)===loomis);
  return (
    <section
      className={`sidebar-section curve-panel ${(ui.curveCollapsed&&!loomis) ? "collapsed" : ""}`}
      aria-label={uiText(loomis?"Loomis 剖面线":"结构线")}
    >
      <button
        className="section-heading"
        aria-expanded={!(ui.curveCollapsed&&!loomis)}
        onClick={() => {if(!loomis){useLoomisUI.setState({open:false});useUI.setState({ curveCollapsed: !ui.curveCollapsed });}}}
      >
        <span>{uiText((ui.curveCollapsed&&!loomis) ? "▶" : "▼")} {uiText(loomis?"Loomis 剖面线":"结构线")}</span>
        <span>{curveRows(s.project).filter(r=>isDerived(r.primary)===loomis).length}{uiText("行")}</span>
      </button>
      <div className="section-body" hidden={(ui.curveCollapsed&&!loomis)}>
        {c && (
          <div className="curve-current" data-testid="curve-current">
            <strong>{uiText("当前：")}{c.name}</strong>
            <button onClick={()=>s.addOnCurvePoint(c.id)}>{uiText("添加结构线定位点")}</button>
            {isSection(c)?<SectionControl id={c.id}/>:<PlaneControl key={c.id} id={c.id} />}
            <SmoothEdgeControl key={"smooth-"+c.id} id={c.id}/>
          </div>
        )}
        <div className="curve-create">
          {loomis&&<><button onClick={()=>useEditor.getState().createLoomisSection()}>{uiText("创建 Loomis Section")}</button>
          <button onClick={()=>useEditor.getState().createLoomisSection(true)}>{uiText("创建 Loomis 中线剖面")}</button></>}
          {!loomis&&<button
            disabled={s.project.landmarks.length < 2}
            onClick={s.startCurve}
          >{uiText("创建曲线")}</button>}
          {s.curveCreation && (
            <div className="curve-create-note">
              {uiText(s.curveCreation.startId
                ? `起点：${s.project.landmarks.find((l) => l.id === s.curveCreation!.startId)?.name}；请选择终点 B`
                : "请选择起点 A")}
              <button onClick={s.cancelCurve}>{uiText("取消创建")}</button>
            </div>
          )}
        </div>
        <div className="curve-list">
          {curveRows(s.project).filter(r=>isDerived(r.primary)===loomis).map(({primary,mirror}) => {
            const x=[primary,mirror].find(x=>x?.id===s.selectedCurveId)??primary;
            return <SymmetricPairListItem key={primary.id} primaryId={primary.id} mirrorId={mirror?.id}
              selectedId={s.selectedCurveId} displayName={curveBaseName(primary,!!mirror)} onSelect={s.selectCurve}
              onRename={id=>useUI.setState({renameTarget:{kind:"curve",id}})}
              onContextMenu={e=>{e.preventDefault();s.selectCurve(x.id);useUI.setState({menu:{target:{kind:"curve",id:x.id},x:e.clientX,y:e.clientY}});}}>
              {()=> <InlineName target={{kind:"curve",id:x.id}} name={curveBaseName(primary,!!mirror)} baseName={curveBaseName(x,!!mirror)}/>}
            </SymmetricPairListItem>;
          })}
        </div>
      </div>
    </section>
  );
}
export function PlaneControl({id}:{id:string}) {
  const p=useEditor(s=>s.project),c=p.curves.find(c=>c.id===id);
  if(!c||isDerived(c))return null;
  if(isFree3DShape(canonical(p,c).shape))return <Free3DHandleControls id={id}/>;
  return <LegacyPlaneControl id={id}/>;
}
function LegacyPlaneControl({ id }: { id: string }) {
  const s = useEditor(useShallow(s=>({addOnCurvePoint:s.addOnCurvePoint,beginEdit:s.beginEdit,cancelCurve:s.cancelCurve,curveCreation:s.curveCreation,endEdit:s.endEdit,project:s.project,selectCurve:s.selectCurve,selectedCurveId:s.selectedCurveId,setCurveShape:s.setCurveShape,startCurve:s.startCurve}))),
    c = s.project.curves.find((c) => c.id === id)!,
    base = canonical(s.project, c),
    f = frame(s.project, base);
  // This inspector's relative zero is stable; the displayed angle follows geometry/history.
  const reference = useRef({id,normal:f.n});
  if(reference.current.id!==id)reference.current={id,normal:f.n};
  const zero=perpendicular(f.d,[reference.current.normal]);
  const side=c.role==='mirror'?-1:1;
  const angle=Math.atan2(dot(f.d,cross(zero,f.n)),dot(zero,f.n))*180/Math.PI*side;
  const restoreSelection=(redo:boolean)=>{const store=useEditor.getState();redo?store.redo():store.undo();const next=useEditor.getState();if(next.project.curves.some(c=>c.id===id))next.selectCurve(id);};
  if(isFree3DShape(base.shape))return null;
  if (isCenterCurve(s.project, c)) return <p>{uiText("固定于中线平面 · 无旋转自由度")}</p>;
  return (
    <NumericSlider className="curve-plane" label={uiText("调整曲线平面")} min={-180} max={180} value={angle} onUndo={()=>restoreSelection(false)} onRedo={()=>restoreSelection(true)} formatValue={v=>formatNumeric(v)+'°'} disabled={f.length<CURVE_EPS} onEditStart={()=>s.beginEdit(true)} onEditEnd={s.endEdit} onChange={a=>{
          s.setCurveShape(base.id, {
            ...base.shape,
            planeNormal: rotate(
              f.n,
              f.d,
              (((a - angle) * Math.PI) / 180) * (c.role === "mirror" ? -1 : 1),
            ),
          });
        }}
      />
  );
}

export function SectionControl({id,compact=false}:{id:string;compact?:boolean}){
 const s=useEditor(),selected=s.project.curves.find(c=>c.id===id)!;
 const c=selected.role==='canonical'?selected:s.project.curves.find(c=>c.id===selected.canonicalCurveId)!;
 if(!isSection(c)||c.role!=='canonical')return null;
 if(c.systemRole==='MAIN_Y')return <ScaffoldShapeControls only="horizontal"/>;
 if(c.systemRole?.startsWith('MAIN_'))return <small>{uiText("系统主环 · 固定于 HeadFrame 主轴平面")}</small>;
 if(c.systemRole?.startsWith('SIDE_'))return <ScaffoldShapeControls only="side"/>;
 if(c.logicalRing==='COMPOSITE')return <NumericSlider label={uiText("Ring Offset")} min={-.95} max={.95} value={c.section.planeOffset} formatValue={formatNumeric} onEditStart={()=>s.beginEdit(true)} onEditEnd={s.endEdit} onChange={v=>s.setSection(c.id,{...c.section,planeOffset:v})}/>;
 if(c.side==='CENTERLINE')return <small>{uiText("解析闭合中线剖面 · 固定于 Loomis 对称平面")}</small>;
 const a=sectionAngles(c.section);
 const restoreSelection=(action:()=>void)=>{action();const next=useEditor.getState();if(next.project.curves.some(c=>c.id===id))next.selectCurve(id);};
 const session={onEditStart:()=>s.beginEdit(true),onEditEnd:s.endEdit,onUndo:()=>restoreSelection(s.undo),onRedo:()=>restoreSelection(s.redo)};
 const change=(x:number,y:number,d:number)=>s.setSection(c.id,sectionFromAngles(x,y,d));
 return <div data-testid="section-inspector"><small>{uiText("解析 Section · 调整唯一 canonical 平面；镜像侧同步")}</small>
 {compact&&<NumericSlider label={uiText("Section Offset")} min={-.999} max={.999} value={c.section.planeOffset} formatValue={v=>formatNumeric(v)} {...session} onChange={v=>s.setSection(c.id,{...c.section,planeOffset:v})}/>}
 <details open={!compact}><summary>{uiText(compact?'高级':'剖面方向')}</summary>
 <NumericSlider label={uiText("Section Tilt X")} min={-90} max={90} value={a.x} formatValue={v=>formatNumeric(v)+'°'} {...session} onChange={v=>change(v,a.y,c.section.planeOffset)}/>
 <NumericSlider label={uiText("Section Tilt Y")} min={-180} max={180} value={a.y} formatValue={v=>formatNumeric(v)+'°'} {...session} onChange={v=>change(a.x,v,c.section.planeOffset)}/>
 </details>
 {!compact&&<NumericSlider label={uiText("Section Offset")} min={-.999} max={.999} value={c.section.planeOffset} formatValue={v=>formatNumeric(v)} {...session} onChange={v=>s.setSection(c.id,{...c.section,planeOffset:v})}/>}
 <small>{uiText("纯 Loomis 球面请在下方选择区域；与自由曲线混合的 Patch 仍使用绘制面的区间模式。")}</small></div>;
}
