import {test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {Vector3} from 'three';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {eyeObjectMatrix} from '../rendering/eyeDisplay';
import {evaluationContext} from '../domain/geometry/evaluation';
import {eyePerspectiveMatrix} from '../domain/eyes/perspective';
test('saved eye-study lid patches and their boundary curves share the same eye display transform',()=>{
 const p=parseLandmarks(readFileSync('/Users/bowen/Desktop/眼部研究3.json','utf8'));
 const patches=p.patches!.filter(x=>p.geometryModules?.[x.id]==='EYES');expect(patches).toHaveLength(2);
 for(const facing of [[.8,-.3,.5],[-.8,.3,.5],[0,0,1]] as [number,number,number][])for(const patch of patches){
 const side=patch.canonicalId?'left':'right',m=eyeObjectMatrix(p,patch.id,facing);expect(m.elements).toEqual(eyePerspectiveMatrix(p,side,facing).elements);
 for(const b of patch.boundaryUses){const c=eyeObjectMatrix(p,b.curveId,facing);for(const v of evaluationContext(p).curve(b.curveId).sample(16))expect(new Vector3(...v).applyMatrix4(m).distanceTo(new Vector3(...v).applyMatrix4(c))).toBeLessThan(1e-10);}
 }
});
