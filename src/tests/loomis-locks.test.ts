import {test,expect} from 'vitest';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame} from '../domain/head/frame';
import {createSection,sectionFromAngles} from '../domain/curves/section';
import {addCap,addCapPoint} from '../domain/head/caps';
import {blockedLoomisEdit,toggleLoomisLock,isLoomisLocked} from '../domain/head/locks';
import {deleteClosure} from '../domain/geometry/dependencies';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {setLoomisOffset} from '../domain/head/offset';
function fixture(){const p=migrateHeadFrame(createLandmarkProject());return createSection({...p,landmarks:[],curves:[],patches:[],centerlineOrder:[]},false).project;}
test('Section pair defaults unlocked, blocks edits/deletion, permits cap/points, roundtrip',()=>{let p=fixture();const id=p.curves[0].id;expect(isLoomisLocked(p,id)).toBe(false);p=toggleLoomisLock(p,id);expect(isLoomisLocked(p,p.curves[1].id)).toBe(true);expect(blockedLoomisEdit(p,deleteClosure(p,[`curve:${id}`]))).toBeTruthy();expect(blockedLoomisEdit(p,{...p,curves:p.curves.map(c=>c.role==='canonical'?{...c,section:sectionFromAngles(20,30,.2)}:c)})).toBeTruthy();const capped=addCap(p,id);expect(blockedLoomisEdit(p,capped)).toBeNull();expect(blockedLoomisEdit(p,addCapPoint(capped,capped.loomisCaps![0].id,.2,.1).project)).toBeNull();expect(parseLandmarks(JSON.stringify(p)).loomisLocks).toEqual(p.loomisLocks);expect(isLoomisLocked(toggleLoomisLock(p,p.curves[1].id),id)).toBe(false);});
test('Cap/point and frame locks prevent indirect movement, adding hosted points remains legal',()=>{let p=fixture();p=addCap(p,p.curves[0].id);const cap=p.loomisCaps![0].id;p=toggleLoomisLock(p,cap);expect(blockedLoomisEdit(p,{...p,headFrame:{...p.headFrame!,radiusX:2}})).toBeTruthy();const r=addCapPoint(p,cap,.1,.2);expect(blockedLoomisEdit(p,r.project)).toBeNull();p=toggleLoomisLock(r.project,r.selectedId);expect(blockedLoomisEdit(p,setLoomisOffset(p,r.selectedId,1,.4))).toBeTruthy();expect(blockedLoomisEdit(p,deleteClosure(p,[`cap:${cap}`]))).toBeTruthy();p=toggleLoomisLock(p,'frame:head');expect(isLoomisLocked(p,'frame:head')).toBe(true);});
