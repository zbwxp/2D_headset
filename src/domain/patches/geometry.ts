import {mirrorPoint} from '../head/frame';
import {InputCache} from '../geometry/cache';
import {patchInputKey} from '../geometry/revisions';
import {count,timed} from '../geometry/diagnostics';
import type {LandmarkProject} from '../landmarks/model';
import type {Vec3} from '../project/types';
import {mirror} from '../landmarks/model';
import {cross,sub,dot,add,scale} from '../geometry/core';
import type {SurfacePatch} from './model';
import {fullnessEvaluator} from './base';
import {evaluationToken,getPatchSolution} from '../continuity/evaluation';
import {fairDifferential} from '../continuity/solver';
import {prepareFullness} from './fullness';
export {baseEvaluator,fullnessEvaluator} from './base';
const evaluators=new InputCache<(u:number,v:number)=>Vec3>(512);
export function evaluator(p:LandmarkProject,patch:SurfacePatch):(u:number,v:number)=>Vec3{
 const key=patchInputKey(p,patch)+evaluationToken(p,patch),hit=evaluators.get(key);if(hit)return hit;
 let f:(u:number,v:number)=>Vec3;
 if(patch.canonicalId){const canonical=evaluator(p,p.patches!.find(x=>x.id===patch.canonicalId)!);f=(u,v)=>mirrorPoint(p,canonical(u,v));}
 else {const solution=getPatchSolution(p,patch);if(!solution?.field)f=fullnessEvaluator(p,patch);
 else {const d=fairDifferential(p,patch,{patches:{[patch.id]:solution},diagnostics:{warnings:[],angles:{}}}),base=(u:number,v:number)=>d(u,v).position;f=(patch.fullness??0)===0?base:prepareFullness(p,patch,base,d);}}
 evaluators.set(key,f);return f;
}
export interface PatchMesh {
    vertices: Vec3[];
    triangles: number[][];
    warning?: string;
    invalid?: string;
}
const cache = new InputCache<PatchMesh>(512);
export function tessellate(p: LandmarkProject, patch: SurfacePatch, n = 24): PatchMesh {
    const key = patchInputKey(p,patch) + ':' + n + ':' + evaluationToken(p,patch);
    const hit=cache.get(key);if(hit)return hit;
    count('patchTessellations');const endTiming=timed('patchTessellation');
    const mesh: PatchMesh = { vertices: [], triangles: [] };
    try {
        const f = evaluator(p, patch);
        const rows: number[][] = [];
        // A full revolution gets four quarter-arc budgets at the selected display quality.
        const around=patch.type==='loop'?4*n:n;
        for (let j = 0; j <= n; j++) {
            const row: number[] = [];
            for (let i = 0; i <= (patch.type === 'tri' ? n - j : patch.type==='loop'?around-1:n); i++) {
                if(patch.type==='lens'&&j>0&&(i===0||i===n)){row.push(rows[0][i]);continue;}
                row.push(mesh.vertices.length);
                mesh.vertices.push(f(i / around, j / n));
            }
            rows.push(row);
        }
        if(patch.type==='loop'){for(let j=0;j<n;j++)for(let i=0;i<around;i++){const k=(i+1)%around;mesh.triangles.push([rows[j][i],rows[j][k],rows[j+1][i]],[rows[j][k],rows[j+1][k],rows[j+1][i]]);}}
        else for (let j = 0; j < n; j++)
            for (let i = 0; i < rows[j + 1].length; i++) {
                if (i + 1 < rows[j].length)
                    mesh.triangles.push([rows[j][i], rows[j][i + 1], rows[j + 1][i]]);
                if (i + 1 < rows[j + 1].length)
                    mesh.triangles.push([rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]]);
            }
        if(patch.type==='lens')mesh.triangles=mesh.triangles.filter(t=>new Set(t).size===3);
        if (mesh.vertices.some(v => !v.every(Number.isFinite)))
            throw Error('曲面求值产生非有限数值');
        const normals = mesh.triangles.map(([a, b, c]) => cross(sub(mesh.vertices[b], mesh.vertices[a]), sub(mesh.vertices[c], mesh.vertices[a])));
        const area = normals.reduce((s, n) => s + Math.hypot(...n), 0);
        const size = Math.max(...mesh.vertices.map(v => Math.hypot(...sub(v, mesh.vertices[0]))));
        if (area < Math.max(size * size * 1e-12, 1e-24))
            throw Error('曲面面积接近零');
        const average = normals.reduce((a, b) => add(a, b), [0, 0, 0] as Vec3);
        if (patch.type!=='loop' && normals.some(n => dot(n, average) < -area * area * 1e-8))
            mesh.warning = '局部法向反转，可能存在折叠（仍显示）';
    }
    catch (e) {
        mesh.invalid = (e as Error).message;
        mesh.triangles = [];
    }
    endTiming();cache.set(key, mesh);
    return mesh;
}
