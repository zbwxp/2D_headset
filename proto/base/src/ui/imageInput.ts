// Reading reference images in (doc 18 §31.5): ONE check for placing, reopening and pasting. Only an embedded PNG / JPEG /
// WebP within the limits is accepted (the record validator checks the data's form; here the browser decodes it and its
// real pixel size must match and fit); a web URL or a temporary blob URL is never kept — a file is read into a data URL.
import { IMAGE_LIMITS, IMAGE_SRC, type DocRecord, type ImageRecord } from '../schema'

const TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** decode `src` and return its pixel size, or why it cannot be used */
export async function checkImageSrc(src: string, declared?: { width: number; height: number }): Promise<{ width: number; height: number } | { error: string }> {
  if (typeof src !== 'string' || !IMAGE_SRC.test(src)) return { error: '只支持嵌入的 PNG、JPEG、WebP 图片' }
  if (src.length > IMAGE_LIMITS.maxSrcLength) return { error: `图片数据太大（超过 ${Math.round(IMAGE_LIMITS.maxSrcLength / 1e6)} MB 字符）` }
  const img = new Image()
  img.src = src
  try {
    await img.decode()
  } catch {
    return { error: '图片无法解码（文件损坏，或者不是真正的图片）' }
  }
  const width = img.naturalWidth, height = img.naturalHeight
  if (!width || !height) return { error: '图片没有像素' }
  if (width > IMAGE_LIMITS.maxSide || height > IMAGE_LIMITS.maxSide || width * height > IMAGE_LIMITS.maxPixels)
    return { error: `图片 ${width} × ${height} 超过上限（边长 ${IMAGE_LIMITS.maxSide}，总像素 ${IMAGE_LIMITS.maxPixels}）` }
  if (declared && (declared.width !== width || declared.height !== height)) return { error: `图片记录的尺寸 ${declared.width} × ${declared.height} 和实际 ${width} × ${height} 不符` }
  return { width, height }
}

/** a picked / dropped file as an embedded data URL, checked */
export async function readImageFile(file: File): Promise<{ src: string; width: number; height: number; name: string } | { error: string }> {
  if (!TYPES.includes(file.type)) return { error: `不支持的文件类型：${file.type || '未知'}（只支持 PNG、JPEG、WebP）` }
  const src = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  }).catch(() => '')
  if (!src) return { error: '读不出这个文件' }
  const size = await checkImageSrc(src)
  if ('error' in size) return size
  return { src, ...size, name: file.name.replace(/\.[^.]+$/, '') || '参考图' }
}

/** every image record among `records` decodes and matches its declared size (reopen, paste) — or the first problem */
export async function checkImageRecords(records: readonly DocRecord[]): Promise<string | null> {
  for (const r of records) {
    if (r.typeName !== 'image') continue
    const img = r as ImageRecord
    const ok = await checkImageSrc(img.src, img)
    if ('error' in ok) return `${img.name || img.id}：${ok.error}`
  }
  return null
}
