import {evaluationContext} from '../geometry/evaluation';
import {boundaryKey,canonicalBoundary,mirrorBoundary,curveLocationOfLandmark} from '../patches/boundary';
import type { LandmarkProject } from '../landmarks/model';
import type { Vec3 } from '../project/types';
import { loop } from '../patches/model';
import { fullnessEvaluator } from '../patches/base';
import { SMOOTH_SUBDIVISIONS as N, SMOOTH_BAND_RINGS, influence, surfaceAdjacency } from './model';
import { latticeWeights } from './field';
export interface Node {
    key: string;
    p: Vec3;
    fixed: boolean;
    edge: boolean;
    neighbors: Set<number>;
    mirror?: string;
    indices: number[];
    sign: number;
}
export interface Chart {
    id: string;
    type: 'tri' | 'quad';
    ring: ReturnType<typeof loop>;
    ids: number[][];
}
export function buildLattice(p: LandmarkProject) {
    if(p.patches?.some(x=>(x.type==='loop'||x.type==='lens')))throw Error('Legacy Smooth 不支持环形面；请使用 Surface Continuity');
    const nodes: Node[] = [], byKey = new Map<string, number>(), charts = new Map<string, Chart>(), adjacency = surfaceAdjacency(p), warnings: string[] = [];
    const ctx=evaluationContext(p),uses=(p.patches??[]).flatMap(patch=>patch.boundaryUses.map(use=>({patch:patch.id,use,key:boundaryKey(p,use)})));
    const overlaps=new Set<string>();
    for(let i=0;i<uses.length;i++)for(let j=i+1;j<uses.length;j++){
        const a=uses[i],b=uses[j];if(a.patch===b.patch||a.use.curveId!==b.use.curveId||a.key===b.key)continue;
        const interval=(u:typeof a)=>[curveLocationOfLandmark(u.use.curveId,u.use.startLandmarkId!,ctx),curveLocationOfLandmark(u.use.curveId,u.use.endLandmarkId!,ctx)].sort((x,y)=>x-y);
        const x=interval(a),y=interval(b);if(Math.min(x[1],y[1])-Math.max(x[0],y[0])>1e-10)overlaps.add(a.use.curveId);
    }
    for(const id of overlaps)warnings.push('宿主 '+id+' 存在不同端点 UUID 的重叠区间；不焊接、不跨区间 Smooth');
    const landmarkMirror = (id: string) => { const l = p.landmarks.find(l => l.id === id)!; return l.mirrorPartnerId ?? (l.type === 'CENTERLINE' ? id : undefined); };
    // A follower uses its canonical chart orientation, not an independently sorted loop.
    const chartRing = (id: string): ReturnType<typeof loop> => {
        const patch = p.patches!.find(x => x.id === id)!;
        if (!patch.canonicalId)
            return loop(p, patch.boundaryUses);
        return chartRing(patch.canonicalId).map(r => {const use=mirrorBoundary(p,r.use),c=canonicalBoundary(p,use);return {id:boundaryKey(p,use),curveId:use.curveId,use,reverse:c.startLandmarkId!==use.startLandmarkId,vertex:use.startLandmarkId!};});
    };
    const boundary = (type: 'tri' | 'quad', i: number, j: number) => {
        if (j === 0)
            return { e: 0, k: i };
        if (type === 'quad') {
            if (i === N)
                return { e: 1, k: j };
            if (j === N)
                return { e: 2, k: N - i };
            if (i === 0)
                return { e: 3, k: N - j };
        }
        else {
            if (i + j === N)
                return { e: 1, k: j };
            if (i === 0)
                return { e: 2, k: N - j };
        }
        return null;
    };
    for (const patch of [...(p.patches ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
        if(patch.type==='loop'||patch.type==='lens')continue;
        const ring = chartRing(patch.id), f = fullnessEvaluator(p, patch), ids: number[][] = [];
        for (let j = 0; j <= N; j++) {
            const row: number[] = [];
            for (let i = 0; i <= (patch.type === 'tri' ? N - j : N); i++) {
                const b = boundary(patch.type, i, j);
                let key = 'P:' + patch.id + ':' + i + ':' + j, edge = false, fixed = false, mirrorKey: string | undefined;
                if (b) {
                    const r = ring[b.e];
                    edge = true;
                    if (b.k === 0 || b.k === N) {
                        const vertex = ring[(b.e + (b.k === N ? 1 : 0)) % ring.length].vertex;
                        key = 'V:' + vertex;
                        fixed = true;
                        const m = landmarkMirror(vertex);
                        if (m)
                            mirrorKey = 'V:' + m;
                    }
                    else {
                        const k = r.reverse ? N - b.k : b.k;
                        key = 'E:' + r.id + ':' + k;
                        const count = adjacency.get(r.id)!.length;
                        fixed = count !== 2 || influence(p, r.curveId) === 0;
                        try {const use=canonicalBoundary(p,r.use),m=mirrorBoundary(p,use),canonicalMirror=canonicalBoundary(p,m);
                            const mk=canonicalMirror.startLandmarkId===m.startLandmarkId?k:N-k;
                            mirrorKey='E:'+boundaryKey(p,m)+':'+mk;
                        } catch { /* Unpaired boundaries have no reflection orbit. */ }
                    }
                }
                else if (patch.mirrorPartnerId)
                    mirrorKey = 'P:' + patch.mirrorPartnerId + ':' + i + ':' + j;
                else {
                    const perm = ring.map(r => ring.findIndex(s => s.vertex === landmarkMirror(r.vertex)));
                    if (perm.every(x => x >= 0)) {
                        const u = i / N, v = j / N, w = patch.type === 'tri' ? [1 - u - v, u, v] : [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v], m = perm.map(k => w[k]);
                        const a = patch.type === 'tri' ? m[1] : m[1] + m[2], b = patch.type === 'tri' ? m[2] : m[2] + m[3];
                        mirrorKey = 'P:' + patch.id + ':' + Math.round(a * N) + ':' + Math.round(b * N);
                    }
                }
                const position = f(i / N, j / N);
                if (!position.every(Number.isFinite))
                    throw Error('Smooth source sample 非有限值');
                let id = byKey.get(key);
                if (id === undefined) {
                    id = nodes.length;
                    byKey.set(key, id);
                    nodes.push({ key, p: position, fixed, edge, neighbors: new Set(), mirror: mirrorKey, indices: [], sign: 1 });
                }
                else {
                    const old = nodes[id], distance = Math.hypot(...position.map((v, k) => v - old.p[k])), scale = Math.max(1, Math.hypot(...position));
                    if (distance > scale * 1e-8)
                        throw Error('共享边 source 位置不一致');
                    old.fixed ||= fixed;
                }
                row.push(id);
            }
            ids.push(row);
        }
        charts.set(patch.id, { id: patch.id, type: patch.type, ring, ids });
    }
    for (const chart of charts.values())
        for (let j = 0; j < chart.ids.length; j++)
            for (let i = 0; i < chart.ids[j].length; i++) {
                const a = chart.ids[j][i];
                for (const [dx, dy] of chart.type === 'quad' ? [[1, 0], [0, 1]] : [[1, 0], [0, 1], [-1, 1]]) {
                    const b = chart.ids[j + dy]?.[i + dx];
                    if (b !== undefined && b !== a) {
                        nodes[a].neighbors.add(b);
                        nodes[b].neighbors.add(a);
                    }
                }
            }
    // Limit correction support by graph distance; open/hard boundaries stay fixed.
    const distances = new Int32Array(nodes.length).fill(-1), queue: number[] = [];
    for (const [edge, patches] of adjacency) {
        if (patches.length > 2)
            warnings.push('Non-manifold Edge：' + edge + '（已固定）');
        if (patches.length !== 2 || influence(p, [...charts.values()].flatMap(c=>c.ring).find(r=>r.id===edge)!.curveId) === 0)
            continue;
        for (let k = 1; k < N; k++) {
            const id = byKey.get('E:' + edge + ':' + k);
            if (id !== undefined && distances[id] === -1) {
                distances[id] = 0;
                queue.push(id);
            }
        }
    }
    for (let read = 0; read < queue.length; read++) {
        const id = queue[read];
        if (distances[id] >= SMOOTH_BAND_RINGS)
            continue;
        for (const other of nodes[id].neighbors)
            if (distances[other] === -1) {
                distances[other] = distances[id] + 1;
                queue.push(other);
            }
    }
    nodes.forEach((node, i) => { if (distances[i] === -1)
        node.fixed = true; });
    // Reflection orbits share one 3D variable; fixed-plane orbits eliminate X.
    const groups = new Map<string, number[]>();
    nodes.forEach((node, i) => {
        if (node.mirror && !byKey.has(node.mirror))
            throw Error('Smooth mirror sample 映射缺失');
        const root = node.mirror && node.mirror < node.key ? node.mirror : node.key;
        node.sign = root === node.key ? 1 : -1;
        const list = groups.get(root) ?? [];
        list.push(i);
        groups.set(root, list);
    });
    let variables = 0;
    for (const [root, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
        const fixed = list.some(i => nodes[i].fixed), self = nodes[byKey.get(root)!].mirror === root;
        const indices = [0, 1, 2].map(k => fixed || self && k === 0 ? -1 : variables++);
        for (const i of list) {
            nodes[i].indices = indices;
            nodes[i].fixed = fixed;
        }
    }
    let L = 0;
    for (let k = 0; k < 3; k++) {
        let min = Infinity, max = -Infinity;
        for (const node of nodes) {
            min = Math.min(min, node.p[k]);
            max = Math.max(max, node.p[k]);
        }
        L = Math.max(L, max - min);
    }
    if (nodes.length && (!Number.isFinite(L) || L < 1e-12))
        throw Error('Smooth source 尺度退化');
    return { nodes, byKey, charts, adjacency, warnings, variables, L: L || 1 };
}
export function stencil(chart: Chart, u: number, v: number) { return latticeWeights(chart.type, N, u, v).map(w => ({ id: chart.ids[w.j][w.i], weight: w.weight })); }
export function interiorUV(chart: Chart, edge: string, t: number): [
    number,
    number
] {
    const index = chart.ring.findIndex(r => r.id === edge), r = chart.ring[index], q = r.reverse ? 1 - t : t, s = 1 / N;
    if (chart.type === 'quad')
        return [[q, s], [1 - s, q], [1 - q, 1 - s], [s, 1 - q]][index] as [
            number,
            number
        ];
    return [[(1 - s) * q, s], [(1 - s) * (1 - q), (1 - s) * q], [s, (1 - s) * (1 - q)]][index] as [
        number,
        number
    ];
}
