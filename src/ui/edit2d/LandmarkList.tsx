import {isAnalytic} from '../../domain/curves/model';
import {count} from '../../domain/geometry/diagnostics';
import {useShallow} from 'zustand/react/shallow';
import SymmetricPairListItem from "../shared/SymmetricPairListItem";
import {landmarkRows} from "../shared/pairRows";
import InlineName from "../shared/InlineName";
import { useUI } from "../session";
import { landmarkBaseName } from "../../domain/landmarks/management";
import { useState,memo } from "react";
import { LockKeyhole } from "lucide-react";
import { useEditor } from "../../app/store";
import {
  driverLocks,
  type SemanticLandmark,
} from "../../domain/landmarks/model";

function LandmarkList({loomis=false}:{loomis?:boolean}) {
 count('renderLandmarkList');
  const selection = useEditor(useShallow(s=>({landmarks:s.project.landmarks,centerlineOrder:s.project.centerlineOrder,reorderCenterline:s.reorderCenterline,selectLandmark:s.selectLandmark,selectedCurveId:s.selectedCurveId,selectedId:s.selectedId,selectedPatchId:s.selectedPatchId})));
  const s={...selection,project:useEditor.getState().project};
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const points = new Map(s.project.landmarks.map((l) => [l.id, l]));
  const included=(l:SemanticLandmark)=>!!((l.placement.kind==='ON_LOOMIS_SURFACE'||(l.placement.kind==="LOOMIS_SCAFFOLD"||l.placement.kind==='ON_SECTION_CAP'))||l.placement.kind==='ON_CURVE'&&s.project.curves.some(c=>c.id===(l.placement.kind==='ON_CURVE'?l.placement.hostCurveId:'')&&isAnalytic(c)))===loomis;
  const renderPoint = (primary: SemanticLandmark, partner?: SemanticLandmark) => {
    if(!included(primary))return null;
    const x = [primary,partner].find(p=>p?.id===(!s.selectedCurveId&&!s.selectedPatchId?s.selectedId:null)) ?? primary;
    const center = x.type === "CENTERLINE" && x.placement.kind !== "ON_CURVE";
    return (
      <SymmetricPairListItem
        primaryId={primary.id} mirrorId={partner?.id} selectedId={s.selectedCurveId||s.selectedPatchId?null:s.selectedId}
        displayName={partner?landmarkBaseName(primary):primary.name}
        onSelect={s.selectLandmark}
        onRename={id=>useUI.setState({renameTarget:{kind:"landmark",id}})}
        key={primary.id}
        data-landmark-id={x.id}
        draggable={center && useUI.getState().renameTarget?.id !== x.id}
        className={[
          drop?.id === x.id ? (drop.after ? "drop-after" : "drop-before") : "",
        ].join(" ")}
        title={center ? "拖动调整中心线顺序；Alt + 上下方向键也可排序" : x.name}
        onContextMenu={(e) => {
          e.preventDefault();
          s.selectLandmark(x.id);
          useUI.setState({
            menu: {
              target: { kind: "landmark", id: x.id },
              x: e.clientX,
              y: e.clientY,
            },
          });
        }}
        onDragStart={(e) => {
          if (!center) return;
          if (useUI.getState().renameTarget?.id === x.id) {
            e.preventDefault();
            return;
          }
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
        {()=> <>{center && (
          <span className="order-grip" aria-hidden="true">
            ⠿
          </span>
        )}
        <span
          style={{
            color: x.type === "CENTERLINE"
              ? "#ffc879"
              : x.type === "LEFT"
                ? "#b9eb9f"
                : "#8fc6e1",
          }}
        >
          ●
        </span>
        <InlineName
          target={{ kind: "landmark", id: x.id }}
          name={partner?landmarkBaseName(primary):x.name}
          baseName={landmarkBaseName(x)}
        />
        {Object.keys(driverLocks(s.project, x.id)).length > 0 && (
          <LockKeyhole size={12} />
        )}
        </>}
      </SymmetricPairListItem>
    );
  };
  if(loomis)return <div className="point-list">{landmarkRows(s.project).filter(r=>included(r.primary)).map(r=>renderPoint(r.primary,r.mirror))}</div>;
  return (
    <div className="point-list">
      <section aria-label="中心线点" className="landmark-group">
        <h3>
          中心线点 <small>拖动排序</small>
        </h3>
        {s.project.centerlineOrder.map((id) => renderPoint(points.get(id)!))}
      </section>
      {s.project.landmarks.some(l=>l.type==="CENTERLINE"&&l.placement.kind==="ON_CURVE")&&<section aria-label="中线结构线定位点" className="landmark-group"><h3>中线结构线定位点</h3>{s.project.landmarks.filter(l=>l.type==="CENTERLINE"&&l.placement.kind==="ON_CURVE").map(l=>renderPoint(l))}</section>}
      <section aria-label="左右对称点" className="landmark-group">
        <h3>左右对称点</h3>
        {landmarkRows(s.project).filter(r=>r.primary.type!=="CENTERLINE").map(r=>renderPoint(r.primary,r.mirror))}
      </section>
    </div>
  );
}

export default memo(LandmarkList);
