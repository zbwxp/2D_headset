import type { LandmarkProject } from '../landmarks/model';
import { getSmoothResult, installSmoothResult, notifySmooth, solveKey } from './evaluation';
import type { SmoothResult } from './field';
let worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined, current = '';
export function ensureSmooth(p: LandmarkProject) {
    if (!p.surfaceSmooth?.enabled || p.surfaceSmooth.strength === 0) {
        if (current) {
            clearTimeout(timer);
            worker?.terminate();
            worker = undefined;
            current = '';
            notifySmooth();
        }
        return;
    }
    const key = solveKey(p);
    if (getSmoothResult(p) || current === key)
        return;
    clearTimeout(timer);
    worker?.terminate();
    worker = undefined;
    current = key;
    notifySmooth();
    timer = setTimeout(() => {
        if (current !== key)
            return;
        const failure = (message: string) => installSmoothResult(p, { fields: {}, diagnostics: { before: 0, after: 0, maxDisplacement: 0, averageDisplacement: 0, iterations: 0, relativeResidual: 0, variables: 0, seamSamples: 0, warnings: [] }, error: message });
        try {
            worker = new Worker(new URL('./smooth.worker.ts', import.meta.url), { type: 'module' });
            worker.onmessage = (e: MessageEvent<SmoothResult>) => { if (current !== key)
                return; current = ''; worker?.terminate(); worker = undefined; installSmoothResult(p, e.data); };
            worker.onerror = e => { if (current !== key)
                return; current = ''; worker?.terminate(); worker = undefined; failure(e.message || 'Smooth Worker 失败'); };
            worker.postMessage({ ...p, views: [], meta: { name: 'smooth', createdAt: 0, updatedAt: 0 } });
        }
        catch (e) {
            current = '';
            failure((e as Error).message);
        }
    }, 60);
}
