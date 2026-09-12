import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useUI } from "../session";
let topLayer = 100;
export default function FloatingPanel({
  id,
  title,
  label,
  onClose,
  children,
}: {
  id: string;
  title: string;
  label?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const saved = useUI((s) => s.positions[id]),
    host = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; px: number; py: number } | null>(
      null,
    );
  const [layer, setLayer] = useState(() => ++topLayer);
  const position = saved ?? {
    x: Math.max(12, window.innerWidth * 0.38),
    y: 140,
  };
  const clamp = (x: number, y: number) => {
    const r = host.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(x, window.innerWidth - r.width)),
      y: Math.max(0, Math.min(y, window.innerHeight - r.height)),
    };
  };
  const move = (x: number, y: number) => {
    const p = clamp(x, y);
    useUI.setState((s) => ({ positions: { ...s.positions, [id]: p } }));
  };
  useLayoutEffect(() => {
    const adjust = () => {
      const p = useUI.getState().positions[id] ?? position;
      const c = clamp(p.x, p.y);
      if (!useUI.getState().positions[id] || c.x !== p.x || c.y !== p.y)
        useUI.setState((s) => ({ positions: { ...s.positions, [id]: c } }));
    };
    const ro = new ResizeObserver(adjust);
    ro.observe(host.current!);
    window.addEventListener("resize", adjust);
    adjust();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", adjust);
    };
  }, [id]);
  return createPortal(
    <div
      ref={host}
      tabIndex={-1}
      role="region"
      aria-label={label ?? title}
      data-floating-panel={id}
      data-ui-keyboard
      className="floating-panel"
      style={{
        left: position.x,
        top: position.y,
        zIndex: layer,
        maxHeight: `max(80px, calc(100dvh - ${position.y + 8}px))`,
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        setLayer(++topLayer);
        if (
          !(e.target as Element).closest(
            "button,input,select,textarea,[contenteditable]",
          )
        )
          host.current?.focus();
      }}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div
        className="floating-header"
        data-testid={`${id}-header`}
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as Element).closest("button")) return;
          e.preventDefault();
          e.stopPropagation();
          setLayer(++topLayer);
          host.current!.focus();
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            px: position.x,
            py: position.y,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            e.stopPropagation();
            const d = drag.current;
            move(d.px + e.clientX - d.x, d.py + e.clientY - d.y);
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <strong title={title}>⠿ {title}</strong>
        <button aria-label={`关闭${label ?? title}`} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="floating-content">{children}</div>
    </div>,
    document.body,
  );
}
