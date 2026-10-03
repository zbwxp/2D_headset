/** Scalar response math only. Geometry, membership and visibility must continue
 * to use the ORIGINAL geometric barycentric coordinates, never these responses. */
export type BarycentricWeights = readonly [number, number, number];
export type TriangleScalarCoordinates = readonly [number, number, number];
export type TriangleVertexIndex = 0 | 1 | 2;
export type ScalarResponseKnot = readonly [number, number];

/** One shared response, oriented from `from` (0) to `to` (1). */
export interface OrientedEdgeResponse {
  from: TriangleVertexIndex;
  to: TriangleVertexIndex;
  knots?: readonly ScalarResponseKnot[];
}

/** A recorder-field constraint, not another geometric/topological vertex. */
export interface InteriorResponseSample {
  id: string;
  at: BarycentricWeights;
  weights: BarycentricWeights;
}

export interface BarycentricInverseConditioning {
  supportSize: number;
  coordinateScale: number;
  /** Active scalar range / max(1, |active coordinates|). */
  relativeSpread: number;
  /** Squared norm after centering and dividing by coordinateScale. */
  centeredSquaredNorm: number;
  minimumRelativeSpread: number;
}

export type BarycentricInverseResult =
  | {available: true; weights: BarycentricWeights; conditioning: BarycentricInverseConditioning}
  | {available: false; reason: string; conditioning?: BarycentricInverseConditioning};

const indices = [0, 1, 2] as const;
const tolerance = 64 * Number.EPSILON;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const same = (a: BarycentricWeights, b: BarycentricWeights) => indices.every(i => a[i] === b[i]);
const copy = (weights: BarycentricWeights): [number, number, number] => [...weights];

function validateWeights(weights: BarycentricWeights, geometric: boolean): void {
  if (!Array.isArray(weights) || weights.length !== 3 || !weights.every(Number.isFinite) ||
      Math.abs(sum(weights) - 1) > tolerance || geometric && weights.some(w => w < 0 || w > 1)) {
    throw Error(geometric ? 'Geometric barycentric coordinates must be finite, nonnegative and sum to one.' :
      'Scalar response weights must be finite and sum to one; signed weights are allowed.');
  }
}

/** Floating evaluation of zero-sum corrections can lose a few ulps when
 * responses overshoot. Complete one PRESENT coordinate from the affine
 * constraint; this never introduces an absent boundary coordinate. */
function finishWeights(weights: [number, number, number], original: BarycentricWeights): BarycentricWeights {
  if (sum(weights) !== 1) {
    const last = [...indices].reverse().find(i => original[i] !== 0)!;
    weights[last] = 1 - sum(indices.filter(i => i !== last).map(i => weights[i]));
  }
  validateWeights(weights, false);
  return weights;
}

function validateEdges(edges: readonly OrientedEdgeResponse[]): void {
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!indices.includes(edge.from) || !indices.includes(edge.to) || edge.from === edge.to) {
      throw Error('A scalar edge response needs two distinct triangle vertices.');
    }
    const key = [edge.from, edge.to].sort().join(':');
    if (seen.has(key)) throw Error('A shared edge may have only one scalar response.');
    seen.add(key);
    for (const [index, knot] of (edge.knots ?? []).entries()) {
      if (!Array.isArray(knot) || knot.length !== 2 || !knot.every(Number.isFinite) ||
          knot[0] <= 0 || knot[0] >= 1 || index > 0 && knot[0] <= edge.knots![index - 1][0]) {
        throw Error('Edge response knots need finite values and strictly increasing interior progress.');
      }
    }
  }
}

/** Piecewise linear, exactly pinned 0/1 endpoints, with no response clamp. */
function edgeResponse(knots: readonly ScalarResponseKnot[] | undefined, t: number): number {
  if (t === 0 || t === 1) return t;
  let left: ScalarResponseKnot = [0, 0];
  for (const right of knots ?? []) {
    if (t <= right[0]) {
      const u = (t - left[0]) / (right[0] - left[0]);
      return (1 - u) * left[1] + u * right[1];
    }
    left = right;
  }
  const u = (t - left[0]) / (1 - left[0]);
  return (1 - u) * left[1] + u;
}

function edgeExtendedWeights(original: BarycentricWeights, edges: readonly OrientedEdgeResponse[]): [number, number, number] {
  const result = copy(original);
  for (const {from, to, knots} of edges) {
    const s = original[from] + original[to];
    if (s === 0) continue;
    const t = original[to] / s;
    const correction = s * (edgeResponse(knots, t) - t);
    result[from] -= correction;
    result[to] += correction;
  }
  finishWeights(result, original);
  return result;
}

/** Add s*(w(t)-t)*(e_to-e_from) for every edge, using original λ throughout.
 * On an edge all other corrections vanish exactly. At the opposite vertex
 * s=0, so the bounded edge function has a continuous zero extension. */
export function evaluateEdgeExtendedWeights(original: BarycentricWeights, edges: readonly OrientedEdgeResponse[] = []): BarycentricWeights {
  validateWeights(original, true);
  validateEdges(edges);
  return edgeExtendedWeights(original, edges);
}

/** Euclidean projection of ORIGINAL λ, independently for each scalar X or Y:
 * w = λ + (q - p·λ) * (p - mean(p)) / ||p - mean(p)||².
 * Only the original nonzero support is free: edges reduce to the two-point
 * inverse, and a vertex has no correction degree of freedom. No epsilon ever
 * changes support. Scaling diagnoses unavailable coordinates without inventing
 * a denominator; unchanged coordinates remain legal even at a singular basis. */
export function solveClosestBarycentricWeights(original: BarycentricWeights, coordinates: TriangleScalarCoordinates, target: number): BarycentricInverseResult {
  try { validateWeights(original, true); } catch (error) {
    return {available: false, reason: error instanceof Error ? error.message : String(error)};
  }
  if (!Array.isArray(coordinates) || coordinates.length !== 3 || !coordinates.every(Number.isFinite) || !Number.isFinite(target)) {
    return {available: false, reason: 'Scalar coordinates and target must be finite.'};
  }
  const active = indices.filter(i => original[i] !== 0);
  const scale = Math.max(1, ...active.map(i => Math.abs(coordinates[i])));
  // Subtract an active origin before centering to avoid a large common offset.
  const origin = coordinates[active[0]];
  const offsets = active.map(i => {
    const delta = coordinates[i] - origin;
    return Number.isFinite(delta) ? delta / scale : coordinates[i] / scale - origin / scale;
  });
  const mean = sum(offsets) / active.length;
  const centered = offsets.map(p => p - mean);
  const norm = sum(centered.map(p => p * p));
  const conditioning: BarycentricInverseConditioning = {
    supportSize: active.length, coordinateScale: scale,
    relativeSpread: Math.max(...offsets) - Math.min(...offsets),
    centeredSquaredNorm: norm, minimumRelativeSpread: tolerance,
  };
  const baseline = sum(indices.map(i => original[i] * coordinates[i]));
  if (target === baseline) return {available: true, weights: copy(original), conditioning};
  if (active.length === 1) return {available: false, reason: 'A real triangle vertex has no scalar correction degree of freedom; edit its snapshot basis.', conditioning};
  if (conditioning.relativeSpread <= tolerance || norm === 0) {
    return {available: false, reason: 'The active vertex coordinate deltas are zero or numerically indistinguishable from zero; edit the snapshot basis to enable this scalar axis.', conditioning};
  }
  const delta = target - baseline;
  const scaledDelta = Number.isFinite(delta) ? delta / scale : target / scale - baseline / scale;
  const factor = scaledDelta / norm;
  const weights = copy(original);
  active.forEach((i, j) => { weights[i] += factor * centered[j]; });
  // Constrain the sum explicitly without introducing an absent vertex.
  const last = active[active.length - 1];
  weights[last] = 1 - sum(indices.filter(i => i !== last).map(i => weights[i]));
  const reproduced = sum(indices.map(i => weights[i] * coordinates[i]));
  if (!weights.every(Number.isFinite) || !Number.isFinite(reproduced) ||
      Math.abs(sum(weights) - 1) > tolerance ||
      Math.abs(reproduced - target) > 256 * Number.EPSILON * Math.max(1, Math.abs(target), Math.abs(baseline))) {
    return {available: false, reason: 'The inverse scalar response cannot be represented with finite, sufficiently accurate weights.', conditioning};
  }
  return {available: true, weights, conditioning};
}

export function validateInteriorResponseSamples(samples: readonly InteriorResponseSample[]): void {
  const ids = new Set<string>();
  const locations = new Map<string, BarycentricWeights>();
  for (const sample of samples) {
    if (!sample || typeof sample.id !== 'string' || !sample.id || ids.has(sample.id)) {
      throw Error('Interior response sample IDs must be nonempty and unique.');
    }
    ids.add(sample.id);
    validateWeights(sample.at, true);
    if (sample.at.some(w => w === 0)) throw Error('Interior response samples must be strictly inside the triangle; edges use their shared response.');
    validateWeights(sample.weights, false);
    const key = sample.at.join(','), existing = locations.get(key);
    if (existing && !same(existing, sample.weights)) {
      throw Error('Interior response samples at the same coordinates have incompatible weights.');
    }
    locations.set(key, sample.weights);
  }
}

/** Pure, atomic replacement by stable ID. Incompatible equal-location samples
 * fail before returning a replacement; inputs and prior constraints are intact. */
export function upsertInteriorResponseSample(samples: readonly InteriorResponseSample[], sample: InteriorResponseSample): InteriorResponseSample[] {
  validateInteriorResponseSamples(samples);
  const next = samples.filter(existing => existing.id !== sample.id);
  next.push({id: sample.id, at: copy(sample.at), weights: copy(sample.weights)});
  next.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  validateInteriorResponseSamples(next);
  return next;
}

/** Deterministic, globally supported C0 field (C1 is not guaranteed):
 * F(λ)=E(λ)+b(λ) Σ α_k(λ) [w_k-E(λ_k)]/b(λ_k),
 * b=27λ0λ1λ2, α_k proportional to 1/||λ-λ_k||².
 * The bubble pins every boundary to its sole shared edge response. Exact
 * sample matching precedes distances; scaled inverse distances avoid overflow.
 * Residual WEIGHTS are transient; persisted samples never contain geometry.
 * Nearby constraints can create steep variation, with no smoothing/clamping. */
export function evaluateTriangularResponseWeights(original: BarycentricWeights, edges: readonly OrientedEdgeResponse[] = [], samples: readonly InteriorResponseSample[] = []): BarycentricWeights {
  return prepareTriangularResponse(edges, samples)(original);
}

export type PreparedTriangularResponse = (original: BarycentricWeights) => BarycentricWeights;

/** Compile once per scalar field, then reuse across geometry and ghost samples.
 * Validation, canonical order, sample edge bases and bubble logs are computed
 * once. Owned copies isolate the sampler from later authoring mutations. */
export function prepareTriangularResponse(edges: readonly OrientedEdgeResponse[] = [], samples: readonly InteriorResponseSample[] = []): PreparedTriangularResponse {
  validateEdges(edges);
  validateInteriorResponseSamples(samples);
  const ownedEdges: OrientedEdgeResponse[] = edges.map(edge => ({...edge, knots: edge.knots?.map(knot => [...knot])}));
  const ordered = [...samples].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(sample => {
    const base = edgeExtendedWeights(sample.at, ownedEdges);
    return {at: copy(sample.at), weights: copy(sample.weights), logBubble: sum(sample.at.map(w => Math.log(w))),
      difference: indices.map(i => sample.weights[i] - base[i])};
  });
  return original => {
    validateWeights(original, true);
    const result = edgeExtendedWeights(original, ownedEdges);
    if (!ordered.length || original.some(w => w === 0)) return result;
    const exact = ordered.find(sample => same(original, sample.at));
    if (exact) return copy(exact.weights);
    const distances = ordered.map(sample => Math.hypot(...indices.map(i => original[i] - sample.at[i])));
    const nearest = Math.min(...distances);
    const total = sum(distances.map(distance => (nearest / distance) ** 2));
    const logBubble = sum(original.map(w => Math.log(w))); // common factor 27 cancels
    ordered.forEach((sample, index) => {
      // Log ratios avoid under/overflow in tiny but strictly nonzero bubbles.
      const logFactor = 2 * (Math.log(nearest) - Math.log(distances[index])) - Math.log(total) +
        logBubble - sample.logBubble;
      indices.forEach(i => {
        const difference = sample.difference[i];
        if (difference !== 0) result[i] += Math.sign(difference) * Math.exp(logFactor + Math.log(Math.abs(difference)));
      });
    });
    return finishWeights(result, original);
  };
}
