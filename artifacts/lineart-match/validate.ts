import fs from 'node:fs';
import assert from 'node:assert/strict';
import {parseLandmarks} from '/Users/bowen/Documents/headset/src/domain/landmarks/persistence';
import {controls} from '/Users/bowen/Documents/headset/src/domain/curves/geometry';
import {resolveNetwork} from '/Users/bowen/Documents/headset/src/domain/junctions/resolve';
const root='/Users/bowen/Documents/headset/artifacts/lineart-match';
const p=parseLandmarks(fs.readFileSync(root+'/matched.json','utf8')),before=parseLandmarks(fs.readFileSync(root+'/before.json','utf8'));
assert.deepEqual(parseLandmarks(JSON.stringify(p)),p);
assert.deepEqual(p.landmarks.map(x=>x.id),before.landmarks.map(x=>x.id));assert.deepEqual(p.curves.map(x=>[x.id,x.startLandmarkId,x.endLandmarkId]),before.curves.map(x=>[x.id,x.startLandmarkId,x.endLandmarkId]));
const ids=new Map(p.landmarks.map(l=>[l.id,l]));let maxPlaneError=0;
for(const l of p.landmarks){assert(l.position.every(Number.isFinite));if(l.type==='CENTERLINE')assert.equal(l.position[0],0);else assert.deepEqual(ids.get(l.mirrorPartnerId!)!.position,[-l.position[0],l.position[1],l.position[2]]);}
for(const c of p.curves){const cp=controls(p,c);assert(cp.flat().every(Number.isFinite));if(c.role==='canonical')for(const q of cp){const err=Math.abs(q.reduce((s,x,i)=>s+(x-cp[0][i])*c.shape.planeNormal[i],0));maxPlaneError=Math.max(maxPlaneError,err);assert(err<1e-8);}else {assert.deepEqual(cp,controls(p,p.curves.find(x=>x.id===c.canonicalCurveId)!).map(q=>[-q[0],q[1],q[2]]));}}
assert.deepEqual(p.centerlineOrder,before.centerlineOrder);
const n=resolveNetwork(p);assert(n.junctions.every(j=>j.state==='VALID'));
const result={sameLandmarkUUIDs:true,sameCurveUUIDsAndEndpoints:true,landmarks:p.landmarks.length,curves:p.curves.length,mirrorExact:true,centerlineOrderUnchanged:true,maxPlaneError,jsonRoundtrip:true,junctions:n.junctions.length,junctionsAllValid:true};
fs.writeFileSync(root+'/validation.json',JSON.stringify(result,null,2));console.log(result);
