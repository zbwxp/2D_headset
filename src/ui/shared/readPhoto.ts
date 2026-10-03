import type {ReferenceImage} from "../../domain/project/types";

export async function readPhoto(file: File, options = {maxDimension:1400,maxDataUrlLength:350_000}): Promise<ReferenceImage> {
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
      options.maxDimension / Math.max(img.naturalWidth, img.naturalHeight),
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
    while (dataUrl.length > options.maxDataUrlLength && quality > 0.25) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    if (dataUrl.length > options.maxDataUrlLength)
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
