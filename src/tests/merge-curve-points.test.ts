import {describe,test,expect,vi} from 'vitest';
import {spanFixture} from './span-fixture';
import {createCurve} from '../domain/curves/management';
import {migrateFree3D} from '../domain/curves/free3d';
import {mergeCurvePoints,mergePointReason} from '../domain/landmarks/merge';
import {addOnCurvePoint,setOnCurveS,validatePlacements} from '../domain/landmarks/placement';
import {pointPosition} from '../domain/geometry/evaluation';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {ensureScaffold,RING_X} from '../domain/head/scaffold';
import {migrateHeadFrame,mirrorPoint} from '../domain/head/frame';
import {addPatch} from '../domain/patches/model';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {boundaryKey} from '../domain/patches/boundary';
import {dispatch2D} from '../ui/authoring/InteractionDispatcher2D';
import {undoToolStep} from '../ui/authoring/state';
import {createOnPatch} from '../domain/curves/onPatch';
import {evaluationContext} from '../domain/geometry/evaluation';

describe('merge two zero-offset anchors on the same curve',()=>{
 test('retains first position, identity and all curves; redirects both symmetric endpoint sets',()=>{
  const f=spanFixture(),p=migrateFree3D(f.p),json=JSON.stringify(p),keep=p.landmarks.find(l=>l.id===f.a)!,drop=p.landmarks.find(l=>l.id===f.b)!;
  const next=mergeCurvePoints(p,f.a,f.b);
  expect(next.landmarks).toHaveLength(p.landmarks.length-2);
  expect(next.landmarks.find(l=>l.id===f.a)).toBe(keep);
  expect(pointPosition(next,f.a)).toEqual(pointPosition(p,f.a));
  expect(next.curves.map(c=>c.id)).toEqual(p.curves.map(c=>c.id));
  expect(next.curves.find(c=>c.id===f.bc)?.startLandmarkId).toBe(f.a);
  expect(next.curves.some(c=>c.startLandmarkId===f.b||c.endLandmarkId===drop.mirrorPartnerId)).toBe(false);
  expect(next.curves.find(c=>c.id===p.curves.find(c=>c.id===f.bc)?.mirrorPartnerCurveId)?.startLandmarkId).toBe(keep.mirrorPartnerId);
  const original=p.curves.find(c=>c.id===f.bc)!;
  if('shape' in original)expect(next.curves.find(c=>c.id===f.bc)).toMatchObject({shape:original.shape});
  expect(pointPosition(next,keep.mirrorPartnerId!)).toEqual(mirrorPoint(next,pointPosition(next,f.a)));
  expect(()=>validatePlacements(next)).not.toThrow();expect(JSON.stringify(p)).toBe(json);
  const loaded=parseLandmarks(JSON.stringify(next));
  expect(loaded.curves.find(c=>c.id===f.bc)?.startLandmarkId).toBe(f.a);
  expect(loaded.landmarks.some(l=>l.id===f.b)).toBe(false);
 });
 test('selecting mirror-side anchors has the same canonical result',()=>{
  const {p,a,b}=spanFixture(),am=p.landmarks.find(l=>l.id===a)!.mirrorPartnerId!,bm=p.landmarks.find(l=>l.id===b)!.mirrorPartnerId!;
  expect(mergeCurvePoints(p,am,bm)).toEqual(mergeCurvePoints(p,a,b));
 });
 test('supports centerline anchors and a shared logical Ring host',()=>{
  let p=createLandmarkProject();const start=p.landmarks[0].id,end=p.landmarks[1].id;
  const c=createCurve(p,start,end,p.views[0],"中线宿主");p=c.project;
  const a=addOnCurvePoint(p,c.selectedId),b=addOnCurvePoint(a.project,c.selectedId);
  expect(mergeCurvePoints(setOnCurveS(b.project,b.selectedId,.8),a.selectedId,b.selectedId).landmarks).toHaveLength(b.project.landmarks.length-1);
  p=ensureScaffold(migrateHeadFrame(createLandmarkProject()));
  const ring=p.curves.find(c=>'logicalRing' in c&&c.logicalRing==='COMPOSITE')!;
  const ra=addOnCurvePoint(p,ring.id),rb=addOnCurvePoint(ra.project,ring.id);
  const rp=setOnCurveS(rb.project,rb.selectedId,.35);
  expect(()=>validatePlacements(mergeCurvePoints(rp,ra.selectedId,rb.selectedId))).not.toThrow();
  const mirror=rp.landmarks.find(l=>l.id===ra.selectedId)!.mirrorPartnerId!;
  expect(()=>mergeCurvePoints(rp,ra.selectedId,mirror)).toThrow('镜像');
 });
 test('rejects nonzero offset on either side, different hosts, system points and same-point clicks',()=>{
  const {p,a,b,ac}=spanFixture();
  for(const id of [a,b,p.landmarks.find(l=>l.id===b)!.mirrorPartnerId!]){
   const offset={...p,landmarks:p.landmarks.map(l=>l.id===id?{...l,placement:{...l.placement,offsetZ:1e-12}}:l)};
   expect(()=>mergeCurvePoints(offset,a,b)).toThrow('Offset');
  }
  const other=addOnCurvePoint(p,ac);expect(()=>mergeCurvePoints(other.project,a,other.selectedId)).toThrow('同一条');
  expect(()=>mergeCurvePoints(p,a,a)).toThrow('另一个');
  expect(mergePointReason(p,p.landmarks[0].id)).toBe('请选择曲线定位点。');
  const sys={...p,landmarks:p.landmarks.map(l=>l.id===a?{...l,systemRole:'BROW' as const}:l)};
  expect(()=>mergeCurvePoints(sys,a,b)).toThrow('系统');
 });
 test('rejects collapsing an existing connecting curve, without deleting anything',()=>{
  const {p,a,b}=spanFixture(),r=createCurve(p,a,b,p.views[0],"连接线"),before=JSON.stringify(r.project);
  expect(()=>mergeCurvePoints(r.project,a,b)).toThrow('相连曲线');expect(JSON.stringify(r.project)).toBe(before);
 });
 test('preserves an existing Patch and its crease by reference updates only',()=>{
  const f=spanFixture(),extra=addOnCurvePoint(f.p,f.host),p=setOnCurveS(extra.project,extra.selectedId,.5);
  const withPatch=addPatch(p,[f.use,f.ac,f.bc]);
  const oldKey=boundaryKey(withPatch,f.use),source={...withPatch,surfaceContinuity:{overrides:{[oldKey]:{mode:'crease' as const}}}};
  const next=mergeCurvePoints(source,extra.selectedId,f.b);
  expect(next.patches?.map(x=>x.id)).toEqual(source.patches?.map(x=>x.id));
  expect(next.patches?.[0].boundaryUses[0]).toMatchObject({startLandmarkId:f.a,endLandmarkId:extra.selectedId});
  expect(next.surfaceContinuity?.overrides[boundaryKey(next,{...f.use,endLandmarkId:extra.selectedId})]).toEqual({mode:'crease'});
  expect(()=>parseLandmarks(JSON.stringify(next))).not.toThrow();
  expect(()=>mergeCurvePoints(source,f.a,f.b)).toThrow('Patch');
 });
 test('updates an existing FREE Smooth Join anchor, without creating a new smooth relation',()=>{
  const f=spanFixture(),p=migrateFree3D(f.p),other=p.landmarks.find(l=>l.name==='右嘴角点')!,r=createCurve(p,f.b,other.id,p.views[0],"分支线");
  const j={id:crypto.randomUUID(),pointId:f.b,a:{curveId:f.bc,endpoint:'START' as const},b:{curveId:r.selectedId,endpoint:'START' as const},radiusRatio:.08};
  const next=mergeCurvePoints({...r.project,curveSmoothJoins:[j]},f.a,f.b);
  expect(next.curveSmoothJoins).toEqual([{...j,pointId:f.a}]);
 });
 test('reattaches ON_PATCH endpoints while preserving the host Patch and surface path',()=>{
  const f=spanFixture(),base=addPatch(f.p,[f.use,f.ac,f.bc]);
  const a=addOnCurvePoint(base,f.ac),b=addOnCurvePoint(setOnCurveS(a.project,a.selectedId,.3),f.ac),end=addOnCurvePoint(setOnCurveS(b.project,b.selectedId,.6),f.bc);
  const curve=createOnPatch(end.project,base.patches![0].id,b.selectedId,end.selectedId);
  const next=mergeCurvePoints(curve.project,a.selectedId,b.selectedId);
  expect(next.patches).toEqual(curve.project.patches);
  expect(next.curves.find(c=>c.id===curve.selectedId)).toEqual({...curve.project.curves.find(c=>c.id===curve.selectedId),startLandmarkId:a.selectedId});
  const actual=evaluationContext(next).curve(curve.selectedId).evaluate(0),expected=pointPosition(next,a.selectedId);
  actual.forEach((v,i)=>expect(v).toBeCloseTo(expected[i],8));
  expect(()=>parseLandmarks(JSON.stringify(next))).not.toThrow();
 });
 test('locked anchors remain protected',()=>{
  const base=ensureScaffold(migrateHeadFrame(createLandmarkProject())),a=addOnCurvePoint(base,RING_X),b=addOnCurvePoint(a.project,RING_X);
  expect(()=>mergeCurvePoints({...b.project,loomisLocks:[a.selectedId]},a.selectedId,b.selectedId)).toThrow('解锁');
 });
 test('tool dispatch and cancellation never imply a point drag',()=>{
  expect(dispatch2D({kind:'mergePoint'},'point')).toBe('mergePoint');
  expect(dispatch2D({kind:'mergePoint'},'curve')).toBe('ignore');
  expect(undoToolStep({kind:'mergePoint',keepId:'a'})).toEqual({kind:'mergePoint'});
 });
 test('one transaction, Undo/Redo, retrying invalid input and cancelling',async()=>{
  vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{},removeItem:()=>{}});
  const {useEditor}=await import('../app/store'),f=spanFixture();
  useEditor.getState().load(f.p);const before=useEditor.getState().project,history=useEditor.getState().past.length;
  useEditor.getState().startPointMerge();useEditor.getState().selectLandmark(f.a);
  useEditor.getState().selectLandmark(f.a);
  expect(useEditor.getState().past).toHaveLength(history);
  expect(useEditor.getState().tool).toEqual({kind:'mergePoint',keepId:f.a});
  useEditor.getState().selectLandmark(f.b);const after=useEditor.getState().project;
  expect(after.landmarks).toHaveLength(before.landmarks.length-2);
  expect(useEditor.getState().past).toHaveLength(history+1);
  expect(useEditor.getState().selection).toEqual({kind:'point',id:f.a});
  useEditor.getState().undo();expect(useEditor.getState().project).toEqual(before);
  useEditor.getState().redo();expect(useEditor.getState().project).toEqual(after);
  useEditor.getState().startPointMerge(f.a);useEditor.getState().cancelTool();
  expect(useEditor.getState().project).toEqual(after);expect(useEditor.getState().past).toHaveLength(history+1);
  vi.unstubAllGlobals();
 });
});
