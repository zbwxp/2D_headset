import type { LandmarkProject } from '../landmarks/model';
import type { SmoothResult } from './field';
const keys = new WeakMap<LandmarkProject, string>();
const results = new Map<string, {
    result: SmoothResult;
    token: number;
}>();
let serial = 0, version = 0;
const listeners = new Set<() => void>();
export const subscribeSmooth = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const smoothVersion = () => version;
export const notifySmooth = () => { version++; listeners.forEach(fn => fn()); };
export function solveKey(p: LandmarkProject) {
    let key = keys.get(p);
    if (!key) {
        key = JSON.stringify({ landmarks: p.landmarks.map(l => [l.id, l.type, l.position, l.mirrorPartnerId]), curves: p.curves, patches: p.patches ?? [], overrides: p.surfaceSmooth?.edgeInfluenceOverrides ?? {} });
        keys.set(p, key);
    }
    return key;
}
export function installSmoothResult(p: LandmarkProject, result: SmoothResult) { const key = solveKey(p); results.set(key, { result, token: ++serial }); if (results.size > 6)
    results.delete(results.keys().next().value!); notifySmooth(); }
export function getSmoothResult(p: LandmarkProject) { return results.get(solveKey(p))?.result; }
export function evaluationToken(p: LandmarkProject) { return !p.surfaceSmooth?.enabled || p.surfaceSmooth.strength === 0 ? 'base' : (results.get(solveKey(p))?.token ?? 'pending') + ':' + p.surfaceSmooth.strength; }
