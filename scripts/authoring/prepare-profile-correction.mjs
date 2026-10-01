/** A specific 30-degree profile target, retaining the shared jaw segment. */
import fs from 'node:fs';
import path from 'node:path';
const out = path.resolve(process.cwd(), process.env.CONTOUR_AUTHORING_DIR ?? 'artifacts/turning-demo'), jobs = JSON.parse(fs.readFileSync(path.join(out, 'yaw-stable-fit-jobs.json'), 'utf8')), info = JSON.parse(fs.readFileSync(path.join(out, 'yaw-final-rig-manifest.json'), 'utf8')), job = structuredClone(jobs.jobs.find(j => j.name === 'profile')), affine = p => [info.chin[0] + .18 + (p[0] - info.chin[0]) * .5, p[1]], last = job.curvePairs.find(p => p.sourceId === info.materialPairs?.[0]?.copy) ?? job.curvePairs[5], q = affine(last.source[0]), shift = q[0] - .5 * last.target[0][0], target = p => [p[0] * .5 + shift, p[1]];
for (const pair of job.curvePairs)
    pair.target = pair === last ? pair.source.map(affine) : pair.target.map(target);
const lip = job.curvePairs[4];
lip.target[3] = last.target[0];
lip.target[2] = [2 * q[0] - last.target[1][0], 2 * q[1] - last.target[1][1]];
const closure = job.curvePairs[6];
closure.target[0] = last.target[3];
closure.target[1] = [last.target[3][0] - .18, -.16];
closure.target[2] = [job.curvePairs[0].target[0][0] - .20, .25];
closure.target[3] = job.curvePairs[0].target[0];
const at = (c, t) => { const u = 1 - t; return [0, 1].map(k => u * u * u * c[0][k] + 3 * u * u * t * c[1][k] + 3 * u * t * t * c[2][k] + t * t * t * c[3][k]); };
job.name = 'profile30';
job.grid = info.grids.profile;
job.pins = [0, .125, .25, .375, .5, .625, .75, .875, 1].map(t => ({ sourcePoint: at(last.source, t), targetPoint: at(last.target, t) }));
job.options = { samplesPerCurve: 97, regularization: 1e-7, endpointTangentWeight: .01 };
fs.writeFileSync(path.join(out, 'yaw-profile30-fit-jobs.json'), JSON.stringify({ jobs: [job] }, null, 2));
console.log({ q, chin: last.target[3], last: last.sourceId, target: job.curvePairs.map(p => ({ id: p.sourceId, p0: p.target[0], p1: p.target[3] })) });
