import { InputCache } from '../geometry/cache';
import type { Vec3 } from '../project/types';
export const FAIR_DEGREE = 12;
export interface FairField {
    type: 'tri' | 'quad' | 'loop' | 'lens';
    degree: number;
    coefficients: Vec3[];
}
export function indices(type: FairField['type'], n = FAIR_DEGREE) { const out: [
    number,
    number
][] = []; for (let j = 1; j < n; j++)
    for (let i = type==='loop'?0:1; i < (type === 'tri' ? n - j : n); i++)
        out.push([i, j]); return out; }
const choose = (n: number, k: number) => { if (k < 0 || k > n)
    return 0; let x = 1; for (let i = 1; i <= k; i++)
    x = x * (n - i + 1) / i; return x; };
const b = (n: number, i: number, x: number) => i < 0 || i > n ? 0 : choose(n, i) * x ** i * (1 - x) ** (n - i);
const tri = (n: number, i: number, j: number, u: number, v: number) => i < 0 || j < 0 || i + j > n ? 0 : choose(n, i) * choose(n - i, j) * u ** i * v ** j * Math.max(0, 1 - u - v) ** (n - i - j);
/** Interior Bernstein coefficients only; every boundary coefficient is hard zero. */
const basisCache = new InputCache<number[][]>(4096);
export function weights(type: FairField['type'], n: number, u: number, v: number) {
    const key = [type, n, u, v].join(':'), hit = basisCache.get(key);
    if (hit)
        return hit;
    return basisCache.set(key, indices(type, n).map(([i, j]) => type === 'loop' ? periodicBasis(n,i,j,u,v) : type !== 'tri' ?
        [b(n, i, u) * b(n, j, v), n * (b(n - 1, i - 1, u) - b(n - 1, i, u)) * b(n, j, v), n * b(n, i, u) * (b(n - 1, j - 1, v) - b(n - 1, j, v))] :
        [tri(n, i, j, u, v), n * (tri(n - 1, i - 1, j, u, v) - tri(n - 1, i, j, u, v)), n * (tri(n - 1, i, j - 1, u, v) - tri(n - 1, i, j, u, v))]));
}
export function fieldDifferential(field: FairField, u: number, v: number) { const w = weights(field.type, field.degree, u, v); const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]] as Vec3[]; field.coefficients.forEach((p, i) => { for (let d = 0; d < 3; d++)
    for (let a = 0; a < 3; a++)
        out[d][a] += p[a] * w[i][d]; }); return { position: out[0], du: out[1], dv: out[2] }; }

/** Periodic uniform cubic B-splines in U × interior Bernstein in V.
 * No coefficient/constraint at a semantic U seam; V boundary displacement is exactly zero. */
function periodicBasis(n:number,i:number,j:number,u:number,v:number){
 const x=((u%1+1)%1)*n;let w=0,d=0;
 for(const shift of [-n,0,n]){const z=x-i+shift,a=Math.abs(z),sign=Math.sign(z);
 if(a<1){w+=2/3-a*a+a*a*a/2;d+=sign*(-2*a+1.5*a*a)*n;}
 else if(a<2){w+=(2-a)**3/6;d-=sign*(2-a)**2*n/2;}}
 return [w*b(n,j,v),d*b(n,j,v),w*n*(b(n-1,j-1,v)-b(n-1,j,v))];
}
