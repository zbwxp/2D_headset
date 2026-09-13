export interface Row {
    indices: number[];
    coefficients: number[];
    target: number;
}
export function pcg(rows: Row[], size: number, maxIterations = 1000) {
    const b = new Float64Array(size), diagonal = new Float64Array(size);
    for (const row of rows)
        row.indices.forEach((i, k) => { const c = row.coefficients[k]; b[i] += c * row.target; diagonal[i] += c * c; });
    if ([...diagonal].some(x => !Number.isFinite(x) || x <= 0))
        throw Error('Smooth 系统对角项非正，无法确认 SPD');
    const apply = (x: Float64Array) => { const y = new Float64Array(size); for (const row of rows) {
        let a = 0;
        for (let k = 0; k < row.indices.length; k++)
            a += row.coefficients[k] * x[row.indices[k]];
        for (let k = 0; k < row.indices.length; k++)
            y[row.indices[k]] += row.coefficients[k] * a;
    } return y; };
    const dot = (a: Float64Array, c: Float64Array) => a.reduce((s, x, i) => s + x * c[i], 0);
    const x = new Float64Array(size), r = b.slice(), z = r.map((v, i) => v / diagonal[i]), direction = z.slice(), bnorm = Math.sqrt(dot(b, b)), threshold = 1e-10 + 1e-8 * bnorm;
    let rz = dot(r, z), residual = Math.sqrt(dot(r, r)), iterations = 0;
    if (residual <= threshold)
        return { x, iterations, relativeResidual: bnorm ? residual / bnorm : 0 };
    for (; iterations < maxIterations; iterations++) {
        const a = apply(direction), denom = dot(direction, a);
        if (!Number.isFinite(denom) || denom <= 0)
            throw Error('Smooth 系统出现非正定搜索方向');
        const alpha = rz / denom;
        for (let i = 0; i < size; i++) {
            x[i] += alpha * direction[i];
            r[i] -= alpha * a[i];
        }
        residual = Math.sqrt(dot(r, r));
        if (!Number.isFinite(residual))
            throw Error('Smooth PCG 出现非有限值');
        if (residual <= threshold) {
            iterations++;
            break;
        }
        for (let i = 0; i < size; i++)
            z[i] = r[i] / diagonal[i];
        const next = dot(r, z), beta = next / rz;
        for (let i = 0; i < size; i++)
            direction[i] = z[i] + beta * direction[i];
        rz = next;
    }
    // Recheck the actual system residual instead of accepting accumulated roundoff.
    const actual = apply(x);
    residual = Math.sqrt(actual.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));
    if (residual > threshold * 5)
        throw Error('Smooth PCG 未收敛');
    return { x, iterations, relativeResidual: bnorm ? residual / bnorm : 0 };
}
