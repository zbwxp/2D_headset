// Smart Guides' snapping (src/snap.ts, doc 18 §30.13).
import { expect, it } from 'vitest'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'
import { snapPoint } from '../src/snap'

it('a point within the tolerance lands exactly on the nearest anchor; else x / y align separately; excluded anchors are ignored', () => {
  const e = new Editor(exampleRecords())
  const ev = e.derived.evaluated()
  expect(snapPoint(ev, { x: 10.8, y: 59.5 }, 2)).toMatchObject({ kind: 'point', p: { x: 10, y: 60 } })
  const al = snapPoint(ev, { x: 40, y: 59.2 }, 2) // y near a2 (60), x near nothing
  expect(al).toMatchObject({ kind: 'align', p: { x: 40, y: 60 }, guides: { y: 60 } })
  expect(snapPoint(ev, { x: 200, y: 200 }, 2)).toMatchObject({ kind: 'none', p: { x: 200, y: 200 } })
  expect(snapPoint(ev, { x: 10.8, y: 59.5 }, 2, (c, a) => c === ids.C1 && a === 'a2').kind).not.toBe('point')
})
