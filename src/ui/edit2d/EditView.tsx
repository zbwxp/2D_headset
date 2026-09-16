import {isAnalytic} from '../../domain/curves/model';
import {frameWire} from '../../domain/head/frame';
import BoundaryAuthoringOverlay from '../patches/BoundaryAuthoringOverlay';
import {count} from '../../domain/geometry/diagnostics';
import {useShallow} from 'zustand/react/shallow';
import {pointPosition} from "../../domain/geometry/evaluation";
import DerivedRenderLayer from "./DerivedRenderLayer";
import InteractionOverlay from "./InteractionOverlay";
import {useOrthographicView} from "./useOrthographicView";
import CurveInteractionOverlay from "../curves/CurveInteractionOverlay";
import { useRef,useState } from "react";
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
export default function EditView() {
 count('renderEditView');
  const s = useEditor(useShallow(s=>({patchCreation:s.patchCreation,pickPatchAnchor:s.pickPatchAnchor,beginEdit:s.beginEdit,curveCreation:s.curveCreation,endEdit:s.endEdit,movePoint:s.movePoint,notify:s.notify,pickCurveEndpoint:s.pickCurveEndpoint,project:s.project,referenceMoving:s.referenceMoving,selectLandmark:s.selectLandmark,selectedCurveId:s.selectedCurveId,selectedId:s.selectedId,setCanvas:s.setCanvas,setReference:s.setReference,setReferenceMoving:s.setReferenceMoving,viewId:s.viewId}))),
    v = s.project.views.find((v) => v.id === s.viewId)!,
    l = s.project.landmarks.find((l) => l.id === s.selectedId),
    { zoom, pan } = v.canvas,
    ref = v.reference;
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<{
      kind: "point" | "pan" | "reference";
      id?: string;
      start: Vec2;
      origin: Vec2;
      recorded?: boolean;
    } | null>(null);
  const [gpuHost,setGpuHost]=useState<HTMLDivElement|null>(null);
  const projection=useOrthographicView(svg,v);
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
    q = l ? project(pointPosition(s.project,l.id), v) : [0, 0];
  const track = motion.track ? [motion.track[0], -motion.track[1]] : null;
  const end = () => {
    drag.current = null;
    s.endEdit();
  };
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
      <span className="point-view-label">{v.label} · 正交投影</span>
      <svg
        ref={svg}
        data-testid="point-editor"
        viewBox={`${-EDIT_VIEWBOX.width/2} ${-EDIT_VIEWBOX.height/2} ${EDIT_VIEWBOX.width} ${EDIT_VIEWBOX.height}`}
        style={{ width: "100%", height: "100%", touchAction: "none" }}
        onWheel={(e) =>
          s.setCanvas({
            ...v.canvas,
            zoom: Math.min(
              5,
              Math.max(0.35, zoom * Math.exp(-e.deltaY * 0.001)),
            ),
          })
        }
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
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
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const p = local(e.clientX, e.clientY);
          if (d.kind === "point") {
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
            const startWorld = world(d.start),
              currentWorld = world(p);
            s.movePoint(d.id!, [
              d.origin[0] + currentWorld[0] - startWorld[0],
              d.origin[1] + currentWorld[1] - startWorld[1],
            ]);
          } else if (d.kind === "pan")
            s.setCanvas({
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
          {frameWire(s.project).map((line,i)=><polyline key={'loomis'+i} data-testid="loomis-wire" points={line.map(p=>{const q=project(p,v);return `${q[0]*UNIT},${-q[1]*UNIT}`;}).join(' ')} fill="none" stroke="#83b5c1" strokeOpacity=".5" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" pointerEvents="none"/>)}
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
                const q = project(p, v);
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
          <CurveInteractionOverlay view={v} projection={projection} />
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
          ].map((x) => {
            const p = project(pointPosition(s.project,x.id), v),
              selected = !s.selectedCurveId && x.id === l?.id;
            return (
              <g key={x.id}>
                <circle
                  data-testid={`landmark-${x.name}`}
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
                  onPointerDown={(e) => {
                    if (e.button === 2) {
                      e.stopPropagation();
                      return;
                    }
                    if (e.shiftKey || e.button !== 0) return;
                    e.stopPropagation();
                    if (s.curveCreation) {
                      e.preventDefault();
                      s.pickCurveEndpoint(x.id);
                      return;
                    }
                    if(s.patchCreation){e.preventDefault();s.pickPatchAnchor(x.id);return;}
                    s.selectLandmark(x.id);
                    e.preventDefault();
                    e.currentTarget.focus({ preventScroll: true });
                    if(x.placement.kind==="ON_CURVE"||(x.placement.kind==="ON_LOOMIS_SURFACE"||(x.placement.kind==="LOOMIS_SCAFFOLD"||x.placement.kind==="ON_SECTION_CAP")))return;
                    drag.current = {
                      kind: "point",
                      id: x.id,
                      start: local(e.clientX, e.clientY),
                      origin: p,
                    };
                    svg.current!.setPointerCapture(e.pointerId);
                    if (!allowedBasis(s.project, x.id).length)
                      s.notify("此点已固定，请解除上方列出的视图锁。");
                  }}
                  onKeyDown={(e) => {
                    if(s.patchCreation)return;
                    if (s.curveCreation) {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        s.pickCurveEndpoint(x.id);
                      }
                      return;
                    }
                    if(x.placement.kind==="ON_CURVE"||(x.placement.kind==="ON_LOOMIS_SURFACE"||(x.placement.kind==="LOOMIS_SCAFFOLD"||x.placement.kind==="ON_SECTION_CAP")))return;
                    const d: Record<string, Vec2> = {
                      ArrowLeft: [-1, 0],
                      ArrowRight: [1, 0],
                      ArrowUp: [0, 1],
                      ArrowDown: [0, -1],
                    };
                    if (d[e.key]) {
                      e.preventDefault();
                      s.beginEdit(true);
                      s.movePoint(x.id, [
                        p[0] + d[e.key][0] * (e.shiftKey ? 0.025 : 0.00625),
                        p[1] + d[e.key][1] * (e.shiftKey ? 0.025 : 0.00625),
                      ]);
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
          <BoundaryAuthoringOverlay view={projection} zoom={zoom}/>
          </InteractionOverlay>
        </g>
      </svg>
      {!s.project.landmarks.length && !s.project.curves.length && !s.project.loomisRegions?.length && (
        <div className="landmark-empty">没有语义点。可撤销删除或打开项目。</div>
      )}
      <div className="point-canvas-tools">
        <button
          onClick={() =>
            s.setCanvas({ ...v.canvas, zoom: Math.max(0.35, zoom / 1.1) })
          }
        >
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          onClick={() =>
            s.setCanvas({ ...v.canvas, zoom: Math.min(5, zoom * 1.1) })
          }
        >
          ＋
        </button>
        <button onClick={() => s.setCanvas({ zoom: 1, pan: [0, 0] })}>
          居中
        </button>
      </div>
      <div className="point-stage-hint">
        {s.referenceMoving ? (
          <button onClick={() => s.setReferenceMoving(false)}>
            完成图片平移
          </button>
        ) : s.curveCreation ? (
          "选择两个语义点创建结构线 · Esc 取消"
        ) : s.selectedCurveId ? (
          (s.project.curves.some(c=>c.id===s.selectedCurveId&&isAnalytic(c))?'解析结构线 · 在侧栏调整参数 · Shift 拖动平移':'拖线弯曲 · 控制柄精调 · Shift 拖动平移')
        ) : (
          "拖动语义点 · 空白处 / Shift 拖动平移 · 滚轮缩放"
        )}
      </div>
    </div>
  );
}
