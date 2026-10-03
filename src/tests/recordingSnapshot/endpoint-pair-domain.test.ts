import {describe,it,expect} from 'vitest';
import {emptyDrawing,sub,length,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {registerEvaluatedAffine} from '../../domain/drawing/evaluatedAffine';
import {displayField,displayPath} from '../../domain/drawing/displayIntervals';
import {transportDeformedIntervals} from '../../domain/drawing/deform';
import {evaluateRecordingSnapshot,resolveEndpointPairBasis} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {evaluateEndpointResponse,invertEndpointPairCoordinate,interpolateEndpointPairDrawing,endpointPairCompatibility,endpointPairNodeAuthorities,validateSnapshotControlResponse} from '../../domain/recordingSnapshot/endpointPair';

function drawing():DrawingDocument{return {...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]}],curves:[{id:'c',name:'Curve',nodes:['a','b'],handles:[[.2,.3],[.8,.3]],width:.01,visible:true,locked:false}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['c']}]};}
function pair(side=90){const w=emptyRecordingSnapshotWorkspace(),d=drawing();w.library.nodes=Object.fromEntries(d.nodes.map(n=>[n.id,n]));w.library.curves=Object.fromEntries(d.curves.map(c=>[c.id,c]));
 const start=emptyRecordingSnapshot('start','Front'),end=emptyRecordingSnapshot('end','Side','view',{x:side,y:0});for(const snapshot of [start,end])snapshot.layers=d.layers.map(l=>({...l,kind:'original'}));
 const r=emptySnapshotRecording('recording');r.mode='endpoint-pair';r.snapshotIds=['start','end'];r.endpointPair={axis:'x',startSnapshotId:'start',endSnapshotId:'end'};r.tracks=[{id:'shape',channel:'shape',targetId:'layer',keys:[{id:'end',angle:{x:side,y:0},value:{nodes:{a:[2,4],b:[4,2]},handles:{c:[[1,2],[3,1]]}}}]}];w.snapshots=[start,end];w.recordings=[r];return {w,r,start,end};}

describe('native endpoint pair scalar response domain',()=>{
 it('pins exact endpoints and interpolates signed, overshooting and descending scalar constraints',()=>{
  const knots:Point2[]=[[.25,-2],[.5,3],[.75,1.5]];validateSnapshotControlResponse({x:knots});
  expect([0,.25,.5,.75,1].map(t=>evaluateEndpointResponse(knots,t))).toEqual([0,-2,3,1.5,1]);expect(evaluateEndpointResponse(knots,.625)).toBe(2.25);expect(evaluateEndpointResponse(knots,.125)).toBe(-1);
  expect(()=>validateSnapshotControlResponse({x:[[.3,1],[.3,2]]})).toThrow();expect(()=>validateSnapshotControlResponse({x:[[0,0]]})).toThrow();expect(()=>validateSnapshotControlResponse({y:[[.5,Infinity]]})).toThrow();
 });
 it('inverts nonzero deltas without a clamp and rejects only numerically unavailable axes',()=>{
  expect(invertEndpointPairCoordinate(2,4,-2)).toEqual({available:true,value:-2});expect(invertEndpointPairCoordinate(2,4,10)).toEqual({available:true,value:4});expect(invertEndpointPairCoordinate(1,1,2).available).toBe(false);expect(invertEndpointPairCoordinate(0,1e-16,1).available).toBe(false);expect(invertEndpointPairCoordinate(0,1e-10,3e-10)).toEqual({available:true,value:3});expect(invertEndpointPairCoordinate(0,1,Infinity).available).toBe(false);
 });
 it.each([-90,90])('samples the two endpoint basis at yaw %s without intermediate geometry keys',side=>{
  const {w,r}=pair(side),saved=JSON.stringify(w),basis=resolveEndpointPairBasis(w,r.id),value=evaluateRecordingSnapshot(w,r.id,{angle:{x:side/3,y:0}});
  expect(value.drawing.nodes[0].position[0]).toBeCloseTo(2/3);expect(value.drawing.nodes[0].position[1]).toBeCloseTo(4/3);expect(value.endpointPair?.role).toBe('correction');expect(value.endpointPair?.start).toBe(basis.start);expect(value.fitDiagnostics).toEqual([]);expect(JSON.stringify(w)).toBe(saved);
  expect(evaluateRecordingSnapshot(w,r.id,{angle:{x:0,y:0}}).drawing).toBe(basis.start.drawing);expect(evaluateRecordingSnapshot(w,r.id,{angle:{x:side,y:0}}).drawing).toBe(basis.end.drawing);
 });
 it('uses endpoint-relative handle vectors and independent node/handle X/Y responses',()=>{
  const {w,r}=pair();r.endpointPair!.responses={nodes:{a:{x:[[.5,-1]],y:[[.5,2]]}},handles:{c:[{x:[[.5,3]],y:[[.5,-1]]},{}]}};
  const result=evaluateRecordingSnapshot(w,r.id,{angle:{x:45,y:0}}).drawing,p=result.nodes.find(n=>n.id==='a')!.position;
  expect(p).toEqual([-2,8]);expect(result.curves[0].handles[0][0]).toBeCloseTo(p[0]+.2+1*3);expect(result.curves[0].handles[0][1]).toBeCloseTo(p[1]+.3+2*-1);
 });
 it('keeps endpoint bases live and leaves stored scalar constraints unchanged after source and endpoint changes',()=>{
  const {w,r}=pair();r.endpointPair!.responses={nodes:{a:{x:[[.5,2]]}},handles:{}};const responses=JSON.stringify(r.endpointPair!.responses),before=evaluateRecordingSnapshot(w,r.id,{angle:{x:45,y:0}});
  w.library.nodes.a.position=[3,0];const sourceChanged=evaluateRecordingSnapshot(w,r.id,{angle:{x:45,y:0}});expect(sourceChanged.drawing.nodes[0].position[0]).toBeCloseTo(before.drawing.nodes[0].position[0]+3);
  const track=r.tracks[0];if(track.channel!=='shape')throw Error('shape');track.keys[0].value.nodes.a=[4,4];expect(evaluateRecordingSnapshot(w,r.id,{angle:{x:45,y:0}}).drawing.nodes[0].position[0]).toBe(11);expect(JSON.stringify(r.endpointPair!.responses)).toBe(responses);
 });
 it('previews a correction draft throughout its segment while useDraft false shows saved constraints',()=>{
  const {w,r}=pair();r.angle={x:30,y:0};r.endpointPair!.draft={angle:r.angle,responses:{nodes:{a:{x:[[1/3,2]]}},handles:{}}};
  expect(evaluateRecordingSnapshot(w,r.id,{angle:{x:60,y:0}}).drawing.nodes[0].position[0]).toBeCloseTo(3);expect(evaluateRecordingSnapshot(w,r.id,{angle:{x:60,y:0},useDraft:false}).drawing.nodes[0].position[0]).toBeCloseTo(4/3);
  const ghost=evaluateRecordingSnapshot(w,r.id,{angle:{x:45,y:0}}).drawing;r.angle={x:45,y:0};expect(evaluateRecordingSnapshot(w,r.id).drawing.nodes).toEqual(ghost.nodes);
 });
 it('includes only the current endpoint draft in its evaluated basis',()=>{
  const {w,r}=pair();r.angle={x:90,y:0};const track=r.tracks[0];if(track.channel!=='shape')throw Error('shape');track.draft={angle:r.angle,value:{nodes:{a:[6,4]},handles:{}}};
  expect(resolveEndpointPairBasis(w,r.id).end.drawing.nodes[0].position[0]).toBe(6);expect(resolveEndpointPairBasis(w,r.id,{useDraft:false}).end.drawing.nodes[0].position[0]).toBe(2);expect(evaluateRecordingSnapshot(w,r.id,{angle:{x:45,y:0}}).drawing.nodes[0].position[0]).toBe(3);
 });
 it('does not apply opt-in semantics to an existing ordinary recording',()=>{
  const {w,r}=pair();r.mode=undefined;const track=r.tracks[0];if(track.channel!=='shape')throw Error('shape');track.keys.push({id:'middle',angle:{x:45,y:0},value:{nodes:{a:[77,0]},handles:{}}});expect(evaluateRecordingSnapshot(w,r.id,{angle:{x:45,y:0}}).drawing.nodes[0].position[0]).toBe(77);r.mode='endpoint-pair';expect(evaluateRecordingSnapshot(w,r.id,{angle:{x:45,y:0}}).drawing.nodes[0].position[0]).toBe(1);
 });
 it('rejects pitch interpolation and incompatible topology rather than guessing',()=>{
  const {w,r}=pair();expect(()=>evaluateRecordingSnapshot(w,r.id,{angle:{x:30,y:10}})).toThrow(/pitch/);const a=drawing(),b=structuredClone(a);b.curves[0].nodes.reverse();expect(endpointPairCompatibility(a,b).join(' ')).toContain('Curve c');expect(()=>interpolateEndpointPairDrawing(a,b,.5)).toThrow(/topology/);
 });
 it('gives linked endpoints one canonical authority, independent of object order',()=>{
  const a=drawing();a.nodes.push({id:'d',position:[1,0]},{id:'e',position:[2,0]});a.curves.push({...a.curves[0],id:'other',nodes:['d','e'],handles:[[1.2,0],[1.8,0]]});a.layers[0].items.push('other');a.endpointLinks=[{id:'link',a:{curveId:'c',end:1},b:{curveId:'other',end:0}}];const b=structuredClone(a);for(const n of b.nodes)n.position=addPoint(n.position,[2,3]);for(const c of b.curves)c.handles=c.handles.map(p=>addPoint(p,[2,3])) as [Point2,Point2];b.nodes.reverse();b.curves.reverse();
  expect(endpointPairNodeAuthorities(a).get('d')).toBe('b');const middle=interpolateEndpointPairDrawing(a,b,.5,{nodes:{b:{x:[[.5,2]],y:[[.5,-1]]}},handles:{}}).drawing;expect(middle.nodes.find(n=>n.id==='b')!.position).toEqual([5,-3]);expect(middle.nodes.find(n=>n.id==='d')!.position).toEqual([5,-3]);b.nodes.find(n=>n.id==='d')!.position[0]+=.001;expect(endpointPairCompatibility(a,b).join(' ')).toMatch(/conflicting node d/);
 });
 it('projects SMOOTH followers through an explicit stable driver while retaining their lengths',()=>{
  const a=drawing();a.nodes.push({id:'d',position:[2,0]});a.curves[0].handles=[[.2,0],[.8,0]];a.curves.push({...a.curves[0],id:'other',nodes:['b','d'],handles:[[1.4,0],[1.8,0]]});a.layers[0].items.push('other');a.joins=[{id:'smooth',a:{curveId:'c',end:1},b:{curveId:'other',end:0},mode:'SMOOTH'}];const b=structuredClone(a);b.curves[0].handles[1]=[1,-.2];b.curves[1].handles[0]=[1,.4];
  const result=interpolateEndpointPairDrawing(a,b,.5,{nodes:{},handles:{other:[{x:[[.5,.1]],y:[[.5,.8]]},{}]}}),p=result.drawing.nodes.find(n=>n.id==='b')!.position,v=sub(result.drawing.curves[0].handles[1],p),u=sub(result.drawing.curves[1].handles[0],p);expect(v[0]*u[1]-v[1]*u[0]).toBeCloseTo(0,12);expect(length(u)).toBeCloseTo(Math.hypot(.36,.32));expect(result.diagnostics.join(' ')).toContain('stable driver');
 });
 it('retains source-t material location as the endpoint basis stretches nonuniformly',()=>{
  const a=drawing();a.displayIntervals=[{id:'material',anchor:{id:'c',reverse:false},scope:'CURVE',ranges:[{id:'cut',start:.2,end:.8}]}];const b=structuredClone(a);b.nodes[1].position=[3,0];b.curves[0].handles[1]=[2.8,.3];
  const end=transportDeformedIntervals(a,b),mid=interpolateEndpointPairDrawing(a,end,.5).drawing,expected=transportDeformedIntervals(a,mid).displayIntervals![0].ranges[0],field=displayField(mid,displayPath(mid,'c'));expect(field.total).toBeGreaterThan(1);expect(mid.displayIntervals![0].ranges[0].start).toBeCloseTo(expected.start,5);expect(mid.displayIntervals![0].ranges[0].end).toBeCloseTo(expected.end,5);expect(mid.displayIntervals![0].ranges[0].id).toBe('cut');
 });
 it('keeps final-control interpolation even when endpoint placement rotation has a nonlinear path',()=>{
  const {w,r}=pair();r.tracks=[{id:'placement',channel:'placement',targetId:'layer',keys:[{id:'rotation',angle:{x:90,y:0},value:{translation:[0,0],rotation:180,scale:1}}]}];
  const middle=evaluateRecordingSnapshot(w,r.id,{angle:{x:45,y:0}}),basis=middle.endpointPair!;for(const n of middle.drawing.nodes){const a=basis.start.drawing.nodes.find(v=>v.id===n.id)!,b=basis.end.drawing.nodes.find(v=>v.id===n.id)!;expect(n.position[0]).toBeCloseTo((a.position[0]+b.position[0])/2);expect(n.position[1]).toBeCloseTo((a.position[1]+b.position[1])/2);}expect(middle.drawing.nodes.find(n=>n.id==='b')!.position[1]).toBeCloseTo(0);
 });
 it('retains but diagnoses stored responses whose basis delta becomes unavailable',()=>{const a=drawing(),b=structuredClone(a),result=interpolateEndpointPairDrawing(a,b,.5,{nodes:{a:{x:[[.5,999]]}},handles:{}});expect(result.drawing.nodes[0].position).toEqual(a.nodes[0].position);expect(result.diagnostics.join(' ')).toContain('Node a X');});
 it('preserves exact endpoint affine metadata and diagnoses only affine ARC basis incompatibility',()=>{
  const a=drawing(),b=structuredClone(a);registerEvaluatedAffine(a,a,()=>({point:p=>p,maxScale:2}));expect(endpointPairCompatibility(a,b)).toEqual([]);expect(interpolateEndpointPairDrawing(a,b,0).drawing).toBe(a);
  a.joins=[{id:'arc',a:{curveId:'c',end:0},b:{curveId:'c',end:1},mode:'ARC',radius:.1}];b.joins=structuredClone(a.joins);expect(endpointPairCompatibility(a,b).join(' ')).toContain('ARC arc');
 });
});
const addPoint=(a:Point2,b:Point2):Point2=>[a[0]+b[0],a[1]+b[1]];
