// archive — save a drawing to text and open it again (graph "Save and open": an
// independent module; docs/archive-plan.md). The drawing is saved; the selection and the
// undo history are not. Opening makes a new document, so a refused file never touches
// the current one.
import { exportState, importState, type Core } from '../document'
import * as legacy from '../legacy' // old formats only: delete with src/legacy for a release (bowen 1791820592)
export const FORMAT = 'headset-v3-drawing'
/**
 * Format versions (docs/archive-plan.md "Format versions"); older ones are refused, with no migration:
 * - 1: single view; not supported (bowen 1791651929).
 * - 2: shape layers, nine views (stage 1); not supported since 3 (dot 1791680650).
 * - 3: plus animation's owned record layer `base:angle` (stage 2); `copyNew` only on owned layers; not supported since 4.
 * - 4: plus the in-between responses (`animation`, stage 3b package 2); not supported since 5.
 * - 5: plus reference pictures (`reference`, docs/reference-images-plan.md); converted once to 6 when opened —
 *   the one exception, for version 5 only (bowen 1791726456: "可以 仅此一次 一般不需要支持前代").
 * - 6: reference pictures in a library, each picture's content once (docs/reference-images-plan.md §10);
 *   converted once to 7 when opened — the second approved exception (bowen 1791808493): a point with
 *   exactly two line ends and no join gets a 'bound' join (docs/ink-joins-principle.md §2.6).
 * - 7: binding is a join ('bound'); each point's joins are an ordered list (docs/j1-joins-checklist.md); read as it is
 *   (a 7 file is an 8 file without end widths) — an older program must refuse an 8 file rather than drop its widths
 *   (dot 1791819678).
 * - 8: a line's two end widths (`stroke.widthB`, docs/two-end-widths-checklist.md, bowen 1791818995); converted once
 *   to 9 when opened (with 7, 6 and 5 on their way) — the third conversion, asked of bowen (docs/point-widths-checklist.md).
 * - 9: widths belong to points (`widths` per shape layer; a line keeps only its profile; bowen 1791820396); converted
 *   to 10 when opened (no masks) — the fourth conversion, approved by bowen 1791907933.
 * - 10: plus masks (`masks`, 显隐; docs/mask-p2-checklist.md); read as it is when opened (an 11 file without playback
 *   pictures), approved by bowen 1791976935.
 * - 11: a reference picture's `view` may be `playback` (docs/playback-edit-checklist.md §5); a 10 reader refuses it
 *   (dot 1791976669); converted to 12 when opened, each arc taking the front's radius (bowen 1791985326).
 * - 12: an arc's radius is one value of its join row, in every view; shape layers hold none
 *   (docs/arc-radius-shared-checklist.md); read as it is when opened (a 13 file without a left layer order).
 * - 13: an optional left layer order (`network.leftOrder`, the stacking at yaw < 0; docs/left-layer-order-checklist.md);
 *   a 12 reader would ignore it and stack wrongly; converted to 14 when opened, every stroke value taking the front's
 *   (bowen 1792057731).
 * - 14: every stroke value is one per meta-curve, in every view (docs/shared-strokes-checklist.md §4): a point's
 *   `width` and a line's `stroke.profile` in the network, a join's manual `zone` in its row, the end strokes in
 *   `joins.ends`; shape layers hold only positions and handles.
 */
export const VERSION = 14

export function save(core: Core): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, document: exportState(core) })
}

export function open(text: string): Core {
  let file: unknown
  try { file = JSON.parse(text) } catch { throw new Error('open-failed: not a drawing file (not JSON)') }
  const f = file as { format?: unknown; version?: unknown; document?: unknown } | null
  if (!f || f.format !== FORMAT) throw new Error('open-failed: not a headset v3 drawing')
  return importState(f.version === VERSION ? f.document : legacy.upgrade(f.version, f.document))
}
