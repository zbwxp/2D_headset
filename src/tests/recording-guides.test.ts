import {test,expect} from 'vitest';
import {createRecorded,duplicate,editShape,mirrorEdit,updateCurve} from '../domain/recording/commands';
import {emptyRecording,parseRecording} from '../domain/recording/model';
import {evaluate} from '../domain/recording/evaluation';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {parseLandmarks} from '../domain/landmarks/persistence';

const front={yaw:0,pitch:0};
test('guide classification is optional for legacy curves, validated and saved independently of names',()=>{
 let r=createRecorded(emptyRecording(),front,'normal','Ordinary');
 r=createRecorded(r,front,'guide','Guide',undefined,true);
 r=updateCurve(r,'guide',c=>({...c,name:'Renamed without a guide prefix'}));
 const saved=parseLandmarks(JSON.stringify({...createLandmarkProject(),recording:r})).recording!;
 expect(saved).toEqual(r);
 expect(saved.curves[0].auxiliary).toBeUndefined();
 expect(saved.curves[1].auxiliary).toBe(true);
 for(const invalid of ['true',1,null])expect(()=>parseRecording({...r,curves:[{...r.curves[1],auxiliary:invalid}]})).toThrow();
});

test('guide has ordinary Auto-Key, frozen and interpolated geometry; duplicate keeps classification',()=>{
 let r=createRecorded(emptyRecording(),front,'guide','Guide',undefined,true);
 r=editShape(r,'guide',{yaw:30,pitch:0},s=>{s[1][0]+=.15;return s;});
 const c=r.curves[0],ordinary={...c,auxiliary:undefined};
 expect(c.keys).toHaveLength(2);
 for(const yaw of [0,15,30,-60]){
  const v={yaw,pitch:0};
  expect(evaluate(c,v)).toEqual(evaluate(ordinary,v));
  const copy=duplicate(r,c.id,v,'copy',[0,0]).curves[1];
  expect(copy.auxiliary).toBe(true);
  expect(copy.keys).toHaveLength(1);
  expect(evaluate(copy,v).shape).toEqual(evaluate(c,v).shape);
 }
});

test('Mirror Edit preserves target classification in both directions',()=>{
 let r=createRecorded(emptyRecording(),front,'normal','Ordinary');
 r=createRecorded(r,front,'guide','Guide',undefined,true);
 const a=mirrorEdit(r,'guide','normal',front),b=mirrorEdit(r,'normal','guide',front);
 expect(a.curves[0].auxiliary).toBeUndefined();
 expect(b.curves[1].auxiliary).toBe(true);
 expect(a.curves[1]).toBe(r.curves[1]);
 expect(b.curves[0]).toBe(r.curves[0]);
});
