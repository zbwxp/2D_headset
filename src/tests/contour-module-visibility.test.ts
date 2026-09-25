import {test,expect} from 'vitest';
import {contourSource} from '../domain/contour/source';
import {ensureScaffold} from '../domain/head/scaffold';
import {migrateHeadFrame} from '../domain/head/frame';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {createEyeScaffold} from '../domain/eyes/scaffold';
import {assignModules} from '../domain/modules/ownership';
test('contour excludes hidden sets from lines and depth without removing source dependencies',()=>{
 const p=assignModules(createEyeScaffold(ensureScaffold(migrateHeadFrame(createLandmarkProject()))));
 p.gazeEyeball={version:1,leftId:'iris-left',rightId:'iris-right',irisScale:.3,recessDepth:.12,tracking:false};
 const original=JSON.stringify(p);
 const all=contourSource(p),headHidden=contourSource({...p,hiddenModules:['HEADSET']}),eyesHidden=contourSource({...p,hiddenModules:['EYES']}),none=contourSource({...p,hiddenModules:['HEADSET','EYES']});
 expect(all.mesh.triangles.length).toBeGreaterThan(0);expect(all.mesh.alwaysLines).toHaveLength(2);
 expect(headHidden.mesh.triangles).toHaveLength(0);expect(headHidden.mesh.alwaysLines).toHaveLength(2);
 expect(eyesHidden.mesh.triangles.length).toBe(all.mesh.triangles.length);expect(eyesHidden.mesh.alwaysLines).toHaveLength(0);
 expect(none.mesh.vertices).toHaveLength(0);expect(none.mesh.boundaries).toHaveLength(0);expect(JSON.stringify(p)).toBe(original);
});
