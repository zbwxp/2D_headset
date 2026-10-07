// The structure of an embedded picture (doc 18 §31.5; review of 4a208bc D2): the browser decodes a PNG whose data was
// cut short (as transparent) and a GIF labelled image/png — "it decoded" is not enough. Before a picture is accepted
// (placing, reopening, pasting) its bytes must be the declared format, whole:
// - the file's own signature matches the declared type (PNG 89 50 4E 47 0D 0A 1A 0A; JPEG FF D8 FF; WebP RIFF….WEBP);
// - PNG: every chunk lies inside the file and its CRC matches (PNG spec §5.3), IHDR first (13 bytes, non-zero size), at
//   least one IDAT, IEND reached;
// - JPEG: the marker segments before the scan lie inside the file, a frame header (SOFn) and a scan (SOS) exist, and the
//   data ends with EOI (FF D9);
// - WebP: the RIFF size is the file's, the form type is WEBP, and every chunk lies inside it.
// Pure (bytes in, a reason or null out), so it is the same check everywhere and testable without a browser.

export type ImageType = 'png' | 'jpeg' | 'webp'

/** the type a data URL declares, or null */
export const declaredType = (src: string): ImageType | null => {
  const m = /^data:image\/(png|jpeg|webp);base64,/.exec(src.slice(0, 40))
  return m ? (m[1] as ImageType) : null
}

const SIG: Record<ImageType, (b: Uint8Array) => boolean> = {
  png: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v),
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP',
}
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n))

/** the signature check alone, from the first bytes (cheap: used by the record validator on every new string) */
export function signatureProblem(type: ImageType, head: Uint8Array): string | null {
  return SIG[type](head) ? null : `内容不是声明的 ${type.toUpperCase()} 格式（文件头不符）`
}

let crcTable: Uint32Array | null = null
function crc32(b: Uint8Array, from: number, to: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = from; i < to; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0
const u32le = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0

function pngProblem(b: Uint8Array): string | null {
  let at = 8, n = 0, idat = false, iend = false
  while (at < b.length) {
    if (at + 12 > b.length) return 'PNG 数据被截断（块头不完整）'
    const len = u32(b, at), type = ascii(b, at + 4, 4)
    if (at + 12 + len > b.length) return `PNG 数据被截断（${type} 块声明 ${len} 字节，文件里不够）`
    if (crc32(b, at + 4, at + 8 + len) !== u32(b, at + 8 + len)) return `PNG 数据损坏（${type} 块校验不符）`
    if (n === 0 && (type !== 'IHDR' || len !== 13 || !u32(b, at + 8) || !u32(b, at + 12))) return 'PNG 第一个块不是有效的 IHDR'
    if (type === 'IDAT') idat = true
    at += 12 + len
    n++
    if (type === 'IEND') {
      iend = true
      break
    }
  }
  if (!idat) return 'PNG 没有图像数据（IDAT）'
  if (!iend) return 'PNG 数据被截断（没有 IEND）'
  return null
}

function jpegProblem(b: Uint8Array): string | null {
  let at = 2, frame = false
  for (;;) {
    if (at + 4 > b.length) return 'JPEG 数据被截断（段头不完整）'
    if (b[at] !== 0xff) return 'JPEG 数据损坏（段标记不在该在的位置）'
    let m = b[at + 1]
    while (m === 0xff && at + 2 < b.length) m = b[++at + 1] // fill bytes
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      at += 2 // standalone markers
      continue
    }
    if (m === 0xd9) return 'JPEG 在图像数据之前就结束了'
    const len = (b[at + 2] << 8) | b[at + 3]
    if (len < 2 || at + 2 + len > b.length) return 'JPEG 数据被截断（段长度超出文件）'
    if ((m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)) frame = true
    if (m === 0xda) break // the scan: entropy-coded data follows
    at += 2 + len
  }
  if (!frame) return 'JPEG 没有帧头（SOF）'
  let end = b.length
  while (end > 2 && b[end - 1] === 0x00) end-- // padding some writers add after EOI
  if (!(b[end - 2] === 0xff && b[end - 1] === 0xd9)) return 'JPEG 数据被截断（没有结束标记 EOI）'
  return null
}

function webpProblem(b: Uint8Array): string | null {
  if (b.length < 20) return 'WebP 数据太短'
  const size = u32le(b, 4)
  if (size + 8 !== b.length && size + 8 + 1 !== b.length) return 'WebP 数据被截断（RIFF 长度和文件不符）'
  let at = 12, image = false
  while (at + 8 <= size + 8) {
    const len = u32le(b, at + 4), type = ascii(b, at, 4)
    if (at + 8 + len > b.length) return `WebP 数据被截断（${type} 块超出文件）`
    if (type === 'VP8 ' || type === 'VP8L' || type === 'ANMF') image = true
    at += 8 + len + (len & 1)
  }
  if (!image) return 'WebP 没有图像数据'
  return null
}

/** why the bytes are not a whole picture of the declared type, or null */
export function imageDataProblem(type: ImageType, b: Uint8Array): string | null {
  const sig = signatureProblem(type, b)
  if (sig) return sig
  return type === 'png' ? pngProblem(b) : type === 'jpeg' ? jpegProblem(b) : webpProblem(b)
}
