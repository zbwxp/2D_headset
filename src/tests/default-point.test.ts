import {test,expect} from 'vitest';
import {addDefaultLandmark} from '../domain/landmarks/management';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame,mirrorPoint} from '../domain/head/frame';
import {pointPosition} from '../domain/geometry/evaluation';
import {parseLandmarks} from '../domain/landmarks/persistence';
test('empty project creates editable center and mirrored pair, respects locks and roundtrips',()=>{
 const p=migrateHeadFrame(createLandmarkProject());p.landmarks=[];p.curves=[];p.patches=[];p.centerlineOrder=[];p.lockedViews=[p.views[0].id];
 const a=addDefaultLandmark(p,true),b=addDefaultLandmark(a.project,false);
 expect(b.project.landmarks).toHaveLength(3);expect(b.project.centerlineOrder).toEqual([a.selectedId]);
 const right=b.project.landmarks.find(l=>l.id===b.selectedId)!;
 expect(right.placement.kind).toBe('FRAME_RELATIVE');expect(Object.keys(right.viewLocks)).toEqual(p.lockedViews);
 expect(pointPosition(b.project,right.mirrorPartnerId!)).toEqual(mirrorPoint(b.project,pointPosition(b.project,right.id)));
 const loaded=parseLandmarks(JSON.stringify(b.project));expect(loaded.landmarks).toHaveLength(3);
 expect(addDefaultLandmark(b.project,false).project.landmarks.at(-1)!.name).toContain('2');
});
