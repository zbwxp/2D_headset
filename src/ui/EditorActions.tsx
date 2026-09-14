import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor } from "../app/store";
import { useUI, activeSelection, focusWorkspace } from "./session";
import { landmarkBaseName } from "../domain/landmarks/management";
import { incidentCurveIds } from "../domain/curves/management";
import FloatingPanel from "./shared/FloatingPanel";
export default function EditorActions() {
  const ui = useUI(),
    s = useEditor(),
    source = s.project.landmarks.find((l) => l.id === ui.duplicateId);
  const [name, setName] = useState(""),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ui.duplicateId) {
      setName(source ? landmarkBaseName(source) + "副本" : "");
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.select();
      });
    }
  }, [ui.duplicateId]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        e.defaultPrevented ||
        e.isComposing ||
        t.closest(
          'input,textarea,[contenteditable]:not([contenteditable="false"]),[data-ui-keyboard],[role="dialog"]',
        ) ||
        document.querySelector('[aria-modal="true"]')
      )
        return;
      if (!t.closest(".point-workspace") || useEditor.getState().curveCreation)
        return;
      const entity = activeSelection();
      if (!entity) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        if (entity.kind === "landmark") {
          e.preventDefault();
          useUI.setState({ duplicateId: entity.id });
        }
      } else if (
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        (e.key === "Delete" || e.key === "Backspace")
      ) {
        e.preventDefault();
        useUI.setState({ deleteTarget: entity });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const close = () => {
    useUI.setState({ duplicateId: null });
    focusWorkspace();
  };
  const target = ui.deleteTarget,
    object =
      target?.kind === "patch"
        ? s.project.patches?.find(p=>p.id===target.id)
        : target?.kind === "curve"
        ? s.project.curves.find((c) => c.id === target.id)
        : s.project.landmarks.find((l) => l.id === target?.id);
  return (
    <>
      {ui.duplicateId && (
        <FloatingPanel id="duplicate" title="复制语义点" onClose={close}>
          <form
            onKeyDown={(e) => {
              if (e.key === "Escape" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                close();
              }
            }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!source) return;
              try {
                s.duplicateSelected(name, source.id);
                close();
              } catch (e) {
                s.notify((e as Error).message);
              }
            }}
          >
            <p>
              {source
                ? `源点：${source.name}`
                : "源语义点已删除，请关闭后重新选择。"}
            </p>
            <label>
              新名称
              <input
                ref={input}
                aria-label="语义点名称"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
              />
            </label>
            <div className="floating-actions">
              <button type="button" onClick={close}>
                取消
              </button>
              <button type="submit" disabled={!source}>
                复制
              </button>
            </div>
          </form>
        </FloatingPanel>
      )}
      {target &&
        object &&
        createPortal(
          <div
            className="landmark-modal-backdrop"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <form
              role="dialog"
              aria-modal="true"
              aria-label={target.kind === "patch"?"删除曲面":target.kind === "curve" ? "删除结构线" : "删除语义点"}
              className="landmark-modal"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  useUI.setState({ deleteTarget: null });
                  focusWorkspace();
                }
              }}
              onSubmit={(e) => {
                e.preventDefault();
                if(target.kind==="patch")s.deletePatch(target.id);
                else if (target.kind === "curve") s.deleteCurve(target.id);
                else s.deleteSelected(target.id);
                useUI.setState({ deleteTarget: null });
                focusWorkspace();
              }}
            >
              <strong>确认删除「{object.name??"曲面"}」？</strong>
              <p>
                {target.kind === "patch" ? "将删除此曲面及镜像曲面，保留所有语义点与结构线。" : target.kind === "curve"
                  ? "mirrorPartnerCurveId" in object &&
                    object.mirrorPartnerCurveId
                    ? "将同时删除左右两条结构线及其依赖 Patch，语义点保留。"
                    : "将删除此结构线及其依赖 Patch，语义点保留。"
                  : "mirrorPartnerId" in object && object.mirrorPartnerId
                    ? "将同时删除左右两个点及其投影锚点。"
                    : "将删除此点及其投影锚点。"}
                {target.kind === "landmark" &&
                  incidentCurveIds(s.project, target.id).size > 0 &&
                  ` 将同时删除 ${incidentCurveIds(s.project, target.id).size} 条相连结构线（含镜像侧）。`}
                可通过撤销恢复。
              </p>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    useUI.setState({ deleteTarget: null });
                    focusWorkspace();
                  }}
                >
                  取消
                </button>
                <button autoFocus type="submit">
                  确认删除
                </button>
              </div>
            </form>
          </div>,
          document.body,
        )}
      {ui.menu && <ContextMenu />}
    </>
  );
}
function ContextMenu() {
  const menu = useUI((s) => s.menu)!;
  useEffect(() => {
    const close = () => useUI.setState({ menu: null });
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
    };
  }, []);
  return createPortal(
    <div
      role="menu"
      data-ui-keyboard
      className="entity-menu"
      style={{
        left: Math.max(0, Math.min(menu.x, window.innerWidth - 180)),
        top: Math.max(0, Math.min(menu.y, window.innerHeight - 135)),
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") useUI.setState({ menu: null });
      }}
    >
      {menu.target.kind === "landmark" && (
        <button
          role="menuitem"
          onClick={() =>
            useUI.setState({ duplicateId: menu.target.id, menu: null })
          }
        >
          复制 <small>Ctrl/Cmd C</small>
        </button>
      )}
      <button
        role="menuitem"
        onClick={() =>
          useUI.setState({ renameTarget: menu.target, menu: null })
        }
      >
        重命名
      </button>
      <button
        role="menuitem"
        onClick={() =>
          useUI.setState({ deleteTarget: menu.target, menu: null })
        }
      >
        删除 <small>Delete</small>
      </button>
    </div>,
    document.body,
  );
}
