import {describe,it,expect} from 'vitest';
import {emptyDrawing,parseDrawing,shapeOf,type DrawingDocument,type StrokeDisplayIntervals,type DisplayInterval,type Cubic} from '../../domain/drawing/model';
import {addLayer,createCurve,ellipse} from '../../domain/drawing/commands';
import {displayField,displayPath} from '../../domain/drawing/displayIntervals';
import {intervalPinch} from '../../domain/drawing/intervalPinch';
import {blendPoseIntervals} from '../../domain/recording/poseIntervals';
import {applyIntervalOverrides,blendIntervalOverrides,missingCornerIntervals,cloneIntervalTracks,applyIntervalEnableFlags,validateIntervalOverrides} from '../../domain/vectorRecording/intervals';
import {createWarpGrid,moveWarpNode} from '../../domain/vectorWarp/model';
import {deformDrawing} from '../../domain/vectorWarp/evaluation';
import {createFill} from '../../domain/drawing/paintCommands';
import {fillGeometry,fillVisible} from '../../domain/drawing/appearance';
import {createArtworkRig,evaluatePose,currentPose,saveKeyform,applyVisibility} from '../../domain/vectorRecording/model';

function source():DrawingDocument {
 let d=addLayer(emptyDrawing(),'Line');d=createCurve(d,d.layers[0].id,[[0,0],[1/3,0],[2/3,0],[1,0]],.02,'Line','line');
 return {...d,displayIntervals:[{id:'track',anchor:{id:'line',reverse:false},ranges:[{id:'range',start:.2,end:.4,mode:'HIDE',inkEnds:[{taper:.02},{taper:.04}]}]}]};
}
function changed(d:DrawingDocument,change:Partial<DisplayInterval>,trackId='track'):StrokeDisplayIntervals[]{return d.displayIntervals!.map(t=>t.id===trackId?{...t,ranges:t.ranges.map(r=>({...r,...change}))}:t);}
const field=(d:DrawingDocument,id='line')=>displayField(d,displayPath(d,id));
const first=(tracks:StrokeDisplayIntervals[])=>tracks[0].ranges[0];

describe('source-space interval appearance overrides',()=>{
 it('replaces only known track appearance while source geometry and IDs remain canonical',()=>{
  const d=source(),before=JSON.stringify(d),overrides=changed(d,{start:.3,end:.75}),result=applyIntervalOverrides(d,overrides);
  expect(result.nodes).toBe(d.nodes);expect(result.curves).toBe(d.curves);expect(result.layers).toBe(d.layers);expect(result.fills).toBe(d.fills);expect(JSON.stringify(d)).toBe(before);expect(result.displayIntervals![0].id).toBe('track');expect(first(result.displayIntervals!).start).toBe(.3);
  first(result.displayIntervals!).start=.5;expect(first(overrides).start).toBe(.3);expect(first(d.displayIntervals!).start).toBe(.2);
 });
 it('validates appearance without admitting geometry, new canonical tracks, retargeting or invalid values',()=>{
  const d=source();expect(()=>validateIntervalOverrides(d.displayIntervals,d)).not.toThrow();
  for(const bad of [changed(d,{start:-.1}),changed(d,{end:NaN}),changed(d,{enabled:'yes' as unknown as boolean}),[{...d.displayIntervals![0],id:'other'}],[{...d.displayIntervals![0],anchor:{id:'line',reverse:true}}],[{...d.displayIntervals![0],scope:'CURVE' as const}],[{...d.displayIntervals![0],nodes:[]}]] as unknown[]){expect(()=>validateIntervalOverrides(bad,d)).toThrow();}
  expect(()=>validateIntervalOverrides([{...d.displayIntervals![0],ranges:[{id:'derived-channel',mode:'SHOW',start:0,end:.2}]}],d)).not.toThrow();
  expect(()=>applyIntervalOverrides(d,changed(d,{id:'line'}))).toThrow();
 });
 it('interpolates boundaries continuously through the old proven coverage engine',()=>{
  const d=source(),a=changed(d,{start:.1,end:.3}),b=changed(d,{start:.6,end:.9});
  const states=[0,.25,.49,.5,.51,.75,1].map(t=>blendIntervalOverrides(d,[{overrides:a,weight:1-t},{overrides:b,weight:t}]));
  states.forEach((tracks,i)=>{const t=[0,.25,.49,.5,.51,.75,1][i];expect(first(tracks).start).toBeCloseTo(.1+.5*t);expect(first(tracks).end).toBeCloseTo(.3+.6*t);});
  const legacy=blendPoseIntervals(d,[{drawing:applyIntervalOverrides(d,a),weight:.4},{drawing:applyIntervalOverrides(d,b),weight:.6}]);
  expect(blendIntervalOverrides(d,[{overrides:a,weight:.4},{overrides:b,weight:.6}])).toEqual(legacy);
 });
 it('inherits omitted tracks from source, accepts positive non-normalized weights, rejects negative ones',()=>{
  const d=source(),out=blendIntervalOverrides(d,[{weight:3},{overrides:changed(d,{start:.6,end:.8}),weight:1}]);expect(first(out).start).toBeCloseTo(.3);
  expect(blendIntervalOverrides(d,[])).toEqual(d.displayIntervals);expect(()=>blendIntervalOverrides(d,[{weight:-1},{weight:2}])).toThrow();expect(()=>blendIntervalOverrides(d,[{weight:0}])).toThrow();
 });
 it('preserves separate canonical tracks on one source path instead of duplicating merged coverage',()=>{
  const d=source();d.displayIntervals!.push({id:'second',anchor:{id:'line',reverse:false},ranges:[{id:'second-range',start:.7,end:.8,mode:'HIDE'}]});
  const overrides=changed(d,{start:.3,end:.5}),tracks=blendIntervalOverrides(d,[{weight:.5},{overrides,weight:.5}]),result=applyIntervalOverrides(d,tracks);
  expect(tracks.map(t=>t.id)).toEqual(['track','second']);expect(result.displayIntervals).toHaveLength(2);expect(tracks.flatMap(t=>t.ranges)).toHaveLength(2);expect(()=>parseDrawing(result)).not.toThrow();
 });
 it('supports SHOW/HIDE role changes without losing derived channels at save/apply',()=>{
  const d=source(),show=changed(d,{mode:'SHOW',start:.2,end:.8}),mid=blendIntervalOverrides(d,[{weight:.5},{overrides:show,weight:.5}]);
  const result=applyIntervalOverrides(d,mid);expect(result.displayIntervals![0].id).toBe('track');expect(()=>parseDrawing(result)).not.toThrow();expect(field(result).mask).not.toEqual(field(d).mask);expect(field(result).mask).not.toEqual(field(applyIntervalOverrides(d,show)).mask);
 });
 it('blends physical tip distances across multiplier/absolute representations',()=>{
  const d=source(),a=changed(d,{inkEnds:[{taperWidthScale:20},{taper:.02}]}),b=changed(d,{inkEnds:[{taper:.2},{taperWidthScale:4}]}),range=first(blendIntervalOverrides(d,[{overrides:a,weight:.5},{overrides:b,weight:.5}]));
  expect(range.inkEnds![0].taper).toBeCloseTo(.3);expect(range.inkEnds![1].taper).toBeCloseTo(.05);expect(range.inkEnds![0].taperWidthScale).toBeUndefined();
 });
 it('allows held enabled-state selection independently of positional weights',()=>{
  const d=source(),off=changed(d,{enabled:false,start:.2}),on=changed(d,{enabled:true,start:.6,end:.8});
  const tracks=blendIntervalOverrides(d,[{overrides:off,weight:.1},{overrides:on,weight:.9}],0);expect(first(tracks).enabled).toBe(false);expect(first(tracks).start).toBeCloseTo(.56);
  expect(first(blendIntervalOverrides(d,[{overrides:off,weight:.1},{overrides:on,weight:.9}],1)).enabled).toBe(true);
 });
 it('handles closed wrap, full-loop and reversed-direction appearance',()=>{
  const d=addLayer(emptyDrawing(),'Loop'),e=ellipse(d,d.layers[0].id,[-1,-1],[1,1],.02),id=e.ids[0],base:DrawingDocument={...e.document,displayIntervals:[{id:'loop',anchor:{id,reverse:true},ranges:[{id:'gap',mode:'HIDE',start:.85,end:.15}]}]},other=changed(base,{start:.95,end:.25},'loop');
  const range=first(blendIntervalOverrides(base,[{weight:.5},{overrides:other,weight:.5}]));expect(range.start).toBeCloseTo(.9);expect(range.end).toBeCloseTo(.2);expect(()=>parseDrawing(applyIntervalOverrides(base,[{...base.displayIntervals![0],ranges:[range]}]))).not.toThrow();
  const full=changed(base,{start:0,end:1},'loop');expect(first(blendIntervalOverrides(base,[{overrides:full,weight:1}]))).toMatchObject({start:0,end:1});
 });
});

describe('missing 2D appearance corners',()=>{
 it('inherits only-X or only-Y edits without neutral dilution',()=>{
  const d=source(),x=changed(d,{start:.6,end:.8}),n=d.displayIntervals;
  expect(missingCornerIntervals(d,n,x,n,{x:90,y:90})).toEqual(x);expect(missingCornerIntervals(d,n,n,x,{x:90,y:90})).toEqual(x);
 });
 it('recognizes equivalent tip representation and empty defaults as unchanged',()=>{
  const d=source();first(d.displayIntervals!).inkEnds=[{taperWidthScale:20},{}];const neutral=d.displayIntervals!,x=changed(d,{start:.6,end:.8}),y=changed(d,{inkEnds:[{taper:.4},{}]});
  expect(first(y).inkEnds![0].taper).toBeCloseTo(.4);expect(missingCornerIntervals(d,neutral,x,y,{x:90,y:90})).toEqual(x);
 });
 it('combines both-edited tracks with positive angle magnitudes, preserving a single-axis edit on other tracks',()=>{
  const d=source();d.displayIntervals!.push({id:'other',anchor:{id:'line',reverse:false},ranges:[{id:'other-range',start:.8,end:.9,mode:'HIDE'}]});
  const x=changed(d,{start:.1,end:.3}),y=changed(d,{start:.6,end:.8});x[1]={...x[1],ranges:[{...x[1].ranges[0],start:.7}]};
  const mixed=missingCornerIntervals(d,undefined,x,y,{x:-90,y:30});expect(first(mixed).start).toBeCloseTo(.225);expect(first(mixed).end).toBeCloseTo(.425);expect(mixed[1]).toEqual(x[1]);
 });
});

describe('single transport and transient ink behavior',()=>{
 it('preserves legacy pinch-before-gap through overrides, enabled flags and Warp transport',()=>{
  const d=source();d.displayIntervals![0].ranges=[{id:'range',mode:'HIDE',start:.5,end:.5,inkEnds:[{taper:.1},{taper:.1}]}];const open=changed(d,{start:.4,end:.6}),tracks=blendIntervalOverrides(d,[{weight:.99},{overrides:open,weight:.01}]),strength=intervalPinch(first(tracks));
  expect(strength).toBeGreaterThan(0);expect(intervalPinch(first(cloneIntervalTracks(tracks)))).toBe(strength);expect(intervalPinch(first(applyIntervalEnableFlags(tracks,{})))).toBe(strength);
  const posed=applyIntervalOverrides(d,tracks),g=moveWarpNode(createWarpGrid({min:[-1,-1],max:[2,1]},2,2),4,[.65,.2]),warped=deformDrawing(posed,g,{diagnostics:'preview'});
  expect(intervalPinch(first(warped.drawing.displayIntervals!))).toBe(strength);expect(JSON.stringify(warped.drawing)).not.toContain('pinch');
 });
 it('applies intervals in source space and transports exactly once with bit-identical preview/full geometry',()=>{
  const d=source(),before=JSON.stringify(d),overrides=blendIntervalOverrides(d,[{weight:.5},{overrides:changed(d,{start:.5,end:.85}),weight:.5}]),posed=applyIntervalOverrides(d,overrides),g=moveWarpNode(createWarpGrid({min:[-1,-1],max:[2,1]},2,2),4,[.9,.5]);
  const a=deformDrawing(posed,g,{diagnostics:'preview'}),b=deformDrawing(posed,g);expect(a.drawing).toEqual(b.drawing);expect(JSON.stringify(d)).toBe(before);expect(posed.nodes).toBe(d.nodes);expect(a.intervalTransportErrors).toEqual([]);expect(shapeOf(a.drawing,'line')).toHaveLength(4);
 });
});


describe('recording integration keeps original vector semantics',()=>{
 it('evaluates only-X interval edits without dilution by missing 2D corners, and exact corrective keys win',()=>{
  const d=source(),rig=createArtworkRig('source',d),x=rig.keys.find(k=>k.angle.x===90&&k.angle.y===0)!;x.intervalOverrides=changed(d,{start:.6,end:.9});
  const pose=evaluatePose(rig,{x:45,y:45},d);expect(first(pose.intervalOverrides!).start).toBeCloseTo(.4);expect(first(pose.intervalOverrides!).end).toBeCloseTo(.65);
  rig.keys.push({...rig.keys[0],id:'correction',name:'Correction',angle:{x:45,y:45},intervalOverrides:changed(d,{start:.1,end:.2})});expect(first(evaluatePose(rig,{x:45,y:45},d).intervalOverrides!).start).toBe(.1);
 });
 it('saves appearance keyforms without writing source and applies overrides before geometry transport',()=>{
  const d=source(),before=JSON.stringify(d),rig=createArtworkRig('source',d);rig.angle={x:30,y:0};rig.draft={...currentPose(rig,d),intervalOverrides:changed(d,{start:.4,end:.75})};
  const saved=saveKeyform(rig,'Test',d),pose=evaluatePose(saved,{x:30,y:0},d),applied=applyVisibility(d,pose);expect(first(applied.displayIntervals!).start).toBe(.4);expect(saved.draft).toBeUndefined();expect(JSON.stringify(d)).toBe(before);expect(applied.nodes).toBe(d.nodes);
 });
 it('hiding complete boundary ink never opens or disables an intentional white fill',()=>{
  let d=addLayer(emptyDrawing(),'Eye');const e=ellipse(d,d.layers[0].id,[-.7,-.3],[.7,.3],.02);d=createFill(e.document,e.ids,'white');d.displayIntervals=[{id:'eye-track',anchor:{id:e.ids[0],reverse:false},ranges:[{id:'eye-range',mode:'HIDE',start:.2,end:.4}]}];
  const overrides=changed(d,{start:0,end:1},'eye-track'),posed=applyIntervalOverrides(d,overrides),g=moveWarpNode(createWarpGrid({min:[-1,-1],max:[1,1]},2,2),4,[.2,.2]),result=deformDrawing(posed,g,{diagnostics:'preview'});
  expect(field(result.drawing,e.ids[0]).mask).toEqual([]);expect(fillVisible(result.drawing,result.drawing.fills[0])).toBe(true);expect(fillGeometry(result.drawing,result.drawing.fills[0]).error).toBeUndefined();expect(result.drawing.fills).toEqual(d.fills);expect(result.drawing.layers).toEqual(d.layers);expect(d.displayIntervals[0].ranges[0].start).toBe(.2);
 });
});
