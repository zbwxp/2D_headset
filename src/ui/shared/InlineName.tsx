import { useLayoutEffect, useRef, useState } from "react";
import { useUI, type Entity } from "../session";
import { useEditor } from "../../app/store";
export default function InlineName({
  target,
  name,
  baseName,
}: {
  target: Entity;
  name: string;
  baseName: string;
}) {
  const editing = useUI(
    (s) =>
      s.renameTarget?.id === target.id && s.renameTarget.kind === target.kind,
  );
  const [value, setValue] = useState(baseName),
    input = useRef<HTMLInputElement>(null),
    done = useRef(false);
  useLayoutEffect(() => {
    if (editing) {
      done.current = false;
      setValue(baseName);
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  const finish = (save: boolean, restoreFocus = false) => {
    const row = input.current?.closest<HTMLElement>('[role="button"]');
    if (done.current) return;
    done.current = true;
    const s = useEditor.getState();
    try {
      if (save && value.trim() !== baseName) {
        if (target.kind === "landmark") s.renameSelected(value, target.id);
        else s.renameCurve(target.id, value);
      }
    } catch (e) {
      s.notify((e as Error).message);
    }
    useUI.setState({ renameTarget: null });
    if (restoreFocus)
      requestAnimationFrame(() => row?.focus({ preventScroll: true }));
  };
  if (editing)
    return (
      <input
        ref={input}
        className="inline-name-input"
        aria-label={target.kind === "landmark" ? "语义点名称" : "结构线名称"}
        value={value}
        maxLength={80}
        onChange={(e) => setValue(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            finish(e.key === "Enter", true);
          }
        }}
      />
    );
  return (
    <span
      className="entity-name"
      onDoubleClick={(e) => {
        e.stopPropagation();
        useUI.setState({ renameTarget: target });
      }}
    >
      {name}
    </span>
  );
}
