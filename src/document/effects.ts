// effects — what each Editor operation declares (ledger row 1; docs/stage3b-correction-plan.md §6,
// dot 1791687532, 1791687563, 1791687873, 1791687901, 1791688005). The transaction checks a call
// against this table when it is made, merges the calls' declarations into one commit, and checks
// the edit's geometric intents against them before the settle. Package 1 changes no behaviour:
// the table reproduces the three settle modes that the name lists chose before.
import * as views from '../views'

/** A range of shape layers, resolved to concrete layer keys from the edited view. */
export type Range = 'none' | 'edited' | 'all-views' | 'non-front' | 'others' | 'corners' | 'front-neighbours'
/** The shared parts of the state an operation may write directly (structure = layers, points, lines, ids). */
export type Shared = 'structure' | 'groups' | 'joins' | 'links' | 'fills' | 'masks' | 'selection' | 'apply' | 'names' | 'meta' | 'animation' | 'reference'
export type Reads = 'draft' | 'settled-trial'

export interface Effect {
  /** Which version it reads: the edit's draft as written, or the settled trial (`view()`); may depend on the arguments. */
  readonly reads: Reads | ((args: readonly unknown[]) => Reads)
  /** The layers its geometric intents (targets, held handles, aimed tips) may be in: checked before the settle. */
  readonly intents: Range
  /** The view layers it writes directly (positions, handles, strokes, radii, end strokes): checked by tests. */
  readonly shapes: Range
  /** Whether it writes the angle baseline record directly: checked by tests. */
  readonly records: boolean
  /** The shared parts it writes directly: checked by tests. */
  readonly shared: readonly Shared[]
  /** Whether the commit may auto-bind in the edited view because of it. */
  readonly autoStructure: boolean
  /** The position settling it needs. */
  readonly settle: 'full' | 'non-front-positions' | 'none'
  /** Whether it stands alone in its edit (only companions beside it). */
  readonly alone: boolean
  /**
   * Whether it may stand beside an alone operation: declared, not inferred from `settle: 'none'`
   * (dot 1791701744). Selections and stroke broadcasts may; reference pictures may not.
   */
  readonly companion: boolean
}

/** The layer keys a range stands for, in a document with `all` view layers, edited in `edited`. */
export function resolve(range: Range, edited: string, all: readonly string[]): string[] {
  switch (range) {
    case 'none': return []
    case 'edited': return [edited]
    case 'all-views': return [...all]
    case 'non-front': return all.filter(k => k !== views.FRONT)
    case 'others': return all.filter(k => k !== edited)
    case 'corners': return views.CORNERS.map(c => c.key)
    // the four views next to the front, the only views a correction may move (stage 3b package 4)
    case 'front-neighbours': return [views.key(90, 0), views.key(-90, 0), views.key(0, 45), views.key(0, -45)]
  }
}

/** A structural change runs through `applyTopology`, which lets every attribute module follow it, so any of these may change. */
const STRUCTURAL: readonly Shared[] = ['structure', 'groups', 'joins', 'links', 'fills', 'masks', 'apply', 'names']
/** Structural operations whose record can delete, merge or unbind, or that insert: responses follow (stage 3b package 2). */
const STRUCTURAL_RESPONSES: readonly Shared[] = [...STRUCTURAL, 'animation']
/** An ordinary edit: full settle (auto-bind in the edited view), not alone. */
const full = (e: Partial<Effect> & Pick<Effect, 'reads'>): Effect =>
  ({ intents: 'none', shapes: 'none', records: false, shared: [], autoStructure: true, settle: 'full', alone: false, companion: false, ...e })
const trialWithout = (handlesAt: number) => (args: readonly unknown[]): Reads => (args[handlesAt] ? 'draft' : 'settled-trial')

/** Every Editor operation's declaration. A call to an operation missing here fails its edit (`undeclared-operation`). */
export const EFFECTS: Record<string, Effect> = {
  // layers, names, types
  layer: full({ reads: 'draft', shared: ['structure'] }),
  renameLayer: full({ reads: 'draft', shared: ['structure'] }),
  renameLine: full({ reads: 'draft', shared: ['names'] }),
  renameGroup: full({ reads: 'draft', shared: ['names'] }),
  layerType: full({ reads: 'draft', shared: ['meta'] }),
  reorderLayer: full({ reads: 'draft', shared: ['structure'] }),
  // the left layer order dropped (docs/left-layer-order-checklist.md §3)
  resetLeftOrder: full({ reads: 'draft', shared: ['structure'] }),
  // copies carry no corrections (docs/correction-cleanup-checklist.md §1)
  copyLayer: full({ reads: 'settled-trial', shapes: 'all-views', records: true, shared: [...STRUCTURAL, 'meta'] }),
  // paste selects what it pasted (its nested select)
  paste: full({ reads: 'draft', shapes: 'all-views', records: true, shared: [...STRUCTURAL, 'selection'] }),
  deleteLayer: full({ reads: 'draft', shapes: 'all-views', records: true, shared: [...STRUCTURAL_RESPONSES, 'meta'] }),
  // states
  lineState: full({ reads: 'draft', shared: ['structure'] }),
  fillState: full({ reads: 'draft', shared: ['fills'] }),
  groupState: full({ reads: 'draft', shared: ['structure'] }),
  layerState: full({ reads: 'draft', shared: ['structure', 'fills'] }),
  layerFills: full({ reads: 'draft', shared: ['fills'] }),
  // network
  line: full({ reads: trialWithout(3), shapes: 'all-views', records: true, shared: STRUCTURAL }),
  move: full({ reads: 'draft', intents: 'edited', shapes: 'edited' }),
  mergePosition: full({ reads: 'settled-trial', intents: 'edited', shapes: 'edited' }),
  moveHandle: full({ reads: 'draft', intents: 'edited', shapes: 'edited' }),
  split: full({ reads: 'settled-trial', shapes: 'all-views', records: true, shared: STRUCTURAL }),
  deleteLine: full({ reads: 'draft', shapes: 'all-views', records: true, shared: STRUCTURAL_RESPONSES }),
  bind: full({ reads: 'draft', intents: 'edited', shapes: 'all-views', records: true, shared: STRUCTURAL_RESPONSES }),
  unbind: full({ reads: 'settled-trial', intents: 'edited', shapes: 'all-views', records: true, shared: STRUCTURAL_RESPONSES }),
  // joins: a smooth join holds its first-clicked handle in every view (an arc's radius is shared: no view written for it);
  // a removed join takes its zone with its row (strokes are one for every view, docs/shared-strokes-checklist.md §3)
  join: full({ reads: 'draft', intents: 'all-views', shapes: 'all-views', records: true, shared: ['joins'] }),
  removeJoin: full({ reads: 'draft', shared: ['joins'] }),
  // the order of a point's join list: shared by every view, no shape written
  joinOrder: full({ reads: 'draft', shared: ['joins'] }),
  // a point's end stroke and a join's manual zone: one value for every view, in the joins
  endStroke: full({ reads: 'draft', shared: ['joins'] }),
  zone: full({ reads: 'draft', shared: ['joins'] }),
  // links: a link moves the second point onto the first in every view
  // a link merges the two components' responses (stage 3b package 2)
  link: full({ reads: 'settled-trial', intents: 'all-views', shapes: 'all-views', shared: ['links', 'animation'] }),
  unlink: full({ reads: 'draft', shared: ['links'] }),
  linkJoin: full({ reads: 'draft', intents: 'all-views', shared: ['links'] }),
  removeLinkJoin: full({ reads: 'draft', shared: ['links'] }),
  // strokes, groups, fills
  // a point's width and a line's profile: one value for every view, in the structure (bowen 1792057731)
  lineStroke: full({ reads: 'draft', shared: ['structure'] }),
  pointWidth: full({ reads: 'draft', shared: ['structure'] }),
  stroke: full({ reads: 'draft', shared: ['structure'] }),
  reorderGroup: full({ reads: 'draft', shared: ['groups'] }),
  moveGroup: full({ reads: 'draft', shared: STRUCTURAL }),
  fill: full({ reads: 'draft', shared: ['fills'] }),
  clearFill: full({ reads: 'draft', shared: ['fills', 'masks'] }),
  fillVisible: full({ reads: 'draft', shared: ['fills'] }),
  reorderFill: full({ reads: 'draft', shared: ['fills'] }),
  // masks (显隐): their own part only, no geometry
  mask: { reads: 'draft', intents: 'none', shapes: 'none', records: false, shared: ['masks'], autoStructure: false, settle: 'none', alone: false, companion: false },
  removeMask: { reads: 'draft', intents: 'none', shapes: 'none', records: false, shared: ['masks'], autoStructure: false, settle: 'none', alone: false, companion: false },
  // selection and transforms
  select: { reads: 'draft', intents: 'none', shapes: 'none', records: false, shared: ['selection'], autoStructure: false, settle: 'none', alone: false, companion: true },
  selectGroup: { reads: 'draft', intents: 'none', shapes: 'none', records: false, shared: ['selection'], autoStructure: false, settle: 'none', alone: false, companion: true },
  transform: full({ reads: 'settled-trial', intents: 'edited', shapes: 'edited' }),
  translate: full({ reads: 'settled-trial', intents: 'edited', shapes: 'edited' }),
  rotate: full({ reads: 'settled-trial', intents: 'edited', shapes: 'edited' }),
  scale: full({ reads: 'settled-trial', intents: 'edited', shapes: 'edited' }),
  flip: full({ reads: 'settled-trial', intents: 'edited', shapes: 'edited' }),
  deleteSelection: full({ reads: 'settled-trial', shapes: 'all-views', records: true, shared: STRUCTURAL_RESPONSES }),
  // stage 2: read the draft's geometry, which their settle-free companions leave unchanged
  broadcastShape: { reads: 'draft', intents: 'non-front', shapes: 'non-front', records: true, shared: [], autoStructure: false, settle: 'non-front-positions', alone: true, companion: false },
  applyFromView: full({ reads: 'draft', intents: 'edited', shapes: 'edited', shared: [] }),
  draftCorners: { reads: 'draft', intents: 'corners', shapes: 'corners', records: false, shared: [], autoStructure: false, settle: 'non-front-positions', alone: true, companion: false },
  fit: { reads: 'draft', intents: 'none', shapes: 'none', records: true, shared: [], autoStructure: false, settle: 'none', alone: true, companion: false },
  // reference pictures: their own part only; an edit of these (and selections) never settles (dot 1791701244)
  placeReference: { reads: 'draft', intents: 'none', shapes: 'none', records: false, shared: ['reference'], autoStructure: false, settle: 'none', alone: false, companion: false },
  setReference: { reads: 'draft', intents: 'none', shapes: 'none', records: false, shared: ['reference'], autoStructure: false, settle: 'none', alone: false, companion: false },
  removeReference: { reads: 'draft', intents: 'none', shapes: 'none', records: false, shared: ['reference'], autoStructure: false, settle: 'none', alone: false, companion: false },
  addAsset: { reads: 'draft', intents: 'none', shapes: 'none', records: false, shared: ['reference'], autoStructure: false, settle: 'none', alone: false, companion: false },
  renameAsset: { reads: 'draft', intents: 'none', shapes: 'none', records: false, shared: ['reference'], autoStructure: false, settle: 'none', alone: false, companion: false },
  removeAsset: { reads: 'draft', intents: 'none', shapes: 'none', records: false, shared: ['reference'], autoStructure: false, settle: 'none', alone: false, companion: false },
  // stage 3b packages 3 and 4: knots on the responses; on an edge from the front, the outer view may
  // move (one of the front's four neighbours; that at most one changes is the final check's, not
  // this table's). The final check reads the settled trial (docs/stage3b-pkg4-move.md §8)
  correct: { reads: 'settled-trial', intents: 'front-neighbours', shapes: 'front-neighbours', records: false, shared: ['animation'], autoStructure: false, settle: 'non-front-positions', alone: true, companion: false },
  // a correction's knots removed (docs/playback-edit-checklist.md §4): responses only, nothing settles
  uncorrect: { reads: 'draft', intents: 'none', shapes: 'none', records: false, shared: ['animation'], autoStructure: false, settle: 'none', alone: false, companion: false },
  // every knot of some controls (docs/correction-cleanup-checklist.md §2): responses only, nothing settles
  clearCorrections: { reads: 'draft', intents: 'none', shapes: 'none', records: false, shared: ['animation'], autoStructure: false, settle: 'none', alone: false, companion: false },
  // mirror (front only, so the edited view is the front). Inside the operation apply copies the
  // source's geometry and line states onto the target in the front, and its strokes and end strokes for
  // every view (one value each); sets or removes the target's joins (an arc's radius and a zone go with
  // their shared row); copies or removes link joins; fills or clears the target's loops
  // (src/apply/index.ts mirrorApply; dot 1791688672)
  mirrorApply: full({ reads: 'settled-trial', intents: 'edited', shapes: 'all-views', records: true, shared: ['structure', 'joins', 'links', 'fills', 'apply'] }),
  mirrorLink: full({ reads: 'settled-trial', intents: 'edited', shapes: 'all-views', records: true, shared: ['structure', 'joins', 'links', 'fills', 'apply'] }),
  unmirror: full({ reads: 'draft', shared: ['apply'] }),
}

/** The commit an edit's calls ask for: the three settle modes of stage 2, merged from the declarations. */
export type Mode = 'full' | 'keeps' | 'views'
export function merge(calls: readonly string[]): { mode: Mode; alone: string[]; refuse?: string } {
  const decl = calls.map(c => EFFECTS[c]!)
  const alone = calls.filter((_, i) => decl[i]!.alone)
  // an alone operation allows only declared companions beside it (selections, stroke broadcasts)
  if (alone.length > 1 || (alone.length && decl.some(d => !d.alone && !d.companion))) return { mode: 'full', alone, refuse: 'stage2-alone' }
  const mode: Mode = !calls.length ? 'full'
    : decl.every(d => d.settle === 'none') ? 'keeps'
    : decl.some(d => d.settle === 'full') ? 'full' : 'views'
  // package 1 reproduces today's modes, where auto-bind goes with the full settle and nothing else
  const autoStructure = !calls.length || decl.some(d => d.autoStructure)
  if (autoStructure !== (mode === 'full')) throw new Error(`unsupported-merge: auto-structure ${autoStructure} with mode ${mode} (${calls.join(', ')})`)
  return { mode, alone }
}
