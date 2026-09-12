import { useRef } from "react";
import { useEditor } from "../../app/store";
import { project } from "../../domain/geometry/core";
import {
  allowedBasis,
  motionState,
  centerlineGuide,
} from "../../domain/landmarks/model";
import type { Vec2 } from "../../domain/project/types";
import ReferenceControls from "./ReferenceControls";
export default function EditView() {
  const s = useEditor(),
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
  const local = (x: number, y: number): Vec2 => {
    const p = new DOMPoint(x, y).matrixTransform(
      svg.current!.getScreenCTM()!.inverse(),
    );
    return [p.x, p.y];
  };
  const world = (p: Vec2): Vec2 => [
    (p[0] - pan[0]) / zoom / 160,
    -(p[1] - pan[1]) / zoom / 160,
  ];
  const motion = l ? motionState(s.project, l.id, v) : { track: null },
    q = l ? project(l.position, v) : [0, 0];
  const track = motion.track ? [motion.track[0], -motion.track[1]] : null;
  const end = () => {
    drag.current = null;
  };
  return (
    <div className="point-stage">
      <ReferenceControls key={v.id} viewId={v.id} />
      <span className="point-view-label">{v.label} · 正交投影</span>
      <svg
        ref={svg}
        data-testid="point-editor"
        viewBox="-300 -280 600 560"
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
            s.beginEdit();
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
              s.beginEdit();
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
                d.origin[0] + (p[0] - d.start[0]) / zoom / 160,
                d.origin[1] - (p[1] - d.start[1]) / zoom / 160,
              ],
            });
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      >
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
          pointerEvents={s.referenceMoving ? "none" : undefined}
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
              transform={`translate(${ref.offset[0] * 160} ${-ref.offset[1] * 160}) rotate(${ref.rotation}) scale(${ref.scale})`}
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
                return `${q[0] * 160},${-q[1] * 160}`;
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
          {track && Math.hypot(...track) > 1e-8 && (
            <line
              data-testid="allowed-track"
              x1={q[0] * 160 - track[0] * 2000}
              y1={-q[1] * 160 - track[1] * 2000}
              x2={q[0] * 160 + track[0] * 2000}
              y2={-q[1] * 160 + track[1] * 2000}
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
            const p = project(x.position, v),
              selected = x.id === l?.id;
            return (
              <g key={x.id}>
                <circle
                  data-testid={`landmark-${x.name}`}
                  aria-label={x.name}
                  role="button"
                  tabIndex={0}
                  cx={p[0] * 160}
                  cy={-p[1] * 160}
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
                  onFocus={() => s.selectLandmark(x.id)}
                  onPointerDown={(e) => {
                    if (e.shiftKey || e.button !== 0) return;
                    e.stopPropagation();
                    s.selectLandmark(x.id);
                    e.preventDefault();
                    e.currentTarget.focus({ preventScroll: true });
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
                    const d: Record<string, Vec2> = {
                      ArrowLeft: [-1, 0],
                      ArrowRight: [1, 0],
                      ArrowUp: [0, 1],
                      ArrowDown: [0, -1],
                    };
                    if (d[e.key]) {
                      e.preventDefault();
                      s.beginEdit();
                      s.movePoint(x.id, [
                        p[0] + d[e.key][0] * (e.shiftKey ? 0.025 : 0.00625),
                        p[1] + d[e.key][1] * (e.shiftKey ? 0.025 : 0.00625),
                      ]);
                    }
                  }}
                />
                {selected && (
                  <text
                    x={p[0] * 160 + 11 / zoom}
                    y={-p[1] * 160 - 10 / zoom}
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
        </g>
      </svg>
      {!l && (
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
        ) : (
          "拖动语义点 · 空白处 / Shift 拖动平移 · 滚轮缩放"
        )}
      </div>
    </div>
  );
}
export function MiniPreview({ viewId }: { viewId: string }) {
  const s = useEditor(),
    v = s.project.views.find((v) => v.id === viewId)!;
  return (
    <button
      className={`point-mini ${s.viewId === viewId ? "active" : ""}`}
      onClick={() => s.selectView(viewId)}
    >
      <svg viewBox="-180 -220 360 440">
        <polyline
          points={centerlineGuide(s.project)
            .map((p) => {
              const q = project(p, v);
              return `${q[0] * 160},${-q[1] * 160}`;
            })
            .join(" ")}
          fill="none"
          stroke="#ffc879"
          strokeWidth="1"
          strokeDasharray="4 6"
        />

        {s.project.landmarks.map((l) => {
          const p = project(l.position, v);
          return (
            <circle
              key={l.id}
              cx={p[0] * 160}
              cy={-p[1] * 160}
              r={l.id === s.selectedId ? 7 : 4}
              fill={l.id === s.selectedId ? "#b9eb9f" : "#83989d"}
            />
          );
        })}
      </svg>
      <span>{v.label}</span>
    </button>
  );
}
