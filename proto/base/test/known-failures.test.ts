// KNOWN FAILURES — real, unfixed problems kept as executable reproductions (dot). Each uses `it.fails`:
// it passes ONLY while the problem still reproduces, and turns red the moment the problem is fixed, so
// the entry must then be moved to a normal test. scripts/gate.sh lists these separately in its report.
import { describe, expect, it } from 'vitest'
import type { Command } from '../src/commands'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'
import { Derived } from '../src/derived'
import { createDocStore, Reference, type FillRecord } from '../src/schema'
import { hitTest } from '../src/evaluate'
import { paintCases } from '../src/paintCases'

describe('KNOWN FAILURE', () => {
  // KF-1 (found by property I13, 8373b9b): a create without an explicit id gets a fresh random id on
  // every plan, so the previewed record and the committed record have DIFFERENT ids. API callers who
  // preview then apply see an id that never exists. Fix direction (dot): a prepared create reuses its
  // allocated identity and the commit re-validates it — not by rewriting ids when comparing.
  it.fails('KF-1 preview and commit of a create give the same new id', () => {
    const e = new Editor(exampleRecords())
    const boundary = (exampleRecords().find((r) => r.id === ids.F) as FillRecord).boundary
    const cmd: Command = { type: 'createFill', parentId: ids.L1, boundary }
    const pv = e.preview(cmd)
    expect(pv.ok).toBe(true)
    const previewed = pv.ok ? pv.affected[0] : undefined
    const r = e.apply(cmd)
    expect(r.ok && r.written).toBe(true)
    const committed = r.ok ? r.affected[0] : undefined
    expect(committed).toBe(previewed) // fails today: two different fresh ids
  })

  // KF-2 (connected ends separated under a pose key) — FIXED with option A; now test/pose-connections.test.ts

  // KF-3 (dot, review of c8f3fc2): the base reference-instance map is pruned only when the whole list
  // RECOMPUTES. Adding and removing references directly in the store while reading instances, with a
  // net-zero membership change, leaves historical entries (21 for 1 live reference) — the whole-list
  // read returns the same cached result and never prunes. The current Editor has no command that adds
  // or removes references, so this is a stated limit, a required acceptance case for future reference
  // add/remove — not claimed solved. dot's original test, verbatim except `it` → `it.fails` and the `KF-3 ` name prefix.
  it.fails('KF-3 base reference membership is lazy: raw-store delete + item reads retain historical keys until whole-table read prunes',()=>{const s=createDocStore();s.put(exampleRecords());const d=new Derived(s,s,{yawRetainedItems:1});d.evaluated();for(let i=0;i<20;i++){const r=Reference.create({id:Reference.createId(`dot${i}`),name:'x',parentId:ids.L1,sourceId:ids.L3,transform:{a:1,b:0,c:0,d:1,e:0,f:0}});s.put([r]);d.instance(r.id,ids.E1);s.remove([r.id]);d.curve(ids.C1)}const before=d.instanceCacheSize;expect(before).toBe(21);d.evaluated();const after=d.instanceCacheSize;expect(after).toBe(1);console.log('BASE_REFERENCE_LIFECYCLE',{beforeWholeRead:before,afterWholeRead:after,liveRefs:1})})
  // KF-4 (dot, review of S1): V-mode picking ignores paint order — segments always beat fills — so a line
  // completely hidden under a fill in front is still picked. Picking must agree with what is visible
  // (principle 4); picking hidden lines, if wanted, is an explicit mode. Fix after S2.
  it.fails('KF-4 V-mode picking selects a line fully hidden under a fill in front', () => {
    const e = new Editor(paintCases['P2-fill-layer-in-front'].records())
    const hit = hitTest(e.derived.evaluated(), { x: 40, y: 30 }, { mode: 'V', tolerance: 2 })
    expect(hit).toMatchObject({ kind: 'fill', address: 'fill:F' })
  })
})
