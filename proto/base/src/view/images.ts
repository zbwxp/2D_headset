// Reference images on screen (doc 18 §31): ONE cache of decoded pictures shared by both renderers (Fabric A and the
// reference B), keyed by the embedded data. A picture still decoding is not drawn yet; when it is ready, every listener
// is told so the canvas repaints. The pixels are never changed — only placed (`transform`) and shown at `opacity`.
import { Path } from 'fabric'
import { cubicsToCommands, imageCorners, imageCubics, type EvalImage, type EvalMask } from '../evaluate'
import type { Vec } from '../schema'
import { paintMasked } from './masks'

const cache = new Map<string, HTMLImageElement | 'loading' | 'failed'>()
const listeners = new Set<() => void>()

/** be told when a picture finished decoding (returns the unsubscribe) */
export function onImageReady(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** the decoded picture for `src`, or null while it decodes (or when it could not be decoded) */
export function decoded(src: string): HTMLImageElement | null {
  const got = cache.get(src)
  if (got instanceof HTMLImageElement) return got
  if (got) return null
  cache.set(src, 'loading')
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  img
    .decode()
    .then(() => {
      cache.set(src, img)
      for (const fn of [...listeners]) fn()
    })
    .catch(() => cache.set(src, 'failed'))
  return null
}

/** paint one image on `l` (current transform = world → device): its pixels through its placement, at its opacity */
export function drawImageWorld(l: CanvasRenderingContext2D, i: EvalImage) {
  const img = decoded(i.src)
  if (!img) return
  const m = i.transform
  l.save()
  l.transform(m.a, m.b, m.c, m.d, m.e, m.f)
  l.globalAlpha *= i.opacity
  l.imageSmoothingEnabled = true
  l.imageSmoothingQuality = 'high'
  l.drawImage(img, 0, 0, i.width, i.height)
  l.restore()
}

/** A Fabric object for a reference image: its `_render` paints the picture in world coordinates (through its masks) */
export class ImageObject extends Path {
  private readonly corners: Vec[]
  constructor(
    private readonly image: EvalImage,
    private readonly masks: EvalMask[] | undefined,
  ) {
    super(cubicsToCommands(imageCubics(image), true), { fill: '', stroke: '', selectable: false, evented: false, objectCaching: false })
    this.corners = imageCorners(image)
  }
  _render(ctx: CanvasRenderingContext2D) {
    ctx.save()
    ctx.translate(-this.pathOffset.x, -this.pathOffset.y) // world coordinates
    if (this.masks?.length) paintMasked(ctx, this.masks, this.corners, 0, (l) => drawImageWorld(l, this.image))
    else drawImageWorld(ctx, this.image)
    ctx.restore()
  }
}


/**
 * The colour of one pixel of a picture (image pixel coordinates), composited on white — `#rrggbb`. One source pixel is
 * copied as it is (no smoothing), so an opaque pixel's values come out exactly (doc 18 §31.3 step 7).
 */
export function pixelColor(src: string, x: number, y: number): string | null {
  const img = decoded(src)
  if (!img) return null
  const c = document.createElement('canvas')
  c.width = c.height = 1
  const l = c.getContext('2d', { willReadFrequently: true })!
  l.imageSmoothingEnabled = false
  l.drawImage(img, Math.floor(x), Math.floor(y), 1, 1, 0, 0, 1, 1)
  return onWhite(l.getImageData(0, 0, 1, 1).data)
}

/** an RGBA pixel composited on white, as `#rrggbb` */
export function onWhite(d: ArrayLike<number>): string {
  const a = d[3] / 255
  const ch = (v: number) => Math.round(v * a + 255 * (1 - a)).toString(16).padStart(2, '0')
  return `#${ch(d[0])}${ch(d[1])}${ch(d[2])}`
}
