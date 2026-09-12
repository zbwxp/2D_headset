import LandmarkActions from "../ui/edit2d/LandmarkActions";
import { useEffect, useRef } from "react";
import {
  Undo2,
  Redo2,
  Download,
  Upload,
  Plus,
  LockKeyhole,
  Unlock,
  Box,
} from "lucide-react";
import { useEditor } from "./store";
import {
  allowedBasis,
  driverLocks,
  motionState,
  editingBasis,
  modelStateCode,
  viewIsLocked,
} from "../domain/landmarks/model";
import { parseLandmarks } from "../domain/landmarks/persistence";
import EditView, { MiniPreview } from "../ui/edit2d/EditView";
import InspectView from "../ui/inspect3d/InspectView";
export default function App() {
  const s = useEditor(),
    file = useRef<HTMLInputElement>(null),
    l = s.project.landmarks.find((l) => l.id === s.selectedId),
    free = l ? allowedBasis(s.project, l.id) : [],
    motion = l
      ? motionState(
          s.project,
          l.id,
          s.project.views.find((v) => v.id === s.viewId)!,
        )
      : { spatialDof: 0, screenDof: 0, track: null },
    activeView = s.project.views.find((v) => v.id === s.viewId)!,
    editAxes = l ? editingBasis(s.project, l.id, activeView) : [],
    lockedViews = s.project.views.filter((v) => viewIsLocked(s.project, v.id)),
    partner = s.project.landmarks.find((x) => x.id === l?.mirrorPartnerId);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement;
      if (t.closest('[role="dialog"]')) return;
      if (
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLInputElement && ["text", "number"].includes(t.type))
      )
        return;
      e.preventDefault();
      const s = useEditor.getState();
      e.shiftKey ? s.redo() : s.undo();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const save = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(s.project, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = s.project.meta.name + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="point-app">
      <header className="topbar">
        <div className="brand">
          <Box size={25} />
          contour<span className="point-version">V0.2 · 语义点</span>
        </div>
        <input
          className="point-name"
          aria-label="项目名称"
          value={s.project.meta.name}
          onChange={(e) => s.rename(e.target.value)}
        />
        <div className="point-top-actions">
          <button
            title="撤销 Ctrl Z"
            aria-label="撤销"
            disabled={!s.past.length}
            onClick={s.undo}
          >
            <Undo2 size={17} />
          </button>
          <button
            title="重做 Ctrl Shift Z"
            aria-label="重做"
            disabled={!s.future.length}
            onClick={s.redo}
          >
            <Redo2 size={17} />
          </button>
          <button disabled={!s.project.landmarks.length} onClick={s.reset}>
            <Plus size={16} />
            新建
          </button>
          <button onClick={() => file.current?.click()}>
            <Upload size={16} />
            打开
          </button>
          <button onClick={save}>
            <Download size={16} />
            保存 JSON
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              s.load(parseLandmarks(await f.text()));
            } catch (error) {
              s.notify((error as Error).message);
            }
          }}
        />
      </header>
      <main className="point-workspace">
        <aside className="point-sidebar">
          <div className="point-side-heading">
            语义点 <span>{s.project.landmarks.length}</span>
          </div>
          <LandmarkActions />
          <div className="point-list">
            {s.project.landmarks.map((x) => (
              <button
                key={x.id}
                aria-label={x.name}
                className={x.id === l?.id ? "active" : ""}
                onClick={() => s.selectLandmark(x.id)}
              >
                <span
                  style={{
                    color:
                      x.type === "CENTERLINE"
                        ? "#ffc879"
                        : x.type === "LEFT"
                          ? "#b9eb9f"
                          : "#8fc6e1",
                  }}
                >
                  ●
                </span>
                {x.name}
                {Object.keys(driverLocks(s.project, x.id)).length > 0 && (
                  <LockKeyhole size={12} />
                )}
              </button>
            ))}
          </div>
          <div className="point-side-note">
            共享 3D 坐标
            <br />
            左右镜像 · 中线硬约束
            <br />左 / 右按角色自身方向
          </div>
        </aside>
        <section className="point-edit-column">
          <nav className="point-view-tabs">
            {s.project.views.map((v) => (
              <button
                key={v.id}
                className={v.id === s.viewId ? "active" : ""}
                onClick={() => s.selectView(v.id)}
              >
                {v.label}
                {viewIsLocked(s.project, v.id) && <LockKeyhole size={12} />}
              </button>
            ))}
            <label
              className="point-lock"
              title="统一开关视图锁；每对镜像点仅约束 driver，follower 通过镜像跟随"
            >
              <input
                type="checkbox"
                aria-label="锁定此视图全部点"
                checked={viewIsLocked(s.project, s.viewId)}
                onChange={(e) => s.setViewLock(s.viewId, e.target.checked)}
              />
              {viewIsLocked(s.project, s.viewId) ? (
                <LockKeyhole size={15} />
              ) : (
                <Unlock size={15} />
              )}
              统一视图锁
            </label>
          </nav>
          <div className="point-global-locks" aria-label="全部点的视图锁">
            <span>显式视图锁：</span>
            {s.project.views
              .filter((v) => viewIsLocked(s.project, v.id))
              .map((v) => (
                <button
                  key={v.id}
                  aria-label={`解锁${v.label}全部点`}
                  onClick={() => s.setViewLock(v.id, false)}
                >
                  {v.label} <Unlock size={12} />
                </button>
              ))}
            {!s.project.views.some((v) => viewIsLocked(s.project, v.id)) && (
              <span>无</span>
            )}
          </div>
          <div className="point-edit-basis" data-testid="edit-basis">
            <span>
              {lockedViews.length
                ? `移动基准：${lockedViews.map((v) => v.label).join("、")}锁约束`
                : `移动基准：${activeView.label}相机平面（深度不变）`}
            </span>
            {editAxes.length === 1 && (
              <code>
                方向 X {editAxes[0][0].toFixed(2)} / Y{" "}
                {editAxes[0][1].toFixed(2)} / Z {editAxes[0][2].toFixed(2)}
              </code>
            )}
          </div>
          <EditView />
          <div className="point-detail">
            <strong>{l?.name ?? "未选中语义点"}</strong>
            <span data-testid="dof">{free.length} DOF</span>
            <span data-testid="motion-status">
              {!l
                ? "空项目 · 撤销或打开项目恢复"
                : motion.spatialDof === 0
                  ? "已固定 · 解除视图锁以继续"
                  : motion.screenDof === 0
                    ? "仅剩视线方向移动 · 请换视图"
                    : motion.screenDof === 1
                      ? "当前视图：沿虚线移动"
                      : "当前视图：平面内自由移动"}
            </span>
          </div>
        </section>
        <section className="point-inspect-column">
          <div className="point-panel-title">
            3D · 空间检查<span>{s.project.landmarks.length} 个语义点</span>
          </div>
          <InspectView />
          <div className="point-minis">
            {["front", "left45", "side"]
              .filter((id) => s.project.views.some((v) => v.id === id))
              .map((id) => (
                <MiniPreview key={id} viewId={id} />
              ))}
          </div>
        </section>
      </main>
      <footer className="point-footer">
        <div>
          <b>{l?.name ?? "空项目"}</b>
          <code data-testid="position">
            {l?.position.map((n) => n.toFixed(4)).join(" / ")}
          </code>
        </div>
        <span>
          {partner
            ? `Driver：${l?.name} → Follower：${partner.name}`
            : l
              ? "正中矢状面 x = 0"
              : "无语义点"}
        </span>
        <span>
          显式视图锁：
          {s.project.views
            .filter((v) => viewIsLocked(s.project, v.id))
            .map((v) => v.label)
            .join("、") || "无"}
        </span>
        <span
          className="point-save-scope"
          title="浏览器各自保存项目；要在另一浏览器使用同一状态，请保存 JSON 后在那里打开。画布布局和缩放不影响此状态码。"
        >
          本浏览器存档 · 模型状态{" "}
          <code data-testid="model-state">{modelStateCode(s.project)}</code>
        </span>
        <span>撤销 {s.past.length} / 100</span>
      </footer>
      {s.message && (
        <div
          role="status"
          className="point-message"
          onClick={() => s.notify("")}
        >
          {s.message}
          <button aria-label="关闭提示">×</button>
        </div>
      )}
    </div>
  );
}
