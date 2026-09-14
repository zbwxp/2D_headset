import NumericSlider from '../shared/NumericSlider';
import {formatNumeric} from '../shared/numericSliderMath';
import {SmoothEdgeControl} from "../smooth/SmoothControls";
import InlineName from "../shared/InlineName";
import { useUI } from "../session";
import { useState } from "react";
import { useEditor } from "../../app/store";
import {
  canonical,
  frame,
  isCenterCurve,
  rotate,
  CURVE_EPS,
} from "../../domain/curves/geometry";
export default function CurvePanel() {
  const s = useEditor(),
    ui = useUI(),
    c = s.project.curves.find((c) => c.id === s.selectedCurveId);
  return (
    <section
      className={`sidebar-section curve-panel ${ui.curveCollapsed ? "collapsed" : ""}`}
      aria-label="结构线"
    >
      <button
        className="section-heading"
        aria-expanded={!ui.curveCollapsed}
        onClick={() => useUI.setState({ curveCollapsed: !ui.curveCollapsed })}
      >
        <span>{ui.curveCollapsed ? "▶" : "▼"} 结构线</span>
        <span>{s.project.curves.length}</span>
      </button>
      <div className="section-body" hidden={ui.curveCollapsed}>
        {c && (
          <div className="curve-current" data-testid="curve-current">
            <strong>当前：{c.name}</strong>
            <PlaneControl key={c.id} id={c.id} />
            <SmoothEdgeControl key={"smooth-"+c.id} id={c.id}/>
          </div>
        )}
        <div className="curve-create">
          <button
            disabled={s.project.landmarks.length < 2}
            onClick={s.startCurve}
          >
            创建曲线
          </button>
          {s.curveCreation && (
            <div className="curve-create-note">
              {s.curveCreation.startId
                ? `起点：${s.project.landmarks.find((l) => l.id === s.curveCreation!.startId)?.name}；请选择终点 B`
                : "请选择起点 A"}
              <button onClick={s.cancelCurve}>取消创建</button>
            </div>
          )}
        </div>
        <div className="curve-list">
          {s.project.curves.map((x) => (
            <div
              role="button"
              tabIndex={0}
              key={x.id}
              aria-label={x.name}
              className={x.id === c?.id ? "active" : ""}
              onClick={() => s.selectCurve(x.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  s.selectCurve(x.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                s.selectCurve(x.id);
                useUI.setState({
                  menu: {
                    target: { kind: "curve", id: x.id },
                    x: e.clientX,
                    y: e.clientY,
                  },
                });
              }}
            >
              <InlineName
                target={{ kind: "curve", id: x.id }}
                name={x.name}
                baseName={
                  x.mirrorPartnerCurveId
                    ? x.name.replace(/^[左右]/, "")
                    : x.name
                }
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
function PlaneControl({ id }: { id: string }) {
  const s = useEditor(),
    c = s.project.curves.find((c) => c.id === id)!,
    base = canonical(s.project, c),
    f = frame(s.project, base);
  const [angle, setAngle] = useState(0);
  if (isCenterCurve(s.project, c)) return <p>固定于中线平面 · 无旋转自由度</p>;
  return (
    <NumericSlider className="curve-plane" label="调整曲线平面" min={-180} max={180} value={angle} formatValue={v=>formatNumeric(v)+'°'} disabled={f.length<CURVE_EPS} onEditStart={s.beginEdit} onChange={a=>{
          s.setCurveShape(base.id, {
            ...base.shape,
            planeNormal: rotate(
              f.n,
              f.d,
              (((a - angle) * Math.PI) / 180) * (c.role === "mirror" ? -1 : 1),
            ),
          });
          setAngle(a);
        }}
      />
  );
}
