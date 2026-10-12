// reference — pictures to draw over, one per view, never part of the drawing (docs/reference-images-plan.md;
// bowen 1791700171, 1791701099; dot 1791700377, 1791701244). It owns the document's `reference` part:
// in the one draft, undo and file, touching no point, line, fill, link or join.
import * as net from '../network'
import * as views from '../views'

export interface ReferenceImage {
  readonly id: string
  /** The view it belongs to and is shown in (one of the nine). */
  readonly view: string
  /** The library picture it shows (§10). */
  readonly asset: string
  /** That picture's content: an embedded PNG, JPEG or WebP data URL (read from the library). */
  readonly src: string
  /** The size this placement is drawn at, pixels: its own, never the library's (dot 1791725852). */
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
  /** Drawn mirrored left-right in its own frame, before its rotation (§9; bowen 1791716942). */
  readonly flipped: boolean
  /** Saved placements (v2's 存 / 调出 / ×; docs/reference-images-plan.md §8.3): at most 1000. */
  readonly slots: readonly ReferenceSlot[]
}
/**
 * What placing takes: exactly one of `src` (the content, added to the library or matched to an identical
 * entry) or `asset` (a library id); `width` / `height` are required with `src` and default to the
 * library's with `asset`; slots and `flipped` may be left out.
 */
export type ReferenceInput = Omit<ReferenceImage, 'asset' | 'src' | 'width' | 'height' | 'slots' | 'flipped'> & {
  readonly src?: string; readonly asset?: string; readonly width?: number; readonly height?: number
  readonly slots?: readonly ReferenceSlot[]; readonly flipped?: boolean
}
export interface Placement { readonly x: number; readonly y: number; readonly scale: number; readonly angle: number }
export interface ReferenceSlot { readonly name: string; readonly placement: Placement | null }
export type ReferenceProps = Partial<Omit<ReferenceImage, 'id' | 'view' | 'asset' | 'src' | 'width' | 'height'>>
/** A library picture (§10): its content once; `width` / `height` are the default size of a new placement. */
export interface Asset { readonly id: string; readonly name: string; readonly src: string; readonly width: number; readonly height: number }
/** A library picture with its use: how many placements show it, and in how many views (counted apart; hidden ones included). */
export interface AssetUse extends Asset { readonly placements: number; readonly views: number }
type Stored = Omit<ReferenceImage, 'src'>
declare const opaque: unique symbol
export type ReferenceState = { readonly [opaque]: 'reference' }
const S = (s: ReferenceState) => s as unknown as { images: Stored[]; library: Asset[] }

export const create = (): ReferenceState => ({ images: [], library: [] }) as unknown as ReferenceState
/** v2's limits (4bc7cc2 `schema.ts` `IMAGE_LIMITS`). */
export const LIMITS = Object.freeze({ srcLength: 100_000_000, side: 16384, slots: 1000, slotName: 100, assetName: 100 })

const TYPES: Record<string, (b: number[]) => boolean> = {
  png: b => [0x89, 0x50, 0x4e, 0x47].every((x, i) => b[i] === x),
  jpeg: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: b => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP',
}
const refuse = (code: string, why: string): never => { throw new net.Refusal(code, `${code}: ${why}`) }

/** A picture's content: a PNG, JPEG or WebP data URL, the whole payload base64, the signature matching (§3). */
function checkSrc(src: unknown): string {
  // the whole payload is base64, padding included (dot), not only its first characters
  const m = typeof src === 'string' && src.length <= LIMITS.srcLength ? /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]{16}[A-Za-z0-9+/]*={0,2})$/.exec(src) : null
  if (typeof src !== 'string' || !m || m[2]!.length % 4 !== 0) refuse('reference-bad-image', 'the picture must be a PNG, JPEG or WebP data URL within the size limit')
  const bytes = [...atob(m![2]!.slice(0, 16))].map(c => c.charCodeAt(0))
  if (!TYPES[m![1]!]!(bytes)) refuse('reference-bad-image', `the picture's bytes are not a ${m![1]} file`)
  return src as string
}
function checkSize(w: unknown, h: unknown) {
  const side = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= LIMITS.side
  if (!side(w) || !side(h) || (w as number) * (h as number) > LIMITS.side ** 2) refuse('reference-bad-size', `width and height must be whole pixels, 1–${LIMITS.side}`)
}

/** One placement's own values checked, as a copy (the decoding is the bench's; dot 1791701244). */
function checkPlacement(v: unknown, asset: string, w: number, h: number): Stored {
  if (!v || typeof v !== 'object') refuse('reference-bad-value', 'an image must be an object')
  const i = v as Record<string, unknown>
  if (typeof i.id !== 'string' || !i.id) refuse('reference-bad-value', 'id must be a non-empty string')
  if (typeof i.view !== 'string' || !views.isView(i.view)) refuse('reference-bad-value', `${JSON.stringify(i.view)} is not a view`)
  checkSize(w, h)
  const finite = (k: string) => { if (typeof i[k] !== 'number' || !Number.isFinite(i[k])) refuse('reference-bad-value', `${k} must be a finite number`) }
  for (const k of ['x', 'y', 'scale', 'angle', 'opacity']) finite(k)
  const scale = i.scale as number
  // the drawn size must be a number too, so a stored image can always be drawn (dot 1791701244)
  if (!(scale > 0) || !Number.isFinite(w * scale) || !Number.isFinite(h * scale)) refuse('reference-bad-value', 'scale must be positive and give a finite size')
  if ((i.opacity as number) < 0 || (i.opacity as number) > 1) refuse('reference-bad-value', 'opacity must be within 0–1')
  if (typeof i.visible !== 'boolean') refuse('reference-bad-value', 'visible must be true or false')
  // flipped: missing is not mirrored; present must be true or false (§9)
  if (i.flipped !== undefined && typeof i.flipped !== 'boolean') refuse('reference-bad-value', 'flipped must be true or false')
  // slots: missing is none; present must be a list of good slots, copied (dot 1791703489)
  const slots = i.slots === undefined ? [] : checkSlots(i.slots, w, h)
  return { id: i.id as string, view: i.view as string, asset, width: w, height: h, x: i.x as number, y: i.y as number, scale, angle: i.angle as number, opacity: i.opacity as number, visible: i.visible as boolean, flipped: i.flipped === true, slots }
}

/** A library picture checked, as a copy (§10). */
function checkAsset(v: unknown): Asset {
  if (!v || typeof v !== 'object' || Array.isArray(v)) refuse('reference-bad-value', 'a library picture must be an object')
  const a = v as Record<string, unknown>
  if (typeof a.id !== 'string' || !a.id) refuse('reference-bad-value', 'a library picture\'s id must be a non-empty string')
  if (typeof a.name !== 'string' || a.name.length > LIMITS.assetName) refuse('reference-bad-value', `a library picture's name must be a string of at most ${LIMITS.assetName} characters`)
  const src = checkSrc(a.src)
  checkSize(a.width, a.height)
  return { id: a.id as string, name: a.name as string, src, width: a.width as number, height: a.height as number }
}

function checkSlots(v: unknown, w: number, h: number): ReferenceSlot[] {
  if (!Array.isArray(v) || v.length > LIMITS.slots) refuse('reference-bad-slots', `slots must be a list of at most ${LIMITS.slots}`)
  const out: ReferenceSlot[] = []
  for (let k = 0; k < (v as unknown[]).length; k++) {
    if (!Object.hasOwn(v as unknown[], k)) refuse('reference-bad-slots', `slot ${k} is missing`)
    const s = (v as unknown[])[k] as Record<string, unknown> | null
    if (!s || typeof s !== 'object' || Array.isArray(s)) refuse('reference-bad-slots', `slot ${k} must be an object`)
    if (typeof s!.name !== 'string' || s!.name.length > LIMITS.slotName) refuse('reference-bad-slots', `slot ${k}'s name must be a string of at most ${LIMITS.slotName} characters`)
    const p = s!.placement as Record<string, unknown> | null
    if (p === null) { out.push({ name: s!.name as string, placement: null }); continue }
    if (!p || typeof p !== 'object' || Array.isArray(p)) refuse('reference-bad-slots', `slot ${k}'s placement must be an object or null`)
    for (const f of ['x', 'y', 'scale', 'angle']) if (typeof p[f] !== 'number' || !Number.isFinite(p[f])) refuse('reference-bad-slots', `slot ${k}'s ${f} must be a finite number`)
    const sc = p.scale as number
    if (!(sc > 0) || !Number.isFinite(w * sc) || !Number.isFinite(h * sc)) refuse('reference-bad-slots', `slot ${k}'s scale must be positive and give a finite size`)
    out.push({ name: s!.name as string, placement: { x: p.x as number, y: p.y as number, scale: sc, angle: p.angle as number } })
  }
  return out
}

/** A picture into the library; an identical content (same `src` text) returns the entry already there, nothing added (§10). */
export function addAsset(s: ReferenceState, input: unknown): string {
  const a = checkAsset(input)
  const same = S(s).library.find(x => x.src === a.src)
  if (same) return same.id
  if (S(s).library.some(x => x.id === a.id)) refuse('reference-exists', `there is already a library picture ${a.id}`)
  S(s).library.push(a)
  return a.id
}
export function renameAsset(s: ReferenceState, id: string, name: unknown) {
  const i = S(s).library.findIndex(x => x.id === id)
  if (i < 0) refuse('reference-unknown', `no library picture ${JSON.stringify(id)}`)
  S(s).library[i] = checkAsset({ ...S(s).library[i]!, name })
}
/** Refused while any placement shows it, in any view, visible or hidden (dot 1791725888). */
export function removeAsset(s: ReferenceState, id: string) {
  const i = S(s).library.findIndex(x => x.id === id)
  if (i < 0) refuse('reference-unknown', `no library picture ${JSON.stringify(id)}`)
  const used = S(s).images.filter(x => x.asset === id)
  if (used.length) refuse('reference-asset-in-use', `library picture ${id} is shown by ${used.length} placement(s)`)
  S(s).library.splice(i, 1)
}

export function place(s: ReferenceState, image: unknown) {
  if (!image || typeof image !== 'object') refuse('reference-bad-value', 'an image must be an object')
  const i = image as Record<string, unknown>
  const hasSrc = i.src !== undefined, hasAsset = i.asset !== undefined
  if (hasSrc === hasAsset) refuse('reference-bad-value', 'an image names its picture by exactly one of src or asset')
  if (typeof i.id === 'string' && S(s).images.some(x => x.id === i.id)) refuse('reference-exists', `there is already a reference image ${i.id}`)
  let asset: string, w: unknown = i.width, h: unknown = i.height
  if (hasSrc) {
    checkSize(w, h)
    // a picture placed by its content: into the library (or the identical entry), its id this image's id kept
    // whole; only the shown name is cut to the name limit (an image id has no length limit; dot 1791727284)
    const placed = checkPlacement(i, '', w as number, h as number) // its own values first: nothing is added for a refused image
    // a new entry's id starts from the image's id and steps past an entry left with that id (a removed image's
    // picture stays in the library): the two kinds of id are not tied together (dot 1791727297)
    let id = placed.id
    if (!S(s).library.some(x => x.src === i.src)) for (let k = 2; S(s).library.some(x => x.id === id); k++) id = `${placed.id}~${k}`
    asset = addAsset(s, { id, name: placed.id.slice(0, LIMITS.assetName), src: i.src, width: w, height: h })
  } else {
    if (typeof i.asset !== 'string' || !i.asset) refuse('reference-bad-value', 'asset must be a non-empty string')
    const entry = S(s).library.find(x => x.id === i.asset)
    if (!entry) refuse('reference-unknown-asset', `no library picture ${JSON.stringify(i.asset)}`)
    asset = entry!.id
    if (w === undefined) w = entry!.width
    if (h === undefined) h = entry!.height
  }
  S(s).images.push(checkPlacement(i, asset, w as number, h as number))
}
export function set(s: ReferenceState, id: string, props: ReferenceProps) {
  const i = S(s).images.findIndex(x => x.id === id)
  if (i < 0) refuse('reference-unknown', `no reference image ${JSON.stringify(id)}`)
  const was = S(s).images[i]!, p = (props ?? {}) as Record<string, unknown>
  const pick = <K extends keyof Stored>(k: K) => (Object.hasOwn(p, k) ? p[k] : was[k])
  // in a change, flipped given must be true or false: an explicit undefined is not "leave it" nor "unmirror" (§9)
  if (Object.hasOwn(p, 'flipped') && typeof p.flipped !== 'boolean') refuse('reference-bad-value', 'flipped must be true or false')
  S(s).images[i] = checkPlacement({ ...was, x: pick('x'), y: pick('y'), scale: pick('scale'), angle: pick('angle'), opacity: pick('opacity'), visible: pick('visible'), flipped: pick('flipped'), slots: pick('slots') }, was.asset, was.width, was.height)
}
export function remove(s: ReferenceState, id: string) {
  const i = S(s).images.findIndex(x => x.id === id)
  if (i < 0) refuse('reference-unknown', `no reference image ${JSON.stringify(id)}`)
  S(s).images.splice(i, 1)
}
const shown = (s: ReferenceState, x: Stored): ReferenceImage => {
  const { id, view, asset, ...rest } = x
  return structuredClone({ id, view, asset, src: S(s).library.find(a => a.id === asset)!.src, ...rest })
}
/** The images of one view, in placing order, as copies, each with its picture's content. */
export const list = (s: ReferenceState, view: string): ReferenceImage[] => S(s).images.filter(x => x.view === view).map(x => shown(s, x))
/** The whole library, in adding order, as copies, each with its use (dot 1791725888). */
export const library = (s: ReferenceState): AssetUse[] => S(s).library.map(a => {
  const using = S(s).images.filter(x => x.asset === a.id)
  return { ...structuredClone(a), placements: using.length, views: new Set(using.map(x => x.view)).size }
})

const openFailed = (f: () => void) => { try { f() } catch (err) { const m = (err as Error).message; throw new Error(m.startsWith('open-failed') ? m : `open-failed: reference: ${m}`) } }

/**
 * At open (version 6, §10): the library first — every entry checked, ids and contents unique, unused ones
 * kept — then every image, which names its picture by `asset` only (an inline `src`, both, neither, a bad
 * or dangling `asset`: refused; dot 1791725888) and has its own size.
 */
export function restore(v: unknown): ReferenceState {
  const d = v as { images?: unknown; library?: unknown } | null
  if (!d || typeof d !== 'object' || !Array.isArray(d.images)) throw new Error('open-failed: reference: images must be a list')
  if (!Array.isArray(d.library)) throw new Error('open-failed: reference: library must be a list')
  const s = create(), library = d.library as unknown[], images = d.images as unknown[]
  for (let k = 0; k < library.length; k++) openFailed(() => {
    if (!Object.hasOwn(library, k)) throw new Error(`library picture ${k} is missing`)
    const a = checkAsset(library[k])
    if (S(s).library.some(x => x.id === a.id)) refuse('reference-exists', `two library pictures are named ${a.id}`)
    if (S(s).library.some(x => x.src === a.src)) refuse('reference-duplicate-picture', `library pictures ${S(s).library.find(x => x.src === a.src)!.id} and ${a.id} hold the same picture`)
    S(s).library.push(a)
  })
  for (let k = 0; k < images.length; k++) openFailed(() => {
    if (!Object.hasOwn(images, k)) throw new Error(`image ${k} is missing`)
    const i = images[k] as Record<string, unknown> | null
    if (!i || typeof i !== 'object') refuse('reference-bad-value', 'an image must be an object')
    if (Object.hasOwn(i!, 'src')) refuse('reference-bad-value', `image ${String(i!.id)} holds its picture inline; a version-6 file names it by asset`)
    if (typeof i!.asset !== 'string' || !i!.asset) refuse('reference-bad-value', `image ${String(i!.id)} must name its picture by asset`)
    if (i!.width === undefined || i!.height === undefined) refuse('reference-bad-size', `image ${String(i!.id)} must have its own width and height`)
    place(s, i)
  })
  return s
}

