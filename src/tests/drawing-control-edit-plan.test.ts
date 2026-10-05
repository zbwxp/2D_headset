import {expect,it} from 'vitest';
import {emptyDrawing,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {dragNode} from '../domain/drawing/nodeDrag';
import {moveHandle,moveNode,transform} from '../domain/drawing/commands';
import {applyMirrorEditing} from '../domain/drawing/mirrorEditing';
import {applyScenePlacement} from '../domain/recordingScene/tracks';
import {applyDrawingControlEditPlan,prepareDrawingControlEditPlan,drawingControlEditProof,drawingControlEditStats,applyDrawingControlWrites} from '../domain/drawing/controlEditPlan';
function fixture(unrelated=0):DrawingDocument {
 const drawing:DrawingDocument={...emptyDrawing(),layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:[]}],mirrorEditing:{enabled:true,curvePairs:[{id:'mirror',a:'a',b:'b',reverse:false}]}};
 for(let i=0;i<unrelated+4;i++){const id=['a','b','c','d'][i]??`other${i}`,x=i*3;drawing.nodes.push({id:`${id}0`,position:[x,0]},{id:`${id}1`,position:[x+1,1]});drawing.curves.push({id,name:id,nodes:[`${id}0`,`${id}1`],handles:[[x+.2,.3],[x+.8,.7]],visible:true,locked:false,width:.01});drawing.layers[0].items.push(id);}
 drawing.nodes.find(n=>n.id==='c0')!.position=[0,0];drawing.curves[2].handles[0]=[-.4,-.6];drawing.endpointLinks=[{id:'link',a:{curveId:'a',end:0},b:{curveId:'c',end:0},joinBrush:{kind:'SMOOTH'}}];
 return drawing;
}
for(const count of [0,100,1000])it(`node follow/mirror and SMOOTH handle scope ignores ${count} unrelated curves`,()=>{
 const before=fixture(count),saved=JSON.stringify(before),point:Point2=[.15,.2],stats=drawingControlEditStats();
 const node=prepareDrawingControlEditPlan(before,{kind:'node',nodeId:'a0',followStrength:.6}),wanted=applyDrawingControlEditPlan(node,{kind:'point',position:point}),full=applyMirrorEditing(before,dragNode(before,'a0',point,.6),{nodes:[{nodeId:'a0',position:point}]});
 expect(wanted).toEqual(full);expect(node.curveIds).toEqual(['a','b','c']);expect(drawingControlEditProof(before,wanted,node)).toBe(node);expect(drawingControlEditProof(before,{...wanted},node)).toBeUndefined();
 const endpoint={curveId:'a',end:0 as const},handle=prepareDrawingControlEditPlan(before,{kind:'handle',endpoint}),position:Point2=[.25,.4],edited=applyDrawingControlEditPlan(handle,{kind:'point',position}),expected=applyMirrorEditing(before,moveHandle(before,endpoint,position),{handles:[{...endpoint,position}]});
 expect(edited).toEqual(expected);expect(handle.curveIds).toEqual(['a','b','c']);expect(drawingControlEditStats().authoredCurves-stats.authoredCurves).toBe(6);expect(JSON.stringify(before)).toBe(saved);
});
it('V transforms use the same frozen canonical kernel and retain snapshot ARC ownership',()=>{
 const before=fixture(30);before.endpointLinks=[];const value={translation:[.1,-.2] as Point2,rotation:8,scale:1.1},plan=prepareDrawingControlEditPlan(before,{kind:'curves',curveIds:['a']}),actual=applyDrawingControlEditPlan(plan,{kind:'transform',value}),raw=transform(before,['a'],p=>applyScenePlacement(value,p));
 expect(actual).toEqual(applyMirrorEditing(before,{...raw,joins:before.joins}));expect(plan.curveIds).toEqual(['a','b']);expect(prepareDrawingControlEditPlan(before,{kind:'curves',curveIds:['a']})).toBe(plan);
});
it('unrelated material does not force geometry authoring to rescan all curves',()=>{
 const before=fixture(100);before.displayIntervals=[{id:'ink',anchor:{id:'other20',reverse:false},scope:'CURVE',ranges:[{id:'show',start:.1,end:.8}]}];const plan=prepareDrawingControlEditPlan(before,{kind:'node',nodeId:'a0'}),next=applyDrawingControlEditPlan(plan,{kind:'point',position:[.1,.2]});expect(plan.fallbackReason).toBeUndefined();expect(next.displayIntervals).toBe(before.displayIntervals);expect(plan.curveIds).toHaveLength(3);
});
it('scalar producer cannot write outside its closure and copied descriptors carry no proof',()=>{
 const before=fixture(4),plan=prepareDrawingControlEditPlan(before,{kind:'handle',endpoint:{curveId:'a',end:0}});expect(()=>applyDrawingControlWrites(plan,{nodePositions:new Map([['other40',[4,0] as Point2]])})).toThrow(/outside/);expect(()=>applyDrawingControlEditPlan({...plan},{kind:'point',position:[0,0]})).toThrow(/Unknown/);
});

it('Drawing transform keeps authored ARC edits while Recording controls retain the basis ARC',()=>{
 const before=fixture();before.mirrorEditing=undefined;before.endpointLinks=[];before.curves[1].nodes[0]='a1';before.curves[1].handles[0]=[1.2,1.3];before.nodes=before.nodes.filter(node=>node.id!=='b0');before.joins=[{id:'arc',a:{curveId:'a',end:1},b:{curveId:'b',end:0},mode:'ARC',radius:.08}];const value={translation:[0,0] as Point2,rotation:0,scale:2},ids=['a','b'];
 const drawingPlan=prepareDrawingControlEditPlan(before,{kind:'curves',curveIds:ids}),drawingTarget=applyDrawingControlEditPlan(drawingPlan,{kind:'transform',value}),expected=transform(before,ids,p=>applyScenePlacement(value,p));expect(drawingTarget).toEqual(expected);expect(drawingTarget.curves).toHaveLength(before.curves.length);expect(drawingTarget.joins[0].radius).toBeCloseTo(.16,12);expect(drawingControlEditProof(before,drawingTarget,drawingPlan)).toBeUndefined();
 const recordingPlan=prepareDrawingControlEditPlan(before,{kind:'curves',curveIds:ids,preserveRelations:true}),recordingTarget=applyDrawingControlEditPlan(recordingPlan,{kind:'transform',value});expect(recordingTarget.joins).toBe(before.joins);expect(recordingTarget.curves.map(curve=>curve.handles)).toEqual(expected.curves.map(curve=>curve.handles));
});

it('ARC handle plans retain the canonical zero-length guard without making the partner writable',()=>{
 const before=fixture(100);before.mirrorEditing=undefined;before.endpointLinks=[];before.curves[1].nodes[0]='a1';before.curves[1].handles[0]=[1.2,1.3];before.nodes=before.nodes.filter(node=>node.id!=='b0');before.joins=[{id:'arc',a:{curveId:'a',end:1},b:{curveId:'b',end:0},mode:'ARC',radius:.08}];
 const endpoint={curveId:'a',end:1 as const},plan=prepareDrawingControlEditPlan(before,{kind:'handle',endpoint}),collapsed=before.nodes.find(node=>node.id==='a1')!.position,saved=JSON.stringify(before);
 expect(plan.curveIds).toEqual(['a']);expect(plan.controls).toEqual([{kind:'handle',...endpoint}]);
 expect(()=>moveHandle(before,endpoint,collapsed)).toThrow('连接柄不能缩为零');expect(()=>applyDrawingControlEditPlan(plan,{kind:'point',position:collapsed})).toThrow('连接柄不能缩为零');
 const position:Point2=[.7,.8],stats=drawingControlEditStats(),actual=applyDrawingControlEditPlan(plan,{kind:'point',position}),expected=moveHandle(before,endpoint,position);
 expect(actual).toEqual(expected);expect(actual.curves[1]).toBe(before.curves[1]);expect(actual.joins).toBe(before.joins);expect(drawingControlEditProof(before,actual,plan)).toBe(plan);expect(drawingControlEditStats().authoredCurves-stats.authoredCurves).toBe(2);expect(JSON.stringify(before)).toBe(saved);
});

it.each(['node','handle','curves'] as const)('%s plans keep hidden authoring explicit and preserve lock rejection',kind=>{
 const before=fixture();before.mirrorEditing=undefined;before.endpointLinks=[];before.curves[0].visible=false;
 const intent=kind==='node'?{kind,nodeId:'a0'}:kind==='handle'?{kind,endpoint:{curveId:'a',end:0 as const}}:{kind,curveIds:['a']};
 const position:Point2=[.4,.5],value=kind==='curves'?{kind:'map' as const,map:(p:Point2):Point2=>[p[0]+.2,p[1]-.1]}:{kind:'point' as const,position};
 expect(()=>applyDrawingControlEditPlan(prepareDrawingControlEditPlan(before,intent),value)).toThrow(/隐藏/);
 const plan=prepareDrawingControlEditPlan(before,{...intent,allowHidden:true}),actual=applyDrawingControlEditPlan(plan,value);
 const expected=kind==='node'?moveNode(before,'a0',position,true):kind==='handle'?moveHandle(before,{curveId:'a',end:0},position,true):transform(before,['a'],(value as {map:(point:Point2)=>Point2}).map,false,true);
 expect(actual).toEqual(expected);expect(actual.curves[0].visible).toBe(false);expect(drawingControlEditProof(before,actual,plan)).toBe(plan);
 const locked={...before,curves:before.curves.map(curve=>curve.id==='a'?{...curve,locked:true}:curve)},saved=JSON.stringify(locked);
 expect(()=>applyDrawingControlEditPlan(prepareDrawingControlEditPlan(locked,{...intent,allowHidden:true}),value)).toThrow(/锁定/);expect(JSON.stringify(locked)).toBe(saved);
});
