// Work counters for the incremental-evaluation stage (dot's acceptance criteria: count index queries,
// planning, evaluation and canvas rebuilds; separate first build from continuous dragging).
// Plain module-level numbers: tests call `resetCounters()` and read `counters` around an operation.
export const counters = {
  /** full rebuilds of an index (first use, or the store's history was reset) */
  indexBuilds: 0,
  /** incremental index updates (one per index recompute that consumed a history diff) */
  indexSteps: 0,
  /** index lookups (connections of an anchor, children of a parent, fills of a curve) */
  indexQueries: 0,
  /** command plans */
  plans: 0,
  /** evaluations of one curve (base drawing) */
  curveEvals: 0,
  /** evaluations of one reference instance of one source curve */
  instanceEvals: 0,
  /** evaluations of one fill */
  fillEvals: 0,
  /** items collected when the WHOLE evaluated list is assembled (references, not re-evaluations) */
  assembledItems: 0,
  /** full-document evaluations through the uncached `evaluate()` */
  fullEvals: 0,
  /** canvas objects (re)built by the view */
  canvasObjects: 0,
}

export type Counters = typeof counters

export function resetCounters() {
  for (const k of Object.keys(counters) as (keyof Counters)[]) counters[k] = 0
}

export const snapshotCounters = (): Counters => ({ ...counters })
