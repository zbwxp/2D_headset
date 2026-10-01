/** Final Drawing authoring pass: explicit paint order and material visibility controls. */
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
const root = process.cwd();
const out = path.resolve(root, process.env.CONTOUR_AUTHORING_DIR ?? 'artifacts/turning-demo');
const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
try {
    const load = p => server.ssrLoadModule('/src/' + p);
    const { createVectorEditingApi } = await load('app/vectorEditingApi.ts');
    const { parseLandmarks } = await load('domain/landmarks/persistence.ts');
    const { serializeProject } = await load('app/autosave.ts');
    const { displayField, displayPath } = await load('domain/drawing/displayIntervals.ts');
    const { createDisplayRouteField } = await load('domain/drawing/displayRoutes.ts');
    let project = parseLandmarks(fs.readFileSync(path.join(out, 'yaw-stable-rig-blueprint-project.json'), 'utf8'));
    let mode = 'drawing';
    const info = JSON.parse(fs.readFileSync(path.join(out, 'yaw-stable-rig-manifest.json'), 'utf8'));
    const source = project.drawing;
    const originalReferences = JSON.stringify(project.drawingSnapshots.items.filter(a => a.id !== info.sourceArtworkId));
    const api = createVectorEditingApi({ getState: () => ({ project, past: [], future: [] }), getMode: () => mode, commitDrawing: d => { project = { ...project, drawing: d }; }, commitArtwork: s => { project = { ...project, ...s }; }, commitRecording: r => { project = { ...project, vectorRecording: r }; }, undo: () => { }, redo: () => { } });
    const recipe = [];
    function execute(commands) {
        const dry = api.execute({ commands, dryRun: true });
        if (!dry.ok)
            throw Error(JSON.stringify(dry));
        const r = api.execute({ commands });
        if (!r.ok)
            throw Error(JSON.stringify(r));
        recipe.push({ method: 'execute', request: { commands }, result: r.value });
        return r.value;
    }
    const cap = source.curves.find(c => c.name === '颈部上缘封口');
    const capField = displayField(source, displayPath(source, cap.id));
    const parts = capField.parts.filter((p, i) => !capField.geometry.pieces[i].joinId && capField.geometry.pieces[i].owners.includes(cap.id));
    const capStart = Math.min(...parts.map(p => p.start)) / capField.total, capEnd = Math.max(...parts.map(p => p.start + p.length)) / capField.total;
    const profileFill = source.fills.find(f => source.layers.find(l => l.id === info.layerIds.profile).items.includes(f.id));
    const track = source.displayIntervals.find(t => t.ranges.some(r => r.id === info.revealRangeId));
    const routeField = createDisplayRouteField(source, track.displayRoute);
    const noseA = routeField.positionOf({ kind: 'curve', curveId: info.profileTargets[1].source, t: .25 });
    const noseB = routeField.positionOf({ kind: 'curve', curveId: info.profileTargets[2].source, t: .65 });
    if (!Number.isFinite(noseA) || !Number.isFinite(noseB))
        throw Error('Missing nose material coordinates');
    const result = execute([
        { op: 'createLayer', name: '侧脸白底 · 遮挡远侧', ref: 'occluder' },
        { op: 'movePaint', objectId: profileFill.id, layerId: '$occluder' },
        { op: 'reorderLayer', layerId: '$occluder', targetLayerId: source.layers.find(l => l.name === '左眼睑').id, after: false },
        ...['右眼睑', '右眼内结构', '右眉'].map(name => ({ op: 'reorderLayer', layerId: source.layers.find(l => l.name === name).id, targetLayerId: '$occluder', after: false })),
        { op: 'addDisplayInterval', curveId: cap.id, mode: 'HIDE', start: capStart, end: capEnd, ref: 'neckClosure' },
        { op: 'setDisplayIntervalEnd', rangeId: '$neckClosure', end: 0, style: { taper: 0, extension: 0 } },
        { op: 'setDisplayIntervalEnd', rangeId: '$neckClosure', end: 1, style: { taper: 0, extension: 0 } },
        { op: 'addDisplayInterval', curveId: info.frontParts.first, mode: 'HIDE', start: info.positions.oldEnd, end: info.positions.oldEnd, ref: 'upperWithdrawal' },
        { op: 'setDisplayIntervalEnd', rangeId: '$upperWithdrawal', end: 0, style: { taperWidthScale: 20, extension: 0 } },
        { op: 'setDisplayIntervalEnd', rangeId: '$upperWithdrawal', end: 1, style: { taper: 0, extension: 0 } },
        { op: 'addDisplayInterval', curveId: track.anchor.id, mode: 'SHOW', start: noseA, end: noseA, ref: 'noseHint' },
        { op: 'setDisplayIntervalEnd', rangeId: '$noseHint', end: 0, style: { taperWidthScale: 10, extension: 0 } },
        { op: 'setDisplayIntervalEnd', rangeId: '$noseHint', end: 1, style: { taperWidthScale: 10, extension: 0 } }
    ]);
    const refs = Object.fromEntries(result.created.filter(x => x.ref).map(x => [x.ref, x.id]));
    const current = project.drawing, occluderIndex = current.layers.findIndex(l => l.id === refs.occluder);
    const headLayers = [info.layerIds.rear, info.layerIds.profile, ...source.layers.filter(l => /面部·[左右]片/.test(l.name)).map(l => l.id)];
    execute(current.curves.filter(c => current.layers.some(l => headLayers.includes(l.id) && l.items.includes(c.id))).map(c => ({ op: 'setDepth', curveId: c.id, offset: current.layers.findIndex(l => l.items.includes(c.id)) - occluderIndex, scope: 'LAYER' })));
    const save = api.artwork({ op: 'save', artworkId: info.sourceArtworkId, name: '转头 · 0—90° 参数工作稿' });
    if (!save.ok)
        throw Error(JSON.stringify(save));
    mode = 'recording';
    const commands = [{ op: 'acceptSource' }, { op: 'bindLayers', layerIds: [refs.occluder], deformerId: info.deformerIds.profile }];
    const r = api.recording({ commands });
    if (!r.ok)
        throw Error(JSON.stringify(r));
    recipe.push({ method: 'recording', request: { commands } });
    const geometry = d => ({ nodes: d.nodes, curves: d.curves.map(c => ({ id: c.id, nodes: c.nodes, handles: c.handles, width: c.width })) });
    if (JSON.stringify(geometry(project.drawing)) !== JSON.stringify(geometry(source)) || JSON.stringify(project.drawing.fills) !== JSON.stringify(source.fills))
        throw Error('Unexpected geometry/fill mutation');
    if (JSON.stringify(project.drawingSnapshots.items.filter(a => a.id !== info.sourceArtworkId)) !== originalReferences)
        throw Error('Original reference changed');
    const center = name => (info.grids[name].bounds.min[0] + info.grids[name].bounds.max[0]) / 2;
    const final = { ...info, stage: 'AUTHORING_BLUEPRINT_NOT_YET_KEYED', manualFeaturePlacement: true, profile30Correction: true, refinedHandoff: true, gradualHandoff: true, cleanupHandoff: true, stagedHandoff: true, occluderLayerId: refs.occluder, neckClosureRangeId: refs.neckClosure, upperWithdrawalRangeId: refs.upperWithdrawal, noseHintRangeId: refs.noseHint, noseHintPositions: [noseA, noseB], farFeatureKeys: { farEye: { angles: [0, 30, 45, 55, 60, 90], s: [1, .6, .4, .16, .12, .10], c: [center('farEye'), .03, .08, .047, .078, .224] }, farEar: { s: [1, .24, .16, .10, .08], c: [center('farEar'), -.07, -.06, .02, .13] } }, sourceFrozenJSON: JSON.stringify(project.drawing), notes: ['One vector source, with explicit Q/chin POSITION links and shared rear-jaw grids.', 'The original reference snapshots are preserved.', 'Copied rear controls have no persistent source-edit synchronization relation.', 'Positive yaw is authored; negative yaw and pitch anchor keys stay neutral.'] };
    fs.writeFileSync(path.join(out, 'yaw-final-rig-blueprint-project.json'), serializeProject(project));
    fs.writeFileSync(path.join(out, 'yaw-final-rig-manifest.json'), JSON.stringify(final, null, 2));
    fs.writeFileSync(path.join(out, 'yaw-final-source-api-recipe.json'), JSON.stringify(recipe, null, 2));
    const curve = project.drawing.curves.find(c => c.name === '鼻尖短线'), node = id => project.drawing.nodes.find(n => n.id === id).position;
    const noseJob = { name: 'nose30', grid: info.grids.nose, curvePairs: [{ sourceId: curve.id, source: [node(curve.nodes[0]), ...curve.handles, node(curve.nodes[1])], target: [[-.13, .11], [-.13, .08], [-.07, .055], [-.095, .043]] }], pins: [], options: { samplesPerCurve: 65, regularization: 1e-7, endpointTangentWeight: .01 } };
    fs.writeFileSync(path.join(out, 'yaw-nose30-fit-jobs.json'), JSON.stringify({ jobs: [noseJob] }, null, 2));
    console.log({ output: 'yaw-final-rig-blueprint-project.json', controls: refs });
}
finally {
    await server.close();
}
