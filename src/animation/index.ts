// animation — angle and expression making (docs/architecture-multiview.md package 4;
// docs/stage2-plan.md). Stage 2, package 1: the angle baseline record layer. It owns the
// meaning of `base:angle` and the role rules that differ from views: a new line's new
// points and handles, a new arc's radius and a paste take the drawn (front) values there
// (declared as copyNew on the layer); split, delete, bind and unbind follow the
// kind-independent rules (step 2). Broadcast and fit come in the next package.
import * as net from '../network'
import * as views from '../views'

/** The hidden front baseline for angle broadcast (graph "Hidden baseline"; bowen 1791647843). */
export const ANGLE = 'base:angle'
/** The record layers this module owns. */
export const RECORDS: readonly string[] = Object.freeze([ANGLE])

/** Give a drawing its angle baseline: a record layer equal to the front (nothing pending). */
export function addRecords(n: net.NetworkState) { net.addShapeLayer(n, ANGLE, 'record', views.FRONT, true) }

/** At open: the drawing has this module's record layers, of kind record and owned (copyNew). */
export function checkRecords(n: net.NetworkState) {
  const layers = net.shapeLayers(n)
  for (const key of RECORDS) {
    const l = layers.find(x => x.key === key)
    if (!l) throw new Error(`open-failed: there is no record layer ${key} (a file from before stage 2)`)
    if (l.kind !== 'record' || !l.copyNew) throw new Error(`open-failed: ${key} is not an owned record layer`)
  }
}
