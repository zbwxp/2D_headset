import {InputCache} from '../geometry/cache';
import {patchInputKey} from '../geometry/revisions';
import {count,timed} from '../geometry/diagnostics';
import type {LandmarkProject} from '../landmarks/model';
import type {Vec3} from '../project/types';
import {mirror} from '../landmarks/model';
import {cross,sub,dot,add,scale} from '../geometry/core';
import type {SurfacePatch} from './model';
import {fullnessEvaluator} from './base';
import {evaluationToken,getSmoothResult} from '../smooth/evaluation';
import {displacement} from '../smooth/field';
export {baseEvaluator,fullnessEvaluator} from './base';
export function evaluator(p:LandmarkProject,patch:SurfacePatch):(u:number,v:number)=>Vec3{
 const base=fullnessEvaluator(p,patch),settings=p.surfaceSmooth;
 if(!settings?.enabled||settings.strength===0)return base;
 const result=getSmoothResult(p);if(!result||result.error)return base;
 if(patch.canonicalId){const f=evaluator(p,p.patches!.find(x=>x.id===patch.canonicalId)!);return(u,v)=>mirror(f(u,v));}
 const field=result.fields[patch.id];if(!field)return base;
 return(u,v)=>{const d=displacement(field,u,v);return d.every(x=>x===0)?base(u,v):add(base(u,v),scale(d,settings.strength));};
}
export interface PatchMesh {
    vertices: Vec3[];
    triangles: number[][];
    warning?: string;
    invalid?: string;
}
const cache = new InputCache<PatchMesh>(512);
export function tessellate(p: LandmarkProject, patch: SurfacePatch, n = 24): PatchMesh {
    const key = patchInputKey(p,patch) + ':' + n + ':' + evaluationToken(p);
    const hit=cache.get(key);if(hit)return hit;
    count('patchTessellations');const endTiming=timed('patchTessellation');
    const mesh: PatchMesh = { vertices: [], triangles: [] };
    try {
        const f = evaluator(p, patch);
        const rows: number[][] = [];
        for (let j = 0; j <= n; j++) {
            const row: number[] = [];
            for (let i = 0; i <= (patch.type === 'tri' ? n - j : n); i++) {
                row.push(mesh.vertices.length);
                mesh.vertices.push(f(i / n, j / n));
            }
            rows.push(row);
        }
        for (let j = 0; j < n; j++)
            for (let i = 0; i < rows[j + 1].length; i++) {
                if (i + 1 < rows[j].length)
                    mesh.triangles.push([rows[j][i], rows[j][i + 1], rows[j + 1][i]]);
                if (i + 1 < rows[j + 1].length)
                    mesh.triangles.push([rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]]);
            }
        if (mesh.vertices.some(v => !v.every(Number.isFinite)))
            throw Error('曲面求值产生非有限数值');
        const normals = mesh.triangles.map(([a, b, c]) => cross(sub(mesh.vertices[b], mesh.vertices[a]), sub(mesh.vertices[c], mesh.vertices[a])));
        const area = normals.reduce((s, n) => s + Math.hypot(...n), 0);
        const size = Math.max(...mesh.vertices.map(v => Math.hypot(...sub(v, mesh.vertices[0]))));
        if (area < Math.max(size * size * 1e-12, 1e-24))
            throw Error('曲面面积接近零');
        const average = normals.reduce((a, b) => add(a, b), [0, 0, 0] as Vec3);
        if (normals.some(n => dot(n, average) < -area * area * 1e-8))
            mesh.warning = '局部法向反转，可能存在折叠（仍显示）';
    }
    catch (e) {
        mesh.invalid = (e as Error).message;
        mesh.triangles = [];
    }
    endTiming();cache.set(key, mesh);
    return mesh;
}
