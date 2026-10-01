/** Explicit Drawing topology refinement in the NEW turn source only. */
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
const root = process.cwd(), out = path.resolve(root, process.env.CONTOUR_AUTHORING_DIR ?? 'artifacts/turning-demo'), server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
try {
    const load = p => server.ssrLoadModule('/src/' + p), { createVectorEditingApi } = await load('app/vectorEditingApi.ts'), { parseLandmarks } = await load('domain/landmarks/persistence.ts'), { serializeProject } = await load('app/autosave.ts'), { shapeOf } = await load('domain/drawing/model.ts');
    let project = parseLandmarks(fs.readFileSync(path.join(out, 'yaw-source-project.json'), 'utf8')), past = [], future = [];
    const m = JSON.parse(fs.readFileSync(path.join(out, 'yaw-source-manifest.json'), 'utf8')), d = project.drawing, oldRefs = JSON.stringify(project.drawingSnapshots.items.filter(a => a.id !== m.sourceArtworkId)), r = m.transfer.original, c = m.transfer.copy, l = m.materialPairs[0].original, seed = m.materialPairs[0].copy, pair = d.mirrorEditing.curvePairs.find(p => [p.a, p.b].includes(r) && [p.a, p.b].includes(l)), axis = d.mirrorEditing.axisNodeIds ?? [], endNodes = new Set([r, l].flatMap(id => d.curves.find(x => x.id === id).nodes)), q = shapeOf(d, seed)[0], h = shapeOf(d, seed)[1], commands = [{ op: 'setMirrorEditing', enabled: false }, { op: 'deleteMirrorPairs', pairIds: [pair.id] }, { op: 'setMirrorAxisNodes', nodeIds: axis.filter(id => !endNodes.has(id)) }, { op: 'splitCurve', curveId: r, t: .65, ref: 'rearTail' }, { op: 'splitCurve', curveId: l, t: .65, ref: 'frontTail' }, { op: 'splitCurve', curveId: c, t: .65, ref: 'copyTail' }, { op: 'linkEndpoints', a: { curveId: r, end: 1 }, b: { curveId: c, end: 1 }, ref: 'rearQ' }, { op: 'linkEndpoints', a: { curveId: l, end: 1 }, b: { curveId: seed, end: 0 }, ref: 'frontQ' }, { op: 'createMirrorPair', a: r, b: l, reverse: false, ref: 'jawUpperPair' }, { op: 'createMirrorPair', a: '$rearTail', b: '$frontTail', reverse: false, ref: 'jawLowerPair' }, { op: 'setMirrorAxisNodes', nodeIds: axis }, { op: 'setMirrorEditing', enabled: true }, { op: 'moveHandle', curveId: m.profileTargets[4].source, end: 1, position: [2 * q[0] - h[0], 2 * q[1] - h[1]] }];
    const api = createVectorEditingApi({ getState: () => ({ project, past, future }), getMode: () => 'drawing', commitDrawing: d => { past.push(project); project = { ...project, drawing: d }; future = []; }, commitArtwork: s => { past.push(project); project = { ...project, ...s }; future = []; }, undo: () => { }, redo: () => { } });
    const dry = api.execute({ commands, dryRun: true });
    if (!dry.ok)
        throw Error(JSON.stringify(dry));
    const result = api.execute({ commands });
    if (!result.ok)
        throw Error(JSON.stringify(result));
    const refs = Object.fromEntries(result.value.created.filter(x => x.ref).map(x => [x.ref, x.id]));
    const saved = api.artwork({ op: 'save', artworkId: m.sourceArtworkId, name: '转头源·Q端点稳态' });
    if (!saved.ok)
        throw Error(JSON.stringify(saved));
    if (JSON.stringify(project.drawingSnapshots.items.filter(a => a.id !== m.sourceArtworkId)) !== oldRefs)
        throw Error('Reference snapshot changed');
    const next = { ...m, stage: 'SOURCE_Q_STABILIZED_NOT_A_FINISHED_TURN', copyPairs: m.copyPairs.flatMap(p => p.original === r ? [{ original: r, copy: c, reference: r, referenceRange: [0, .65] }, { original: refs.rearTail, copy: refs.copyTail, reference: r, referenceRange: [.65, 1] }] : [{ ...p, reference: p.original, referenceRange: [0, 1] }]), materialPairs: [{ original: refs.frontTail, copy: seed, sourceRange: [0, 1] }], frontParts: { first: l, last: refs.frontTail }, transfer: { ...m.transfer, original: refs.rearTail, copy: refs.copyTail, t: (.8 - .65) / .35, originalMaterial: { curveId: r, t: .8 } }, qLinkIds: [refs.frontQ, refs.rearQ], qSourcePoint: q, seedG1: true, profileGrid: { rows: 12, columns: 8 }, mirrorPairRemap: { old: pair.id, replacements: [refs.jawUpperPair, refs.jawLowerPair] } };
    const json = serializeProject(project);
    parseLandmarks(json);
    fs.writeFileSync(path.join(out, 'yaw-stable-source-project.json'), json);
    fs.writeFileSync(path.join(out, 'yaw-stable-source-manifest.json'), JSON.stringify(next, null, 2));
    fs.writeFileSync(path.join(out, 'yaw-source-stabilize-api-recipe.json'), JSON.stringify({ commands, result: result.value }, null, 2));
    console.log(JSON.stringify({ curves: project.drawing.curves.length, pairs: project.drawing.mirrorEditing.curvePairs.length, refs, output: 'yaw-stable-source-project.json' }, null, 2));
}
finally {
    await server.close();
}
