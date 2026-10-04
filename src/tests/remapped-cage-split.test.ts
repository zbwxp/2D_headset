import {expect,test} from 'vitest';
import * as commands from '../domain/drawing/commands';
import {emptyDrawing,shapeOf,type Cubic,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {createCurveSplitIntent,applyCurveSplitIntent} from '../domain/drawing/layerEditIntent';
import {neutralBend} from '../domain/deformation/coons';
import {mappedParameter} from '../domain/deformation/cubicDeformation';
import {applyLayerCageDomain,applyLayerDomainPostShape} from '../domain/recordingSnapshot/layerCageEvaluation';
import {layerCageDomainProjection,type SnapshotLayerCageDomain} from '../domain/recordingSnapshot/layerCageDomain';
import {displayField,displayPath} from '../domain/drawing/displayIntervals';
import {derivedUses,subcurve} from '../domain/drawing/roundedJoin';
import {placeDrawingAffines,drawingLayerObjectOwners} from '../domain/drawing/affineDrawing';
import {applyAffine2D,type Affine2D} from '../domain/geometry/affine2d';
import {createCageGeometryProjector} from '../domain/drawing/cageGeometry';
import {curveFitRange} from '../domain/drawing/curveFitRange';
import {copyCurveSource} from '../domain/drawing/curveProvenance';
import {evaluatedDeformationSource,evaluatedMaterialProgram,remapEvaluatedDeformations} from '../domain/drawing/evaluatedDeformation';
import {remapDrawingIdentities} from '../domain/recordingSnapshot/sources';
import {mirrorSnapshotDrawing} from '../domain/recordingSnapshot/snapshotMirror';

const near=(a:Point2,b:Point2)=>expect(Math.hypot(a[0]-b[0],a[1]-b[1])).toBeLessThan(1e-10);
const sameShape=(a:Cubic,b:Cubic)=>a.forEach((p,i)=>near(p,b[i]));
const sameGeometry=(a:Cubic[],b:Cubic[])=>{expect(a).toHaveLength(b.length);a.forEach((shape,i)=>sameShape(shape,b[i]));};
const sameRange=(a:Cubic,b:Cubic)=>{const left=curveFitRange(a)!,right=curveFitRange(b)!;expect(left.id).toBe(right.id);left.parameterRange.forEach((t,i)=>expect(t).toBeCloseTo(right.parameterRange[i],14));};
const material=(drawing:DrawingDocument,id:string)=>displayField(drawing,displayPath(drawing,id));
const native=(geometry:ReturnType<typeof derivedUses>,ids:readonly string[])=>ids.map(id=>geometry.pieces.find(piece=>!piece.joinId&&piece.owners[0]===id)!).map(piece=>{const range=curveFitRange(piece.shape)!.parameterRange;return range[0]>range[1]?{...piece,shape:copyCurveSource(piece.shape,[...piece.shape].reverse() as Cubic,1,0)}:piece;});
function fixture(){
 let drawing=commands.addLayer(emptyDrawing(),'Source');const layer=drawing.layers[0].id;
 drawing=commands.createCurve(drawing,layer,[[-.8,-.3],[-.65,.2],[-.2,0],[0,0]],.013,'A','a');
 drawing=commands.createCurve(drawing,layer,[[0,0],[0,.23],[0,.47],[0,.7]],.013,'B','b');drawing=commands.connect(drawing,{curveId:'a',end:1},{curveId:'b',end:0},'ARC',.08);
 let counter=0;const intent=createCurveSplitIntent(drawing,'a',.373,{allocateId:()=>`split-${++counter}`});drawing=applyCurveSplitIntent(drawing,intent).document;
 const bend=neutralBend();bend.handles[1][0][0]=1.13;bend.handles[0][1][1]=-.08;
 const domain:SnapshotLayerCageDomain={kind:'h-coons',id:'first-cage',layerIds:[layer],restRect:{min:[-1,-1],max:[1,1]},quad:[[-1,-1],[.9,-.85],[.75,.95],[-.9,.85]],bend,fitLineages:[{id:'a',parts:[{curveId:intent.childCurveIds[0],parameterRange:[0,intent.t]},{curveId:intent.childCurveIds[1],parameterRange:[intent.t,1]}]}]};
 const second={...structuredClone(domain),id:'second-cage'};second.bend!.handles[2][0][1]=.9;
 return {drawing,layer,domain,second,ids:intent.childCurveIds};
}
function presentation(drawing:DrawingDocument){const map=(id:string)=>`present:${id}`,inverse=(id:string)=>id.slice(8),output=remapDrawingIdentities(drawing,map);remapEvaluatedDeformations(output,drawing,remapDrawingIdentities(evaluatedDeformationSource(drawing)!,map),map,inverse);return output;}

test('namespace adapters replay split families in full context and remap exported lineage identities',()=>{
 const f=fixture(),drawing=applyLayerCageDomain(f.drawing,f.domain),before=material(drawing,f.ids[0]),presented=presentation(drawing),after=material(presented,`present:${f.ids[0]}`);
 sameGeometry(after.geometry.shapes,before.geometry.shapes);
 for(const s of [.07,.3,.68,.93])near(after.at(s).p,before.at(s).p);
 const program=evaluatedMaterialProgram(presented,`present:${f.ids[0]}`)!,step=program.find(step=>step.kind==='cage');expect(step?.kind).toBe('cage');if(step?.kind!=='cage')throw Error('Missing cage');
 expect(step.domain.fitLineages).toEqual([{id:'present:a',parts:f.domain.fitLineages![0].parts.map(part=>({...part,curveId:`present:${part.curveId}`}))}]);
 const oldPath=displayPath(drawing,f.ids[0]),newPath=displayPath(presented,`present:${f.ids[0]}`);sameGeometry(derivedUses(presented,newPath.segments,newPath.closed).shapes,derivedUses(drawing,oldPath.segments,oldPath.closed).shapes);
});

test('an affine between two cages retains the trimmed fitted-parent intervals',()=>{
 const f=fixture(),first=applyLayerCageDomain(f.drawing,f.domain),before=material(first,f.ids[0]),pieces=native(before.geometry,f.ids),matrix:Affine2D=[.9,.03,.08,.85,.02,-.01],owners=drawingLayerObjectOwners(first),affine=placeDrawingAffines(first,{[f.layer]:matrix},id=>owners.get(id)),between=material(affine,f.ids[0]),mapped=native(between.geometry,f.ids);
 pieces.forEach((piece,i)=>sameRange(mapped[i].shape,piece.shape));
 const q=curveFitRange(pieces[0].shape)!.parameterRange[1],a=pieces[0].shape,b=pieces[1].shape,parent:Cubic=[a[0],[a[0][0]+(a[1][0]-a[0][0])/q,a[0][1]+(a[1][1]-a[0][1])/q],[b[3][0]+(b[2][0]-b[3][0])/(1-q),b[3][1]+(b[2][1]-b[3][1])/(1-q)],b[3]],projector=createCageGeometryProjector(layerCageDomainProjection(f.second),new Set(f.ids)),expected=projector.fit(parent.map(p=>applyAffine2D(matrix,p)) as Cubic),cut=mappedParameter(q,expected.parameters),second=applyLayerCageDomain(affine,f.second),actual=native(material(second,f.ids[0]).geometry,f.ids);
 sameShape(actual[0].shape,subcurve(expected.shape,0,cut));sameShape(actual[1].shape,subcurve(expected.shape,cut,1));
 const presented=presentation(second);sameGeometry(material(presented,`present:${f.ids[0]}`).geometry.shapes,material(second,f.ids[0]).geometry.shapes);
});

test('ordinary post-shape fitting and subsequent trims keep the current fitted-parent frame',()=>{
 const f=fixture(),first=applyLayerCageDomain(f.drawing,f.domain),before=material(first,f.ids[0]),after=applyLayerDomainPostShape(first,{nodes:{},handles:{[f.ids[0]]:[[.02,.01],[0,0]]}},new Set([...f.ids,'b'])),corrected=material(after,f.ids[0]),old=native(before.geometry,f.ids),next=native(corrected.geometry,f.ids);
 old.forEach((piece,i)=>sameRange(next[i].shape,piece.shape));
 sameGeometry(material(presentation(after),`present:${f.ids[0]}`).geometry.shapes,corrected.geometry.shapes);
 const shape=next[0].shape,[lo,hi]=curveFitRange(shape)!.parameterRange,trim=subcurve(shape,.19,.83);expect(curveFitRange(trim)!.parameterRange[0]).toBeCloseTo(lo+(hi-lo)*.19,12);expect(curveFitRange(trim)!.parameterRange[1]).toBeCloseTo(lo+(hi-lo)*.83,12);
 const second=applyLayerCageDomain(after,f.second),source=material(second,f.ids[0]),presented=presentation(second),view=material(presented,`present:${f.ids[0]}`);sameGeometry(view.geometry.shapes,source.geometry.shapes);for(const s of [.1,.4,.8])near(view.at(s).p,source.at(s).p);
});

test('reflection of a split cage keeps complete-family geometry and is an involution',()=>{
 const f=fixture(),first=applyLayerCageDomain(f.drawing,f.domain),second=applyLayerCageDomain(first,f.second),before=material(second,f.ids[0]),mirrored=mirrorSnapshotDrawing(second,{axisX:0,curvePairs:[]}).drawing,after=material(mirrored,f.ids[0]);
 expect(after.geometry.shapes).toHaveLength(before.geometry.shapes.length);after.geometry.shapes.forEach((shape,i)=>shape.forEach((p,k)=>near(p,[-before.geometry.shapes[i][k][0],before.geometry.shapes[i][k][1]])));
 const back=mirrorSnapshotDrawing(mirrored,{axisX:0,curvePairs:[]}).drawing;material(back,f.ids[0]).geometry.shapes.forEach((shape,i)=>sameShape(shape,before.geometry.shapes[i]));sameShape(shapeOf(back,f.ids[0]),shapeOf(second,f.ids[0]));
});
