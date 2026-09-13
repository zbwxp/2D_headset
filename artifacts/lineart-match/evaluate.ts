import fs from 'node:fs';
import {parseLandmarks} from '/Users/bowen/Documents/headset/src/domain/landmarks/persistence';
import {controls} from '/Users/bowen/Documents/headset/src/domain/curves/geometry';
import {resolveNetwork} from '/Users/bowen/Documents/headset/src/domain/junctions/resolve';
const root='/Users/bowen/Documents/headset/artifacts/lineart-match';
const results:any={};
for(const file of ['before','matched']){const p=parseLandmarks(fs.readFileSync(root+'/'+file+'.json','utf8'));const n=resolveNetwork(p);results[file]={curves:p.curves.map(c=>({name:c.name,id:c.id,controls:controls(p,c)})),network:n};if(file==='matched')fs.writeFileSync(root+'/matched.json',JSON.stringify(p,null,2));console.log(file,n.junctions.map(j=>({state:j.state,reason:j.reason})));}
fs.writeFileSync(root+'/evaluation.json',JSON.stringify(results));
