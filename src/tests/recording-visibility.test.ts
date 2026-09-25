import {test,expect} from 'vitest';
import {createRecorded} from '../domain/recording/commands';
import {emptyRecording,parseRecording} from '../domain/recording/model';
import {setViewVisibility,curveVisible,pointVisible} from '../domain/recording/visibility';
import {createRecordedPoint,editRecordedPoint,createSemanticCurve} from '../domain/recording/points';
import {evaluateRecording} from '../domain/recording/junctions';
test('per-view visibility preserves shape keys, canonicalizes yaw, restores and persists',()=>{
 let r=createRecorded(emptyRecording(),{yaw:0,pitch:0},'a','A');const c=r.curves[0];r={...r,curves:[{...c,keys:[c.keys[0],{...c.keys[0],yaw:60}]}]};
 const next=setViewVisibility(r,'a',{yaw:-30,pitch:0},false),n=next.curves[0];
 expect(n.keys).toBe(r.curves[0].keys);expect(curveVisible(n,{yaw:0,pitch:0})).toBe(true);expect(curveVisible(n,{yaw:60,pitch:0})).toBe(true);expect(curveVisible(n,{yaw:30,pitch:0})).toBe(false);expect(curveVisible(n,{yaw:-30,pitch:0})).toBe(false);
 expect(parseRecording(JSON.parse(JSON.stringify(next)))).toEqual(next);
 expect(curveVisible(setViewVisibility(next,'a',{yaw:30,pitch:0},true).curves[0],{yaw:30,pitch:0})).toBe(true);
 expect(()=>parseRecording({...next,curves:[{...n,visibilityKeys:[{yaw:0,pitch:0,visible:2}]}]})).toThrow();
 expect(setViewVisibility({...r,curves:[{...r.curves[0],locked:true}]},'a',{yaw:0,pitch:0},false).curves[0].visibilityKeys).toBeUndefined();
});
test('point per-view hiding keeps endpoint geometry and shape keys, with canonical yaw and persistent restoration',()=>{
 const front={yaw:0,pitch:0},side={yaw:60,pitch:0},mid={yaw:30,pitch:0};
 let r=emptyRecording();
 for(const id of ['a','b']){r=createRecordedPoint(r,front,id,id,[id==='a'?-.5:.5,0]);r=editRecordedPoint(r,id,side,[id==='a'?-.4:.4,.1]);}
 r=createSemanticCurve(r,front,'curve','Semantic','a','b');
 const next=setViewVisibility(r,'a',{...mid,yaw:-30},false),p=next.points![0];
 expect(next.curves).toBe(r.curves);expect(p.keys).toBe(r.points![0].keys);expect(p.visible).toBe(true);
 expect(pointVisible(p,front)).toBe(true);expect(pointVisible(p,side)).toBe(true);
 expect(pointVisible(p,mid)).toBe(false);expect(pointVisible(p,{...mid,yaw:-30})).toBe(false);
 expect(evaluateRecording(next,mid)).toEqual(evaluateRecording(r,mid));expect(parseRecording(next)).toEqual(next);
 expect(setViewVisibility(next,'a',mid,false)).toBe(next);
 const restored=setViewVisibility(next,'a',mid,true);expect(pointVisible(restored.points![0],mid)).toBe(true);
 expect(pointVisible({...restored.points![0],visible:false},mid)).toBe(false);
 const locked={...r,points:r.points!.map(p=>({...p,locked:true}))};expect(setViewVisibility(locked,'a',mid,false)).toBe(locked);
 for(const visibilityKeys of [[],[{...mid,visible:1}],[{...mid,visible:false},{...mid,visible:true}],[{yaw:-30,pitch:0,visible:false}]]){
  expect(()=>parseRecording({...r,points:r.points!.map(p=>({...p,visibilityKeys}))})).toThrow();
 }
});
