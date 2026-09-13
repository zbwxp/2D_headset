import type { Vec3 } from '../project/types';
export interface DisplacementField {
    type: 'tri' | 'quad';
    n: number;
    values: Vec3[][];
}
export interface SmoothDiagnostics {
    before: number;
    after: number;
    maxDisplacement: number;
    averageDisplacement: number;
    iterations: number;
    relativeResidual: number;
    variables: number;
    seamSamples: number;
    warnings: string[];
}
export interface SmoothResult {
    fields: Record<string, DisplacementField>;
    diagnostics: SmoothDiagnostics;
    error?: string;
}
export type Weight = {
    i: number;
    j: number;
    weight: number;
};
export function latticeWeights(type: 'tri' | 'quad', n: number, u: number, v: number): Weight[] {
    const snap = (x: number) => Math.abs(x - Math.round(x)) < 1e-10 ? Math.round(x) : x;
    const x = snap(Math.max(0, Math.min(1, u)) * n), y = snap(Math.max(0, Math.min(1, v)) * n);
    let i = Math.floor(x), j = Math.floor(y);
    if (type === 'quad') {
        i = Math.min(n - 1, i);
        j = Math.min(n - 1, j);
        const a = x - i, b = y - j;
        return [{ i, j, weight: (1 - a) * (1 - b) }, { i: i + 1, j, weight: a * (1 - b) }, { i, j: j + 1, weight: (1 - a) * b }, { i: i + 1, j: j + 1, weight: a * b }].filter(w => w.weight !== 0);
    }
    const a = x - i, b = y - j;
    if (i + j >= n)
        return [{ i: Math.min(i, n - j), j, weight: 1 }];
    return (a + b <= 1 ? [
        { i, j, weight: 1 - a - b }, { i: i + 1, j, weight: a }, { i, j: j + 1, weight: b }
    ] : [{ i: i + 1, j, weight: 1 - b }, { i: i + 1, j: j + 1, weight: a + b - 1 }, { i, j: j + 1, weight: 1 - a }]).filter(w => Math.abs(w.weight) > 1e-14);
}
export function displacement(field: DisplacementField, u: number, v: number): Vec3 {
    const out: Vec3 = [0, 0, 0];
    for (const w of latticeWeights(field.type, field.n, u, v)) {
        const p = field.values[w.j][w.i];
        for (let k = 0; k < 3; k++)
            out[k] += p[k] * w.weight;
    }
    return out;
}
