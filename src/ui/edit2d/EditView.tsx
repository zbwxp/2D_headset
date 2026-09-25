import {CHIN} from '../../domain/chin/model';
import {displayPoint,rawDisplayPlane} from '../../rendering/moduleDisplay';
import GazeOverlay2D from '../head/GazeOverlay2D';
import {eyeSide} from '../../domain/eyes/scaffold';
import {modulePickable} from '../authoring/moduleAccess';
import {SelectionCycle} from '../authoring/selectionCycle';
import {editSurfacePicker} from '../../rendering/edit2d/picking';
import {HELMET} from '../../domain/head/scaffold';
import {surfaceRef} from '../authoring/state';
import {useVisibility} from '../authoring/visibility';
import {uiText} from "../i18n";
import {pickOnPatch} from '../authoring/onPatchTool';
import {isLoomisLocked} from '../../domain/head/locks';
import {dispatch2D,placementCapability,fineHit2D,fineHits2D} from '../authoring/InteractionDispatcher2D';
import {beginConstrainedDrag,constrainedValue,type ConstrainedDrag} from '../authoring/constrainedDrag';
import {surfaceHit,previewSurfacePoint,commitRegion} from '../authoring/surfaceHit';
import AuthoringPreview2D from '../authoring/AuthoringPreview2D';
import {isDerived,isOnPatch} from '../../domain/curves/model';
import {frameWire} from '../../domain/head/frame';
import BoundaryAuthoringOverlay from '../patches/BoundaryAuthoringOverlay';
import {count} from '../../domain/geometry/diagnostics';
import {useShallow} from 'zustand/react/shallow';
import {pointPosition} from "../../domain/geometry/evaluation";
import DerivedRenderLayer from "./DerivedRenderLayer";
import InteractionOverlay from "./InteractionOverlay";
import {useOrthographicView} from "./useOrthographicView";
import CurveInteractionOverlay from "../curves/CurveInteractionOverlay";
import { useRef,useState,useEffect,type PointerEvent as ReactPointerEvent } from "react";
import { useEditor } from "../../app/store";
import {worldToPlane,screenToSvg,EDIT_VIEWBOX} from "../../rendering/orthographic";
import {
  allowedBasis,
  motionState,
  centerlineGuide,
} from "../../domain/landmarks/model";
import type { Vec2 } from "../../domain/project/types";
import ReferenceControls from "./ReferenceControls";
const UNIT=EDIT_VIEWBOX.unitsPerWorld;
export default function EditView({viewId}:{viewId?:string}) {
 const selectionCycle=useRef(new SelectionCycle(true));
 const pendingSelection=useRef<{hits:{kind:string;id:string}[];x:number;y:number;project:ReturnType<typeof useEditor.getState>['project']}|null>(null);
 count('renderEditView');
  const hidden=useVisibility();
  const s = useEditor(useShallow(s=>({patchCreation:s.patchCreation,pickPatchAnchor:s.pickPatchAnchor,beginEdit:s.beginEdit,curveCreation:s.curveCreation,endEdit:s.endEdit,movePoint:s.movePoint,notify:s.notify,pickCurveEndpoint:s.pickCurveEndpoint,pickMergePoint:s.pickMergePoint,project:s.project,referenceMoving:s.referenceMoving,selectLandmark:s.selectLandmark,selectedCurveId:s.selectedCurveId,selectedId:s.selectedId,setCanvas:s.setCanvas,setReference:s.setReference,setReferenceMoving:s.setReferenceMoving,viewId:s.viewId}))),
    v = s.project.views.find((v) => v.id === (viewId??s.viewId))!,
    l = s.project.landmarks.find((l) => l.id === s.selectedId),
    { zoom, pan } = v.canvas,
    ref = v.reference;
  const setCanvas=(canvas:{zoom:number;pan:Vec2})=>s.setCanvas(canvas,v.id);
  const curveController=useRef<((e:ReactPointerEvent,id:string,index:0|1|2)=>void)|null>(null);
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<{
      kind: "point" | "constrained" | "pan" | "reference";
      id?: string;
      start: Vec2;
      origin: Vec2;
      recorded?: boolean; constrained?:ConstrainedDrag;
    } | null>(null);
  const [gpuHost,setGpuHost]=useState<HTMLDivElement|null>(null);
  const projection=useOrthographicView(svg,v);
  useEffect(()=>selectionCycle.current.reset(),[projection.orientationToken,projection.zoom,projection.pan[0],projection.pan[1]]);
  const project=(p:readonly number[],_view:typeof v)=>worldToPlane(p,projection).slice(0,2) as Vec2;
  const local = (x:number,y:number):Vec2 => {
    const rect=svg.current!.getBoundingClientRect();
    return screenToSvg([x-rect.left,y-rect.top],projection);
  };
  const world = (p: Vec2): Vec2 => [
    (p[0] - pan[0]) / zoom / UNIT,
    -(p[1] - pan[1]) / zoom / UNIT,
  ];
  const motion = l ? motionState(s.project, l.id, v) : { track: null },
    q = l ? project(displayPoint(s.project,l.id,pointPosition(s.project,l.id),projection.forward), v) : [0, 0];
  const track = motion.track ? [motion.track[0], -motion.track[1]] : null;
  const end = () => {
    drag.current = null;
    s.endEdit();
  };
  const startPoint=(e:ReactPointerEvent,id:string)=>{if(!modulePickable(id))return;const x=s.project.landmarks.find(x=>x.id===id)!;const p=project(pointPosition(s.project,id),v);
                    if (e.button === 2) {
                      e.stopPropagation();
                      return;
                    }
                    if (e.shiftKey || e.button !== 0) return;
                    e.stopPropagation();
                    const action=dispatch2D(useEditor.getState().tool,'point');
                    e.preventDefault();
                    if(action==='mergePoint'){s.pickMergePoint(x.id);return;}
                    if(action==='curveEndpoint'){s.pickCurveEndpoint(x.id);return;}
                    if(action==='patchAnchor'){s.pickPatchAnchor(x.id);return;}
                    if(action!=='point')return;
                    s.selectLandmark(x.id);
                    const capability=placementCapability(x);
                    if(eyeSide(s.project,x.id)||capability==='select'||isLoomisLocked(s.project,x.id))return;
                    if(capability!=='spatial'){
                      drag.current={kind:'constrained',id:x.id,start:local(e.clientX,e.clientY),origin:p,constrained:beginConstrainedDrag(s.project,x.id,projection)};
                      svg.current!.setPointerCapture(e.pointerId);return;
                    }
                    drag.current = {
                      kind: "point",
                      id: x.id,
                      start: local(e.clientX, e.clientY),
                      origin: p,
                    };
                    svg.current!.setPointerCapture(e.pointerId);
                    if (!allowedBasis(s.project, x.id).length)
                      s.notify("此点已固定，请解除上方列出的视图锁。");

  };
  useEffect(()=>{const stop=()=>{if(drag.current?.recorded||drag.current?.kind==='reference')useEditor.getState().endEdit();drag.current=null;};const visibility=()=>{if(document.hidden)stop();};window.addEventListener('blur',stop);document.addEventListener('visibilitychange',visibility);return()=>{stop();window.removeEventListener('blur',stop);document.removeEventListener('visibilitychange',visibility);};},[]);
  return (
    <div className="point-stage" data-testid="edit-viewport">
      <svg className="edit-background" viewBox={`${-EDIT_VIEWBOX.width/2} ${-EDIT_VIEWBOX.height/2} ${EDIT_VIEWBOX.width} ${EDIT_VIEWBOX.height}`} aria-hidden="true">
        <defs>
          <pattern
            id="point-grid"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M20 0H0V20"
              fill="none"
              stroke="#ffffff"
              strokeOpacity=".05"
              strokeWidth=".6"
            />
          </pattern>
        </defs>
        <g
          transform={`translate(${pan.join(" ")}) scale(${zoom})`}
          pointerEvents="none"
        >
          {ref?.visible && (
            <image
              data-testid="reference-image"
              href={ref.dataUrl}
              x={(-ref.width / Math.max(ref.width, ref.height)) * 208}
              y={(-ref.height / Math.max(ref.width, ref.height)) * 208}
              width={(ref.width / Math.max(ref.width, ref.height)) * 416}
              height={(ref.height / Math.max(ref.width, ref.height)) * 416}
              opacity={ref.opacity}
              transform={`translate(${ref.offset[0] * UNIT} ${-ref.offset[1] * UNIT}) rotate(${ref.rotation}) scale(${ref.scale})`}
              pointerEvents="none"
            />
          )}
          <rect
            x="-3000"
            y="-3000"
            width="6000"
            height="6000"
            fill="url(#point-grid)"
            pointerEvents="none"
          />
        </g>
      </svg>
      <div ref={setGpuHost} className="edit-gpu-host" />
      <ReferenceControls viewId={v.id} />
      <span className="point-view-label">{uiText(v.label)}{uiText("· 正交投影")}</span>
      <svg
        ref={svg}
        data-testid="point-editor" data-authoring-focus="2d" tabIndex={0}
        viewBox={`${-EDIT_VIEWBOX.width/2} ${-EDIT_VIEWBOX.height/2} ${EDIT_VIEWBOX.width} ${EDIT_VIEWBOX.height}`}
        style={{ width: "100%", height: "100%", touchAction: "none" }}
        onPointerDownCapture={e=>{
          pendingSelection.current=null;
          if(e.button!==0||e.shiftKey)return; e.currentTarget.focus({preventScroll:true});
          const r=e.currentTarget.getBoundingClientRect(),xy:Vec2=[e.clientX-r.left,e.clientY-r.top],target=e.target as Element;
          if(target.closest('[data-testid="on-patch-handles"], [data-testid="control-point-handles"]'))return;
          if(s.referenceMoving||(target.closest('[data-testid="gaze-overlay-2d"]')&&useEditor.getState().tool.kind==='select'))return;
          const curve=target.closest('[data-curve-id]'),point=target.closest('[data-point-id]');let hit:{kind:string;id:string}|null=fineHit2D(s.project,projection,xy,curve?.getAttribute('data-curve-id')??undefined,point?.getAttribute('data-point-id')??undefined,id=>hidden(id)||!modulePickable(id));
          const tool=useEditor.getState().tool;
          if(tool.kind==='mergePoint'){e.preventDefault();e.stopPropagation();if(hit?.kind==='point')s.pickMergePoint(hit.id);return;}
          if(tool.kind==='select'&&!target.closest('[data-handle-index]')){
            const hits:{kind:string;id:string}[]=fineHits2D(s.project,projection,xy,id=>hidden(id)||!modulePickable(id));
            if(hit){const i=hits.findIndex(h=>h.kind===hit!.kind&&h.id===hit!.id);if(i>=0)hits.splice(i,1);hits.unshift(hit);}
            const ids=new Set([...(s.project.patches??[]).map(p=>p.id),...(s.project.loomisCaps??[]).map(p=>p.id),...(s.project.loomisRegions??[]).map(p=>p.id),HELMET,CHIN].filter(id=>!hidden(id)&&modulePickable(id)));
            while(ids.size){const h=editSurfacePicker.current?.pick(xy,ids);if(!h)break;hits.push({kind:'surface',id:h.id});ids.delete(h.id);}
            pendingSelection.current={hits,x:e.clientX,y:e.clientY,project:s.project};
            // Drag the selected nearby object; only a completed click advances the cycle.
            const selected=useEditor.getState().selection;
            hit=hits.find(h=>h.kind===hits[0]?.kind&&h.kind===selected?.kind&&h.id===selected.id)??hits[0]??null;
            if(hit?.kind==='surface'){e.stopPropagation();useEditor.getState().selectObject(surfaceRef(s.project,hit.id));return;}
          }else selectionCycle.current.reset();
          const action=dispatch2D(tool,(hit?.kind??'empty') as 'point'|'curve'|'surface'|'empty');
          if(action==='onPatch'){e.preventDefault();e.stopPropagation();pickOnPatch(xy,projection,hit?.kind==='point'?hit.id:undefined);return;}
          if(action==='surfacePoint'||action==='region'){e.preventDefault();e.stopPropagation();const r=e.currentTarget.getBoundingClientRect(),xy:Vec2=[e.clientX-r.left,e.clientY-r.top];if(action==='surfacePoint')previewSurfacePoint(xy,projection);else commitRegion(xy,projection);return;}
          if(hit?.kind==='point'){e.stopPropagation();startPoint(e,hit.id);return;}
          if(hit?.kind==='curve'){e.stopPropagation();curveController.current?.(e,hit.id,Number(curve?.getAttribute('data-curve-id')===hit.id?curve?.getAttribute('data-handle-index')??0:0) as 0|1|2);return;}
        }}
        onPointerMoveCapture={e=>{const p=pendingSelection.current;if(p&&Math.hypot(e.clientX-p.x,e.clientY-p.y)>4){pendingSelection.current=null;selectionCycle.current.reset();}}}
        onPointerCancelCapture={()=>{pendingSelection.current=null;selectionCycle.current.reset();}}
        onPointerUpCapture={e=>{
          const p=pendingSelection.current;pendingSelection.current=null;if(!p||e.button!==0)return;
          const h=selectionCycle.current.next(p.hits,e.clientX,e.clientY,p.project),state=useEditor.getState();if(!h)return;
          if(h.kind==='point')state.selectLandmark(h.id);else if(h.kind==='curve')state.selectCurve(h.id);else state.selectObject(surfaceRef(state.project,h.id));
        }}
        onWheel={(e) =>
          setCanvas({
            ...v.canvas,
            zoom: Math.min(
              5,
              Math.max(0.35, zoom * Math.exp(-e.deltaY * 0.001)),
            ),
          })
        }
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          const r=e.currentTarget.getBoundingClientRect(),xy:Vec2=[e.clientX-r.left,e.clientY-r.top];
          const hit=e.button===0&&!e.shiftKey&&!s.referenceMoving?surfaceHit(s.project,xy,projection):null;
          const action=dispatch2D(useEditor.getState().tool,hit?'surface':'empty',e.shiftKey||e.button!==0);
          if(action==='surface'&&hit){useEditor.getState().selectObject(hit.ref);return;}
          if(action!=='pan'&&!s.referenceMoving)return;
          const start = local(e.clientX, e.clientY);
          if (s.referenceMoving && ref?.visible && !ref.locked) {
            s.beginEdit(true);
            drag.current = {
              kind: "reference",
              start,
              origin: [...ref.offset],
            };
          } else drag.current = { kind: "pan", start, origin: [...pan] };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerLeave={()=>selectionCycle.current.reset()}
        onPointerMove={(e) => {
          selectionCycle.current.move(e.clientX,e.clientY);
          const d = drag.current;
          if (!d) return;
          const p = local(e.clientX, e.clientY);
          if(d.kind==='constrained'){
            if(!d.recorded&&Math.hypot(p[0]-d.start[0],p[1]-d.start[1])<2)return;
            const r=e.currentTarget.getBoundingClientRect(),value=constrainedValue(useEditor.getState().project,d.constrained!,[e.clientX-r.left,e.clientY-r.top],projection);
            if(!value)return;if(!d.recorded){s.beginEdit(true);d.recorded=true;}
            const editor=useEditor.getState();if(value.kind==='curve')editor.setOnCurveS(d.id!,value.s);else if(value.kind==='ellipsoid')editor.setSurfacePoint(d.id!,value.direction);else if(value.kind==='patch')editor.setPatchPoint(d.id!,value.u,value.v);else editor.setCapPoint(d.id!,value.u,value.v);
          } else if (d.kind === "point") {
            if (!d.recorded) {
              if (Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) < 2) return;
              if (!motionState(s.project, d.id!, v).screenDof) {
                s.notify(
                  allowedBasis(s.project, d.id!).length
                    ? "此视图看不到允许的深度移动，请切换视图。"
                    : "此点被硬约束固定，请解除下方列出的视图锁。",
                );
                return;
              }
              s.beginEdit(true);
              d.recorded = true;
            }
            const startWorld = rawDisplayPlane(s.project,d.id!,world(d.start),projection),
              currentWorld = rawDisplayPlane(s.project,d.id!,world(p),projection);
            s.movePoint(d.id!, [
              d.origin[0] + currentWorld[0] - startWorld[0],
              d.origin[1] + currentWorld[1] - startWorld[1],
            ]);
          } else if (d.kind === "pan")
            setCanvas({
              zoom,
              pan: [
                d.origin[0] + p[0] - d.start[0],
                d.origin[1] + p[1] - d.start[1],
              ],
            });
          else if (ref && !ref.locked)
            s.setReference(v.id, {
              ...ref,
              offset: [
                d.origin[0] + (p[0] - d.start[0]) / zoom / UNIT,
                d.origin[1] - (p[1] - d.start[1]) / zoom / UNIT,
              ],
            });
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      >
        <g transform={`translate(${pan.join(" ")}) scale(${zoom})`} pointerEvents={s.referenceMoving ? "none" : undefined}>
          <DerivedRenderLayer view={projection} gpuHost={gpuHost} />
          <InteractionOverlay>
          {frameWire(s.project).map((line,i)=><polyline key={'loomis'+i} data-testid="loomis-wire" points={line.map(p=>{const q=project(displayPoint(s.project,"head",p,projection.forward),v);return `${q[0]*UNIT},${-q[1]*UNIT}`;}).join(' ')} fill="none" stroke="#83b5c1" strokeOpacity=".5" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" pointerEvents="none"/>)}
          <path
            d="M-3000 0H3000 M0 -3000V3000"
            stroke="#a0afba"
            strokeOpacity=".18"
            strokeDasharray="4 7"
            pointerEvents="none"
          />
          <polyline
            data-testid="centerline-guide"
            points={centerlineGuide(s.project)
              .map((p) => {
                const q = project(displayPoint(s.project,"head",p,projection.forward), v);
                return `${q[0] * UNIT},${-q[1] * UNIT}`;
              })
              .join(" ")}
            fill="none"
            stroke="#ffc879"
            strokeOpacity=".7"
            strokeWidth="1"
            strokeDasharray="3 5"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
          <CurveInteractionOverlay controller={curveController} view={v} projection={projection} />
          {!s.selectedCurveId && track && Math.hypot(...track) > 1e-8 && (
            <line
              data-testid="allowed-track"
              x1={q[0] * UNIT - track[0] * 2000}
              y1={-q[1] * UNIT - track[1] * 2000}
              x2={q[0] * UNIT + track[0] * 2000}
              y2={-q[1] * UNIT + track[1] * 2000}
              stroke="#ffc879"
              strokeWidth="1.5"
              strokeDasharray="6 5"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
          {[
            ...s.project.landmarks.filter((x) => x.id !== l?.id),
            ...(l ? [l] : []),
          ].filter(x=>!hidden(x.id)).map((x) => {
            const p = project(displayPoint(s.project,x.id,pointPosition(s.project,x.id),projection.forward), v),
              selected = !s.selectedCurveId && x.id === l?.id;
            return (
              <g key={x.id}>
                <circle
                  data-testid={`landmark-${x.name}`} data-point-id={x.id}
                  aria-label={x.name}
                  role="button"
                  tabIndex={0}
                  cx={p[0] * UNIT}
                  cy={-p[1] * UNIT}
                  r={(selected ? 6 : 4) / zoom}
                  fill={selected ? "#b9eb9f" : "#1b2328"}
                  stroke={
                    x.type === "CENTERLINE"
                      ? "#ffc879"
                      : x.type === "LEFT"
                        ? "#b9eb9f"
                        : "#8fc6e1"
                  }
                  strokeWidth={selected ? 2.5 : 1.5}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: "grab" }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    s.selectLandmark(x.id);
                  }}
                  onDoubleClick={(e) => {
                    if (s.curveCreation) return;
                    e.stopPropagation();
                    s.selectLandmark(x.id);
                  }}
                  onFocus={() => {
                    if (!s.curveCreation&&!s.patchCreation) s.selectLandmark(x.id);
                  }}
                  onPointerDown={e=>startPoint(e,x.id)}
                  onKeyDown={(e) => {
                    if(s.patchCreation)return;
                    if (s.curveCreation) {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        s.pickCurveEndpoint(x.id);
                      }
                      return;
                    }
                  }}
                />
                {selected && (
                  <text
                    x={p[0] * UNIT + 11 / zoom}
                    y={-p[1] * UNIT - 10 / zoom}
                    fill="#e5efdf"
                    fontSize={12 / zoom}
                    paintOrder="stroke"
                    stroke="#192126"
                    strokeWidth={3 / zoom}
                    pointerEvents="none"
                  >
                    {x.name}
                  </text>
                )}
              </g>
            );
          })}
          <GazeOverlay2D view={projection}/>
          <AuthoringPreview2D view={projection}/>
          <BoundaryAuthoringOverlay view={projection} zoom={zoom}/>
          </InteractionOverlay>
        </g>
      </svg>
      {!s.project.landmarks.length && !s.project.curves.length && !s.project.loomisRegions?.length && (
        <div className="landmark-empty">{uiText("没有语义点。可撤销删除或打开项目。")}</div>
      )}
      <div className="point-canvas-tools">
        <button
          onClick={() =>
            setCanvas({ ...v.canvas, zoom: Math.max(0.35, zoom / 1.1) })
          }
        >
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          onClick={() =>
            setCanvas({ ...v.canvas, zoom: Math.min(5, zoom * 1.1) })
          }
        >
          ＋
        </button>
        <button onClick={() => setCanvas({ zoom: 1, pan: [0, 0] })}>{uiText("居中")}</button>
      </div>
      <div className="point-stage-hint">
        {uiText(s.referenceMoving ? (
          <button onClick={() => s.setReferenceMoving(false)}>{uiText("完成图片平移")}</button>
        ) : s.curveCreation ? (
          "选择两个语义点创建结构线 · Esc 取消"
        ) : s.selectedCurveId ? (
          (s.project.curves.some(c=>c.id===s.selectedCurveId&&'controlPointIds' in c)?'眼睑 Bézier · 拖动眼角和控制柄 · Shift 拖动平移':s.project.curves.some(c=>c.id===s.selectedCurveId&&isOnPatch(c))?'贴面派生线 · 移动端点或修改 Host Surface · Shift 拖动平移':s.project.curves.some(c=>c.id===s.selectedCurveId&&isDerived(c))?'解析结构线 · 在侧栏调整参数 · Shift 拖动平移':'拖线弯曲 · 控制柄精调 · Shift 拖动平移')
        ) : (
          "拖动语义点 · 空白处 / Shift 拖动平移 · 滚轮缩放"
        ))}
      </div>
    </div>
  );
}
