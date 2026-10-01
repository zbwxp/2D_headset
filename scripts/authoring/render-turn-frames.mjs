/** Offline art preview of the production PaintScene using a real Skia Canvas.
 * It preserves MistFill's exact algorithm and embeds its PNGs in clean SVG.
 * This is not browser interaction QA. Install @napi-rs/canvas in an isolated
 * tooling prefix and set CONTOUR_CANVAS_MODULE to that module if needed. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
const require = createRequire(import.meta.url), { createCanvas, Path2D, loadImage } = require(process.env.CONTOUR_CANVAS_MODULE ?? '/tmp/contour-canvas-render/node_modules/@napi-rs/canvas');
globalThis.Path2D = Path2D;
globalThis.document = { createElement(tag) { if (tag !== 'canvas')
        throw Error('Unsupported DOM element ' + tag); return createCanvas(1, 1); } };
const root = process.cwd(), input = process.argv[2] ?? 'artifacts/turning-demo/yaw-stable-rig-tuned-project.json', output = process.argv[3] ?? 'artifacts/turning-demo/full-tuned', server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
fs.mkdirSync(output, { recursive: true });
try {
    const { createVectorEditingApi } = await server.ssrLoadModule('/src/app/vectorEditingApi.ts'), { parseLandmarks } = await server.ssrLoadModule('/src/domain/landmarks/persistence.ts'), project = parseLandmarks(fs.readFileSync(input, 'utf8')), before = JSON.stringify(project), api = createVectorEditingApi({ getState: () => ({ project, past: [], future: [] }), getMode: () => 'recording', commitDrawing: () => { throw Error('read only'); }, undo: () => { }, redo: () => { } }), requestedAngles = process.env.YAW_ANGLES ? process.env.YAW_ANGLES.split(',').map(x => ({ x: Number(x), y: 0 })) : undefined, result = api.previewRecordingFrames({ angles: requestedAngles, width: 800, height: 800, center: [-.3294804514288924, -.05], pixelsPerUnit: 300, showFills: true });
    if (!result.ok)
        throw Error(JSON.stringify(result));
    const frames = result.value.frames, sheet = createCanvas(1600, 30 + Math.ceil(frames.length / 4) * 420), ctx = sheet.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    ctx.fillStyle = '#1e3138';
    ctx.font = '17px sans-serif';
    ctx.fillText('Contour · Production PaintScene + Skia Canvas · Full fills / mist · Offline preview', 18, 25);
    for (let i = 0; i < frames.length; i++) {
        const f = frames[i], stem = 'yaw-' + f.angle.x;
        fs.writeFileSync(path.join(output, stem + '.svg'), f.svg);
        const image = await loadImage(Buffer.from(f.svg)), canvas = createCanvas(800, 800), c = canvas.getContext('2d');
        c.fillStyle = 'white';
        c.fillRect(0, 0, 800, 800);
        c.drawImage(image, 0, 0, 800, 800);
        fs.writeFileSync(path.join(output, stem + '.png'), canvas.toBuffer('image/png'));
        const x = (i % 4) * 400, y = Math.floor(i / 4) * 420 + 30;
        ctx.drawImage(canvas, x, y + 20, 400, 400);
        ctx.fillStyle = '#1e3138';
        ctx.font = '16px sans-serif';
        ctx.fillText(`X ${f.angle.x}°`, x + 12, y + 18);
    }
    fs.writeFileSync(path.join(output, 'contact-sheet.png'), sheet.toBuffer('image/png'));
    fs.writeFileSync(path.join(output, 'diagnostics.json'), JSON.stringify({ ...result.value, frames: frames.map(({ svg, ...f }) => f), renderer: 'Production PaintScene with @napi-rs/canvas; browser interaction not exercised' }, null, 2));
    if (JSON.stringify(project) !== before)
        throw Error('Preview mutated input');
    console.log(JSON.stringify({ output, frames: frames.length, warnings: result.value.warningFrameIndices, maxErrorPixels: result.value.maxErrorPixels }, null, 2));
}
finally {
    await server.close();
}
