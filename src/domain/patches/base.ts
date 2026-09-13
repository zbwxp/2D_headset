import {prepareFullness} from "./fullness";
import type { LandmarkProject } from '../landmarks/model';
import { mirror } from '../landmarks/model';
import type { Vec3 } from '../project/types';
import { add, sub, scale, cross, dot } from '../geometry/core';
import { controls, bezier } from '../curves/geometry';
import { loop, type SurfacePatch } from './model';
export function baseEvaluator(p: LandmarkProject, patch: SurfacePatch): (u: number, v: number) => Vec3 {
    if (patch.canonicalId) {
        const f = baseEvaluator(p, p.patches!.find(x => x.id === patch.canonicalId)!);
        return (u, v) => mirror(f(u, v));
    }
    const ring = loop(p, patch.boundaryEdgeIds), cp = ring.map(r => { const c = controls(p, p.curves.find(c => c.id === r.id)!); return r.reverse ? [...c].reverse() as typeof c : c; });
    const corners = cp.map(c => c[0]);
    const f = (u: number, v: number): Vec3 => {
        if (patch.type === 'quad') {
            const blend = add(add(scale(corners[0], (1 - u) * (1 - v)), scale(corners[1], u * (1 - v))), add(scale(corners[2], u * v), scale(corners[3], (1 - u) * v)));
            return sub(add(add(scale(bezier(cp[0], u), 1 - v), scale(bezier(cp[2], 1 - u), v)), add(scale(bezier(cp[3], 1 - v), 1 - u), scale(bezier(cp[1], v), u))), blend);
        }
        const l = [1 - u - v, u, v];
        let q: Vec3 = [0, 0, 0];
        for (let i = 0; i < 3; i++)
            q = add(q, scale(corners[i], l[i]));
        for (let i = 0; i < 3; i++) {
            const j = (i + 1) % 3, s = l[i] + l[j];
            if (s < 1e-14)
                continue;
            const t = l[j] / s;
            const linear = add(scale(corners[i], 1 - t), scale(corners[j], t));
            q = add(q, scale(sub(bezier(cp[i], t), linear), s * s));
        }
        return q;
    };
    // An invariant boundary uses a symmetry-equivariant parameter mapping.
    const permutation = ring.map(r => { const l = p.landmarks.find(l => l.id === r.vertex)!; return ring.findIndex(s => s.vertex === (l.mirrorPartnerId ?? l.id)); });
    if (permutation.every(i => i >= 0) && permutation.some((i, j) => i !== j))
        return (u, v) => {
            const weights = patch.type === 'tri' ? [1 - u - v, u, v] : [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v];
            const mapped = weights.map((_, i) => weights[permutation[i]]);
            const a = patch.type === 'tri' ? mapped[1] : mapped[1] + mapped[2], b = patch.type === 'tri' ? mapped[2] : mapped[2] + mapped[3];
            return scale(add(f(u, v), mirror(f(a, b))), .5);
        };
    return f;
}
const prepared = new WeakMap<LandmarkProject, Map<string, (u:number,v:number)=>Vec3>>();
export function fullnessEvaluator(p:LandmarkProject,patch:SurfacePatch):(u:number,v:number)=>Vec3 {
 let map=prepared.get(p);if(!map){map=new Map();prepared.set(p,map);}const cached=map.get(patch.id);if(cached)return cached;
 let f:(u:number,v:number)=>Vec3;
 if(patch.canonicalId){const canonical=fullnessEvaluator(p,p.patches!.find(x=>x.id===patch.canonicalId)!);f=(u,v)=>mirror(canonical(u,v));}
 else {const base=baseEvaluator(p,patch);f=(patch.fullness??0)===0?base:prepareFullness(p,patch,base);}
 map.set(patch.id,f);return f;
}
