import {test,expect} from 'vitest';
import * as commands from '../../domain/drawing/commands';
import {emptyDrawing,shapeOf,type Cubic,type Point2} from '../../domain/drawing/model';
import {neutralBend} from '../../domain/deformation/coons';
import {applyLayerCageDomain,applyLayerDomainPostShape} from '../../domain/recordingSnapshot/layerCageEvaluation';
import {evaluateLayerCageDomain} from '../../domain/recordingSnapshot/layerCageEvaluation';
import type {SnapshotLayerCageDomain} from '../../domain/recordingSnapshot/layerCageDomain';
import {displayField,displayPath,addDisplayInterval,changeDisplayInterval} from '../../domain/drawing/displayIntervals';
import {createDisplayRouteField,captureRouteCoverage,type DisplayRoute} from '../../domain/drawing/displayRoutes';
import {displayRouteInk} from '../../domain/drawing/displayRouteInk';
import {strokeInk} from '../../domain/drawing/appearance';
import {strokeFor} from '../../domain/drawing/strokes';
import {derivedUses,roundedJoins} from '../../domain/drawing/roundedJoin';
import {placeDrawingAffines,drawingLayerObjectOwners} from '../../domain/drawing/affineDrawing';
import {retainSnapshotAffines} from '../../domain/recordingSnapshot/elementPlacement';
import {evaluatedMaterialSource} from '../../domain/drawing/evaluatedDeformation';
import {curveMaterialParameterMap} from '../../domain/drawing/materialParameter';
const line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
const near=(a:Point2,b:Point2)=>expect(Math.hypot(a[0]-b[0],a[1]-b[1])).toBeLessThan(1e-8);
const tangent=(shapes:Cubic[])=>{for(let i=1;i<shapes.length;i++){const a=shapes[i-1],b=shapes[i],u:Point2=[a[3][0]-a[2][0],a[3][1]-a[2][1]],v:Point2=[b[1][0]-b[0][0],b[1][1]-b[0][1]];expect((u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v))).toBeGreaterThan(1-1e-6);}};
function fixture(){
 let d=commands.addLayer(emptyDrawing(),'Layer');const layer=d.layers[0].id;
 d=commands.createCurve(d,layer,line([-.8,0],[0,0]),.013,'A','a');d=commands.createCurve(d,layer,line([0,0],[0,.8]),.013,'B','b');d=commands.connect(d,{curveId:'a',end:1},{curveId:'b',end:0},'ARC',.2);
 const bend=neutralBend();bend.handles[1][0][0]=bend.handles[1][1][0]=1.2;bend.handles[0][1][1]=-.1;
 const domain:SnapshotLayerCageDomain={kind:'h-coons',id:'cage',layerIds:[layer],restRect:{min:[-1,-1],max:[1,1]},quad:[[-1,-1],[.85,-.8],[.5,1],[-.9,.8]],bend};return {d,layer,domain};
}

test('runtime Drawing consumers use one cage program for source ARC, material and fixed-width ink',()=>{
 let {d,domain}=fixture();d=addDisplayInterval(d,'a');const track=d.displayIntervals![0];d=changeDisplayInterval(d,track.id,track.ranges[0].id,{start:.17,end:.87});
 const stage=evaluateLayerCageDomain(d,domain),actual=applyLayerCageDomain(d,domain),path=displayPath(d,'a'),wanted=stage.projectMaterialField(displayField(d,path)).field,field=displayField(actual,path);
 expect(field.geometry.shapes).toEqual(wanted.geometry.shapes);expect(derivedUses(actual,path.segments).shapes).toEqual(wanted.geometry.shapes);
 for(const s of [.17,.4,.8,.87])near(field.at(s).p,wanted.at(s).p);
 const runs=strokeInk(actual,strokeFor(actual,'a'));expect(runs.length).toBeGreaterThan(0);near(runs[0].shapes[0][0],field.at(.17).p);near(runs.at(-1)!.shapes.at(-1)![3],field.at(.87).p);
 expect(actual.curves.map(c=>c.width)).toEqual(d.curves.map(c=>c.width));expect(evaluatedMaterialSource(actual).nodes).toEqual(d.nodes);
});

test('post-domain sparse handles edit the displayed cubic and carry the correction onto retained ARC material',()=>{
 const {d,domain}=fixture(),cage=applyLayerCageDomain(d,domain),before=displayField(cage,displayPath(cage,'a')),value={nodes:{},handles:{a:[[0,0],[.08,-.03]] as [Point2,Point2]}},after=applyLayerDomainPostShape(cage,value,new Set(['a','b'])),field=displayField(after,displayPath(after,'a'));
 near(shapeOf(after,'a')[2],[shapeOf(cage,'a')[2][0]+.08,shapeOf(cage,'a')[2][1]-.03]);expect(shapeOf(after,'b')).toEqual(shapeOf(cage,'b'));
 expect(field.total).toBe(before.total);expect(field.geometry.pieces.filter(p=>p.joinId).map(p=>p.shape)).not.toEqual(before.geometry.pieces.filter(p=>p.joinId).map(p=>p.shape));
 expect(field.geometry.shapes.flat(2).every(Number.isFinite)).toBe(true);for(let i=1;i<field.geometry.shapes.length;i++)near(field.geometry.shapes[i-1][3],field.geometry.shapes[i][0]);
 const reset=applyLayerDomainPostShape(cage,{nodes:{},handles:{}},new Set(['a','b']));expect(reset).toBe(cage);
 const sourceMap=curveMaterialParameterMap(before,displayPath(cage,'a'),'a'),targetMap=curveMaterialParameterMap(field,displayPath(after,'a'),'a');for(const s of [.1,.4,.8])expect(targetMap.parameterAt(s)).toBeCloseTo(sourceMap.parameterAt(s),11);
});

test('cage and sparse correction survive identity copies and later affine order including zero',()=>{
 const {d,domain,layer}=fixture(),cage=applyLayerCageDomain(d,domain),path=displayPath(cage,'a'),before=displayField(cage,path),clone=retainSnapshotAffines({...cage,nodes:cage.nodes.map(node=>({...node})),curves:cage.curves.map(curve=>({...curve}))},[cage]);
 expect(displayField(clone,path).geometry.shapes).toEqual(before.geometry.shapes);
 const owners=drawingLayerObjectOwners(cage);
 for(const matrix of [[-1,0,.2,.7,.3,-.1],[0,0,0,0,0,0]] as [number,number,number,number,number,number][]){const after=placeDrawingAffines(cage,{[layer]:matrix},id=>owners.get(id)),field=displayField(after,path);expect(field.total).toBe(before.total);for(const s of [.2,.5,.8]){const p=before.at(s).p;near(field.at(s).p,[matrix[0]*p[0]+matrix[2]*p[1]+matrix[4],matrix[1]*p[0]+matrix[3]*p[1]+matrix[5]]);}}
});

test('runtime route ARC projection preserves canonical source material identities after a handle correction',()=>{
 const base=fixture();let d=commands.unlinkEndpoints(base.d,'none');
 // Keep two source identities and author a real cross-layer display relation.
 d={...d,joins:[],nodes:[...d.nodes,{id:'separate',position:[0,0]}],curves:d.curves.map(curve=>curve.id==='b'?{...curve,nodes:['separate',curve.nodes[1]]}:curve)};
 d=commands.linkEndpoints(d,{curveId:'a',end:1},{curveId:'b',end:0});const id=d.endpointLinks![0].id;d={...d,endpointLinks:d.endpointLinks!.map(link=>({...link,throughDisplay:true,joinBrush:{kind:'ARC' as const,trimDistance:.2}}))};
 const route:DisplayRoute={seed:{segments:[{id:'a',reverse:false}],closed:false},throughLinkIds:[id]},before=createDisplayRouteField(d,route),cage=applyLayerCageDomain(d,base.domain),after=applyLayerDomainPostShape(cage,{nodes:{},handles:{a:[[0,0],[.04,.02]]}},new Set(['a','b'])),field=createDisplayRouteField(after,route);
 expect(field.total).toBe(before.total);tangent(field.geometry.shapes);for(const s of [.1,.4,.6,.9])expect(field.materialAt(s)).toEqual(before.materialAt(s));
 const coverage=[{start:.2,end:.8,ends:[{},{}]}] as Parameters<typeof captureRouteCoverage>[1],captured=captureRouteCoverage(field,coverage);expect(captured.map(span=>span.from.kind)).toEqual(captureRouteCoverage(before,coverage).map(span=>span.from.kind));
 const ink=displayRouteInk(after,route,new Map([['a',0],['b',1]]));expect(ink.diagnostics).toEqual([]);expect(ink.runs.size).toBe(2);
});

test('real Recorder basis A writes sparse post-domain draft and Save keeps material replay',async()=>{
 const {d,domain}=fixture(),{upsertDrawingSource,canonicalElementId}=await import('../../domain/recordingSnapshot/sources'),{emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording}=await import('../../domain/recordingSnapshot/model'),{createSnapshotAngleGraph}=await import('../../domain/recordingSnapshot/angleGraph'),{applySnapshotCommand}=await import('../../domain/recordingSnapshot/commands'),{resolveSnapshot}=await import('../../domain/recordingSnapshot/evaluation'),{parseRecordingSnapshots}=await import('../../domain/recordingSnapshot/persistence');
 const workspace=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',d),source=workspace.snapshots[0],view=emptyRecordingSnapshot('view'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0}),recording=emptySnapshotRecording('recording'),id=(key:string)=>canonicalElementId('source',key);
 view.layers=[{kind:'reference',id:'slot',name:'Layer',baseSnapshotId:source.id,baseLayerId:source.layers[0].id}];side.layers=structuredClone(view.layers);view.deformation.layerDomains=[{...domain,layerIds:['slot']}];recording.mode='triangulated';recording.snapshotIds=[view.id,side.id];recording.activeSnapshotId=view.id;recording.angleGraph=createSnapshotAngleGraph([view,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));workspace.snapshots.push(view,side);workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 const before=resolveSnapshot(workspace,view.id).drawing,p=shapeOf(before,id('a'))[1],wanted:Point2=[p[0]+.04,p[1]+.03];
 applySnapshotCommand(workspace,{op:'moveShapeHandle',layerId:'slot',curveId:id('a'),end:0,position:wanted});near(shapeOf(resolveSnapshot(workspace,view.id).drawing,id('a'))[1],wanted);
 expect(Object.keys(view.draft!.deformation.layerDomains![0].postShape!.handles)).toEqual([id('a')]);
 applySnapshotCommand(workspace,{op:'saveSelected',layerIds:['slot'],warpIds:[]});expect(view.draft).toBeUndefined();
 const reloaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(workspace))),after=resolveSnapshot(reloaded,view.id).drawing;near(shapeOf(after,id('a'))[1],wanted);expect(displayField(after,displayPath(after,id('a'))).geometry.shapes.flat(2).every(Number.isFinite)).toBe(true);
});

test('presentation identity remapping preserves projected ARC and source material provenance',async()=>{
 const {d,domain}=fixture(),cage=applyLayerCageDomain(d,domain),{remapDrawingIdentities}=await import('../../domain/recordingSnapshot/sources'),{evaluatedDeformationSource,remapEvaluatedDeformations}=await import('../../domain/drawing/evaluatedDeformation'),map=(id:string)=>'present:'+id,inverse=(id:string)=>id.slice(8),presented=remapDrawingIdentities(cage,map);
 remapEvaluatedDeformations(presented,cage,remapDrawingIdentities(evaluatedDeformationSource(cage)!,map),map,inverse);
 const a=displayField(cage,displayPath(cage,'a')),b=displayField(presented,displayPath(presented,'present:a'));
 expect(b.geometry.shapes).toEqual(a.geometry.shapes);for(const s of [.1,.5,.9])near(b.at(s).p,a.at(s).p);
});

test('automatic mirror conjugates a cage and its post-correction instead of rebuilding its ARC',async()=>{
 const {d,domain}=fixture(),cage=applyLayerCageDomain(d,domain,{nodes:{},handles:{a:[[0,0],[.04,.02]]}}),{mirrorSnapshotDrawing}=await import('../../domain/recordingSnapshot/snapshotMirror'),mirrored=mirrorSnapshotDrawing(cage,{axisX:0,curvePairs:[]}).drawing;
 const a=displayField(cage,displayPath(cage,'a')),b=displayField(mirrored,displayPath(mirrored,'a'));
 expect(b.geometry.shapes).toHaveLength(a.geometry.shapes.length);b.geometry.shapes.forEach((shape,i)=>shape.forEach((p,j)=>near(p,[-a.geometry.shapes[i][j][0],a.geometry.shapes[i][j][1]])));
 const back=mirrorSnapshotDrawing(mirrored,{axisX:0,curvePairs:[]}).drawing;displayField(back,displayPath(back,'a')).geometry.shapes.forEach((shape,i)=>shape.forEach((p,j)=>near(p,a.geometry.shapes[i][j])));
});

test('pure program export contains authored fields and sparse corrections, with no prior Snapshot references',async()=>{
 const {d,domain}=fixture(),cage=applyLayerCageDomain(d,domain,{nodes:{},handles:{a:[[0,0],[.04,.02]]}}),{evaluatedMaterialProgram}=await import('../../domain/drawing/evaluatedDeformation'),program=evaluatedMaterialProgram(cage,'a')!;
 expect(program.map(step=>step.kind)).toEqual(['cage','post-shape']);expect(program[0]).toEqual({kind:'cage',domain});expect(JSON.parse(JSON.stringify(program))).toEqual(program);
 expect(evaluatedMaterialSource(cage).curves).toEqual(d.curves);
});

test('domain material survives a referenced parent, and child sparse shape acts after that field',async()=>{
 const {d,domain}=fixture(),{upsertDrawingSource,canonicalElementId}=await import('../../domain/recordingSnapshot/sources'),{emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot}=await import('../../domain/recordingSnapshot/model'),{resolveSnapshot}=await import('../../domain/recordingSnapshot/evaluation');
 const workspace=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',d),source=workspace.snapshots[0],parent=emptyRecordingSnapshot('parent'),child=emptyRecordingSnapshot('child'),id=(key:string)=>canonicalElementId('source',key);
 parent.layers=[{kind:'reference',id:'slot',name:'Layer',baseSnapshotId:source.id,baseLayerId:source.layers[0].id}];parent.deformation.layerDomains=[{...domain,layerIds:['slot']}];child.layers=[{kind:'reference',id:'child-slot',name:'Layer',baseSnapshotId:parent.id,baseLayerId:'slot'}];workspace.snapshots.push(parent,child);
 const before=resolveSnapshot(workspace,parent.id).drawing,plain=resolveSnapshot(workspace,child.id).drawing;expect(displayField(plain,displayPath(plain,id('a'))).geometry.shapes).toEqual(displayField(before,displayPath(before,id('a'))).geometry.shapes);
 child.deformation.layers['child-slot']={shape:{nodes:{},handles:{[id('a')]:[[0,0],[.02,.04]]}}};const edited=resolveSnapshot(workspace,child.id).drawing;near(shapeOf(edited,id('a'))[2],[shapeOf(before,id('a'))[2][0]+.02,shapeOf(before,id('a'))[2][1]+.04]);expect(displayField(edited,displayPath(edited,id('a'))).geometry.shapes).not.toEqual(displayField(before,displayPath(before,id('a'))).geometry.shapes);
});

test('disabling a domain recovers its input while retaining sparse corrections for restore',()=>{
 const {d,domain}=fixture(),post={nodes:{},handles:{a:[[0,0],[.04,.02]] as [Point2,Point2]}},before=applyLayerCageDomain(d,domain,post);
 expect(applyLayerCageDomain(d,{...domain,enabled:false},post)).toBe(d);
 expect(applyLayerCageDomain(d,{...domain,enabled:true},post)).toEqual(before);expect(post.handles.a[1]).toEqual([.04,.02]);
});

test('post-domain ARC remains tangent to its source pieces after a handle correction',()=>{
 const {d,domain}=fixture(),cage=applyLayerCageDomain(d,domain),after=applyLayerDomainPostShape(cage,{nodes:{},handles:{a:[[0,0],[.08,-.03]]}},new Set(['a','b'])),geometry=displayField(after,displayPath(after,'a')).geometry;
 tangent(geometry.shapes);const join=after.joins[0],forward=derivedUses(after,[{id:join.a.curveId,reverse:join.a.end===0},{id:join.b.curveId,reverse:join.b.end===1}]);expect(roundedJoins(after).get(join.id)!.shapes).toEqual(forward.pieces.filter(piece=>piece.joinId).map(piece=>piece.shape));
});
