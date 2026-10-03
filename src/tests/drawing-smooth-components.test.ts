import {expect,test,vi} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {createVectorEditingApi} from '../app/vectorEditingApi';
import {createCurve,linkEndpoints,moveHandle} from '../domain/drawing/commands';
import {addDisplayInterval} from '../domain/drawing/displayIntervals';
import {adoptDisplayRoute} from '../domain/drawing/displayRouteAuthoring';
import {displayRouteInkSupport} from '../domain/drawing/displayRouteInk';
import {setEndpointLinkBrush} from '../domain/drawing/endpointRelationAuthoring';
import {finalizeGeometryEdit} from '../domain/drawing/geometryEdit';
import {emptyDrawing,curveById,nodeAt,sub,length,type DrawingDocument,type Endpoint,type Point2} from '../domain/drawing/model';
import {drawingSmoothComponents,projectDrawingSmoothComponent,projectDrawingSmoothHandle} from '../domain/drawing/smoothHandleAuthoring';
import {deriveSmoothComponents,smoothEndpointKey} from '../domain/endpointRelations/smoothComponent';
import {deriveSmoothComponents as snapshotComponents,projectSmoothComponent} from '../domain/recordingSnapshot/smoothComponent';
import {projectSnapshotTransformTargets} from '../domain/recordingSnapshot/transformTargets';
import {drawingControlDragTarget} from '../ui/drawing/editGestures';

const a:Endpoint={curveId:'a',end:1},b:Endpoint={curveId:'b',end:0};
const vector=(drawing:DrawingDocument,endpoint:Endpoint)=>sub(curveById(drawing,endpoint.curveId).handles[endpoint.end],nodeAt(drawing,endpoint).position);
function fixture():DrawingDocument {
 let drawing=emptyDrawing();drawing.layers=[{id:'left',name:'Left',visible:true,locked:false,items:[]},{id:'right',name:'Right',visible:true,locked:false,items:[]}];
 drawing=createCurve(drawing,'left',[[-1,0],[-.7,0],[-.3,0],[0,0]],.01,'A','a');
 drawing=createCurve(drawing,'right',[[.1,.1],[.4,.2],[.7,.1],[1,.1]],.01,'B','b');
 drawing=linkEndpoints(drawing,a,b,true);drawing=addDisplayInterval(drawing,'a');
 drawing=adoptDisplayRoute(drawing,drawing.displayIntervals![0].id,drawing.endpointLinks![0].id).document;
 return setEndpointLinkBrush(drawing,drawing.endpointLinks![0].id,{kind:'SMOOTH'});
}
function withStore(drawing:DrawingDocument,run:()=>void):void {
 const state=useEditor.getState(),mode=useWorkspaceMode.getState().mode;vi.useFakeTimers();
 try{useWorkspaceMode.getState().setMode('drawing');useEditor.setState({project:{...createEmptyProject(),drawing},past:[],future:[]});run();}
 finally{vi.runAllTimers();useEditor.setState(state,true);useWorkspaceMode.getState().setMode(mode);vi.useRealTimers();}
}

test.each([a,b])('cross-layer A handle gesture and API share exact controls, source ownership and one Undo (%s)',endpoint=>{
 const drawing=fixture(),saved=structuredClone(drawing),other=endpoint.curveId==='a'?b:a;
 const start:Point2=[.08,.03],pointer:Point2=[.18,-.17],target=drawingControlDragTarget(drawing,{handle:endpoint},start,pointer);
 withStore(drawing,()=>{
  const editor=useEditor.getState();let preview=drawing;
  // DrawingRoom's actual handle handler reads a frozen gesture base, including
  // after earlier previews. Store commits share its geometry finalization.
  for(const point of [[-.12,.08],[.33,.15],pointer] as Point2[]){const position=drawingControlDragTarget(drawing,{handle:endpoint},start,point);preview=finalizeGeometryEdit(drawing,moveHandle(drawing,endpoint,position),{handles:[{...endpoint,position}]});}
  expect(useEditor.getState().project.drawing).toBe(drawing);expect(useEditor.getState().past).toEqual([]);
  editor.beginEdit();editor.setDrawing(preview);editor.endEdit();const gesture=useEditor.getState().project.drawing!;
  expect(useEditor.getState().past).toHaveLength(1);
  expect(gesture.nodes).toEqual(drawing.nodes);expect(gesture.layers).toEqual(drawing.layers);expect(gesture.endpointLinks).toEqual(drawing.endpointLinks);
  expect(gesture.curves.map(curve=>curve.nodes)).toEqual(drawing.curves.map(curve=>curve.nodes));
  expect(length(vector(gesture,other))).toBeCloseTo(length(vector(drawing,other)),14);
  const va=vector(gesture,a),vb=vector(gesture,b);expect(va[0]*vb[1]-va[1]*vb[0]).toBeCloseTo(0,14);expect(va[0]*vb[0]+va[1]*vb[1]).toBeLessThan(0);
  expect(displayRouteInkSupport(gesture,gesture.displayIntervals![0].displayRoute!)).toEqual([]);
  editor.undo();expect(useEditor.getState().project.drawing).toEqual(saved);editor.redo();expect(useEditor.getState().project.drawing).toEqual(gesture);editor.undo();
  const api=createVectorEditingApi(),result=api.execute({commands:[{op:'moveHandle',curveId:endpoint.curveId,end:endpoint.end,position:target}]});
  expect(result).toMatchObject({ok:true,value:{applied:true}});expect(useEditor.getState().project.drawing).toEqual(gesture);expect(useEditor.getState().past).toHaveLength(1);
  expect(api.undo()).toMatchObject({ok:true});expect(useEditor.getState().project.drawing).toEqual(saved);
 });
 expect(drawing).toEqual(saved);
});

test('cross-layer authoring follows transitive explicit relations while shared node identity alone adds no tangent constraint',()=>{
 let drawing=fixture();drawing=createCurve(drawing,'right',[[0,0],[0,.7],[.3,.7],[.6,.7]],.01,'C','c');
 const c:Endpoint={curveId:'c',end:0};drawing.endpointLinks!.push({id:'next',a:b,b:c,joinBrush:{kind:'SMOOTH'}});
 drawing=createCurve(drawing,'left',[[0,0],[.1,.2],[.2,.4],[.3,.6]],.01,'Independent','independent');
 drawing.curves.find(curve=>curve.id==='independent')!.nodes[0]=nodeAt(drawing,a).id;
 const saved=structuredClone(drawing),next=moveHandle(drawing,c,[.2,.4]),va=vector(next,a),vb=vector(next,b),vc=vector(next,c);
 expect(va[0]*vc[1]-va[1]*vc[0]).toBeCloseTo(0,14);expect(va[0]*vc[0]+va[1]*vc[1]).toBeGreaterThan(0);
 expect(vb[0]*vc[0]+vb[1]*vc[1]).toBeLessThan(0);expect(length(va)).toBeCloseTo(length(vector(drawing,a)),14);expect(length(vb)).toBeCloseTo(length(vector(drawing,b)),14);
 expect(curveById(next,'independent')).toEqual(curveById(drawing,'independent'));expect(next.nodes).toEqual(drawing.nodes);expect(drawing).toEqual(saved);
});

test('authoring locks and hidden followers reject atomically; runtime and Recorder visibility remain explicit policies',()=>{
 const locked=fixture();curveById(locked,'b').locked=true;const saved=structuredClone(locked);
 expect(()=>moveHandle(locked,a,[-.2,-.2])).toThrow(/锁定/);expect(locked).toEqual(saved);
 // A length-only edit does not rewrite an unchanged locked follower.
 expect(()=>moveHandle(locked,a,[-.6,0])).not.toThrow();
 withStore(locked,()=>{
  const result=createVectorEditingApi().execute({commands:[{op:'renameCurve',curveId:'a',name:'Do not commit'},{op:'moveHandle',curveId:'a',end:1,position:[-.2,-.2]}]});
  expect(result).toMatchObject({ok:false,error:{code:'CONSTRAINT_VIOLATION',commandIndex:1}});expect(useEditor.getState().past).toEqual([]);expect(useEditor.getState().project.drawing).toEqual(saved);
 });
 const hidden=fixture();curveById(hidden,'b').visible=false;
 expect(()=>moveHandle(hidden,a,[-.2,-.2])).toThrow(/隐藏/);expect(()=>moveHandle(hidden,a,[-.2,-.2],true)).not.toThrow();
 const runtime=structuredClone(locked);curveById(runtime,'a').handles[1]=[-.2,-.2];projectDrawingSmoothComponent(runtime,drawingSmoothComponents(runtime)[0]);expect(vector(runtime,b)[1]).toBeGreaterThan(0);
});

test.each(['ARC','SHARP',undefined] as const)('%s link brushes do not force handle collinearity',kind=>{
 const drawing=fixture();drawing.endpointLinks![0].joinBrush=kind==='ARC'?{kind,trimDistance:.04}:kind?{kind}:undefined;
 const next=moveHandle(drawing,a,[-.2,-.2]);expect(curveById(next,'b')).toEqual(curveById(drawing,'b'));expect(next.nodes).toEqual(drawing.nodes);
});

test('the neutral graph owns stable traversal, signs and conflict detection for all projection policies',()=>{
 const c:Endpoint={curveId:'c',end:0},relations=[{id:'02',a:b,b:c},{id:'01',a,b}],components=deriveSmoothComponents(relations);
 expect(snapshotComponents).toBe(deriveSmoothComponents);
 expect(components).toEqual([{relationId:'01',members:[{endpoint:a,sign:1},{endpoint:b,sign:-1},{endpoint:c,sign:1}],conflict:false}]);
 expect(deriveSmoothComponents([...relations].reverse())).toEqual(components);
 expect(deriveSmoothComponents([...relations,{id:'03',a:c,b:a}])[0].conflict).toBe(true);
 const drawing=fixture(),component=drawingSmoothComponents(drawing)[0],neutral=deriveSmoothComponents(drawing.endpointLinks!)[0];
 expect([...component.ends]).toEqual(neutral.members.map(member=>[smoothEndpointKey(member.endpoint),member]));expect(component.driver).toEqual(neutral.members[0].endpoint);
});

test('runtime and authoring retain distinct minimum-length and driver policies',()=>{
 const drawing=fixture();curveById(drawing,'a').handles[1]=[-1e-8,0];curveById(drawing,'b').handles[0]=[0,2e-8];
 const component=deriveSmoothComponents(drawing.endpointLinks!)[0],inputs=component.members.map(({endpoint})=>({node:nodeAt(drawing,endpoint).position,handle:curveById(drawing,endpoint.curveId).handles[endpoint.end]})),runtime=projectSmoothComponent(component,inputs);
 expect(runtime.controls[1].handle).toEqual([2e-8,0]);expect(runtime.diagnostics.join(' ')).not.toContain('zero');
 expect(()=>projectDrawingSmoothHandle(drawing,a)).toThrow(/collapse/);
 const normal=fixture(),changed=structuredClone(normal);curveById(changed,'b').handles[0]=[0,.4];
 const authored=projectDrawingSmoothHandle(changed,b),stable=structuredClone(changed);projectDrawingSmoothComponent(stable,drawingSmoothComponents(stable)[0]);
 expect(vector(authored,a)).toEqual([0,-.3]);expect(vector(stable,b)).toEqual([.4,0]);
});

test('transform policy keeps exact explicit targets and rejects incompatible or contradictory components atomically',()=>{
 const before=fixture(),target=structuredClone(before);curveById(target,'b').handles[0]=[.2,.4];const saved=structuredClone(target),result=projectSnapshotTransformTargets(before,target);
 expect(curveById(result,'b').handles[0]).toEqual([.2,.4]);expect(length(vector(result,a))).toBeCloseTo(.3,14);expect(target).toEqual(saved);
 const incompatible=structuredClone(target);curveById(incompatible,'a').handles[1]=[-.4,0];expect(()=>projectSnapshotTransformTargets(before,incompatible)).toThrow(/incompatible transformed/);
 const conflict=fixture();conflict.endpointLinks!.push({id:'conflict',a,b:a,joinBrush:{kind:'SMOOTH'}});const old=structuredClone(conflict);
 expect(()=>moveHandle(conflict,a,[-.2,-.2])).toThrow(/conflicting/);expect(conflict).toEqual(old);
 const same=curveById(before,'a').handles[1];expect(moveHandle(before,a,same)).toBe(before);
});
