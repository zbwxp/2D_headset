import {uiText} from "../i18n";
import NumericSlider from '../shared/NumericSlider';
import {formatNumeric} from '../shared/numericSliderMath';
import FloatingPanel from "../shared/FloatingPanel";
import { useRef, useState } from "react";
import {
  ImagePlus,
  SlidersHorizontal,
  X,
  Trash2,
  RotateCcw,
  LockKeyhole,
  Unlock,
  Move,
} from "lucide-react";
import { useEditor } from "../../app/store";
import type { ReferenceImage } from "../../domain/project/types";
import {readPhoto} from "../shared/readPhoto";
export default function ReferenceControls({ viewId }: { viewId: string }) {
  const s = useEditor(),
    ref = s.project.views.find((v) => v.id === viewId)?.reference;
  const input = useRef<HTMLInputElement>(null),
    request = useRef(0);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const update = (patch: Partial<ReferenceImage>) => {
    if (ref) s.setReference(viewId, { ...ref, ...patch });
  };
  const change = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const id = ++request.current,
      originView = viewId,
      originProject = s.project.meta.createdAt;
    setBusy(true);
    try {
      const photo = await readPhoto(file);
      if (
        id !== request.current ||
        useEditor.getState().project.meta.createdAt !== originProject
      )
        return;
      useEditor.getState().beginEdit();
      useEditor.getState().setReference(originView, photo);
      useEditor.getState().setReferenceMoving(false);
      setOpen(true);
    } catch (error) {
      s.notify((error as Error).message);
    } finally {
      if (id === request.current) setBusy(false);
    }
  };
  return (
    <div
      className="reference-controls"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        data-testid="reference-input"
        type="file"
        ref={input}
        hidden
        accept="image/jpeg,image/png,image/webp"
        onChange={change}
      />
      <button
        className="reference-trigger"
        onClick={() => (open || ref ? setOpen(!open) : input.current?.click())}
        disabled={busy}
        aria-label={uiText(ref ? "参考图设置" : "载入参考照片")}
      >
        <ImagePlus size={14} />
        {uiText(busy ? "正在载入…" : ref ? "参考图" : "载入参考照片")}
        {ref && <SlidersHorizontal size={12} />}
      </button>
      {open && (
        <FloatingPanel
          id="reference"
          title={ref?.name ?? "参考图"}
          label={uiText("参考照片设置")}
          onClose={() => setOpen(false)}
        >
          {ref ? (
            <>
              <div className="reference-modes">
                <button
                  className={s.referenceMoving ? "active" : ""}
                  disabled={ref.locked || !ref.visible}
                  aria-pressed={s.referenceMoving}
                  onClick={() => {
                    s.setReferenceMoving(!s.referenceMoving);
                  }}
                >
                  <Move size={13} />{uiText("平移图片")}</button>
                <button
                  aria-label={uiText(ref.locked ? "解锁参考图" : "锁定参考图")}
                  onClick={() => {
                    s.beginEdit();
                    update({ locked: !ref.locked });
                    s.setReferenceMoving(false);
                  }}
                >
                  {ref.locked ? (
                    <LockKeyhole size={13} />
                  ) : (
                    <Unlock size={13} />
                  )}{uiText(" ")}
                  {uiText(ref.locked ? "已锁定" : "锁定")}
                </button>
              </div>
              <label className="reference-visible">
                <input
                  type="checkbox"
                  checked={ref.visible}
                  onChange={(e) => {
                    s.beginEdit();
                    update({ visible: e.target.checked });
                  }}
                />{uiText("显示参考图")}</label>
              {[
                {
                  label: "透明度",
                  min: 0,
                  max: 1,
                  value: ref.opacity,
                  key: "opacity",
                },
                {
                  label: "图片缩放",
                  min: 0.1,
                  max: 10,
                  value: ref.scale,
                  key: "scale",
                },
                {
                  label: "水平位置",
                  min: -2,
                  max: 2,
                  value: ref.offset[0],
                  key: "x",
                },
                {
                  label: "垂直位置",
                  min: -2,
                  max: 2,
                  value: ref.offset[1],
                  key: "y",
                },
                {
                  label: "旋转",
                  min: -180,
                  max: 180,
                  value: ref.rotation,
                  key: "rotation",
                },
              ].map((r) => (
                <NumericSlider className="reference-slider" inputScale={r.key==='opacity'||r.key==='scale'?100:1} key={r.key} label={uiText(r.label)} min={r.min} max={r.max} value={r.value} disabled={ref.locked} formatValue={v=>r.key==='opacity'||r.key==='scale'?formatNumeric(v*100)+'%':formatNumeric(v)+(r.key==='rotation'?'°':'')} onEditStart={()=>s.beginEdit(true)} onEditEnd={s.endEdit} onChange={value=>{
                      update(
                        r.key === "x"
                          ? { offset: [value, ref.offset[1]] }
                          : r.key === "y"
                            ? { offset: [ref.offset[0], value] }
                            : { [r.key]: value },
                      );
                    }}
                  />
              ))}
              <div className="reference-actions">
                <button
                  disabled={ref.locked}
                  onClick={() => input.current?.click()}
                >{uiText("替换照片")}</button>
                <button
                  disabled={ref.locked}
                  title={uiText("重置图片位置")}
                  aria-label={uiText("重置参考图位置")}
                  onClick={() => {
                    s.beginEdit();
                    update({ offset: [0, 0], scale: 1, rotation: 0 });
                  }}
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  disabled={ref.locked}
                  title={uiText("移除照片")}
                  aria-label={uiText("移除参考照片")}
                  onClick={() => {
                    request.current++;
                    s.beginEdit();
                    s.setReference(viewId, undefined);
                    s.setReferenceMoving(false);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <p>{uiText("仅用于描摹，不参与求解。随当前视角和项目保存。")}{uiText(ref.locked ? " 已锁定图片变换。" : "")}
              </p>
            </>
          ) : (
            <div className="reference-empty">
              <p>{uiText("当前视图没有参考图。")}</p>
              <button disabled={busy} onClick={() => input.current?.click()}>{uiText("载入参考照片")}</button>
            </div>
          )}
        </FloatingPanel>
      )}
    </div>
  );
}
