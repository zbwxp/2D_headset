import {canonicalBoundary,boundaryParameters} from '../patches/boundary';
import type { LandmarkProject } from '../landmarks/model';
import type { Vec3 } from '../project/types';
import { controls } from '../curves/geometry';
import { derivative } from '../geometry/bezier';
import { buildLattice, stencil, interiorUV } from './lattice';
import { SMOOTH_SUBDIVISIONS as N, SMOOTH_WEIGHTS as W, influence } from './model';
import { pcg, type Row } from './pcg';
import type { SmoothResult, SmoothDiagnostics } from './field';
const diagnostics = (): SmoothDiagnostics => ({ before: 0, after: 0, maxDisplacement: 0, averageDisplacement: 0, iterations: 0, relativeResidual: 0, variables: 0, seamSamples: 0, warnings: [] });
export function solveSmooth(p: LandmarkProject): SmoothResult {
    const debug = diagnostics();
    try {
        const g = buildLattice(p), { nodes, L } = g, rows: Row[] = [];
        debug.warnings = g.warnings;
        debug.variables = g.variables;
        // Each scalar residual row may couple all three coordinates through Q.
        // Eliminated hard variables have index -1; mirror X signs enter the same row.
        const scalarRow = (terms: {
            id: number;
            axis: number;
            coefficient: number;
        }[], target: number, weight: number) => {
            const map = new Map<number, number>(), s = Math.sqrt(weight);
            for (const term of terms) {
                const node = nodes[term.id], index = node.indices[term.axis];
                if (index < 0)
                    continue;
                const a = term.coefficient * s * (term.axis === 0 ? node.sign : 1);
                map.set(index, (map.get(index) ?? 0) + a);
            }
            const entries = [...map].filter(([, v]) => Math.abs(v) > 1e-16).sort(([a], [b]) => a - b);
            if (entries.length)
                rows.push({ indices: entries.map(([i]) => i), coefficients: entries.map(([, v]) => v), target: target * s });
        };
        // Fidelity and fairness act only on displacement, never absolute positions.
        nodes.forEach((node, id) => {
            for (let axis = 0; axis < 3; axis++) {
                scalarRow([{ id, axis, coefficient: 1 }], 0, W.source * (node.edge ? W.edge : 1));
                if (node.neighbors.size)
                    scalarRow([{ id, axis, coefficient: 1 }, ...[...node.neighbors].sort((a, b) => a - b).map(id => ({ id, axis, coefficient: -1 / node.neighbors.size }))], 0, W.fair);
            }
        });
        type Seam = {
            coefficients: {
                id: number;
                weight: number;
            }[];
            Q: number[][];
            before: Vec3;
        };
        const seams: Seam[] = [];
        const point = (weights: {
            id: number;
            weight: number;
        }[]): Vec3 => [0, 1, 2].map(k => weights.reduce((s, w) => s + w.weight * nodes[w.id].p[k] / L, 0)) as Vec3;
        // Build Q and transverse lengths once from pre-smooth geometry.
        for (const [edge, patches] of [...g.adjacency].sort(([a], [b]) => a.localeCompare(b))) {
            const use=canonicalBoundary(p,g.charts.get(patches[0])!.ring.find(r=>r.id===edge)!.use);
            const alpha = influence(p, use.curveId);
            if (patches.length !== 2 || alpha === 0)
                continue;
            const cp = controls(p, p.curves.find(c => c.id === use.curveId)!);
            const {t0,t1}=boundaryParameters(p,use);
            let skipped = 0;
            for (let k = 1; k < N; k++) {
                const t = k / N, e = g.byKey.get('E:' + edge + ':' + k)!;
                const a = stencil(g.charts.get(patches[0])!, ...interiorUV(g.charts.get(patches[0])!, edge, t)), b = stencil(g.charts.get(patches[1])!, ...interiorUV(g.charts.get(patches[1])!, edge, t));
                const tangent = derivative(cp, t0+(t1-t0)*t), norm = Math.hypot(...tangent);
                if (!Number.isFinite(norm) || norm < 1e-10 * L) {
                    skipped++;
                    continue;
                }
                const tau = tangent.map(x => x / norm), Q = [0, 1, 2].map(i => [0, 1, 2].map(j => (i === j ? 1 : 0) - tau[i] * tau[j]));
                const project = (v: number[]): Vec3 => Q.map(row => row.reduce((s, x, j) => s + x * v[j], 0)) as Vec3;
                const ep = point([{ id: e, weight: 1 }]), ap = point(a), bp = point(b);
                const hA = Math.hypot(...project(ap.map((v, i) => v - ep[i]))), hB = Math.hypot(...project(bp.map((v, i) => v - ep[i])));
                if (!Number.isFinite(hA + hB) || hA < 1e-10 || hB < 1e-10) {
                    skipped++;
                    continue;
                }
                const coefficients = [...a.map(w => ({ id: w.id, weight: w.weight / hA })), ...b.map(w => ({ id: w.id, weight: w.weight / hB })), { id: e, weight: -1 / hA - 1 / hB }];
                const before = project(point(coefficients));
                seams.push({ coefficients, Q, before });
                for (let i = 0; i < 3; i++)
                    scalarRow(coefficients.flatMap(w => [0, 1, 2].map(axis => ({ id: w.id, axis, coefficient: w.weight * Q[i][axis] }))), -before[i], W.seam * alpha);
            }
            if (skipped)
                debug.warnings.push(edge + ': ' + skipped + '/' + (N - 1) + ' 个退化 seam sample 已跳过' + (skipped > (N - 1) / 2 ? '；该 seam 无法可靠 Smooth' : ''));
        }
        // A = sum(row^T row) plus positive fidelity is SPD on free variables.
        const solved = pcg(rows, g.variables), values: Vec3[] = nodes.map(node => node.indices.map((index, k) => index < 0 ? 0 : solved.x[index] * (k === 0 ? node.sign : 1)) as Vec3);
        debug.iterations = solved.iterations;
        debug.relativeResidual = solved.relativeResidual;
        debug.seamSamples = seams.length;
        debug.before = seams.reduce((s, row) => s + Math.hypot(...row.before), 0) / (seams.length || 1);
        debug.after = seams.reduce((s, row) => { const delta = [0, 1, 2].map(k => row.coefficients.reduce((a, w) => a + w.weight * values[w.id][k], 0)); return s + Math.hypot(...row.Q.map((q, i) => row.before[i] + q.reduce((a, x, j) => a + x * delta[j], 0))); }, 0) / (seams.length || 1);
        for (const v of values) {
            const d = Math.hypot(...v) * L;
            debug.maxDisplacement = Math.max(debug.maxDisplacement, d);
            debug.averageDisplacement += d / (values.length || 1);
        }
        const fields: SmoothResult['fields'] = {};
        for (const patch of p.patches ?? []) {
            if (patch.canonicalId||(patch.type==='loop'||patch.type==='lens'))
                continue;
            const chart = g.charts.get(patch.id)!;
            fields[patch.id] = { type: patch.type, n: N, values: chart.ids.map(row => row.map(id => values[id].map(x => x * L) as Vec3)) };
        }
        return { fields, diagnostics: debug };
    }
    catch (e) {
        return { fields: {}, diagnostics: debug, error: (e as Error).message };
    }
}
