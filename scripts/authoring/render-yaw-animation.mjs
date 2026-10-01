/** Render every integer yaw using the actual saved rig and production fills. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url), { createCanvas, Path2D, loadImage } = require(process.env.CONTOUR_CANVAS_MODULE ?? '/tmp/contour-canvas-render/node_modules/@napi-rs/canvas');
globalThis.Path2D = Path2D;
globalThis.document = { createElement(tag) { if (tag !== 'canvas')
        throw Error(tag); return createCanvas(1, 1); } };
const root = process.cwd(), input = process.argv[2], out = process.argv[3];
if (!input || !out)
    throw Error('Usage: render-yaw-animation.mjs project.json new-output-dir');
if (fs.existsSync(out))
    throw Error('Output already exists: ' + out);
fs.mkdirSync(out, { recursive: true });
const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
try {
    const { parseLandmarks } = await server.ssrLoadModule('/src/domain/landmarks/persistence.ts'), { createVectorEditingApi } = await server.ssrLoadModule('/src/app/vectorEditingApi.ts'), project = parseLandmarks(fs.readFileSync(input, 'utf8')), before = JSON.stringify(project), api = createVectorEditingApi({ getState: () => ({ project, past: [], future: [] }), getMode: () => 'recording', commitDrawing: () => { throw Error('Readonly'); }, undo: () => { }, redo: () => { } }), diagnostics = [], camera = { width: 800, height: 800, center: [-.3294804514288924, -.05], pixelsPerUnit: 300, showFills: true };
    for (let start = 0; start <= 90; start += 31) {
        const angles = Array.from({ length: Math.min(31, 91 - start) }, (_, i) => ({ x: start + i, y: 0 })), result = api.previewRecordingFrames({ ...camera, angles });
        if (!result.ok)
            throw Error(JSON.stringify(result));
        for (const frame of result.value.frames) {
            const x = frame.angle.x, stem = 'frame_' + String(x).padStart(3, '0');
            fs.writeFileSync(path.join(out, stem + '.svg'), frame.svg);
            const image = await loadImage(Buffer.from(frame.svg)), canvas = createCanvas(800, 800), c = canvas.getContext('2d');
            c.fillStyle = 'white';
            c.fillRect(0, 0, 800, 800);
            c.drawImage(image, 0, 0);
            c.fillStyle = '#26424c';
            c.font = '18px sans-serif';
            c.fillText(`Contour · X ${x}°  / Y 0° · production vector rig`, 20, 32);
            fs.writeFileSync(path.join(out, stem + '.png'), canvas.toBuffer('image/png'));
            const { svg, ...report } = frame;
            diagnostics.push(report);
        }
        console.log('Rendered through ' + Math.min(90, start + 30) + '°');
    }
    if (JSON.stringify(project) !== before)
        throw Error('Rendering mutated project');
    for (let x = 89; x >= 0; x--)
        fs.copyFileSync(path.join(out, 'frame_' + String(x).padStart(3, '0') + '.png'), path.join(out, 'frame_' + String(180 - x).padStart(3, '0') + '.png'));
    const report = { input, camera, renderer: 'Production PaintScene and native Skia Canvas; not browser interaction QA', integerAngles: 91, sourceUnchanged: true, warningAngles: diagnostics.filter(f => f.warningCurveIds.length || f.intervalTransportErrors.length || f.routeDiagnostics.length).map(f => f.angle.x), maxErrorPixels: Math.max(...diagnostics.map(f => f.maxErrorPixels)), frames: diagnostics };
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    const video = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-framerate', '24', '-i', path.join(out, 'frame_%03d.png'), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(out, 'yaw-0-90-roundtrip.mp4')], { encoding: 'utf8' });
    if (video.status !== 0)
        throw Error(video.stderr);
    console.log(JSON.stringify({ video: path.join(out, 'yaw-0-90-roundtrip.mp4'), warningAngles: report.warningAngles, maxErrorPixels: report.maxErrorPixels }));
}
finally {
    await server.close();
}
