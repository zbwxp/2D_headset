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
async function readPhoto(file: File): Promise<ReferenceImage> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("请选择 JPG、PNG 或 WebP 图片。");
  if (file.size > 20_000_000) throw new Error("参考照片请小于 20 MB。");
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () =>
        reject(new Error("无法读取这张图片，请换用 JPG、PNG 或 WebP。"));
      img.src = url;
    });
    const ratio = Math.min(
      1,
      1400 / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器无法处理图片。");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let quality = 0.85,
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > 350_000 && quality > 0.25) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    if (dataUrl.length > 350_000)
      throw new Error("图片细节过多，请缩小后重新载入。");
    return {
      name: file.name.slice(0, 120),
      dataUrl,
      width: canvas.width,
      height: canvas.height,
      opacity: 0.45,
      visible: true,
      locked: false,
      offset: [0, 0],
      scale: 1,
      rotation: 0,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
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
        aria-label={ref ? "参考图设置" : "载入参考照片"}
      >
        <ImagePlus size={14} />
        {busy ? "正在载入…" : ref ? "参考图" : "载入参考照片"}
        {ref && <SlidersHorizontal size={12} />}
      </button>
      {open && (
        <FloatingPanel
          id="reference"
          title={ref?.name ?? "参考图"}
          label="参考照片设置"
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
                  <Move size={13} />
                  平移图片
                </button>
                <button
                  aria-label={ref.locked ? "解锁参考图" : "锁定参考图"}
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
                  )}{" "}
                  {ref.locked ? "已锁定" : "锁定"}
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
                />
                显示参考图
              </label>
              {[
                {
                  label: "透明度",
                  min: 0,
                  max: 1,
                  step: 0.05,
                  value: ref.opacity,
                  key: "opacity",
                  display: Math.round(ref.opacity * 100) + "%",
                },
                {
                  label: "图片缩放",
                  min: 0.1,
                  max: 5,
                  step: 0.05,
                  value: ref.scale,
                  key: "scale",
                  display: Math.round(ref.scale * 100) + "%",
                },
                {
                  label: "水平位置",
                  min: -2,
                  max: 2,
                  step: 0.01,
                  value: ref.offset[0],
                  key: "x",
                  display: ref.offset[0].toFixed(2),
                },
                {
                  label: "垂直位置",
                  min: -2,
                  max: 2,
                  step: 0.01,
                  value: ref.offset[1],
                  key: "y",
                  display: ref.offset[1].toFixed(2),
                },
                {
                  label: "旋转",
                  min: -180,
                  max: 180,
                  step: 1,
                  value: ref.rotation,
                  key: "rotation",
                  display: ref.rotation + "°",
                },
              ].map((r) => (
                <label className="reference-slider" key={r.key}>
                  {r.label}
                  <output>{r.display}</output>
                  <input
                    disabled={ref.locked}
                    aria-label={r.label}
                    type="range"
                    min={r.min}
                    max={r.max}
                    step={r.step}
                    value={r.value}
                    onPointerDown={() => s.beginEdit()}
                    onKeyDown={(e) => {
                      if (
                        [
                          "ArrowLeft",
                          "ArrowRight",
                          "ArrowUp",
                          "ArrowDown",
                          "Home",
                          "End",
                        ].includes(e.key)
                      )
                        s.beginEdit();
                    }}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      update(
                        r.key === "x"
                          ? { offset: [value, ref.offset[1]] }
                          : r.key === "y"
                            ? { offset: [ref.offset[0], value] }
                            : { [r.key]: value },
                      );
                    }}
                  />
                </label>
              ))}
              <div className="reference-actions">
                <button
                  disabled={ref.locked}
                  onClick={() => input.current?.click()}
                >
                  替换照片
                </button>
                <button
                  disabled={ref.locked}
                  title="重置图片位置"
                  aria-label="重置参考图位置"
                  onClick={() => {
                    s.beginEdit();
                    update({ offset: [0, 0], scale: 1, rotation: 0 });
                  }}
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  disabled={ref.locked}
                  title="移除照片"
                  aria-label="移除参考照片"
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
              <p>
                仅用于描摹，不参与求解。随当前视角和项目保存。
                {ref.locked ? " 已锁定图片变换。" : ""}
              </p>
            </>
          ) : (
            <div className="reference-empty">
              <p>当前视图没有参考图。</p>
              <button disabled={busy} onClick={() => input.current?.click()}>
                载入参考照片
              </button>
            </div>
          )}
        </FloatingPanel>
      )}
    </div>
  );
}
