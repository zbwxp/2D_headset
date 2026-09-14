import {world} from './world-fixture';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseLandmarks } from '../domain/landmarks/persistence';
import { addPatch, loop, prunePatches, parsePatches } from '../domain/patches/model';
import { evaluator, tessellate } from '../domain/patches/geometry';
import { controls, bezier } from '../domain/curves/geometry';
import { mirror } from '../domain/landmarks/model';
const source = () => parseLandmarks(readFileSync('artifacts/basic-patch/adjusted-source.json', 'utf8'));
const tri = (p: ReturnType<typeof source>) => ['左面壳前边界·颧颊至下颊', '左颊部体积线·颧颊至颊峰', '左颊部体积线·颊峰至下颊'].map(n => p.curves.find(c => c.name === n)!.id);
const quad = (p: ReturnType<typeof source>) => ['左面壳前边界·额颞至颧颊', '左斜面带横向桥·额颞层', '左面壳后边界·颞侧至颧弓', '左斜面带横向桥·颧颊层'].map(n => p.curves.find(c => c.name === n)!.id);
const near = (a: number[], b: number[]) => expect(Math.hypot(...a.map((x, i) => x - b[i]))).toBeLessThan(1e-10);
describe('BasePatch', () => {
    for (const type of ['tri', 'quad'] as const)
        it(`${type} exact boundary, arbitrary selection order, mirror final geometry`, () => {
            const base = source(), ids = type === 'tri' ? tri(base) : quad(base), p = addPatch(base, [...ids].reverse()), patch = p.patches![0], f = evaluator(p, patch), g = evaluator(p, p.patches![1]);
            const ring = loop(p, ids);
            for (let e = 0; e < ring.length; e++)
                for (let i = 0; i <= 40; i++) {
                    const t = i / 40, r = ring[e], cp = controls(p, p.curves.find(c => c.id === r.id)!);
                    const uv = type === 'tri' ? [[t, 0], [1 - t, t], [0, 1 - t]][e] : [[t, 0], [1, t], [1 - t, 1], [0, 1 - t]][e];
                    near(f(uv[0], uv[1]), bezier(cp, r.reverse ? 1 - t : t));
                }
            for (let i = 0; i < 10; i++)
                near(g(i / 20, .25), mirror(f(i / 20, .25)));
            expect(p.landmarks).toEqual(base.landmarks);
            expect(p.curves).toEqual(base.curves);
            expect(tessellate(p, patch).invalid).toBeUndefined();
        });
    it('updates from node and handle source edits', () => { let p = source(); p = addPatch(p, tri(p)); const patch = p.patches![0], before = evaluator(p, patch)(.3, .3); const ring = loop(p, patch.boundaryEdgeIds); const q = { ...p, landmarks: p.landmarks.map(l => l.id === ring[0].vertex ? { ...l, placement: {kind:'WORLD' as const,position:[world(l).position[0], world(l).position[1], world(l).position[2] + .2] as [
                number,
                number,
                number
            ]} } : l) }; expect(evaluator(q, patch)(.3, .3)).not.toEqual(before); const edge = p.curves.find(c => c.id === ring[0].id)!; if (edge.role !== 'canonical')
        throw Error('fixture'); const r = { ...p, curves: p.curves.map(c => c.id === edge.id ? { ...edge, shape: { ...edge.shape, startHandle: { ...edge.shape.startHandle, offset: .4 } } } : c) }; expect(evaluator(r, patch)(.3, .3)).not.toEqual(before); });
    it('preserves source through JSON, allows shared edges, prunes dependent pairs', () => { let p = source(); p = addPatch(p, tri(p)); p = addPatch(p, quad(p)); const loaded = parseLandmarks(JSON.stringify(p)); expect(loaded.patches).toEqual(p.patches); expect(loaded.landmarks).toEqual(p.landmarks); expect(loaded.curves).toEqual(p.curves); const removed = prunePatches({ ...p, curves: p.curves.filter(c => c.id !== tri(p)[0]) }); expect(removed.patches).toHaveLength(2); });
    it('rejects duplicate, disconnected, repeated and broken loops', () => { const p = source(), ids = tri(p); expect(() => loop(p, [ids[0], ids[0], ids[1]])).toThrow(); expect(() => loop(p, p.curves.slice(0, 3).map(c => c.id))).toThrow(); expect(() => addPatch(addPatch(p, ids), ids)).toThrow(); expect(() => parsePatches([{ id: 'bad', type: 'tri', boundaryEdgeIds: ['absent', ...ids.slice(1)] }], p)).toThrow(); });
    it('numerical degeneration keeps record and recovers on restoring source', () => { let p = source(); p = addPatch(p, tri(p)); const patch = p.patches![0]; const flat = { ...p, landmarks: p.landmarks.map(l => ({ ...l, placement: {kind:'WORLD' as const,position:[0, 0, 0] as [
                number,
                number,
                number
            ]} })) }; expect(tessellate(flat, patch).invalid).toBeTruthy(); expect(flat.patches).toEqual(p.patches); expect(tessellate(p, patch).invalid).toBeUndefined(); });
});
it('self-symmetric quad creates once and preserves exact reflected geometry', () => {
    const base = source();
    const ids = ['左颅壳前侧弧·颅顶至额颞', '右颅壳前侧弧·颅顶至额颞', '左面壳额部横向基准', '右面壳额部横向基准'].map(n => base.curves.find(c => c.name === n)!.id);
    const p = addPatch(base, ids);
    expect(p.patches).toHaveLength(1);
    const patch = p.patches![0], f = evaluator(p, patch), ring = loop(p, ids);
    const perm = ring.map(r => { const l = p.landmarks.find(l => l.id === r.vertex)!; return ring.findIndex(q => q.vertex === (l.mirrorPartnerId ?? l.id)); });
    for (const u of [.1, .3, .7])
        for (const v of [.2, .6]) {
            const w = [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v], m = perm.map(i => w[i]);
            near(f(u, v), mirror(f(m[1] + m[2], m[2] + m[3])));
        }
    for (let e = 0; e < 4; e++)
        for (let i = 0; i <= 20; i++) {
            const t = i / 20, r = ring[e], uv = [[t, 0], [1, t], [1 - t, 1], [0, 1 - t]][e];
            near(f(...uv as [
                number,
                number
            ]), bezier(controls(p, p.curves.find(c => c.id === r.id)!), r.reverse ? 1 - t : t));
        }
});
it('adjacent patches share source edge and cascade without deleting independent patch', () => {
    let p = source();
    p = addPatch(p, tri(p));
    p = addPatch(p, quad(p));
    const ids = ['左面壳前边界·颧颊至下颊', '左斜面带横向桥·颧颊层', '左面壳后边界·颧弓至下颌角', '左斜面带横向桥·下颊层'].map(n => p.curves.find(c => c.name === n)!.id);
    p = addPatch(p, ids);
    expect(p.patches).toHaveLength(6);
    expect(p.patches!.filter(x => x.boundaryEdgeIds.includes(ids[0]))).toHaveLength(2);
    expect(prunePatches({ ...p, curves: p.curves.filter(c => c.id !== ids[0]) }).patches).toHaveLength(2);
});
