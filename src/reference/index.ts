// reference — pictures to draw over, one per view, never part of the drawing (docs/reference-images-plan.md;
// bowen 1791700171, 1791701099; dot 1791700377, 1791701244). It owns the document's `reference` part:
// in the one draft, undo and file, touching no point, line, fill, link or join.
import * as net from '../network'
import * as views from '../views'

export interface ReferenceImage {
  readonly id: string
  /** The view it belongs to and is shown in (one of the nine). */
  readonly view: string
  /** An embedded PNG, JPEG or WebP data URL. */
  readonly src: string
  /** Pixels. */
  readonly width: number
  readonly height: number
  /** Its centre, drawing units. */
  readonly x: number
  readonly y: number
  /** Drawing units per pixel. */
  readonly scale: number
  /** Degrees. */
  readonly angle: number
  readonly opacity: number
  readonly visible: boolean
}
export type ReferenceProps = Partial<Omit<ReferenceImage, 'id' | 'view' | 'src' | 'width' | 'height'>>
declare const opaque: unique symbol
export type ReferenceState = { readonly [opaque]: 'reference' }
const S = (s: ReferenceState) => s as unknown as { images: ReferenceImage[] }

export const create = (): ReferenceState => ({ images: [] }) as unknown as ReferenceState
/** v2's limits (4bc7cc2 `schema.ts` `IMAGE_LIMITS`). */
export const LIMITS = Object.freeze({ srcLength: 100_000_000, side: 16384 })

const TYPES: Record<string, (b: number[]) => boolean> = {
  png: b => [0x89, 0x50, 0x4e, 0x47].every((x, i) => b[i] === x),
  jpeg: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: b => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP',
}
const refuse = (code: string, why: string): never => { throw new net.Refusal(code, `${code}: ${why}`) }

/**
 * One image checked, as a copy (§3). The signature is checked, not whether the picture decodes;
 * decoding is the bench's (dot 1791701244).
 */
export function check(v: unknown): ReferenceImage {
  if (!v || typeof v !== 'object') refuse('reference-bad-value', 'an image must be an object')
  const i = v as Record<string, unknown>
  if (typeof i.id !== 'string' || !i.id) refuse('reference-bad-value', 'id must be a non-empty string')
  if (typeof i.view !== 'string' || !views.isView(i.view)) refuse('reference-bad-value', `${JSON.stringify(i.view)} is not a view`)
  const src = i.src
  // the whole payload is base64, padding included (dot), not only its first characters
  const m = typeof src === 'string' && src.length <= LIMITS.srcLength ? /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]{16}[A-Za-z0-9+/]*={0,2})$/.exec(src) : null
  if (typeof src !== 'string' || !m || m[2]!.length % 4 !== 0) refuse('reference-bad-image', 'the picture must be a PNG, JPEG or WebP data URL within the size limit')
  const bytes = [...atob(m![2]!.slice(0, 16))].map(c => c.charCodeAt(0))
  if (!TYPES[m![1]!]!(bytes)) refuse('reference-bad-image', `the picture's bytes are not a ${m![1]} file`)
  const side = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= LIMITS.side
  if (!side(i.width) || !side(i.height) || (i.width as number) * (i.height as number) > LIMITS.side ** 2) refuse('reference-bad-size', `width and height must be whole pixels, 1–${LIMITS.side}`)
  const finite = (k: string) => { if (typeof i[k] !== 'number' || !Number.isFinite(i[k])) refuse('reference-bad-value', `${k} must be a finite number`) }
  for (const k of ['x', 'y', 'scale', 'angle', 'opacity']) finite(k)
  const scale = i.scale as number, w = i.width as number, h = i.height as number
  // the drawn size must be a number too, so a stored image can always be drawn (dot 1791701244)
  if (!(scale > 0) || !Number.isFinite(w * scale) || !Number.isFinite(h * scale)) refuse('reference-bad-value', 'scale must be positive and give a finite size')
  if ((i.opacity as number) < 0 || (i.opacity as number) > 1) refuse('reference-bad-value', 'opacity must be within 0–1')
  if (typeof i.visible !== 'boolean') refuse('reference-bad-value', 'visible must be true or false')
  return { id: i.id as string, view: i.view as string, src: src as string, width: w, height: h, x: i.x as number, y: i.y as number, scale, angle: i.angle as number, opacity: i.opacity as number, visible: i.visible as boolean }
}

export function place(s: ReferenceState, image: unknown) {
  const img = check(image)
  if (S(s).images.some(x => x.id === img.id)) refuse('reference-exists', `there is already a reference image ${img.id}`)
  S(s).images.push(img)
}
export function set(s: ReferenceState, id: string, props: ReferenceProps) {
  const i = S(s).images.findIndex(x => x.id === id)
  if (i < 0) refuse('reference-unknown', `no reference image ${JSON.stringify(id)}`)
  const was = S(s).images[i]!, p = (props ?? {}) as Record<string, unknown>
  const pick = <K extends keyof ReferenceImage>(k: K) => (Object.hasOwn(p, k) ? p[k] : was[k])
  S(s).images[i] = check({ ...was, x: pick('x'), y: pick('y'), scale: pick('scale'), angle: pick('angle'), opacity: pick('opacity'), visible: pick('visible') })
}
export function remove(s: ReferenceState, id: string) {
  const i = S(s).images.findIndex(x => x.id === id)
  if (i < 0) refuse('reference-unknown', `no reference image ${JSON.stringify(id)}`)
  S(s).images.splice(i, 1)
}
/** The images of one view, in placing order, as copies. */
export const list = (s: ReferenceState, view: string): ReferenceImage[] => S(s).images.filter(x => x.view === view).map(x => ({ ...x }))

/** At open: every image checked, ids unique. */
export function restore(v: unknown): ReferenceState {
  const images = (v as { images?: unknown } | null)?.images
  if (!Array.isArray(images)) throw new Error('open-failed: reference: images must be a list')
  const s = create()
  for (let k = 0; k < images.length; k++) {
    if (!Object.hasOwn(images, k)) throw new Error(`open-failed: reference: image ${k} is missing`)
    try { place(s, images[k]) } catch (err) { throw new Error(`open-failed: reference: ${(err as Error).message}`) }
  }
  return s
}
