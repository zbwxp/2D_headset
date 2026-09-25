import {test,expect} from 'vitest';
import {parseRecording,emptyRecording} from '../domain/recording/model';
import {createRecorded,duplicate} from '../domain/recording/commands';
import {recordingReferenceLayout,saveBackgroundState,applyBackgroundState,updateBackgroundState,renameBackgroundState,deleteBackgroundState,matchesBackgroundState,type RecordingReferenceImage} from '../domain/recording/reference';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {createLandmarkProject} from '../domain/landmarks/presets';
import type {ReferenceImage} from '../domain/project/types';
const photo:ReferenceImage={name:'nine cells.png',dataUrl:'data:image/png;base64,AAAA',width:3000,height:3000,scale:10,offset:[-8,10],rotation:12,opacity:.5,locked:false,visible:true};
test('room background persists independently of view keys and ordinary 2D references',()=>{
 const project=createLandmarkProject(),views=structuredClone(project.views),r={...emptyRecording(),reference:photo};
 const curve=createRecorded(r,{yaw:0,pitch:0},'a','A'),copied=duplicate(curve,'a',{yaw:45,pitch:10},'b',[0,0]);
 const loaded=parseLandmarks(JSON.stringify({...project,recording:copied}));
 expect(loaded.recording?.reference).toEqual(photo);expect(loaded.recording?.curves).toHaveLength(2);expect(loaded.views.map(v=>v.reference)).toEqual(views.map(v=>v.reference));
 expect(parseRecording(JSON.parse(JSON.stringify(loaded.recording)))).toEqual(copied);
 expect(parseRecording({version:1,curves:[]})).not.toHaveProperty('reference');
});
test('invalid background transforms and nonembedded image sources are rejected',()=>{
 for(const patch of [{offset:[10.01,0]},{offset:[0,NaN]},{offset:[0]},{width:0},{height:5000},{scale:0},{scale:10.1},{opacity:2},{rotation:181},{locked:1},{dataUrl:'https://example.com/image.png'},{dataUrl:'data:image/svg+xml;base64,AAAA'}]){
  expect(()=>parseRecording({version:1,curves:[],reference:{...photo,...patch}})).toThrow();
 }
 const parsed=parseRecording({version:1,curves:[],reference:photo});parsed.reference!.offset[0]=0;expect(photo.offset[0]).toBe(-8);
});
test('background uses stable room coordinates, scales with viewport, and permits all nine cells',()=>{
 const left={...photo,scale:3,offset:[0,0] as [number,number],rotation:0};
 const a=recordingReferenceLayout(left,600,600,1,[0,0]),b=recordingReferenceLayout(left,600,600,2,[20,-10]);
 expect(b.width).toBe(a.width*2);expect([b.x,b.y]).toEqual([320,290]);
 // At 3× scale, each outer cell can be brought exactly to the viewport center.
 for(const x of [-1,0,1])for(const y of [-1,0,1]){
  const r={...left,offset:[-x*2.6,y*2.6] as [number,number]},p=recordingReferenceLayout(r,600,600,1,[0,0]);
  expect(p.x+x*p.width/3).toBeCloseTo(300);expect(p.y+y*p.height/3).toBeCloseTo(300);
 }
});
test('named background states cover nine cells and more without copying image data or changing recording keys',()=>{
 let r:RecordingReferenceImage=photo;
 for(let i=0;i<10;i++)r=saveBackgroundState({...r,offset:[(i%3-1)*2.6,(Math.floor(i/3)-1)*2.6],scale:3,rotation:i,opacity:.2+i*.05},'s'+i,'Cell '+i);
 expect(r.states).toHaveLength(10);expect(new Set(r.states!.map(s=>s.slot)).size).toBe(10);
 expect(JSON.stringify(r).match(/data:image/g)).toHaveLength(1);
 const saved=JSON.stringify(r.states),locked={...r,locked:true,visible:false};
 for(const state of r.states!){
  const applied=applyBackgroundState(locked,state.id);
  expect(matchesBackgroundState(applied,state)).toBe(true);expect(applied.offset).not.toBe(state.offset);
  expect(applied.locked).toBe(true);expect(applied.visible).toBe(false);expect(applied.dataUrl).toBe(r.dataUrl);expect(applied.states).toBe(r.states);
 }
 expect(JSON.stringify(r.states)).toBe(saved);
 const recording=createRecorded({...emptyRecording(),reference:r},{yaw:0,pitch:0},'curve','Curve');
 expect(parseRecording(JSON.parse(JSON.stringify(recording)))).toEqual(recording);
});
test('state rename, explicit overwrite and deletion preserve other states and fixed grid slots',()=>{
 let r=saveBackgroundState(photo,'last','Bottom right',8);r=saveBackgroundState(r,'first','Top left',0);
 const a=r.states![0],b=r.states![1],moved={...r,offset:[2,3] as [number,number],scale:2};
 expect(matchesBackgroundState(moved,b)).toBe(false);expect(moved.states![1]).toBe(b);
 const updated=updateBackgroundState(moved,'first');expect(updated.states![1].offset).toEqual([2,3]);expect(updated.states![0]).toBe(a);
 const renamed=renameBackgroundState(updated,'first','New Name');expect(renamed.states![1].name).toBe('New Name');
 expect(renameBackgroundState(renamed,'first','  ')).toBe(renamed);
 expect(updateBackgroundState(renamed,'first')).toBe(renamed);
 const removed=deleteBackgroundState(renamed,'first');expect(removed.states).toEqual([a]);expect(removed.activeStateId).toBeUndefined();expect(removed.offset).toEqual([2,3]);
 const added=saveBackgroundState(removed,'new','New');expect(added.states!.at(-1)!.slot).toBe(0);
 expect(saveBackgroundState(added,'duplicate','Duplicate',8)).toBe(added);
 expect(applyBackgroundState(added,'missing')).toBe(added);expect(deleteBackgroundState(added,'missing')).toBe(added);
});
test('invalid state transforms, identities, slots and dangling active state are rejected; legacy images still load',()=>{
 const ref=saveBackgroundState(photo,'s','Cell');
 for(const patch of [{name:''},{slot:-1},{slot:NaN},{offset:[11,0]},{scale:11},{opacity:2},{rotation:181}]){
  expect(()=>parseRecording({...emptyRecording(),reference:{...ref,states:[{...ref.states![0],...patch}]}})).toThrow();
 }
 for(const patch of [{states:{}},{states:[ref.states![0],ref.states![0]]},{states:[ref.states![0],{...ref.states![0],id:'other'}]},{activeStateId:'missing'}]){
  expect(()=>parseRecording({...emptyRecording(),reference:{...ref,...patch}})).toThrow();
 }
 expect(parseRecording({...emptyRecording(),reference:photo}).reference).toEqual(photo);
});
