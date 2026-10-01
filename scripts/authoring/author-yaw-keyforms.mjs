/** Author real parameter keyforms with the public validated Recording API. */
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
const prefix = process.env.YAW_PREFIX ?? 'yaw';
const root = process.cwd(), out = path.resolve(root, process.env.CONTOUR_AUTHORING_DIR ?? 'artifacts/turning-demo'), server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
try {
    const load = p => server.ssrLoadModule('/src/' + p), { createVectorEditingApi } = await load('app/vectorEditingApi.ts'), { parseLandmarks } = await load('domain/landmarks/persistence.ts'), { serializeProject } = await load('app/autosave.ts'), { blendWarpGrids } = await load('domain/vectorWarp/model.ts');
    let project = parseLandmarks(fs.readFileSync(path.join(out, `${prefix}-rig-blueprint-project.json`), 'utf8')), past = [], future = [];
    const info = JSON.parse(fs.readFileSync(path.join(out, `${prefix}-rig-manifest.json`), 'utf8')), before = JSON.stringify(project.drawing), beforeArtworks = JSON.stringify(project.drawingSnapshots), log = [], api = createVectorEditingApi({ getState: () => ({ project, past, future }), getMode: () => 'recording', commitDrawing: () => { throw Error('Source write blocked'); }, commitRecording: r => { past.push(project); project = { ...project, vectorRecording: r }; future = []; }, undo: () => { if (past.length) {
            future.push(project);
            project = past.pop();
        } }, redo: () => { if (future.length) {
            past.push(project);
            project = future.pop();
        } } });
    const fitPath = path.join(out, process.env.YAW_FIT_NAME ?? `${prefix}-fitted90.json`), fits = fs.existsSync(fitPath) ? JSON.parse(fs.readFileSync(fitPath, 'utf8')) : null, entries = fits?.jobs ?? fits?.results ?? fits ?? [], fitted = Object.fromEntries(entries.map(j => [j.name, j.grid]));
    const affine = (grid, sx = 1, sy = 1, tx = 0, ty = 0) => ({ ...structuredClone(grid), nodes: grid.nodes.map(n => ({ position: [n.position[0] * sx + tx, n.position[1] * sy + ty], handleU: [n.handleU[0] * sx + tx, n.handleU[1] * sy + ty], handleV: [n.handleV[0] * sx + tx, n.handleV[1] * sy + ty], twist: [n.twist[0] * sx, n.twist[1] * sy] })) });
    const shift30 = info.manualFeaturePlacement ? .18 : .13, noseFitPath = path.join(out, 'yaw-nose30-fitted.json'), nose30 = info.manualFeaturePlacement && fs.existsSync(noseFitPath) ? JSON.parse(fs.readFileSync(noseFitPath, 'utf8')).jobs[0].grid : null;
    const profile30Path = path.join(out, 'yaw-profile30-fitted.json'), profile30 = info.profile30Correction ? JSON.parse(fs.readFileSync(profile30Path, 'utf8')).jobs[0].grid : null;
    const phase30 = (name, x) => { if (name === 'profile' && profile30)
        return blendWarpGrids([{ grid: info.grids.profile, weight: 1 - x / 30 }, { grid: profile30, weight: x / 30 }]); const f = x / 30, s = 1 - (name === 'rear' ? (info.manualFeaturePlacement ? .20 : .25) : (info.manualFeaturePlacement ? .50 : .4)) * f; return affine(info.grids[name], s, 1, info.chin[0] * (1 - s) + shift30 * f, 0); };
    const faceProgress = x => x <= 60 ? .55 * (x - 30) / 30 : .55 + .45 * (x - 60) / 30;
    const lerp = (a, b, t) => a + (b - a) * t, atKey = (x, values) => { const i = Math.min(2, Math.floor(x / 30)); return lerp(values[i], values[i + 1], (x - i * 30) / 30); }, centerX = name => { const b = info.grids[name].bounds; return (b.min[0] + b.max[0]) / 2; };
    function gridAt(name, x) {
        const rest = info.grids[name], t = x / 90;
        if (name === 'head')
            return rest;
        if (['rear', 'front', 'profile'].includes(name)) {
            if (x <= 30)
                return phase30(name, x);
            const progress = faceProgress(x);
            return blendWarpGrids([{ grid: phase30(name, 30), weight: 1 - progress }, { grid: fitted[name], weight: progress }]);
        }
        if (name === 'ear' || name === 'neck') {
            if (fitted[name])
                return blendWarpGrids([{ grid: rest, weight: 1 - t }, { grid: fitted[name], weight: t }]);
            return name === 'ear' ? affine(rest, 1 + .7 * t, 1, .9585632556987141 * t, 0) : rest;
        }
        if (name === 'eye')
            return info.manualFeaturePlacement ? affine(rest, atKey(x, [1, .96, .84, .72]), 1, atKey(x, [0, .175, .35, .5240613139441799]), 0) : affine(rest, lerp(1, .72, t), 1, .5240613139441799 * t, 0);
        if (name === 'iris') {
            const parentS = info.manualFeaturePlacement ? atKey(x, [1, .96, .84, .72]) : lerp(1, .72, t), parentT = info.manualFeaturePlacement ? atKey(x, [0, .175, .35, .5240613139441799]) : .5240613139441799 * t, s = info.manualFeaturePlacement ? atKey(x, [1, .85, .65, .47]) : lerp(1, .47, t);
            return affine(rest, s / parentS, 1, (.3983680788516792 * t - parentT) / parentS, 0);
        }
        if (name === 'brow')
            return info.manualFeaturePlacement ? affine(rest, atKey(x, [1, .95, .72, .5]), 1, atKey(x, [0, .165, .28, .39681371392289877]), 0) : affine(rest, lerp(1, .5, t), 1, .39681371392289877 * t, 0);
        if (name === 'mouth')
            return info.manualFeaturePlacement ? affine(rest, atKey(x, [1, .88, .66, .5]), 1, atKey(x, [0, .17094, .32468, .4499779371248022]), 0) : affine(rest, lerp(1, .5, t), 1, .4499779371248022 * t, 0);
        if (name === 'nose') {
            if (nose30) {
                if (x <= 30)
                    return blendWarpGrids([{ grid: rest, weight: 1 - x / 30 }, { grid: nose30, weight: x / 30 }]);
                const p = faceProgress(x);
                return affine(nose30, 1, 1, (info.targetChin[0] - info.chin[0] - shift30) * p, 0);
            }
            return affine(rest, 1, 1, (.31 - info.chin[0]) * t, 0);
        }
        if (name === 'farEye' || name === 'farEar') {
            if (info.refinedHandoff) {
                const c = centerX(name), values = info.farFeatureKeys?.[name] ?? (name === 'farEye' ? { s: [1, .55, .27, .18, .12], c: [c, -.09, -.10, .02, .18] } : { s: [1, .24, .16, .10, .08], c: [c, -.07, -.03, .02, .13] }), angles = values.angles ?? [0, 30, 45, 60, 90], i = Math.min(angles.length - 2, angles.findIndex((v, j) => j < angles.length - 1 && x >= v && x <= angles[j + 1])), q = (x - angles[i]) / (angles[i + 1] - angles[i]), s = lerp(values.s[i], values.s[i + 1], q), target = lerp(values.c[i], values.c[i + 1], q);
                return affine(rest, s, 1, target - s * c, 0);
            }
            if (info.manualFeaturePlacement) {
                const c = centerX(name), s = atKey(x, name === 'farEye' ? [1, .65, .22, .12] : [1, .35, .12, .08]), target = atKey(x, name === 'farEye' ? [c, -.03, .06, .18] : [c, .06, .08, .13]);
                return affine(rest, s, 1, target - s * c, 0);
            }
            const s = x <= 30 ? lerp(1, .75, x / 30) : x <= 60 ? lerp(.75, .18, (x - 30) / 30) : lerp(.18, .001, (x - 60) / 30), c = centerX(name), target = name === 'farEye' ? (info.farFeaturesParent ? c : .31) : (info.farFeaturesParent ? -.12 : .12);
            return affine(rest, s, 1, lerp(c, target, t) - s * c, 0);
        }
        throw Error(name);
    }
    const positions = info.positions, profileDirection = Math.sign(positions.newEnd - positions.newQ) || 1, noseNear = info.noseHintPositions ? (profileDirection > 0 ? Math.min(...info.noseHintPositions) : Math.max(...info.noseHintPositions)) : 0, noseFar = info.noseHintPositions ? (profileDirection > 0 ? Math.max(...info.noseHintPositions) : Math.min(...info.noseHintPositions)) : 0, noseOverlap = noseNear + profileDirection * .003, sorted = (a, b) => ({ start: Math.min(a, b), end: Math.max(a, b) }), angles = Object.keys(fitted).length ? (info.stagedHandoff ? [0, 15, 30, 45, 48, 50, 55, 60, 90] : info.cleanupHandoff ? [0, 15, 30, 45, 50, 55, 60, 90] : info.refinedHandoff ? [0, 15, 30, 45, 60, 90] : [0, 15, 30, 60, 90]) : [0, 15, 30];
    for (const x of angles) {
        const commands = [{ op: 'setAngle', angle: { x, y: 0 } }];
        for (const [name, id] of Object.entries(info.deformerIds)) {
            const grid = gridAt(name, x);
            commands.push({ op: 'editGridNodes', deformerId: id, moveHandles: false, edits: grid.nodes.map((n, index) => ({ index, ...n })) });
        }
        const chinT = x <= 30 ? shift30 * x / 30 : (shift30 + (info.targetChin[0] - info.chin[0] - shift30) * faceProgress(x)), chinTarget = [info.chin[0] + chinT, info.chin[1]];
        for (const name of ['rear', 'front', 'profile'])
            commands.push({ op: 'pinGridPoint', deformerId: info.deformerIds[name], sourcePoint: info.chin, targetPoint: chinTarget });
        const newProgress = Math.min(1, x / 15), oldProgress = Math.max(0, Math.min(1, (x - 15) / 15)), extend = Math.max(0, Math.min(1, (x - (info.gradualHandoff ? 45 : 30)) / (info.refinedHandoff ? 15 : 30))), sideEnd = info.cleanupHandoff ? (x <= 45 ? positions.newQ : x <= (info.stagedHandoff ? 48 : 50) ? lerp(positions.newQ, noseOverlap, (x - 45) / (info.stagedHandoff ? 3 : 5)) : lerp(noseOverlap, positions.newEnd, Math.min(1, (x - (info.stagedHandoff ? 48 : 50)) / (info.stagedHandoff ? 12 : 10)))) : lerp(positions.newQ, positions.newEnd, extend), oldEnd = info.refinedHandoff ? positions.oldQ : lerp(positions.oldQ, positions.oldEnd, extend);
        commands.push({ op: 'changePoseInterval', rangeId: info.revealRangeId, ...sorted(lerp(positions.newC, positions.newH, newProgress), lerp(positions.newC, sideEnd, newProgress)) }, { op: 'changePoseInterval', rangeId: info.frontHandoffRangeId, ...sorted(lerp(positions.oldC, positions.oldH, oldProgress), lerp(positions.oldC, oldEnd, oldProgress)) });
        if (info.noseHintRangeId) {
            const [a, b] = info.noseHintPositions, p = Math.max(0, Math.min(1, (x - 15) / 15));
            commands.push({ op: 'changePoseInterval', rangeId: info.noseHintRangeId, ...sorted(a, lerp(a, b, p)) });
        }
        if (info.upperWithdrawalRangeId)
            commands.push({ op: 'changePoseInterval', rangeId: info.upperWithdrawalRangeId, start: lerp(positions.oldEnd, positions.oldQ, info.cleanupHandoff ? Math.max(0, Math.min(1, (x - (info.stagedHandoff ? 48 : 45)) / (info.stagedHandoff ? 2 : 5))) : extend), end: positions.oldEnd });
        // Rear transfer cuts are always plain; only the exposed profile/cheek tip tapers.
        const sideOuter = positions.newQ > positions.newH ? 1 : 0, oldOuter = positions.oldQ > positions.oldH ? 1 : 0;
        commands.push({ op: 'setPoseIntervalEnd', rangeId: info.revealRangeId, end: sideOuter, style: { taperWidthScale: info.cleanupHandoff ? 20 * Math.max(0, Math.min(1, (sideEnd - noseFar) / (positions.newEnd - noseFar))) : 20 * extend, extension: 0 } }, { op: 'setPoseIntervalEnd', rangeId: info.frontHandoffRangeId, end: oldOuter, style: { taperWidthScale: info.refinedHandoff ? 0 : 20 * extend, extension: 0 } });
        for (const fade of info.fades) {
            const end = info.gradualHandoff ? (fade.layerName === '鼻部' ? Math.max(0, Math.min(1, (x - 15) / 15)) : fade.layerName === '左眉' ? Math.max(0, Math.min(1, (x - 45) / (info.cleanupHandoff ? 10 : 15))) : Math.max(0, Math.min(1, (x - 45) / 30))) : info.refinedHandoff ? (fade.layerName === '鼻部' ? Math.max(0, Math.min(1, (x - 30) / 15)) : Math.max(0, Math.min(1, (x - 30) / (info.farFadeEnd ? info.farFadeEnd - 30 : 30)))) : fade.layerName === '鼻部' ? (info.manualFeaturePlacement ? Math.max(0, Math.min(1, (x - 30) / 30)) : Math.min(1, x / 60)) : x <= 30 ? 0 : x <= 60 ? .3 * (x - 30) / 30 : .3 + .7 * (x - 60) / 30;
            commands.push({ op: 'changePoseInterval', rangeId: fade.rangeId, start: 0, end, fullLoop: fade.closed && end === 1 });
        }
        commands.push({ op: 'saveKeyform', name: x === 0 ? '正面 0°' : x === 15 ? '15° · 下巴覆盖接力' : x === 30 ? '30° · 同形交接完成' : x === 45 ? '45° · 轮廓接力修正' : x === 48 ? '48° · 新轮廓已连续覆盖' : x === 50 ? '50° · 旧颊线撤退' : x === 55 ? '55° · 远部件遮挡' : x === 60 ? '60° · 侧轮廓修正' : '右侧 90°' });
        const dry = api.recording({ commands, dryRun: true });
        if (!dry.ok)
            throw Error(JSON.stringify(dry));
        const result = api.recording({ commands });
        if (!result.ok)
            throw Error(JSON.stringify(result));
        log.push({ method: 'recording', request: { commands }, pinResults: result.value.pinResults });
    }
    const end = api.recording({ commands: [{ op: 'setAngle', angle: { x: 0, y: 0 } }] });
    if (!end.ok)
        throw Error(JSON.stringify(end));
    if (JSON.stringify(project.drawing) !== before || JSON.stringify(project.drawingSnapshots) !== beforeArtworks)
        throw Error('Recording mutated source/artwork');
    const checks = angles.map(x => { const result = api.previewRecording({ angle: { x, y: 0 }, showFills: false, width: 800, height: 800, center: [-.3294804514288924, -.05], pixelsPerUnit: 300 }); if (!result.ok)
        throw Error(JSON.stringify(result)); fs.writeFileSync(path.join(out, `${prefix}-${x}-ink.svg`), result.value.svg); return { angle: x, maxErrorPixels: result.value.maxErrorPixels, warningCurveIds: result.value.warningCurveIds, intervalTransportErrors: result.value.intervalTransportErrors, routeDiagnostics: result.value.routeDiagnostics, diagnostics: result.value.diagnostics }; });
    project.meta.name = Object.keys(fitted).length ? 'Contour · 0—90° 向右转头工作稿' : 'Contour · 早期轮廓交接工作稿';
    const filename = process.env.YAW_OUTPUT ?? (Object.keys(fitted).length ? `${prefix}-rig-first-pass-project.json` : `${prefix}-early-handoff-project.json`), text = serializeProject(project);
    parseLandmarks(text);
    fs.writeFileSync(path.join(out, filename), text);
    fs.writeFileSync(path.join(out, `${prefix}-rig-manifest.json`), JSON.stringify({ ...info, stage: 'AUTHORED_YAW_OFFLINE_REVIEW_BROWSER_PENDING', authoredAngles: angles }, null, 2));
    fs.writeFileSync(path.join(out, `${prefix}-keyform-api-recipe.json`), JSON.stringify(log, null, 2));
    fs.writeFileSync(path.join(out, process.env.YAW_CHECKS ?? `${prefix}-checks.json`), JSON.stringify({ authoredAngles: angles, checks }, null, 2));
    console.log(JSON.stringify({ filename, authoredAngles: angles, checks: checks.map(c => ({ x: c.angle, error: c.maxErrorPixels, warnings: c.warningCurveIds.length, intervals: c.intervalTransportErrors.length, routes: c.routeDiagnostics.length })) }, null, 2));
}
finally {
    await server.close();
}
