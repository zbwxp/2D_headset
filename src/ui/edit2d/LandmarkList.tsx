import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import { useEditor } from "../../app/store";
import {
  driverLocks,
  type SemanticLandmark,
} from "../../domain/landmarks/model";

export default function LandmarkList() {
  const s = useEditor();
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const points = new Map(s.project.landmarks.map((l) => [l.id, l]));
  const renderPoint = (x: SemanticLandmark) => {
    const center = x.type === "CENTERLINE";
    return (
      <button
        key={x.id}
        aria-label={x.name}
        data-landmark-id={x.id}
        draggable={center}
        className={[
          x.id === s.selectedId ? "active" : "",
          drop?.id === x.id ? (drop.after ? "drop-after" : "drop-before") : "",
        ].join(" ")}
        title={center ? "拖动调整中心线顺序；Alt + 上下方向键也可排序" : x.name}
        onClick={() => s.selectLandmark(x.id)}
        onDragStart={(e) => {
          if (!center) return;
          setDragging(x.id);
          e.dataTransfer.setData("text/plain", x.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!center || !dragging) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const rect = e.currentTarget.getBoundingClientRect();
          setDrop({ id: x.id, after: e.clientY > rect.top + rect.height / 2 });
        }}
        onDrop={(e) => {
          if (!center || !dragging) return;
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          s.reorderCenterline(
            dragging,
            x.id,
            e.clientY > rect.top + rect.height / 2,
          );
          setDragging(null);
          setDrop(null);
        }}
        onDragEnd={() => {
          setDragging(null);
          setDrop(null);
        }}
        onKeyDown={(e) => {
          if (!center || !e.altKey || !["ArrowUp", "ArrowDown"].includes(e.key))
            return;
          e.preventDefault();
          const down = e.key === "ArrowDown";
          const target =
            s.project.centerlineOrder[
              s.project.centerlineOrder.indexOf(x.id) + (down ? 1 : -1)
            ];
          if (target) s.reorderCenterline(x.id, target, down);
        }}
      >
        {center && (
          <span className="order-grip" aria-hidden="true">
            ⠿
          </span>
        )}
        <span
          style={{
            color: center
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
    );
  };
  return (
    <div className="point-list">
      <section aria-label="中心线点" className="landmark-group">
        <h3>
          中心线点 <small>拖动排序</small>
        </h3>
        {s.project.centerlineOrder.map((id) => renderPoint(points.get(id)!))}
      </section>
      <section aria-label="左右对称点" className="landmark-group">
        <h3>左右对称点</h3>
        {s.project.landmarks
          .filter((l) => l.type !== "CENTERLINE")
          .map(renderPoint)}
      </section>
    </div>
  );
}
