/** Extract fixed legacy or scene frame previews. No app/project writes. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';

const [input,destination]=process.argv.slice(2);
if(!input||!destination){process.stderr.write('Usage: node extract-recording-frames.mjs result.json NEW_OUTPUT_DIRECTORY\n');process.exit(2);}
try{
 const raw=JSON.parse(await readFile(input,'utf8'));if(raw.ok===false)throw Error(raw.error?.message??'API response failed');const value=raw.value??raw;
 if(value.savedKeyformsOnly!==true||!Array.isArray(value.frames)||!value.frames.length||value.frames.length>31)throw Error('Expected a saved-keyform previewRecordingFrames response');
 const scene=typeof value.sceneId==='string';
 if(!value.viewport||(!scene&&(typeof value.artworkId!=='string'||typeof value.rigId!=='string')))throw Error('Missing stable scene or artwork/rig/camera identity');
 const camera=JSON.stringify(value.viewport),frames=value.frames.map((frame,index)=>{
  if(frame.index!==index||(scene?frame.sceneId!==value.sceneId:frame.artworkId!==value.artworkId||frame.rigId!==value.rigId)||frame.usedDraft!==false||JSON.stringify(frame.viewport)!==camera)throw Error(`Frame ${index} changes source, rig, camera or uses an unsaved draft`);
  if(!frame.angle||![frame.angle.x,frame.angle.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=90))throw Error(`Frame ${index} has invalid parameters`);
  if(typeof frame.svg!=='string'||frame.svg.length>20_000_000||!/^\s*<svg\b/.test(frame.svg)||/<!DOCTYPE|<script\b/i.test(frame.svg))throw Error(`Frame ${index} is not a supported generated SVG`);
  return {...frame,filename:`frame-${String(index).padStart(3,'0')}.svg`};
 });
 // Validate everything before making a new directory; never overwrite outputs.
 const output=resolve(destination);await mkdir(dirname(output),{recursive:true});await mkdir(output);
 for(const frame of frames)await writeFile(join(output,frame.filename),frame.svg,{flag:'wx'});
 const manifest={...value,frames:frames.map(({svg,...frame})=>frame)};await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
 process.stdout.write(`Wrote ${frames.length} saved-keyform SVG frames and manifest to ${output}\n`);
 if(value.allFramesIdentical)process.stdout.write('Warning: all rendered frames are identical; this does not demonstrate a head turn.\n');
}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}
