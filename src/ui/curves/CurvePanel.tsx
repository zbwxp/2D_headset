import { useRef, useState } from "react";
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
    c = s.project.curves.find((c) => c.id === s.selectedCurveId);
  const [mode, setMode] = useState<"rename" | "delete" | null>(null),
    [name, setName] = useState(""),
    [error, setError] = useState("");
  return (
    <section className="curve-panel" aria-label="结构线">
      <h3>
        结构线 <span>{s.project.curves.length}</span>
      </h3>
      <button disabled={s.project.landmarks.length < 2} onClick={s.startCurve}>
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
      <div className="curve-list">
        {s.project.curves.map((x) => (
          <button
            key={x.id}
            className={x.id === c?.id ? "active" : ""}
            onClick={() => s.selectCurve(x.id)}
            aria-label={x.name}
          >
            {x.name}
          </button>
        ))}
      </div>
      {c && (
        <>
          <div className="curve-actions">
            <button
              onClick={() => {
                setName(
                  c.mirrorPartnerCurveId
                    ? c.name.replace(/^[左右]/, "")
                    : c.name,
                );
                setError("");
                setMode("rename");
              }}
            >
              重命名结构线
            </button>
            <button onClick={() => setMode("delete")}>删除结构线</button>
          </div>
          <PlaneControl key={c.id} id={c.id} />
          <p>
            拖线改变弯曲 · 控制柄精调
            <br />
            视图锁仅约束端点
          </p>
        </>
      )}
      {mode && c && (
        <div className="landmark-modal-backdrop">
          <form
            role="dialog"
            aria-modal="true"
            aria-label={mode === "delete" ? "删除结构线" : "重命名结构线"}
            className="landmark-modal"
            onKeyDown={(e) => {
              if (e.key === "Escape") setMode(null);
            }}
            onSubmit={(e) => {
              e.preventDefault();
              try {
                if (mode === "delete") s.deleteCurve(c.id);
                else s.renameCurve(c.id, name);
                setMode(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <strong>
              {mode === "delete" ? "删除" : "重命名"}「{c.name}」
            </strong>
            {mode === "delete" ? (
              <p>
                {c.mirrorPartnerCurveId
                  ? "将同时删除左右两条结构线。"
                  : "将删除此结构线。"}
                语义点保留，可撤销恢复。
              </p>
            ) : (
              <label>
                基础名称
                <input
                  aria-label="结构线名称"
                  autoFocus
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            {error && <p role="alert">{error}</p>}
            <div>
              <button type="button" onClick={() => setMode(null)}>
                取消
              </button>
              <button type="submit">
                {mode === "delete" ? "确认删除" : "确定"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
function PlaneControl({ id }: { id: string }) {
  const s = useEditor(),
    c = s.project.curves.find((c) => c.id === id)!,
    base = canonical(s.project, c),
    f = frame(s.project, base);
  const [angle, setAngle] = useState(0),
    gesture = useRef(false);
  if (isCenterCurve(s.project, c)) return <p>固定于中线平面 · 无旋转自由度</p>;
  return (
    <label className="curve-plane">
      调整曲线平面 <output>{angle}°</output>
      <input
        aria-label="调整曲线平面"
        type="range"
        min="-180"
        max="180"
        step="1"
        value={angle}
        disabled={f.length < CURVE_EPS}
        onPointerDown={() => {
          gesture.current = false;
        }}
        onPointerUp={() => {
          gesture.current = false;
        }}
        onPointerCancel={() => {
          gesture.current = false;
        }}
        onBlur={() => {
          gesture.current = false;
        }}
        onKeyUp={() => {
          gesture.current = false;
        }}
        onChange={(e) => {
          const a = Number(e.target.value);
          if (a === angle) return;
          if (!gesture.current) {
            s.beginEdit();
            gesture.current = true;
          }
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
    </label>
  );
}
