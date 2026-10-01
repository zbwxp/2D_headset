/** Explicit authoring recipe: create a NEW source artwork through contourAI.
 * Never edits either input reference or the bundled examples. */
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
const root = process.cwd(), out = path.resolve(root, process.env.CONTOUR_AUTHORING_DIR ?? 'artifacts/turning-demo');
fs.mkdirSync(out, { recursive: true });
const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
try {
    const load = p => server.ssrLoadModule('/src/' + p), { createVectorEditingApi } = await load('app/vectorEditingApi.ts'), { createEmptyProject } = await load('app/emptyProject.ts'), { parseDrawing, shapeOf, nodeAt } = await load('domain/drawing/model.ts'), { subcurve } = await load('domain/drawing/roundedJoin.ts'), { saveDrawingSnapshot, restoreDrawingSnapshot } = await load('domain/drawing/snapshots.ts'), { serializeProject } = await load('app/autosave.ts'), { parseLandmarks } = await load('domain/landmarks/persistence.ts');
    const front = parseDrawing(JSON.parse(fs.readFileSync('src/assets/hairless-symmetric-two-face-mirror.json', 'utf8'))), side = parseDrawing(JSON.parse(fs.readFileSync('src/assets/right90-reference.json', 'utf8'))), rawFront = JSON.stringify(front), rawSide = JSON.stringify(side), rearIds = ['1ebb7283-3694-46b6-8002-47ec50d0057a', '65450d8d-7c62-4d87-b421-616dfbcab097', '52b399a3-a55d-4f08-9fbb-abe711ab4f9a'], profileIds = ['1a723ec7-9bbe-4c56-8c0f-680d03741aa6', 'c9198c28-7a59-463d-8854-8e0e13efe472', '515c94f3-3de1-46d3-84ad-b33898e77fec', 'bbb3c633-c3bd-43a7-b38d-d95c537c3e9a', '02cab759-7e76-4933-947b-44c73aa96417', '04da1759-bd52-42f4-857d-afbea7bf1326'], originalLeft = profileIds[0], chin = nodeAt(front, { curveId: rearIds[1], end: 1 }).position, sideChin = nodeAt(side, { curveId: profileIds[5], end: 1 }).position, seedStart = .65;
    let state = saveDrawingSnapshot({ drawing: front }, '正面参考·镜像'), frontId = state.drawingSnapshots.activeId;
    state = saveDrawingSnapshot({ ...state, drawing: side }, '右侧90°参考');
    const sideId = state.drawingSnapshots.activeId;
    state = restoreDrawingSnapshot(state, frontId);
    let project = { ...createEmptyProject(), ...state }, past = [], future = [];
    const api = createVectorEditingApi({ getState: () => ({ project, past, future }), getMode: () => 'drawing', commitDrawing: d => { past.push(project); project = { ...project, drawing: d }; future = []; }, commitArtwork: s => { past.push(project); project = { ...project, ...s }; future = []; }, undo: () => { if (past.length) {
            future.push(project);
            project = past.pop();
        } }, redo: () => { if (future.length) {
            past.push(project);
            project = future.pop();
        } } });
    const execute = (commands, label) => { const dry = api.execute({ commands, dryRun: true }); if (!dry.ok)
        throw Error(label + ' dry: ' + JSON.stringify(dry)); const result = api.execute({ commands }); if (!result.ok)
        throw Error(label + ': ' + JSON.stringify(result)); return result.value; };
    const commands = [{ op: 'createLayer', name: '转头·后下颌副本', ref: 'rear' }, { op: 'createLayer', name: '转头·额鼻唇颏部件', ref: 'profile' }];
    const rearShapes = rearIds.map(id => shapeOf(front, id)), profileShapes = profileIds.map(id => shapeOf(side, id).map(([x, y]) => [chin[0] + .2 * (x - sideChin[0]), y]));
    profileShapes[5] = subcurve(shapeOf(front, originalLeft), seedStart, 1);
    const q = profileShapes[5][0];
    profileShapes[4][3] = [...q];
    profileShapes[4][2] = [q[0] - .025, q[1] + .035];
    const closure = [chin, [chin[0] - .14, -.1], [chin[0] - .12, .25], profileShapes[0][0]], profileNames = ['额鼻根', '鼻梁', '鼻尖至鼻底', '人中', '唇缘', '下颏共形种子', '内部闭合'];
    profileShapes.push(closure);
    for (const [prefix, shapes, names] of [['rear', rearShapes, ['颅顶闭合', '后下颌共形副本', '内部闭合']], ['profile', profileShapes, profileNames]]) {
        for (let i = 0; i < shapes.length; i++)
            commands.push({ op: 'createCurve', layerId: '$' + prefix, shape: shapes[i], width: .008, name: `转头·${names[i]}`, ref: prefix + i });
        for (let i = 0; i < shapes.length; i++)
            commands.push({ op: 'connectGeometry', a: { curveId: '$' + prefix + i, end: 1 }, b: { curveId: '$' + prefix + ((i + 1) % shapes.length), end: 0 } });
        commands.push({ op: 'createFill', curveIds: shapes.map((_, i) => '$' + prefix + i), color: 'white', ref: prefix + 'Fill' });
        commands.push({ op: 'addDisplayInterval', curveId: '$' + prefix + '0', mode: 'SHOW', start: 0, end: 0, ref: prefix + 'Range' });
    }
    commands.push({ op: 'linkEndpoints', a: { curveId: '$rear1', end: 1 }, b: { curveId: '$profile5', end: 1 }, ref: 'sideChin' }, { op: 'linkEndpoints', a: { curveId: rearIds[1], end: 1 }, b: { curveId: '$rear1', end: 1 }, ref: 'sharedChin' }, { op: 'linkEndpoints', a: { curveId: rearIds[1], end: 0 }, b: { curveId: '$rear1', end: 0 }, ref: 'sharedRearStart' }, { op: 'setLinkJoinBrush', linkId: '$sideChin', brush: { kind: 'ARC', trimDistance: .05257222158088604 } }, { op: 'reorderLayer', layerId: '$rear', targetLayerId: front.layers.find(l => l.name === '面部·左片').id, after: true }, { op: 'reorderLayer', layerId: '$profile', targetLayerId: '$rear', after: false });
    const first = execute(commands, 'create'), refs = Object.fromEntries(first.created.filter(x => x.ref).map(x => [x.ref, x.id])), rearTrack = project.drawing.displayIntervals.find(t => t.ranges.some(r => r.id === refs.rearRange)), profileTrack = project.drawing.displayIntervals.find(t => t.ranges.some(r => r.id === refs.profileRange));
    const routeCommands = [{ op: 'adoptDisplayRoute', trackId: rearTrack.id, linkId: refs.sideChin }, { op: 'removeDisplayInterval', rangeId: refs.profileRange }, { op: 'setDisplayIntervalEnd', rangeId: refs.rearRange, end: 0, style: { taper: 0, extension: 0 } }, { op: 'setDisplayIntervalEnd', rangeId: refs.rearRange, end: 1, style: { taper: 0, extension: 0 } }];
    execute(routeCommands, 'route');
    const source = project.drawing;
    for (const c of front.curves)
        if (JSON.stringify(source.curves.find(x => x.id === c.id)) !== JSON.stringify(c))
            throw Error('Original curve mutated ' + c.id);
    for (const n of front.nodes)
        if (JSON.stringify(source.nodes.find(x => x.id === n.id)) !== JSON.stringify(n))
            throw Error('Original node mutated ' + n.id);
    for (const f of front.fills)
        if (JSON.stringify(source.fills.find(x => x.id === f.id)) !== JSON.stringify(f))
            throw Error('Original fill mutated ' + f.id);
    const saved = api.artwork({ op: 'save', name: '转头源·固定侧部件·待录制' });
    if (!saved.ok)
        throw Error(JSON.stringify(saved));
    project.meta.name = 'Contour · 固定部件转头工作稿';
    const serialized = serializeProject(project), roundtrip = parseLandmarks(serialized);
    if (JSON.stringify(roundtrip.drawing) !== JSON.stringify(project.drawing))
        throw Error('Source roundtrip failed');
    const metadata = { stage: 'SOURCE_ONLY_NOT_A_FINISHED_TURN', frontArtworkId: frontId, sideArtworkId: sideId, sourceArtworkId: project.drawingSnapshots.activeId, copyPairs: rearIds.map((original, i) => ({ original, copy: refs['rear' + i] })), materialPairs: [{ original: originalLeft, copy: refs.profile5, sourceRange: [seedStart, 1] }], profileTargets: profileIds.map((reference, i) => ({ source: refs['profile' + i], reference })), closureCurveId: refs.profile6, layerIds: { rear: refs.rear, profile: refs.profile }, routeTrackIds: [front.displayIntervals.find(t => t.displayRoute).id, rearTrack.id], revealRangeId: refs.rearRange, chinLinkIds: [front.endpointLinks.find(l => l.throughDisplay).id, refs.sideChin, refs.sharedChin], sharedRearStartLinkId: refs.sharedRearStart, transfer: { original: rearIds[1], copy: refs.rear1, t: .8, brush: { taper: 0, extension: 0 } }, notes: ['Same source controls plus same full Warp chain are required for rear copies. No persistent handle-copy relation exists.', 'The seeded last-profile subcurve must stay affine with the old jaw through initial handover.', 'No angle keyforms are authored in this source-only artifact.'] };
    fs.writeFileSync(path.join(out, 'yaw-source-project.json'), serialized);
    fs.writeFileSync(path.join(out, 'yaw-source-drawing.json'), JSON.stringify(source, null, 2));
    fs.writeFileSync(path.join(out, 'yaw-source-manifest.json'), JSON.stringify(metadata, null, 2));
    fs.writeFileSync(path.join(out, 'yaw-source-api-recipe.json'), JSON.stringify({ inputFront: 'src/assets/hairless-symmetric-two-face-mirror.json', inputSide: 'src/assets/right90-reference.json', phase1: { commands }, phase1Created: first.created, phase2: { commands: routeCommands }, metadata }, null, 2));
    if (rawFront !== JSON.stringify(front) || rawSide !== JSON.stringify(side))
        throw Error('Input reference mutated');
    console.log(JSON.stringify({ curves: source.curves.length, layers: source.layers.length, fills: source.fills.length, artworkId: metadata.sourceArtworkId, out }, null, 2));
}
finally {
    await server.close();
}
