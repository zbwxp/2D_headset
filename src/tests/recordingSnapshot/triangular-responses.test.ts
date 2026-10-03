import {describe, expect, it} from 'vitest';
import {
  evaluateEdgeExtendedWeights, evaluateTriangularResponseWeights, prepareTriangularResponse,
  solveClosestBarycentricWeights, upsertInteriorResponseSample, validateInteriorResponseSamples,
  type BarycentricWeights, type InteriorResponseSample, type OrientedEdgeResponse,
} from '../../domain/recordingSnapshot/triangularResponses';

const sum = (w: BarycentricWeights) => w[0] + w[1] + w[2];
const dot = (w: BarycentricWeights, p: BarycentricWeights) => w[0] * p[0] + w[1] * p[1] + w[2] * p[2];
const close = (actual: BarycentricWeights, expected: BarycentricWeights, digits = 12) => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], digits));
const edges: OrientedEdgeResponse[] = [
  {from: 0, to: 1, knots: [[.25, -1], [.5, 2], [.75, .25]]},
  {from: 1, to: 2, knots: [[.25, 3], [.5, -.5], [.75, 2]]},
  {from: 2, to: 0, knots: [[.25, -2], [.5, 1.5], [.75, 1.2]]},
];
const samples: InteriorResponseSample[] = [
  {id: 'a', at: [.2, .3, .5], weights: [-1, 3, -1]},
  {id: 'b', at: [.6, .3, .1], weights: [.5, -.3, .8]},
  {id: 'c', at: [.2, .6, .2], weights: [1.2, .3, -.5]},
];

describe('geometric triangle edge response extension', () => {
  it('returns the geometric basis without responses and never mutates inputs', () => {
    const original: BarycentricWeights = [.2, .3, .5], before = JSON.stringify({original, edges});
    expect(evaluateEdgeExtendedWeights(original)).toEqual(original);
    expect(sum(evaluateEdgeExtendedWeights(original, edges))).toBeCloseTo(1, 14);
    expect(JSON.stringify({original, edges})).toBe(before);
  });

  it.each([0, 1, 2] as const)('retains exact real vertex %s with all three edge responses', vertex => {
    const at: [number, number, number] = [0, 0, 0]; at[vertex] = 1;
    expect(evaluateEdgeExtendedWeights(at, edges)).toEqual(at);
  });

  it.each([0, 1, 2])('reduces exactly to the sole shared response on edge %s, including signed knots', edgeIndex => {
    const edge = edges[edgeIndex];
    for (const [t, response] of [[0, 0], ...edge.knots!, [1, 1]]) {
      const at: [number, number, number] = [0, 0, 0], expected: [number, number, number] = [0, 0, 0];
      at[edge.from] = 1 - t; at[edge.to] = t;
      expected[edge.from] = 1 - response; expected[edge.to] = response;
      close(evaluateEdgeExtendedWeights(at, edges), expected);
      expect(evaluateEdgeExtendedWeights(at, edges)[3 - edge.from - edge.to]).toBe(0);
    }
  });

  it.each([0, 1, 2])('approaches every edge continuously from the interior, edge %s', edgeIndex => {
    const edge = edges[edgeIndex], other = 3 - edge.from - edge.to;
    for (const t of [.01, .25, .5, .75, .99]) {
      const boundary: [number, number, number] = [0, 0, 0]; boundary[edge.from] = 1 - t; boundary[edge.to] = t;
      const near = boundary.map(w => w * (1 - 1e-10)) as [number, number, number]; near[other] = 1e-10;
      close(evaluateEdgeExtendedWeights(near, edges), evaluateEdgeExtendedWeights(boundary, edges), 7);
    }
  });

  it('is invariant under reversing an edge and its oriented response', () => {
    const edge = edges[0];
    const reversed: OrientedEdgeResponse = {from: edge.to, to: edge.from,
      knots: [...edge.knots!].reverse().map(([t, w]) => [1 - t, 1 - w])};
    for (const at of [[.2, .3, .5], [.7, .3, 0], [0, 0, 1]] as BarycentricWeights[]) {
      close(evaluateEdgeExtendedWeights(at, [edge]), evaluateEdgeExtendedWeights(at, [reversed]));
    }
  });

  it('preserves sum one across a grid and rejects malformed or double-owned edges', () => {
    for (let a = 0; a <= 10; a++) for (let b = 0; b <= 10 - a; b++) {
      const at: BarycentricWeights = [a / 10, b / 10, (10 - a - b) / 10];
      expect(sum(evaluateEdgeExtendedWeights(at, edges))).toBeCloseTo(1, 12);
    }
    expect(() => evaluateEdgeExtendedWeights([.2, .3, .4], edges)).toThrow(/sum/);
    expect(() => evaluateEdgeExtendedWeights([-.1, .5, .6], edges)).toThrow(/nonnegative/);
    expect(() => evaluateEdgeExtendedWeights([.2, .3, .5], [edges[0], {...edges[0], from: 1, to: 0}])).toThrow(/only one/);
    expect(() => evaluateEdgeExtendedWeights([.2, .3, .5], [{from: 0, to: 1, knots: [[.5, 1], [.5, 2]]}])).toThrow(/strictly increasing/);
  });
});

describe('closest original barycentric scalar inverse', () => {
  it('meets both constraints and is the closest solution to ORIGINAL geometric weights', () => {
    const original: BarycentricWeights = [.2, .3, .5], p: BarycentricWeights = [2, -1, 4];
    const result = solveClosestBarycentricWeights(original, p, 7);
    expect(result.available).toBe(true); if (!result.available) return;
    expect(sum(result.weights)).toBeCloseTo(1, 14); expect(dot(result.weights, p)).toBeCloseTo(7, 13);
    // The remaining feasible direction is orthogonal to both (1,1,1) and p.
    const nullDirection = [p[1] - p[2], p[2] - p[0], p[0] - p[1]];
    const distance = (w: readonly number[]) => w.reduce((s, v, i) => s + (v - original[i]) ** 2, 0);
    const best = distance(result.weights);
    for (const step of [-2, -.1, .1, 2]) expect(distance(result.weights.map((v, i) => v + step * nullDirection[i]))).toBeGreaterThan(best);
    expect(result.weights.some(w => w < 0)).toBe(true);
    expect(result.conditioning.supportSize).toBe(3);
  });

  it.each(([[.75, .25, 0], [.75, 0, .25], [0, .75, .25]] as BarycentricWeights[]).map(original => ({original})))('reduces to the two-point inverse at $original without freeing the absent vertex', ({original}) => {
    const p: BarycentricWeights = [2, 4, 8], active = [0, 1, 2].filter(i => original[i] !== 0);
    for (const target of [-3, 20]) {
      const result = solveClosestBarycentricWeights(original, p, target);
      expect(result.available).toBe(true); if (!result.available) continue;
      const t = (target - p[active[0]]) / (p[active[1]] - p[active[0]]);
      expect(result.weights[active[0]]).toBeCloseTo(1 - t, 13); expect(result.weights[active[1]]).toBeCloseTo(t, 13);
      expect(result.weights[original.indexOf(0)]).toBe(0); expect(result.conditioning.supportSize).toBe(2);
    }
  });

  it('does not borrow an off-edge coordinate when the active edge axis is constant', () => {
    const result = solveClosestBarycentricWeights([.3, .7, 0], [1, 1, 100], 2);
    expect(result.available).toBe(false); expect(result.conditioning?.relativeSpread).toBe(0);
  });

  it('keeps exact unchanged singular axes legal and diagnoses changed constant/near-constant axes', () => {
    const original: BarycentricWeights = [.2, .3, .5];
    for (const p of [[3, 3, 3], [0, 1e-16, 2e-16], [1e8, 1e8 + 1e-7, 1e8 + 2e-7]] as BarycentricWeights[]) {
      const unchanged = solveClosestBarycentricWeights(original, p, dot(original, p));
      expect(unchanged.available).toBe(true); if (unchanged.available) expect(unchanged.weights).toEqual(original);
      const changed = solveClosestBarycentricWeights(original, p, dot(original, p) + 1);
      expect(changed.available).toBe(false); expect(changed.conditioning?.relativeSpread).toBeLessThanOrEqual(64 * Number.EPSILON);
    }
    expect(solveClosestBarycentricWeights(original, [0, 1e-10, 2e-10], 3e-10).available).toBe(true);
  });

  it('has no correction at a vertex and never snaps a tiny positive coordinate to zero', () => {
    expect(solveClosestBarycentricWeights([1, 0, 0], [2, 4, 8], 3).available).toBe(false);
    const unchanged = solveClosestBarycentricWeights([1, 0, 0], [2, 4, 8], 2);
    expect(unchanged.available).toBe(true); if (unchanged.available) expect(unchanged.weights).toEqual([1, 0, 0]);
    const near = solveClosestBarycentricWeights([1 - 1e-15, 1e-15, 0], [2, 4, 8], 3);
    expect(near.available).toBe(true); if (near.available) close(near.weights, [.5, .5, 0]);
  });

  it('solves X and Y independently, permits overshoot, and rejects nonfinite inputs', () => {
    const original: BarycentricWeights = [.2, .3, .5];
    const x = solveClosestBarycentricWeights(original, [0, 1, 0], 4), y = solveClosestBarycentricWeights(original, [0, 0, 1], -2);
    expect(x.available && y.available).toBe(true);
    if (x.available && y.available) { expect(x.weights[1]).toBeCloseTo(4, 13); expect(y.weights[2]).toBeCloseTo(-2, 13); expect(x.weights).not.toEqual(y.weights); }
    expect(solveClosestBarycentricWeights(original, [0, NaN, 1], 1).available).toBe(false);
    expect(solveClosestBarycentricWeights(original, [0, 1, 2], Infinity).available).toBe(false);
  });
});

describe('boundary-zero interior scalar response field', () => {
  it('compiles constraints once and isolates the reusable sampler from authoring mutations', () => {
    const ownedEdges = structuredClone(edges), ownedSamples = structuredClone(samples);
    const evaluate = prepareTriangularResponse(ownedEdges, ownedSamples), at: BarycentricWeights = [.3, .3, .4];
    const before = evaluate(at);
    ownedSamples[0].weights = [.1, .2, .7]; ownedSamples.reverse(); ownedEdges[0].knots = [[.5, 10]];
    expect(evaluate(at)).toEqual(before);
    expect(evaluate(samples[0].at)).toEqual(samples[0].weights);
    expect(() => prepareTriangularResponse([], [{...samples[0], weights: [2, 2, 2]}])).toThrow(/sum/);
  });

  it('reproduces every stored signed weight constraint exactly and keeps array order irrelevant', () => {
    for (const sample of samples) expect(evaluateTriangularResponseWeights(sample.at, edges, samples)).toEqual(sample.weights);
    const at: BarycentricWeights = [.3, .3, .4];
    expect(evaluateTriangularResponseWeights(at, edges, samples)).toEqual(evaluateTriangularResponseWeights(at, edges, [...samples].reverse()));
    expect(sum(evaluateTriangularResponseWeights(at, edges, samples))).toBeCloseTo(1, 12);
  });

  it('retains all original edge responses and vertices exactly with multiple interior corrections', () => {
    for (const edge of edges) for (const t of [0, .1, .25, .5, .75, 1]) {
      const at: [number, number, number] = [0, 0, 0]; at[edge.from] = 1 - t; at[edge.to] = t;
      expect(evaluateTriangularResponseWeights(at, edges, samples)).toEqual(evaluateEdgeExtendedWeights(at, edges));
      const near = at.map(w => w * (1 - 1e-11)) as [number, number, number]; near[3 - edge.from - edge.to] = 1e-11;
      close(evaluateTriangularResponseWeights(near, edges, samples), evaluateEdgeExtendedWeights(at, edges), 7);
    }
  });

  it('is continuous at constraints and handles tiny nonzero sample distances without epsilon snapping', () => {
    const single: InteriorResponseSample = {id: 'single', at: [.2, .3, .5], weights: [-1, 2, 0]};
    for (const epsilon of [1e-7, 1e-10, 1e-15]) {
      const at: BarycentricWeights = [.2 + epsilon, .3, .5 - epsilon];
      close(evaluateTriangularResponseWeights(at, edges, [single]), single.weights, epsilon > 1e-9 ? 4 : 7);
    }
    const tiny: InteriorResponseSample[] = [
      {id: 'a', at: [1e-180, .4, .6], weights: [0, .5, .5]},
      {id: 'b', at: [2e-180, .4, .6], weights: [0, .3, .7]},
    ];
    const evaluated = evaluateTriangularResponseWeights([1.5e-180, .4, .6], [], tiny);
    expect(evaluated.every(Number.isFinite)).toBe(true); expect(sum(evaluated)).toBeCloseTo(1, 12);
  });

  it('uses a bubble-scaled exact one-sample field and leaves zero corrections unchanged', () => {
    const at: BarycentricWeights = [.25, .25, .5], sampleAt: BarycentricWeights = [.2, .4, .4];
    const sample: InteriorResponseSample = {id: 'single', at: sampleAt, weights: [.5, .1, .4]};
    const ratio = at[0] * at[1] * at[2] / (sampleAt[0] * sampleAt[1] * sampleAt[2]);
    const expected = at.map((v, i) => v + ratio * (sample.weights[i] - sampleAt[i])) as [number, number, number];
    close(evaluateTriangularResponseWeights(at, [], [sample]), expected);
    const unchanged: InteriorResponseSample = {...sample, weights: evaluateEdgeExtendedWeights(sampleAt, edges)};
    expect(evaluateTriangularResponseWeights(at, edges, [unchanged])).toEqual(evaluateEdgeExtendedWeights(at, edges));
  });

  it('retains the affine sum through large finite signed overshoot without clamping', () => {
    const sample: InteriorResponseSample = {id: 'overshoot', at: [.2, .3, .5], weights: [-1000, 2001, -1000]};
    const result = evaluateTriangularResponseWeights([.3, .3, .4], [], [sample]);
    expect(sum(result)).toBe(1); expect(result[0]).toBeLessThan(-1000); expect(result[1]).toBeGreaterThan(2000);
    expect(evaluateTriangularResponseWeights(sample.at, [], [sample])).toEqual(sample.weights);
  });

  it('updates by stable ID, rejects incompatible duplicate coordinates atomically, and stores only weights', () => {
    const before = JSON.stringify(samples), replacement: InteriorResponseSample = {...samples[0], weights: [.1, .2, .7]};
    const next = upsertInteriorResponseSample(samples, replacement);
    expect(next.length).toBe(samples.length); expect(next.find(s => s.id === 'a')?.weights).toEqual(replacement.weights);
    expect(JSON.stringify(samples)).toBe(before);
    expect(() => upsertInteriorResponseSample(samples, {...samples[0], id: 'different', weights: [.1, .2, .7]})).toThrow(/incompatible/);
    expect(JSON.stringify(samples)).toBe(before);
    expect(() => validateInteriorResponseSamples([{id: 'edge', at: [.5, .5, 0], weights: [1, 0, 0]}])).toThrow(/strictly inside/);
    expect(() => validateInteriorResponseSamples([samples[0], samples[0]])).toThrow(/unique/);
    expect(() => validateInteriorResponseSamples([{...samples[0], weights: [1, 1, 1]}])).toThrow(/sum/);
    const compatible = upsertInteriorResponseSample(samples, {...samples[0], id: 'equivalent'});
    expect(evaluateTriangularResponseWeights(samples[0].at, edges, compatible)).toEqual(samples[0].weights);
    expect(Object.keys(next[0]).sort()).toEqual(['at', 'id', 'weights']);
  });
});
