import { useRef, useState } from "react";
import { useEditor } from "../../app/store";
import { useUI } from "../session";
import FloatingPanel from "../shared/FloatingPanel";
import {
  incidentHalves,
  occupiedHalves,
  halfKey,
} from "../../domain/junctions/topology";
import { resolveNetwork } from "../../domain/junctions/resolve";
import type {
  CurveHalfEdgeRef,
  ResolvedJunction,
} from "../../domain/junctions/model";
export default function JunctionInspector() {
  const id = useUI((s) => s.junctionLandmarkId);
  if (!id) return null;
  return <InspectorContent key={id} id={id} />;
}
function InspectorContent({ id }: { id: string }) {
  const s = useEditor(),
    l = s.project.landmarks.find((l) => l.id === id),
    [pairing, setPairing] = useState(false),
    [a, setA] = useState(""),
    [b, setB] = useState(""),
    [error, setError] = useState("");
  const incident = incidentHalves(s.project, id),
    occupied = occupiedHalves(s.project),
    free = incident.filter((h) => !occupied.has(halfKey(h))),
    rows = resolveNetwork(s.project).junctions.filter(
      (j) => j.landmarkId === id,
    );
  const label = (h: CurveHalfEdgeRef) =>
    `${s.project.curves.find((c) => c.id === h.curveId)?.name} · ${h.endpoint === "start" ? "起点" : "终点"}`;
  const create = (a: CurveHalfEdgeRef, b: CurveHalfEdgeRef) => {
    try {
      s.createJunction(id, a, b);
      setPairing(false);
      setA("");
      setB("");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <FloatingPanel
      id="junction"
      title={`交点 · ${l?.name ?? "已删除"}`}
      label="交点检查器"
      onClose={() =>
        useUI.setState({ junctionLandmarkId: null, hoverJunctionId: null })
      }
    >
      {!l ? (
        <p>此语义点已删除，可通过撤销恢复。</p>
      ) : (
        <>
          <p>相连结构线：{incident.length}</p>
          <div className="junction-pairs">
            {rows.map((j) => (
              <Pair
                key={`${j.sourceId}:${j.mirrored}`}
                junction={j}
                label={`${label(j.sideA)} ↔ ${label(j.sideB)}`}
              />
            ))}
          </div>
          {incident.length === 2 && free.length === 2 ? (
            <div className="junction-corner">
              <p>
                {label(free[0])} ↔ {label(free[1])}
              </p>
              <p>状态：Corner</p>
              <button onClick={() => create(free[0], free[1])}>设为平滑</button>
            </div>
          ) : (
            <>
              <strong>未配对端点：{free.length}</strong>
              <ul>
                {free.map((h) => (
                  <li key={halfKey(h)}>{label(h)}</li>
                ))}
              </ul>
              {!pairing ? (
                <button
                  disabled={free.length < 2}
                  onClick={() => {
                    setPairing(true);
                    setError("");
                  }}
                >
                  ＋ 添加平滑配对
                </button>
              ) : (
                <form
                  className="junction-pairing"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const first = free.find((h) => halfKey(h) === a),
                      second = free.find((h) => halfKey(h) === b);
                    if (first && second) create(first, second);
                  }}
                >
                  <label>
                    第一条
                    <select
                      aria-label="第一条结构线"
                      value={a}
                      onChange={(e) => setA(e.target.value)}
                    >
                      <option value="">选择结构线</option>
                      {free.map((h) => (
                        <option key={halfKey(h)} value={halfKey(h)}>
                          {label(h)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    第二条
                    <select
                      aria-label="第二条结构线"
                      value={b}
                      onChange={(e) => setB(e.target.value)}
                    >
                      <option value="">选择结构线</option>
                      {free
                        .filter((h) => halfKey(h) !== a)
                        .map((h) => (
                          <option key={halfKey(h)} value={halfKey(h)}>
                            {label(h)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button type="button" onClick={() => setPairing(false)}>
                    取消配对
                  </button>
                  <button disabled={!a || !b || a === b}>建立平滑</button>
                </form>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="junction-invalid">
              {error}
            </p>
          )}
          <p>平滑范围控制局部接管长度；原语义点、控制柄和平面保持不变。</p>
        </>
      )}
    </FloatingPanel>
  );
}
function Pair({
  junction: j,
  label,
}: {
  junction: ResolvedJunction;
  label: string;
}) {
  const s = useEditor(),
    source = s.project.smoothJunctions.find((x) => x.id === j.sourceId)!,
    gesture = useRef(false),
    [error, setError] = useState("");
  return (
    <div
      className="junction-pair"
      data-testid={`junction-pair-${j.sourceId}`}
      onMouseEnter={() => useUI.setState({ hoverJunctionId: j.sourceId })}
      onMouseLeave={() => useUI.setState({ hoverJunctionId: null })}
    >
      <strong>{label}</strong>
      <p className={j.state === "INVALID" ? "junction-invalid" : ""}>
        {j.state === "VALID"
          ? "● Smooth · G1"
          : `⚠ 当前平滑连接无效：${j.reason}`}
      </p>
      <label>
        平滑范围 <output>{Math.round(source.extent * 100)}%</output>
        <input
          aria-label="平滑范围"
          type="range"
          min="0.01"
          max="0.45"
          step="0.01"
          value={source.extent}
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
            try {
              if (
                s.setJunctionExtent(
                  source.id,
                  Number(e.target.value),
                  !gesture.current,
                )
              )
                gesture.current = true;
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      </label>
      {error && (
        <p role="alert" className="junction-invalid">
          {error}
        </p>
      )}
      <button
        onClick={() => {
          s.removeJunction(source.id);
          useUI.setState({ hoverJunctionId: null });
        }}
      >
        取消平滑
      </button>
    </div>
  );
}
