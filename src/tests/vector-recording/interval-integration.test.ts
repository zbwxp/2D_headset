import {describe,it,expect} from 'vitest';
import {emptyDrawing,type DrawingDocument} from '../../domain/drawing/model';
import {createArtworkRig,evaluatePose,currentPose,saveKeyform,setRigAngle,applyVisibility,emptyVectorRecording} from '../../domain/vectorRecording/model';
import {parseVectorRecording} from '../../domain/vectorRecording/persistence';
import {deformDrawing} from '../../domain/vectorWarp/evaluation';
import {fillGeometry} from '../../domain/drawing/appearance';
function line():DrawingDocument{return {...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]}],curves:[{id:'c',name:'Line',nodes:['a','b'],handles:[[1/3,0],[2/3,0]],width:.01,visible:true,locked:false}],layers:[{id:'l',name:'Layer',items:['c'],visible:true,locked:false}],displayIntervals:[{id:'track',anchor:{id:'c',reverse:false},scope:'CURVE',ranges:[{id:'range',mode:'HIDE',start:.4,end:.4}]}]};}
describe('angle interval appearance integration',()=>{
 it('smoothly opens a gap across 0/intermediate/90 keys without changing source JSON',()=>{
  const d=line(),before=JSON.stringify(d);let r=setRigAngle(createArtworkRig('front',d),{x:90,y:0});const p=currentPose(r,d),tracks=structuredClone(d.displayIntervals!);tracks[0].ranges[0].end=.8;r=saveKeyform({...r,draft:{...p,intervalOverrides:tracks}},undefined,d);
  for(const [x,end] of [[0,.4],[22.5,.5],[45,.6],[67.5,.7],[90,.8]]){const pose=evaluatePose(r,{x,y:0},d),visible=applyVisibility(d,pose),output=deformDrawing(visible,[]);expect(output.drawing.displayIntervals![0].ranges[0].end).toBeCloseTo(end,10);}
  expect(JSON.stringify(d)).toBe(before);expect(r.keys.find(k=>k.angle.x===90)!.intervalOverrides![0].ranges[0].end).toBe(.8);
  expect(()=>evaluatePose(r,{x:45,y:0})).toThrow('source artwork');expect(evaluatePose(r,{x:90,y:0}).intervalOverrides![0].ranges[0].end).toBe(.8);
 });
 it('keeps interval enable state separate and persists source-space overrides across save/reload',()=>{
  const d=line();let r=setRigAngle(createArtworkRig('front',d),{x:90,y:0});const pose=currentPose(r,d),intervalOverrides=structuredClone(d.displayIntervals!);intervalOverrides[0].ranges[0]={...intervalOverrides[0].ranges[0],start:.2,end:.9,inkEnds:[{taper:.01},{taper:.03}]};r=saveKeyform({...r,draft:{...pose,intervals:{range:false},intervalOverrides}},undefined,d);
  const loaded=parseVectorRecording(JSON.parse(JSON.stringify({...emptyVectorRecording(),rigs:[r]}))).rigs[0],p=evaluatePose(loaded,{x:90,y:0},d),result=applyVisibility(d,p).displayIntervals![0].ranges[0];expect(result).toMatchObject({start:.2,end:.9,enabled:false,inkEnds:[{taper:.01},{taper:.03}]});expect(d.displayIntervals![0].ranges[0]).toEqual({id:'range',mode:'HIDE',start:.4,end:.4});
 });
 it('does not dilute a sole X-axis reveal at missing XY corners and honors explicit correctives',()=>{
  const d=line();let r=setRigAngle(createArtworkRig('front',d),{x:90,y:0}),p=currentPose(r,d),tracks=structuredClone(d.displayIntervals!);tracks[0].ranges[0].end=.8;r=saveKeyform({...r,draft:{...p,intervalOverrides:tracks}},undefined,d);
  expect(applyVisibility(d,evaluatePose(r,{x:90,y:90},d)).displayIntervals![0].ranges[0].end).toBeCloseTo(.8);r=setRigAngle(r,{x:45,y:45});p=currentPose(r,d);tracks=structuredClone(p.intervalOverrides!);tracks[0].ranges[0].end=.95;r=saveKeyform({...r,draft:{...p,intervalOverrides:tracks}},undefined,d);expect(applyVisibility(d,evaluatePose(r,{x:45,y:45},d)).displayIntervals![0].ranges[0].end).toBeCloseTo(.95);
 });
 it('hides closure-edge ink while retaining an overlapping white face fill and its complete boundary',()=>{
  const d=line();d.nodes.push({id:'z',position:[.5,1]});d.curves.push({id:'c2',name:'Side',nodes:['b','z'],handles:[[.9,.2],[.6,.8]],width:.01,visible:true,locked:false},{id:'c3',name:'Closure',nodes:['z','a'],handles:[[.4,.8],[.1,.2]],width:.01,visible:true,locked:false});d.layers[0].items.push('c2','c3','f');d.fills=[{id:'f',name:'White face piece',visible:true,locked:false,color:'white',boundary:[{id:'c',reverse:false},{id:'c2',reverse:false},{id:'c3',reverse:false}]}];d.displayIntervals![0].anchor.id='c3';const before=JSON.stringify(d),p=currentPose(createArtworkRig('front',d),d),overrides=structuredClone(d.displayIntervals!);overrides[0].ranges[0].start=0;overrides[0].ranges[0].end=1;
  const out=deformDrawing(applyVisibility(d,{...p,intervalOverrides:overrides}),[]).drawing;expect(out.fills).toEqual(d.fills);expect(out.fills[0].color).toBe('white');expect(fillGeometry(out,out.fills[0]).shapes).toEqual(fillGeometry(d,d.fills[0]).shapes);expect(out.curves.every(c=>c.visible)).toBe(true);expect(out.displayIntervals![0].ranges[0]).toMatchObject({mode:'HIDE',start:0,end:1});expect(JSON.stringify(d)).toBe(before);
 });
});
