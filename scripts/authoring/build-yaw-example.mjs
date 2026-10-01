/** Reproduce the authoring example in a fresh directory; never overwrite a prior run. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const output = path.resolve(process.argv[2] ?? 'artifacts/yaw-reproduction');
if (fs.existsSync(output))
    throw Error('Choose a new output directory: ' + output);
fs.mkdirSync(output, { recursive: true });
const environment = { ...process.env, CONTOUR_AUTHORING_DIR: output };
function run(command, args, extra = {}) { const result = spawnSync(command, args, { env: { ...environment, ...extra }, stdio: 'inherit' }); if (result.status !== 0)
    throw Error(command + ' ' + args.join(' ') + ' failed'); }
const script = name => 'scripts/authoring/' + name;
run('node', [script('build-yaw-source.mjs')]);
run('node', [script('stabilize-yaw-source.mjs')]);
run('node', [script('prepare-yaw-rig.mjs')], { YAW_PREFIX: 'yaw-stable' });
run('node', [script('finish-yaw-blueprint.mjs')]);
run('python', [script('fit-warp-grid.py'), path.join(output, 'yaw-stable-fit-jobs.json'), '--output', path.join(output, 'yaw-stable-fitted90.json')]);
run('node', [script('prepare-profile-correction.mjs')]);
run('python', [script('fit-warp-grid.py'), path.join(output, 'yaw-profile30-fit-jobs.json'), '--output', path.join(output, 'yaw-profile30-fitted.json')]);
run('python', [script('fit-warp-grid.py'), path.join(output, 'yaw-nose30-fit-jobs.json'), '--output', path.join(output, 'yaw-nose30-fitted.json')]);
run('node', [script('author-yaw-keyforms.mjs')], { YAW_PREFIX: 'yaw-final', YAW_FIT_NAME: 'yaw-stable-fitted90.json', YAW_OUTPUT: 'yaw-final-rig-project.json' });
console.log('Authored project: ' + path.join(output, 'yaw-final-rig-project.json'));
console.log('Run render-turn-frames.mjs and render-yaw-animation.mjs for production filled previews.');
