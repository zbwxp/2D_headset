// Reference image commands (doc 18 §31): place an image, and its position slots (bowen 1791365335).
// - placeImage: one write, one undo — the image, and (unless a layer is given) a new layer 「参考图」 below every layer
//   (the layer is created in the same plan, so a refused or cancelled place leaves nothing behind);
// - saveImageSlot / recallImageSlot: two separate actions, never one button doing both by the slot's state (v103's
//   trap: clicking a filled slot recalled it, so the current position could never be saved there — §31.8). Saving
//   writes the CURRENT placement into slot n, empty or not; recalling sets the placement from slot n.
//   Both stay available while the image's layer is locked (v103: choosing a saved position is not a manual move;
//   bowen locks the reference to draw and switches views) — the one stated exemption of the generic lock check,
//   limited to these two commands, image records, and the `transform` / `slots` fields (commands.writeGuard);
// - clearImageSlot, renameImageSlot: ordinary edits (refused under a lock).
import type { RecordId } from '@tldraw/store'
import { getIndexBelow, type IndexKey } from '@tldraw/utils'
import type { EditError, IdSource, Plan } from './commands'
import { childrenOf, placedChildren } from './indexes'
import { getAs } from './model'
import { Container, Image, type Affine, type BaseReader, type ContainerRecord, type DocRecord, type ImageRecord, type ImageSlot } from './schema'

export type ImageCommand =
  | { type: 'placeImage'; id?: RecordId<ImageRecord>; layerId?: RecordId<ContainerRecord>; newLayerId?: RecordId<ContainerRecord>; name: string; src: string; width: number; height: number; transform: Affine; opacity?: number }
  | { type: 'saveImageSlot'; id: RecordId<ImageRecord>; n: number; name?: string }
  | { type: 'recallImageSlot'; id: RecordId<ImageRecord>; n: number }
  | { type: 'clearImageSlot'; id: RecordId<ImageRecord>; n: number }
  | { type: 'renameImageSlot'; id: RecordId<ImageRecord>; n: number; name: string }

/** the commands allowed to write an image's `transform` / `slots` while its layer is locked (see header) */
export const LOCK_EXEMPT_IMAGE_COMMANDS: ReadonlySet<string> = new Set(['saveImageSlot', 'recallImageSlot'])

const fail = (code: EditError['code'], message: string, objects: string[]): Plan => ({ ok: false, error: { code, message, objects, fixes: [] } })
const slotNumber = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 1000

export function planImage(store: BaseReader, cmd: ImageCommand, ids: IdSource): Plan {
  if (cmd.type === 'placeImage') {
    const puts: DocRecord[] = []
    const creates: string[] = []
    let layer = cmd.layerId
    if (layer !== undefined) {
      if (!getAs(store, layer, 'container')) return fail('NOT_FOUND', `no container ${layer}`, [String(layer)])
    } else {
      // a new layer 「参考图」 below every layer (Illustrator: a template layer to trace over — doc 18 §31.3 step 1)
      const lowest = childrenOf(store as any, null, 'container')
        .map((id) => (store.get(id as any) as ContainerRecord).index)
        .sort()[0]
      layer = (cmd.newLayerId ?? ids.take('container', () => Container.createId())) as RecordId<ContainerRecord>
      puts.push(Container.create({ id: layer, name: '参考图', parentId: null, index: getIndexBelow((lowest ?? null) as IndexKey | null) }))
      creates.push(layer)
    }
    // at the bottom of its layer
    const lowestChild = placedChildren(store as any, layer as string)
      .map((id) => (store.get(id as any) as unknown as { index: string }).index)
      .sort()[0]
    const image = Image.create({
      id: (cmd.id ?? ids.take('image', () => Image.createId())) as RecordId<ImageRecord>,
      name: cmd.name,
      parentId: layer,
      index: getIndexBelow((lowestChild ?? null) as IndexKey | null),
      src: cmd.src,
      width: cmd.width,
      height: cmd.height,
      transform: { ...cmd.transform },
      ...(cmd.opacity !== undefined ? { opacity: cmd.opacity } : {}),
    })
    puts.push(image)
    creates.push(image.id)
    return { ok: true, label: 'placeImage', puts, affected: [image.id, ...(cmd.layerId ? [] : [layer as string])], creates }
  }
  const img = getAs(store, cmd.id, 'image')
  if (!img) return fail('NOT_FOUND', `no image ${cmd.id}`, [String(cmd.id)])
  if (!slotNumber(cmd.n)) return fail('INVALID', `slot must be a whole number 0–999 (got ${cmd.n})`, [img.id])
  const slot = img.slots.find((s) => s.n === cmd.n)
  const withSlots = (slots: ImageSlot[]): Plan => ({ ok: true, label: cmd.type, puts: [{ ...img, slots: slots.sort((a, b) => a.n - b.n) }], affected: [img.id] })
  switch (cmd.type) {
    case 'saveImageSlot': {
      const name = cmd.name?.trim() || slot?.name || `位置 ${cmd.n + 1}`
      return withSlots([...img.slots.filter((s) => s.n !== cmd.n), { n: cmd.n, name, transform: { ...img.transform } }])
    }
    case 'recallImageSlot':
      if (!slot) return fail('NOT_FOUND', `slot ${cmd.n + 1} of ${img.name || img.id} is empty: nothing to recall`, [img.id])
      return { ok: true, label: 'recallImageSlot', puts: [{ ...img, transform: { ...slot.transform } }], affected: [img.id] }
    case 'clearImageSlot':
      if (!slot) return fail('NOT_FOUND', `slot ${cmd.n + 1} is already empty`, [img.id])
      return withSlots(img.slots.filter((s) => s.n !== cmd.n))
    case 'renameImageSlot': {
      if (!slot) return fail('NOT_FOUND', `slot ${cmd.n + 1} is empty: save a position there first`, [img.id])
      if (typeof cmd.name !== 'string' || !cmd.name.trim()) return fail('INVALID', 'a slot name must not be empty', [img.id])
      return withSlots(img.slots.map((s) => (s.n === cmd.n ? { ...s, name: cmd.name.trim() } : s)))
    }
  }
}
