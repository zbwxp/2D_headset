import {describe,expect,it} from 'vitest';
import {emptyDrawing,type Cubic,type DrawingDocument,type Point2,type StrokeDisplayIntervals} from '../../domain/drawing/model';
import {applyCurveSplitIntent,createCurveSplitIntent,splitCurveParameter,type CurveSplitIntent} from '../../domain/drawing/layerEditIntent';
import {createDrawingPathMaterialFrame,type DrawingPathMaterialPoint} from '../../domain/drawing/pathMaterialSupport';
import {registerEvaluatedAffine} from '../../domain/drawing/evaluatedAffine';
import {createSnapshotPathMaterialFrame,type SnapshotMaterialPathLineage} from '../../domain/recordingSnapshot/pathMaterialFrame';

const main:Cubic=[[0,0],[.17,.53],[.64,-.29],[1,0]];
const line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
function fixture(reverse=false,closed=false):DrawingDocument {
 const next=closed?[[1,0],[.9,.8],[.1,.6],[0,0]] as Cubic:line([1,0],[1.7,.2]);
 return {...emptyDrawing(),nodes:[{id:'a',position:main[0]},{id:'b',position:main[3]},...closed?[]:[{id:'c',position:next[3]}]],curves:[
  {id:'first',name:'First',nodes:['a','b'],handles:[main[1],main[2]],width:.01,visible:true,locked:false},
  {id:'next',name:'Next',nodes:['b',closed?'a':'c'],handles:[next[1],next[2]],width:.01,visible:true,locked:false},
 ],layers:[{id:'layer',name:'Layer',items:['first','next'],visible:true,locked:false}],displayIntervals:[{id:'material',anchor:{id:'first',reverse},ranges:[{id:'range',start:.17,end:.83}]}]};
}
function split(drawing:DrawingDocument,curveId='first',t=.371,prefix='split') {
 let serial=0;const intent=createCurveSplitIntent(drawing,curveId,t,{allocateId:()=>`${prefix}-${++serial}`});return {intent,drawing:applyCurveSplitIntent(drawing,intent).document};
}
const lineage=(intent:CurveSplitIntent):SnapshotMaterialPathLineage=>({sourceTrackId:'material',curves:[{sourceCurveId:intent.curveId,parts:[{curveId:intent.childCurveIds[0],parameterRange:[0,intent.t]},{curveId:intent.childCurveIds[1],parameterRange:[intent.t,1]}]}]});
const mapSplit=(point:DrawingPathMaterialPoint,intent:CurveSplitIntent):DrawingPathMaterialPoint=>point.kind==='curve'&&point.curveId===intent.curveId?{kind:'curve',...splitCurveParameter(intent,point.t)}:point;
const track=(drawing:DrawingDocument)=>drawing.displayIntervals![0];
const points=[0,.001,.07,.17,.29,.371,.49,.63,.77,.89,.999];

function assertSameMaterial(before:DrawingDocument,after:DrawingDocument,intent:CurveSplitIntent,nextLineage:SnapshotMaterialPathLineage,previousLineage?:SnapshotMaterialPathLineage){
 const source=createSnapshotPathMaterialFrame(before,track(before),previousLineage,!!previousLineage),logical=createSnapshotPathMaterialFrame(after,track(after),nextLineage,true);
 expect(logical.total).toBeCloseTo(source.total,12);
 for(const value of points){
  const support=mapSplit(source.materialAt(value),intent),mapped=logical.positionOf(support),delta=Math.abs(mapped-value);expect(Math.min(delta,source.closed?Math.abs(1-delta):delta)).toBeLessThan(1e-11);
  const actual=logical.materialAt(value);expect(actual.kind).toBe(support.kind);
  if(actual.kind==='curve'&&support.kind==='curve'){expect(actual.curveId).toBe(support.curveId);expect(actual.t).toBeCloseTo(support.t,10);}
  else if(actual.kind==='join'&&support.kind==='join'){expect(actual.linkId??actual.joinId).toBe(support.linkId??support.joinId);expect(actual.s).toBeCloseTo(support.s,10);}
 }
}

describe('live logical path material frames',()=>{
 it.each([false,true])('recovers the original exact path measurement with reverse=%s',reverse=>{
  const before=fixture(reverse),after=split(before),saved=JSON.stringify(after.drawing);assertSameMaterial(before,after.drawing,after.intent,lineage(after.intent));
  const actual=createDrawingPathMaterialFrame(after.drawing,track(after.drawing)),logical=createSnapshotPathMaterialFrame(after.drawing,track(after.drawing),lineage(after.intent),true);
  for(const value of points){const retained=logical.positionOf(actual.materialAt(value));expect(actual.positionOf(logical.materialAt(retained))).toBeCloseTo(value,12);}
  expect(JSON.stringify(after.drawing)).toBe(saved);expect(JSON.stringify(lineage(after.intent))).not.toMatch(/handles|nodes|position|drawing/);
 });
 it.each([false,true])('preserves the closed anchor frame with reverse=%s',reverse=>{
  const before=fixture(reverse,true),after=split(before);assertSameMaterial(before,after.drawing,after.intent,lineage(after.intent));
 });
 it('coalesces a newly split edited child when the whole retained root cannot recompose',()=>{
  const first=split(fixture()),edited=structuredClone(first.drawing),oldLineage=lineage(first.intent);edited.curves.find(curve=>curve.id===first.intent.childCurveIds[0])!.handles[0][1]+=.127;
  const second=split(edited,first.intent.childCurveIds[0],.613,'again'),next=structuredClone(oldLineage),cut=first.intent.t*second.intent.t;
  next.curves[0].parts.splice(0,1,{curveId:second.intent.childCurveIds[0],parameterRange:[0,cut]},{curveId:second.intent.childCurveIds[1],parameterRange:[cut,first.intent.t]});
  assertSameMaterial(edited,second.drawing,second.intent,next,oldLineage);
 });
 it('keeps a closed anchor inside a contracted run at its native material origin',()=>{
  const first=split(fixture(false,true)),after={...first.drawing,displayIntervals:[{...track(first.drawing),anchor:{id:first.intent.childCurveIds[1],reverse:false}}]},logical=createSnapshotPathMaterialFrame(after,track(after),lineage(first.intent),true);
  const origin=logical.materialAt(0);expect(origin.kind).toBe('curve');if(origin.kind==='curve'){expect(origin.curveId).toBe(first.intent.childCurveIds[0]);expect(origin.t).toBeCloseTo(1,12);}
  for(const value of points){const actual=logical.positionOf(logical.materialAt(value)),delta=Math.abs(actual-value);expect(Math.min(delta,Math.abs(1-delta))).toBeLessThan(1e-11);}
 });
 it('uses the deferred affine material source instead of measuring placed controls',()=>{
  const source=fixture(),point=([x,y]:Point2):Point2=>[x*2.3+.4,y*.37-.2],drawing={...source,nodes:source.nodes.map(node=>({...node,position:point(node.position)})),curves:source.curves.map(curve=>({...curve,handles:curve.handles.map(point) as [Point2,Point2]}))};
  registerEvaluatedAffine(drawing,source,()=>({point,maxScale:2.3}));const after=split(drawing);assertSameMaterial(drawing,after.drawing,after.intent,lineage(after.intent));
 });
 it('rejects a missing live child instead of manufacturing its old geometry',()=>{
  const after=split(fixture()),missing={...after.drawing,curves:after.drawing.curves.filter(curve=>curve.id!==after.intent.childCurveIds[1])};
  expect(()=>createSnapshotPathMaterialFrame(missing,track(missing),lineage(after.intent),true)).toThrow(/absent|live path/);
 });
});

function routeFixture(reverse=false):DrawingDocument {
 const a:Cubic=[[-1,0],[-.83,.21],[-.17,-.12],[0,0]],b:Cubic=[[0,0],[.08,.3],[.13,.73],[0,1]],material:StrokeDisplayIntervals={id:'material',anchor:{id:'first',reverse:false},displayRoute:{seed:{segments:[{id:'first',reverse}],closed:false},throughLinkIds:['link']},ranges:[{id:'range',start:.15,end:.85}]};
 return {...emptyDrawing(),nodes:[{id:'a0',position:a[0]},{id:'a1',position:a[3]},{id:'b0',position:b[0]},{id:'b1',position:b[3]}],curves:[{id:'first',name:'A',nodes:['a0','a1'],handles:[a[1],a[2]],width:.01,visible:true,locked:false},{id:'next',name:'B',nodes:['b0','b1'],handles:[b[1],b[2]],width:.01,visible:true,locked:false}],layers:[{id:'a',name:'A',items:['first'],visible:true,locked:false},{id:'b',name:'B',items:['next'],visible:true,locked:false}],endpointLinks:[{id:'link',a:{curveId:'first',end:1},b:{curveId:'next',end:0},throughDisplay:true,joinBrush:{kind:'ARC',trimDistance:.13}}],displayIntervals:[material]};
}
describe('ARC path material identities',()=>{
 it.each([false,true])('keeps local closed ARC joins and their anchor trims, reversed=%s',reverse=>{
  const before=fixture(reverse,true);before.joins=[{id:'arc',a:{curveId:'next',end:1},b:{curveId:'first',end:0},mode:'ARC',radius:.06}];
  const after=split(before);assertSameMaterial(before,after.drawing,after.intent,lineage(after.intent));
 });
 it.each([false,true])('rebuilds the original explicit-route ARC before measuring, reversed=%s',reverse=>{
  const before=routeFixture(reverse),after=split(before);assertSameMaterial(before,after.drawing,after.intent,lineage(after.intent));
  const frame=createSnapshotPathMaterialFrame(after.drawing,track(after.drawing),lineage(after.intent),true),support:DrawingPathMaterialPoint={kind:'join',joinId:'not-the-synthetic-name',linkId:'link',s:.29},value=frame.positionOf(support);
  expect(frame.materialAt(value)).toMatchObject({kind:'join',linkId:'link',s:expect.closeTo(.29,11)});
 });
 it('retains the same canonical ARC fraction when reversing an explicit route',()=>{
  const forward=routeFixture(),reverse={...forward,displayIntervals:[{...track(forward),displayRoute:{...track(forward).displayRoute!,seed:{segments:[{id:'first',reverse:true}],closed:false}}}]},a=createDrawingPathMaterialFrame(forward,track(forward)),b=createDrawingPathMaterialFrame(reverse,track(reverse)),point:DrawingPathMaterialPoint={kind:'join',joinId:'display-join:link',linkId:'link',s:.23};
  const x=a.positionOf(point),y=b.positionOf(point);expect(y).toBeCloseTo(1-x,12);expect(b.materialAt(y)).toMatchObject({kind:'join',linkId:'link',s:expect.closeTo(.23,12)});
 });
 it('uses the stable link identity when contraction changes its synthetic ARC name',()=>{
  const before=routeFixture();let serial=0;const names=['left','display-join:link','seam-node','seam-join'],intent=createCurveSplitIntent(before,'first',.371,{allocateId:()=>names[serial++]}),after=applyCurveSplitIntent(before,intent).document,actual=createDrawingPathMaterialFrame(after,track(after)),logical=createSnapshotPathMaterialFrame(after,track(after),lineage(intent),true),point:DrawingPathMaterialPoint={kind:'join',joinId:'unused',linkId:'link',s:.41};
  const a=actual.materialAt(actual.positionOf(point)),b=logical.materialAt(logical.positionOf(a));expect(a.kind).toBe('join');expect(b.kind).toBe('join');
  if(a.kind==='join'&&b.kind==='join'){expect(a.joinId).not.toBe(b.joinId);expect(a.linkId).toBe(b.linkId);expect(a.s).toBeCloseTo(b.s,12);}
 });
 it('does not contract across a newly authored internal ARC',()=>{
  const first=split(fixture()),changed={...first.drawing,joins:first.drawing.joins.map(join=>join.id===first.intent.seamJoinId?{...join,mode:'ARC' as const,radius:.04}:join)},actual=createDrawingPathMaterialFrame(changed,track(changed)),logical=createSnapshotPathMaterialFrame(changed,track(changed),lineage(first.intent),true);
  expect(logical.total).toBe(actual.total);for(const value of points)expect(logical.materialAt(value)).toEqual(actual.materialAt(value));
 });
});
