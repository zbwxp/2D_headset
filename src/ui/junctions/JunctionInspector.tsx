import { useRef } from "react";
import { useEditor } from "../../app/store";
import { useUI } from "../session";
import FloatingPanel from "../shared/FloatingPanel";
import {
  config,
  incident,
  key,
  mirrorHalf,
} from "../../domain/surfaceSmooth/config";
import { resolveNetwork } from "../../domain/surfaceSmooth/solver";
export default function JunctionInspector() {
  const id = useUI((s) => s.junctionLandmarkId);
  return id ? <Content key={id} id={id} /> : null;
}
function Content({ id }: { id: string }) {
  const s = useEditor(),
    gesture = useRef(false),
    debug = useUI((s) => s.smoothDebug),
    l = s.project.landmarks.find((l) => l.id === id),
    cfg = config(s.project, id),
    rows = incident(s.project, id),
    node = resolveNetwork(s.project).nodes.find((n) => n.landmarkId === id);
  const seen = new Set<string>();
  const groups = rows.filter((h) => {
    if (seen.has(key(h))) return false;
    seen.add(key(h));
    if (l?.type === "CENTERLINE") seen.add(key(mirrorHalf(s.project, h)));
    return true;
  });
  return (
    <FloatingPanel
      id="junction"
      title={`Surface Smooth · ${l?.name ?? "已删除"}`}
      label="Surface Smooth Node 检查器"
      onClose={() =>
        useUI.setState({ junctionLandmarkId: null, hoverJunctionId: null })
      }
    >
      {!l ? (
        <p>此语义点已删除，可撤销恢复。</p>
      ) : (
        <div
          className="surface-node-controls"
          onMouseEnter={() => useUI.setState({ hoverJunctionId: id })}
          onMouseLeave={() => useUI.setState({ hoverJunctionId: null })}
        >
          <label>
            <input
              type="checkbox"
              aria-label="Surface Smooth"
              checked={cfg.enabled}
              onChange={(e) =>
                s.setSurfaceNode(id, { enabled: e.target.checked })
              }
            />
            Surface Smooth
          </label>
          <label>
            平滑范围 <output>{Math.round(cfg.extent * 100)}%</output>
            <input
              aria-label="平滑范围"
              type="range"
              min=".01"
              max=".45"
              step=".01"
              value={cfg.extent}
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
                if (
                  s.setSurfaceNode(
                    id,
                    { extent: Number(e.target.value) },
                    !gesture.current,
                  )
                )
                  gesture.current = true;
              }}
            />
          </label>
          <p>
            参与结构线（{node?.participants.length ?? 0}/{rows.length}）
          </p>
          {groups.map((h) => {
            const m = mirrorHalf(s.project, h),
              paired = l.type === "CENTERLINE" && m.curveId !== h.curveId,
              excluded = cfg.excludedHalfEdges.some((x) => key(x) === key(h));
            const label =
              (paired ? "左/右 · " : "") +
              s.project.curves.find((c) => c.id === h.curveId)!.name +
              ` · ${h.endpoint === "start" ? "起点" : "终点"}`;
            return (
              <label key={key(h)} style={{ display: "block", margin: "8px 0" }}>
                <input
                  type="checkbox"
                  aria-label={label}
                  checked={!excluded}
                  onChange={(e) => {
                    const keys = new Set([key(h), ...(paired ? [key(m)] : [])]);
                    s.setSurfaceNode(id, {
                      excludedHalfEdges: e.target.checked
                        ? cfg.excludedHalfEdges.filter((x) => !keys.has(key(x)))
                        : [...cfg.excludedHalfEdges, h],
                    });
                  }}
                />
                {label}
              </label>
            );
          })}
          <p role="status" data-testid="surface-node-status">
            {node?.state === "INVALID"
              ? `⚠ 当前平滑无效：${node.reason}`
              : node?.state === "OFF"
                ? "Surface Smooth 已关闭"
                : node?.state === "NO_OP"
                  ? "参与结构线不足 2 条，当前不执行 Surface Smooth"
                  : node?.stress === "HIGH_STRESS"
                    ? "⚠ 局部转向较大，建议增加平滑范围"
                    : "✓ 平滑稳定"}
          </p>
          <label>
            <input
              type="checkbox"
              aria-label="显示平滑调试"
              checked={debug}
              onChange={(e) =>
                useUI.setState({ smoothDebug: e.target.checked })
              }
            />
            显示平滑调试（切平面与截点）
          </label>
          <p>
            所有线仍连接原语义点；无需修正的端点保持原曲线。调试仅显示在二维视图。
          </p>
        </div>
      )}
    </FloatingPanel>
  );
}
