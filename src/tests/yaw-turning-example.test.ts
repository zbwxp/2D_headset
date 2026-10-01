import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {evaluateRecording} from '../app/vectorRecordingApi';
import {displayField,displayPath,displayRouteFor} from '../domain/drawing/displayIntervals';
import {createDisplayRouteField} from '../domain/drawing/displayRoutes';
import {evaluatePose} from '../domain/vectorRecording/model';
import {validateIntervalOverrides} from '../domain/vectorRecording/intervals';
import {shapeOf,nodeAt} from '../domain/drawing/model';
const raw=readFileSync(new URL('../assets/yaw-turning-example.json',import.meta.url),'utf8');
const sourceProject=()=>parseLandmarks(raw);
const oldUpper='1a723ec7-9bbe-4c56-8c0f-680d03741aa6';
const newJaw='0dc97a08-bbb2-4e50-b409-ed2e01a86de9';
const noseBridge='a5e3d79e-4c57-4ddc-8cd7-5e6fa8797f41';
const copiedRear=[['1ebb7283-3694-46b6-8002-47ec50d0057a','1dd7d561-4060-4587-83f0-3f4b9531883a'],['65450d8d-7c62-4d87-b421-616dfbcab097','94a38df5-7a2a-4778-8227-d360796b3712'],['70a36ae8-28c3-4eed-b729-92de86b64969','5f87ef6a-51a5-4ec6-971e-bf2ef217f73e'],['52b399a3-a55d-4f08-9fbb-abe711ab4f9a','589efa37-0d5d-4547-ba77-2c78476d1cd0']];

test('the bundled example is a real, independent keyed rig with preserved source references',()=>{
 const p=sourceProject(),rig=p.vectorRecording!.rigs.find(r=>r.artworkId===p.drawingSnapshots!.activeId)!;
 expect(p.drawing!.curves).toHaveLength(134);expect(rig.deformers).toHaveLength(13);
 expect(rig.keys.filter(k=>k.angle.y===0&&k.angle.x>=0).map(k=>k.angle.x).sort((a,b)=>a-b)).toEqual([0,15,30,45,48,50,55,60,90]);
 expect(p.drawingSnapshots!.items).toHaveLength(3);
 const refs=p.drawingSnapshots!.items.filter(a=>a.id!==p.drawingSnapshots!.activeId);
 for(const file of ['hairless-symmetric-two-face-mirror.json','right90-reference.json']){const expected=JSON.parse(readFileSync(new URL('../assets/'+file,import.meta.url),'utf8'));expect(refs.some(r=>JSON.stringify(r.drawing)===JSON.stringify(expected))).toBe(true);}
 expect(new Set(rig.keys.map(k=>JSON.stringify(k.visibility))).size).toBe(1);
});

test('every integer yaw retains true linked geometry, material routes and the original source',()=>{
 const p=sourceProject(),before=JSON.stringify(p),source=p.drawing!;
 // These copies share complete source geometry and one full deformer chain.
 const copyPairs=copiedRear;
 for(const[a,b]of copyPairs){expect(source.curves.some(c=>c.id===a)).toBe(true);expect(source.curves.some(c=>c.id===b)).toBe(true);}
 for(let x=0;x<=90;x++){
  const out=evaluateRecording(p,{angle:{x,y:0}}),d=out.drawing;
  expect(out.routeDiagnostics,`route at ${x}`).toEqual([]);expect(out.intervalTransportErrors,`interval at ${x}`).toEqual([]);expect(out.warningCurveIds,`fit at ${x}`).toEqual([]);
  for(const link of d.endpointLinks??[]){const a=nodeAt(d,link.a).position,b=nodeAt(d,link.b).position;expect(Math.hypot(a[0]-b[0],a[1]-b[1]),`link at ${x}`).toBeLessThan(1e-12);}
  for(const[a,b]of copyPairs)expect(shapeOf(d,a),`copy at ${x}`).toEqual(shapeOf(d,b));
 }
 expect(JSON.stringify(p)).toBe(before);
},60000);

test('the old upper contour stays covered until the new Q-to-nose chain is complete',()=>{
 const p=sourceProject();
 const covered=(d:NonNullable<typeof p.drawing>,owner:string,a:number,b:number)=>{const f=displayField(d,displayPath(d,owner));return (f.mask??[[0,1]]).some(([lo,hi])=>lo<=Math.min(a,b)+1e-8&&hi>=Math.max(a,b)-1e-8);};
 for(let i=0;i<=100;i++){
  const x=45+i/20,d=evaluateRecording(p,{angle:{x,y:0}}).drawing,old=createDisplayRouteField(d,displayRouteFor(d,oldUpper)!),next=createDisplayRouteField(d,displayRouteFor(d,newJaw)!);
  // The preserved base SHOW stops just before the geometric temple node.
  // Sample inside that authored terminal cut, rather than requiring hidden ink.
  const oldA=old.positionOf({kind:'curve',curveId:oldUpper,t:.0001})!,oldB=old.positionOf({kind:'curve',curveId:oldUpper,t:1})!,newA=next.positionOf({kind:'curve',curveId:newJaw,t:0})!,newB=next.positionOf({kind:'curve',curveId:noseBridge,t:.25})!;
  const oldFull=covered(d,oldUpper,oldA,oldB),newFull=covered(d,newJaw,newA,newB);
  expect(oldFull||newFull,`continuous contour coverage at ${x}`).toBe(true);
  if(x<=48)expect(oldFull,`old contour withdrew early at ${x}`).toBe(true);
  if(x>=48)expect(newFull,`new contour incomplete at ${x}`).toBe(true);
 }
},60000);

test('fractional yaw never emits appearance outside its validated normalized domain',()=>{
 const p=sourceProject(),rig=p.vectorRecording!.rigs.find(r=>r.artworkId===p.drawingSnapshots!.activeId)!;
 for(let i=0;i<=1800;i++){const x=i/20,pose=evaluatePose(rig,{x,y:0},p.drawing!);expect(()=>validateIntervalOverrides(pose.intervalOverrides,p.drawing!),`appearance at ${x} degrees`).not.toThrow();}
},30000);
