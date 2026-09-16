import {isAnalytic} from '../../domain/curves/model';
import {evaluationContext} from '../../domain/geometry/evaluation';
import {curvePolyline,type CurveProvider} from '../../domain/geometry/curveProvider';
import {worldToPlane,worldToSvg,screenToPlane,EDIT_VIEWBOX,type OrthographicViewState} from '../../rendering/orthographic';
import {useShallow} from 'zustand/react/shallow';
import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useEditor } from "../../app/store";
import { add, sub } from "../../domain/geometry/core";
import {
  controls,
  canonical,
  nearestParameter,
  planeTarget,
  bezier,
  bodyShape,
  handleShape,
} from "../../domain/curves/geometry";
import type { ControlPoints } from "../../domain/curves/geometry";
import type {
  LandmarkProject,
  LandmarkView,
} from "../../domain/landmarks/model";
import type { CurveEdge } from "../../domain/curves/model";
import type { Vec2, Vec3 } from "../../domain/project/types";
const UNIT=EDIT_VIEWBOX.unitsPerWorld;
export function curvePath(cp: ControlPoints, v: OrthographicViewState): string {
  const xy = cp.map((p) => {
    const q = worldToSvg(p,v);
    return `${q[0]},${q[1]}`;
  });
  return `M${xy[0]} C${xy[1]} ${xy[2]} ${xy[3]}`;
}
export function providerPath(g:CurveProvider,v:OrthographicViewState){return g.controls?curvePath(g.controls,v):curvePolyline(g).map((p,i)=>(i?'L':'M')+worldToSvg(p,v).slice(0,2).join(',')).join(' ');}
export default function CurveInteractionOverlay({view,projection}:{view:LandmarkView;projection:OrthographicViewState}) {
  const project=(p:readonly number[],_view:LandmarkView)=>worldToPlane(p,projection).slice(0,2) as Vec2;
  const s = useEditor(useShallow(s=>({beginEdit:s.beginEdit,curveCreation:s.curveCreation,endEdit:s.endEdit,notify:s.notify,patchCreation:s.patchCreation,project:s.project,referenceMoving:s.referenceMoving,selectCurve:s.selectCurve,selectedCurveId:s.selectedCurveId,setCurveShape:s.setCurveShape}))),
    group = useRef<SVGGElement>(null);
  const drag = useRef<{
    project: LandmarkProject;
    curve: CurveEdge;
    index: 0 | 1 | 2;
    t: number;
    start: Vec2;
    startTarget: Vec3;
    point: Vec3;
    recorded: boolean;
    view: LandmarkView;
  } | null>(null);
  const local = (e: ReactPointerEvent): Vec2 => {
    const rect=group.current!.ownerSVGElement!.getBoundingClientRect();
    return screenToPlane([e.clientX-rect.left,e.clientY-rect.top],projection);
  };
  const start = (e: ReactPointerEvent, c: CurveEdge, index: 0 | 1 | 2) => {
    if (
      s.referenceMoving ||
      s.curveCreation ||
      e.shiftKey ||
      e.button !== 0
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    s.selectCurve(c.id);
    if(s.patchCreation||isAnalytic(c)) return;
    const q = local(e),
      target = planeTarget(s.project, c, view, q),
      base = canonical(s.project, c);
    if (!target) {
      s.notify(
        "曲线平面在此视图接近侧向，或端点重合；请换视图或分开端点后编辑。",
      );
      return;
    }
    const t = Math.max(
      0.05,
      Math.min(0.95, nearestParameter(controls(s.project, c), view, q)),
    );
    drag.current = {
      project: s.project,
      curve: c,
      index,
      t,
      start: [e.clientX, e.clientY],
      startTarget: target,
      point: index
        ? controls(s.project, base)[index]
        : bezier(controls(s.project, base), t),
      recorded: false,
      view,
    };
    group.current!.setPointerCapture(e.pointerId);
  };
  return (
    <g
      ref={group}
      className="curve-layer"
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        e.stopPropagation();
        if (
          Math.hypot(e.clientX - d.start[0], e.clientY - d.start[1]) < 2 &&
          !d.recorded
        )
          return;
        const q = planeTarget(d.project, d.curve, d.view, local(e));
        if (!q) return;
        if (!d.recorded) {
          s.beginEdit(true);
          d.recorded = true;
        }
        const target = add(d.point, sub(q, d.startTarget)),
          base = canonical(d.project, d.curve);
        s.setCurveShape(
          base.id,
          d.index
            ? handleShape(d.project, base, d.index, target)
            : bodyShape(d.project, base, d.t, target),
        );
      }}
      onPointerUp={(e) => {
        if (drag.current) e.stopPropagation();
        drag.current = null;
        s.endEdit();
      }}
      onPointerCancel={() => {
        drag.current = null;
        s.endEdit();
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        s.endEdit();
      }}
    >
      {[
        ...s.project.curves.filter((c) => c.id !== s.selectedCurveId),
        ...s.project.curves.filter((c) => c.id === s.selectedCurveId),
      ].map((c) => {
        const selected = c.id === s.selectedCurveId || s.patchCreation?.host===c.id,
          g = evaluationContext(s.project).curve(c.id), cp=g.controls,
          path = providerPath(g, projection);
        return (
          <g key={c.id}>
            <path
              data-testid={`curve-${c.id}`}
              strokeDasharray={"systemRole" in c&&c.systemRole?.startsWith("MAIN_")?"5 4":undefined}
              d={path}
              fill="none"
              stroke={selected ? "#f0d8ff" : "#ab9fdd"}
              strokeWidth={selected ? 2.5 : 1.5}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
              opacity={selected ? 1 : 0}
            />
            {(
              <path
                data-testid={`curve-hit-${c.id}`}
                d={path}
                fill="none"
                stroke="transparent"
                strokeWidth="12"
                vectorEffect="non-scaling-stroke"
                style={{ cursor: "grab" }}
                pointerEvents={s.curveCreation ? "none" : "stroke"}
                onPointerDown={(e) => start(e, c, 0)}
              />
            )}
            {selected && cp && (
              <>
                <path
                  d={`M${project(cp[0], view)
                    .map((x, i) => x * (i ? -UNIT : UNIT))
                    .join(",")} L${project(cp[1], view)
                    .map((x, i) => x * (i ? -UNIT : UNIT))
                    .join(",")} M${project(cp[3], view)
                    .map((x, i) => x * (i ? -UNIT : UNIT))
                    .join(",")} L${project(cp[2], view)
                    .map((x, i) => x * (i ? -UNIT : UNIT))
                    .join(",")}`}
                  stroke="#ab9fdd"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  pointerEvents="none"
                />
                {([1, 2] as const).map((index) => {
                  const q = project(cp[index], view);
                  return (
                    <circle
                      key={index}
                      data-testid={`curve-handle-${index}`}
                      aria-label={`控制柄 ${index}`}
                      cx={q[0] * UNIT}
                      cy={-q[1] * UNIT}
                      r={5 / view.canvas.zoom}
                      fill="#342d45"
                      stroke="#f0d8ff"
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: "grab" }}
                      onPointerDown={(e) => start(e, c, index)}
                    />
                  );
                })}
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}
