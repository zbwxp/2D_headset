import {expect,test} from 'vitest';
import {createCurve,connect} from '../../domain/drawing/commands';
import {emptyDrawing,shapeOf,type DrawingDocument,type Point2,type Cubic} from '../../domain/drawing/model';
import {neutralBend} from '../../domain/deformation/coons';
import {evaluatedMaterialProgram} from '../../domain/drawing/evaluatedDeformation';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot} from '../../domain/recordingSnapshot/model';
import {upsertDrawingSource,canonicalElementId} from '../../domain/recordingSnapshot/sources';
import {resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {inheritedTopologyLayerProgram} from '../../domain/recordingSnapshot/inheritedTopologyMaterial';
import {prepareSnapshotLocalDrawingEdit} from '../../domain/recordingSnapshot/drawingTopology';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import type {SnapshotLayerCageDomain} from '../../domain/recordingSnapshot/layerCageDomain';

const id=(value:string)=>canonicalElementId('source',value);
const localShape:Cubic=[[-.6,.6],[-.4,.9],[.1,.8],[.3,.5]];
const near=(a:Point2,b:Point2)=>a.forEach((value,index)=>expect(value).toBeCloseTo(b[index],8));
const sameGeometry=(actual:DrawingDocument,wanted:DrawingDocument)=>wanted.curves.forEach(curve=>shapeOf(actual,curve.id).forEach((point,index)=>near(point,shapeOf(wanted,curve.id)[index])));
function fixture(wholeLayer=false){
 let sourceDrawing=emptyDrawing();sourceDrawing.layers=[{id:'source-layer',name:'Layer',visible:true,locked:false,items:[]}];
 sourceDrawing=createCurve(sourceDrawing,'source-layer',[[-.8,0],[-.6,.1],[-.3,.2],[-.1,0]],.01,'A','a');sourceDrawing=createCurve(sourceDrawing,'source-layer',[[.2,.2],[.3,.4],[.6,.6],[.7,.8]],.01,'B','b');
 const workspace=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',sourceDrawing),source=workspace.snapshots[0],parent=emptyRecordingSnapshot('parent'),child=emptyRecordingSnapshot('child'),bend=neutralBend();bend.handles[1][0][0]=1.13;
 parent.layers=[{kind:'reference',id:'parent-layer',name:'Parent',baseSnapshotId:source.id,baseLayerId:id('source-layer')}];
 const stroke:SnapshotLayerCageDomain={kind:'h-coons',id:'stroke-cage',layerIds:['parent-layer'],strokeScope:{kind:'continuous-strokes',curveIds:[id('a')]},restRect:{min:[-1,-1],max:[1,1]},quad:[[-1,-1],[.95,-.8],[.8,1],[-.9,.9]],bend};
 parent.deformation.layerDomains=[...(wholeLayer?[{...stroke,id:'whole-cage',strokeScope:undefined,quad:[[-1.1,-1],[1.1,-.9],[1.05,1.2],[-1.1,1.1]] as [Point2,Point2,Point2,Point2]}]:[]),stroke];
 child.layers=[{kind:'reference',id:'child-layer',name:'Child',baseSnapshotId:parent.id,baseLayerId:'parent-layer'}];workspace.snapshots.push(parent,child);return {workspace,parent,sourceDrawing,stroke};
}
const child=(workspace:ReturnType<typeof fixture>['workspace'])=>resolveSnapshot(workspace,'child').drawing;
const edit=(workspace:ReturnType<typeof fixture>['workspace'],drawing:DrawingDocument)=>prepareSnapshotLocalDrawingEdit(workspace,{snapshotId:'child',state:'saved',beforeDrawing:child(workspace),drawing}).workspace;
const cageIds=(steps:ReturnType<typeof inheritedTopologyLayerProgram>)=>steps?.flatMap(step=>step.kind==='cage'?[step.domain.id]:[])??[];

test.each([false,true])('inherited program selects actual connected stroke and common whole-layer fields (whole=%s)',wholeLayer=>{
 const f=fixture(wholeLayer),parent=resolveSnapshot(f.workspace,'parent').drawing,before=child(f.workspace),disconnected=createCurve(before,'child-layer',localShape,.01,'Local','local'),connected=connect(disconnected,{curveId:id('a'),end:1},{curveId:'local',end:0},'POSITION');
 const select=(drawing:DrawingDocument)=>inheritedTopologyLayerProgram(parent,'parent-layer',{drawing,layerId:'child-layer',curveId:'local'});
 expect(cageIds(select(disconnected))).toEqual(wholeLayer?['whole-cage']:[]);expect(cageIds(select(connected))).toEqual([...(wholeLayer?['whole-cage']:[]),'stroke-cage']);
 expect(()=>inheritedTopologyLayerProgram(parent,'parent-layer')).toThrow(/different material programs/);
 // Coordinates inside the other stroke's cage never grant field membership.
 expect(cageIds(select({...disconnected,nodes:disconnected.nodes.map(node=>node.id===disconnected.curves.at(-1)!.nodes[0]?{...node,position:[-.5,0]}:node)}))).toEqual(wholeLayer?['whole-cage']:[]);
});

test.each([false,true])('child P disconnected from a scoped cage remains exact and follows only whole-layer fields (whole=%s)',wholeLayer=>{
 const f=fixture(wholeLayer),before=child(f.workspace),target=createCurve(before,'child-layer',localShape,.01,'Local','local'),parentBefore=structuredClone(f.parent),workspace=edit(f.workspace,target),actual=child(workspace);
 sameGeometry(actual,target);expect(workspace.snapshots.find(snapshot=>snapshot.id==='parent')).toEqual(parentBefore);expect(cageIds(evaluatedMaterialProgram(actual,'local'))).toEqual(wholeLayer?['whole-cage']:[]);sameGeometry(child(parseRecordingSnapshots(JSON.parse(JSON.stringify(workspace)))),target);
 const edited=structuredClone(workspace),parent=edited.snapshots.find(snapshot=>snapshot.id==='parent')!,stroke=parent.deformation.layerDomains!.find(domain=>domain.id==='stroke-cage') as SnapshotLayerCageDomain;stroke.quad[1][0]+=.18;
 shapeOf(child(edited),'local').forEach((point,index)=>near(point,shapeOf(actual,'local')[index]));
 if(wholeLayer){const whole=parent.deformation.layerDomains!.find(domain=>domain.id==='whole-cage') as SnapshotLayerCageDomain;whole.quad[2][1]+=.12;expect(shapeOf(child(edited),'local')).not.toEqual(shapeOf(actual,'local'));}
});

test.each(['POSITION','SMOOTH'] as const)('child P connected by %s inherits its scoped cage and leaves unrelated stroke untouched',join=>{
 const f=fixture(),before=child(f.workspace),created=createCurve(before,'child-layer',localShape,.01,'Local','local'),target=connect(created,{curveId:id('a'),end:1},{curveId:'local',end:0},join),workspace=edit(f.workspace,target),actual=child(workspace);
 sameGeometry(actual,target);expect(cageIds(evaluatedMaterialProgram(actual,'local'))).toContain('stroke-cage');shapeOf(actual,id('b')).forEach((point,index)=>near(point,shapeOf(before,id('b'))[index]));sameGeometry(child(parseRecordingSnapshots(JSON.parse(JSON.stringify(workspace)))),target);
 const edited=structuredClone(workspace),domain=edited.snapshots.find(snapshot=>snapshot.id==='parent')!.deformation.layerDomains![0] as SnapshotLayerCageDomain;domain.quad[1][0]+=.18;const updated=child(edited);expect(shapeOf(updated,'local')).not.toEqual(shapeOf(actual,'local'));shapeOf(updated,id('b')).forEach((point,index)=>near(point,shapeOf(actual,id('b'))[index]));
});

test('disconnected P preserves layer-wide sparse response stages after excluding the other stroke cage',()=>{
 const f=fixture(),domain=f.parent.deformation.layerDomains![0];domain.postShape={nodes:{},handles:{[id('a')]:[[.02,.01],[0,0]]}};
 const parent=resolveSnapshot(f.workspace,'parent').drawing,before=child(f.workspace),target=createCurve(before,'child-layer',localShape,.01,'Local','local'),steps=inheritedTopologyLayerProgram(parent,'parent-layer',{drawing:target,layerId:'child-layer',curveId:'local'});
 expect(cageIds(steps)).toEqual([]);expect(steps?.some(step=>step.kind==='post-shape')).toBe(true);const workspace=edit(f.workspace,target);sameGeometry(child(workspace),target);expect(workspace.snapshots.find(snapshot=>snapshot.id==='parent')).toEqual(f.parent);
});

test('a new bridge between incompatible inherited programs rejects atomically instead of selecting a nearby field',()=>{
 const f=fixture(),before=child(f.workspace),created=createCurve(before,'child-layer',localShape,.01,'Bridge','bridge'),first=connect(created,{curveId:id('a'),end:1},{curveId:'bridge',end:0},'POSITION'),target=connect(first,{curveId:id('b'),end:0},{curveId:'bridge',end:1},'POSITION'),saved=JSON.stringify(f.workspace);
 expect(()=>edit(f.workspace,target)).toThrow(/different material programs/);expect(JSON.stringify(f.workspace)).toBe(saved);expect(f.workspace.library.curves.bridge).toBeUndefined();
});
