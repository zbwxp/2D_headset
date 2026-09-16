import { count, timed } from '../geometry/diagnostics';
import type { LandmarkProject } from '../landmarks/model';
import { getSmoothResult, installSmoothResult, solveKey } from './evaluation';
import type { ContinuityResult } from './solver';
let worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined;
let desired = '', pending: LandmarkProject | undefined, inflight: {
    key: string;
    p: LandmarkProject;
} | undefined;
function dispatch() {
    if (inflight || !pending)
        return;
    const p = pending, key = solveKey(p);
    pending = undefined;
    if (key !== desired)
        return;
    try {
        if (!worker) {
            worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
            worker.onmessage = (e: MessageEvent<ContinuityResult>) => { const job = inflight; inflight = undefined; if (job && job.key === desired)
                installSmoothResult(job.p, e.data); dispatch(); };
            worker.onerror = e => { const job = inflight; inflight = undefined; worker?.terminate(); worker = undefined; if (job && job.key === desired)
                failure(job.p, e.message || 'Smooth Worker 失败'); dispatch(); };
        }
        inflight = { key, p };
        const end = timed('workerInputPreparation');
        count('smoothDispatches');
        worker.postMessage({ ...p, views: [], meta: { name: 'smooth', createdAt: 0, updatedAt: 0 } });
        end();
    }
    catch (e) {
        inflight = undefined;
        failure(p, (e as Error).message);
    }
}
function failure(p: LandmarkProject, message: string) { installSmoothResult(p, { patches: Object.fromEntries((p.patches ?? []).filter(x => !x.canonicalId).map(x => [x.id, { iterations: 0, error: message }])), diagnostics: { angles: {}, warnings: [message] } }); }
export function ensureSmooth(p: LandmarkProject) {
    if (!p.patches?.length) {
        desired = '';
        pending = undefined;
        clearTimeout(timer);
        return;
    }
    const key = solveKey(p);
    if (key === desired)
        return;
    desired = key;
    pending = undefined;
    clearTimeout(timer);
    if (getSmoothResult(p))
        return;
    timer = setTimeout(() => { if (desired === key) {
        pending = p;
        dispatch();
    } }, 60);
}
