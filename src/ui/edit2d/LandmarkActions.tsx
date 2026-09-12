import { incidentCurveIds } from "../../domain/curves/management";
import { useState } from "react";
import { useEditor } from "../../app/store";
import { landmarkBaseName } from "../../domain/landmarks/management";
export default function LandmarkActions() {
  const s = useEditor(),
    l = s.project.landmarks.find((l) => l.id === s.selectedId);
  const [mode, setMode] = useState<"duplicate" | "rename" | "delete" | null>(
      null,
    ),
    [name, setName] = useState(""),
    [error, setError] = useState("");
  const open = (m: typeof mode) => {
    setName(
      l
        ? m === "rename"
          ? landmarkBaseName(l)
          : landmarkBaseName(l) + "副本"
        : "",
    );
    setError("");
    setMode(m);
  };
  return (
    <>
      <div className="landmark-actions">
        {(["duplicate", "rename", "delete"] as const).map((m, i) => (
          <button
            key={m}
            disabled={!l || !!s.selectedCurveId || !!s.curveCreation}
            onClick={() => open(m)}
          >
            {["复制", "重命名", "删除"][i]}
          </button>
        ))}
      </div>
      {mode && l && (
        <div className="landmark-modal-backdrop">
          <form
            role="dialog"
            aria-modal="true"
            aria-label={
              mode === "duplicate"
                ? "复制语义点"
                : mode === "rename"
                  ? "重命名语义点"
                  : "删除语义点"
            }
            className="landmark-modal"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setMode(null);
              }
            }}
            onSubmit={(e) => {
              e.preventDefault();
              try {
                if (mode === "duplicate") s.duplicateSelected(name);
                else if (mode === "rename") s.renameSelected(name);
                else s.deleteSelected();
                setMode(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <strong>
              {mode === "duplicate"
                ? "复制"
                : mode === "rename"
                  ? "重命名"
                  : "删除"}
              「{l.name}」
            </strong>
            {mode === "delete" ? (
              <p>
                {l.mirrorPartnerId
                  ? "将同时删除左右两个点及其投影锚点。"
                  : "将删除此点及其投影锚点。"}
                {incidentCurveIds(s.project, l.id).size > 0 &&
                  ` 将同时删除 ${incidentCurveIds(s.project, l.id).size} 条相连结构线（含镜像侧）。`}
                可通过撤销恢复。
              </p>
            ) : (
              <label>
                {l.mirrorPartnerId
                  ? "基础名称（不含“左 / 右”前缀）"
                  : "中文名称"}
                <input
                  autoFocus
                  aria-label="语义点名称"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                />
              </label>
            )}
            {mode === "duplicate" && (
              <p>复制当前位置，自动选中新点；当前视图锁立即生效。</p>
            )}
            {error && <p role="alert">{error}</p>}
            <div>
              <button type="button" onClick={() => setMode(null)}>
                取消
              </button>
              <button autoFocus={mode === "delete"} type="submit">
                {mode === "delete" ? "确认删除" : "确定"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
