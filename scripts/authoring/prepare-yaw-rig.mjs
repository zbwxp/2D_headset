/** Prepare source-only visibility controls and a real, bound rig through contourAI.
 * This writes a separate draft artifact. Original reference snapshots stay intact. */
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
const prefix = process.env.YAW_PREFIX ?? 'yaw';
const root = process.cwd(), out = path.resolve(root, process.env.CONTOUR_AUTHORING_DIR ?? 'artifacts/turning-demo'), server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
try {
    const load = p => server.ssrLoadModule('/src/' + p), { createVectorEditingApi } = await load('app/vectorEditingApi.ts'), { parseLandmarks } = await load('domain/landmarks/persistence.ts'), { serializeProject } = await load('app/autosave.ts'), { shapeOf, nodeAt } = await load('domain/drawing/model.ts'), { subcurve } = await load('domain/drawing/roundedJoin.ts'), { displayPath } = await load('domain/drawing/displayIntervals.ts'), { createDisplayRouteField } = await load('domain/drawing/displayRoutes.ts');
    let project = parseLandmarks(fs.readFileSync(path.join(out, `${prefix}-source-project.json`), 'utf8')), mode = 'drawing', past = [], future = [];
    const manifest = JSON.parse(fs.readFileSync(path.join(out, `${prefix}-source-manifest.json`), 'utf8')), side = JSON.parse(fs.readFileSync('src/assets/right90-reference.json', 'utf8')), initialRefs = JSON.stringify(project.drawingSnapshots.items.filter(a => a.id !== manifest.sourceArtworkId));
    const api = createVectorEditingApi({ getState: () => ({ project, past, future }), getMode: () => mode, commitDrawing: d => { past.push(project); project = { ...project, drawing: d }; future = []; }, commitArtwork: s => { past.push(project); project = { ...project, ...s }; future = []; }, commitRecording: r => { past.push(project); project = { ...project, vectorRecording: r }; future = []; }, undo: () => { if (past.length) {
            future.push(project);
            project = past.pop();
        } }, redo: () => { if (future.length) {
            past.push(project);
            project = future.pop();
        } } });
    const batches = [], run = (method, commands) => { const dry = api[method]({ commands, dryRun: true }); if (!dry.ok)
        throw Error(JSON.stringify(dry)); const r = api[method]({ commands }); if (!r.ok)
        throw Error(JSON.stringify(r)); batches.push({ method, request: { commands }, result: r.value }); return r.value; };
    let source = project.drawing;
    const layer = name => source.layers.find(l => l.name === name).id, oldRoute = source.displayIntervals.find(t => t.id === manifest.routeTrackIds[0]).displayRoute, newRoute = source.displayIntervals.find(t => t.id === manifest.routeTrackIds[1]).displayRoute, oldField = createDisplayRouteField(source, oldRoute), newField = createDisplayRouteField(source, newRoute), oldJoin = oldField.geometry.pieces.find(p => p.joinId).joinId, newJoin = newField.geometry.pieces.find(p => p.joinId).joinId;
    const positions = { oldH: oldField.positionOf({ kind: 'curve', curveId: manifest.transfer.original, t: manifest.transfer.t }), newH: newField.positionOf({ kind: 'curve', curveId: manifest.transfer.copy, t: manifest.transfer.t }), oldC: oldField.positionOf({ kind: 'join', joinId: oldJoin, s: .5 }), newC: newField.positionOf({ kind: 'join', joinId: newJoin, s: .5 }), oldQ: oldField.positionOf({ kind: 'curve', curveId: manifest.materialPairs[0].original, t: manifest.materialPairs[0].sourceRange[0] }), newQ: newField.positionOf({ kind: 'curve', curveId: manifest.materialPairs[0].copy, t: 0 }), oldEnd: oldField.positionOf({ kind: 'curve', curveId: manifest.frontParts?.first ?? manifest.materialPairs[0].original, t: 0 }), newEnd: newField.positionOf({ kind: 'curve', curveId: manifest.profileTargets[0].source, t: 0 }) };
    if (Object.values(positions).some(v => v === null || !Number.isFinite(v)))
        throw Error('Missing material anchor');
    const commands = [{ op: 'changeDisplayInterval', rangeId: manifest.revealRangeId, start: positions.newC, end: positions.newC }, { op: 'addDisplayInterval', curveId: manifest.transfer.original, mode: 'HIDE', start: positions.oldC, end: positions.oldC, ref: 'frontHandoff' }, { op: 'setDepth', curveId: manifest.transfer.copy, offset: 3, scope: 'LAYER' }, ...manifest.profileTargets.map(p => ({ op: 'setDepth', curveId: p.source, offset: 2, scope: 'LAYER' }))];
    const fadingLayers = ['左眼睑', '左眼内结构', '左眉', '左耳', '鼻部'], seen = new Set(), fades = [];
    for (const name of fadingLayers) {
        const l = source.layers.find(l => l.name === name);
        for (const id of l.items) {
            const curve = source.curves.find(c => c.id === id);
            if (!curve || !curve.visible || curve.inkVisible === false)
                continue;
            const p = displayPath(source, id), key = p.segments.map(u => u.id).sort().join('|');
            if (seen.has(key))
                continue;
            seen.add(key);
            const ref = 'fade' + fades.length;
            fades.push({ ref, layerName: name, curveId: id, closed: p.closed });
            commands.push({ op: 'addDisplayInterval', curveId: id, mode: 'HIDE', start: 0, end: 0, ref });
        }
    }
    const sourceResult = run('execute', commands), refs = Object.fromEntries(sourceResult.created.filter(x => x.ref).map(x => [x.ref, x.id]));
    run('execute', [{ op: 'setDisplayIntervalEnd', rangeId: refs.frontHandoff, end: 0, style: { taper: 0, extension: 0 } }, { op: 'setDisplayIntervalEnd', rangeId: refs.frontHandoff, end: 1, style: { taper: 0, extension: 0 } }]);
    for (const f of fades)
        f.rangeId = refs[f.ref];
    const save = api.artwork({ op: 'save', artworkId: manifest.sourceArtworkId, name: '转头源·固定侧部件' });
    if (!save.ok)
        throw Error(JSON.stringify(save));
    source = project.drawing;
    mode = 'recording';
    const nonNeck = source.layers.filter(l => l.name !== '颈部与衣领').map(l => l.id), create = [{ op: 'ensureRig' }, { op: 'createDeformer', layerIds: nonNeck, name: '头部 · 公共父域', rows: 2, columns: 2, ref: 'head' },
        { op: 'createDeformer', layerIds: [layer('面部·右片'), manifest.layerIds.rear], parentId: '$head', name: '后下颌 · 原段与同形副本', rows: 6, columns: 4, ref: 'rear' },
        { op: 'createDeformer', layerIds: [layer('面部·左片')], parentId: '$head', name: '前脸底形 · 转侧收回', rows: 6, columns: 4, ref: 'front' },
        { op: 'createDeformer', layerIds: [manifest.layerIds.profile], parentId: '$head', name: '额鼻唇颏 · 侧轮廓', rows: manifest.profileGrid?.rows ?? 8, columns: manifest.profileGrid?.columns ?? 5, ref: 'profile' },
        { op: 'createDeformer', layerIds: [layer('右眼睑')], parentId: '$head', name: '近侧眼睑', rows: 2, columns: 2, ref: 'eye' },
        { op: 'createDeformer', layerIds: [layer('右眼内结构')], parentId: '$eye', name: '近侧虹膜 · 眼睑子域', rows: 2, columns: 2, ref: 'iris' },
        { op: 'createDeformer', layerIds: [layer('右眉')], parentId: '$head', name: '近侧眉', rows: 2, columns: 2, ref: 'brow' },
        { op: 'createDeformer', layerIds: [layer('左眼睑'), layer('左眼内结构'), layer('左眉')], parentId: '$head', name: '远侧眼眉 · 连续收窄', rows: 2, columns: 2, ref: 'farEye' },
        { op: 'createDeformer', layerIds: [layer('右耳')], parentId: '$head', name: '近侧耳', rows: 5, columns: 5, ref: 'ear' },
        { op: 'createDeformer', layerIds: [layer('左耳')], parentId: '$head', name: '远侧耳 · 遮挡收回', rows: 2, columns: 2, ref: 'farEar' },
        { op: 'createDeformer', layerIds: [layer('嘴部')], parentId: '$head', name: '嘴线', rows: 2, columns: 2, ref: 'mouth' },
        { op: 'createDeformer', layerIds: [layer('鼻部')], parentId: '$head', name: '正面鼻线 · 区间收回', rows: 2, columns: 2, ref: 'nose' },
        { op: 'createDeformer', layerIds: [layer('颈部与衣领')], name: '颈部与衣领 · 独立域', rows: 6, columns: 6, ref: 'neck' }];
    const rigResult = run('recording', create), deformerIds = Object.fromEntries(rigResult.created.filter(x => x.ref).map(x => [x.ref, x.id])), rig = project.vectorRecording.rigs.find(r => r.artworkId === manifest.sourceArtworkId), chin = nodeAt(source, { curveId: manifest.transfer.original, end: 1 }).position, targetChin = nodeAt(side, { curveId: manifest.transfer.originalMaterial?.curveId ?? manifest.transfer.original, end: 1 }).position, grids = Object.fromEntries(Object.entries(deformerIds).map(([name, id]) => [name, rig.deformers.find(d => d.id === id).grid]));
    const sourceIds = name => source.layers.filter(l => l.name === name).flatMap(l => l.items).filter(id => source.curves.some(c => c.id === id)), targetFor = id => { const copy = manifest.copyPairs.find(p => p.original === id); if (copy?.reference)
        return subcurve(shapeOf(side, copy.reference), ...copy.referenceRange); if (id === manifest.frontParts?.last)
        return shapeOf(side, manifest.profileTargets.at(-1).reference); return shapeOf(side, id); }, pairs = ids => ids.map(id => ({ sourceId: id, referenceId: id, source: shapeOf(source, id), target: targetFor(id) }));
    const rear = pairs(manifest.copyPairs.map(p => p.original)), front = pairs(sourceIds('面部·左片'));
    const frontJaw = front.find(p => p.sourceId === (manifest.frontParts?.first ?? manifest.materialPairs[0].original)), forehead = shapeOf(side, manifest.profileTargets[0].reference)[0], lastTarget = shapeOf(side, manifest.profileTargets.at(-1).reference), qTarget = lastTarget[0];
    frontJaw.target = manifest.frontParts ? [forehead, [forehead[0] - .03, .15], [qTarget[0] - (lastTarget[1][0] - qTarget[0]) * .65 / .35, qTarget[1] - (lastTarget[1][1] - qTarget[1]) * .65 / .35], qTarget] : [forehead, [forehead[0] - .03, .15], [targetChin[0] - .10, targetChin[1] + .10], targetChin];
    const profile = manifest.profileTargets.map(p => ({ sourceId: p.source, referenceId: p.reference, source: shapeOf(source, p.source), target: shapeOf(side, p.reference) }));
    profile.push({ sourceId: manifest.closureCurveId, source: shapeOf(source, manifest.closureCurveId), target: [targetChin, [targetChin[0] - .22, targetChin[1] + .18], [forehead[0] - .25, forehead[1] - .1], forehead] });
    const jobs = Object.entries({ rear, front, profile, ear: pairs(sourceIds('右耳')), neck: pairs(sourceIds('颈部与衣领')) }).map(([name, curvePairs]) => ({ name, grid: grids[name], curvePairs, pins: ['rear', 'front', 'profile'].includes(name) ? [{ sourcePoint: chin, targetPoint: targetChin }, ...(manifest.qSourcePoint && ['front', 'profile'].includes(name) ? [{ sourcePoint: manifest.qSourcePoint, targetPoint: qTarget }] : [])] : [], options: { samplesPerCurve: 65, regularization: 1e-7, ...(name === 'profile' ? { endpointTangentWeight: .01 } : name === 'front' ? { endpointTangentWeight: .1 } : {}) } }));
    const info = { ...manifest, stage: 'RIG_BINDINGS_ONLY_NOT_A_FINISHED_TURN', rigId: rig.id, deformerIds, positions, frontHandoffRangeId: refs.frontHandoff, fades, chin, targetChin, qTarget: manifest.qSourcePoint ? qTarget : undefined, jobsFile: `${prefix}-fit-jobs.json`, grids, sourceFrozenJSON: JSON.stringify(source) };
    fs.writeFileSync(path.join(out, `${prefix}-rig-blueprint-project.json`), serializeProject(project));
    fs.writeFileSync(path.join(out, `${prefix}-rig-manifest.json`), JSON.stringify(info, null, 2));
    fs.writeFileSync(path.join(out, `${prefix}-fit-jobs.json`), JSON.stringify({ jobs }, null, 2));
    fs.writeFileSync(path.join(out, `${prefix}-rig-setup-api-recipe.json`), JSON.stringify(batches, null, 2));
    if (JSON.stringify(project.drawingSnapshots.items.filter(a => a.id !== manifest.sourceArtworkId)) !== initialRefs)
        throw Error('Reference snapshots changed');
    console.log(JSON.stringify({ rigId: rig.id, deformerIds, positions, fades: fades.length, jobs: jobs.map(j => [j.name, j.curvePairs.length]) }, null, 2));
}
finally {
    await server.close();
}
