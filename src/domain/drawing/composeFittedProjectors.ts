import {point} from './sampling';
import {mappedParameter} from '../deformation/cubicDeformation';
import type {Cubic,Point2} from './model';
import {composeCurveParameterMaps} from '../deformation/curveParameterRestriction';
import {createFittedGeometryProjector,type GeometryFit} from './cageGeometry';
import {retainCageSplitShapeRange} from './cageSplitProjector';
type Projector=ReturnType<typeof createFittedGeometryProjector>;
/** Compose existing fitting stages and their exact parameter maps. */
export function composeFittedProjectors(first:Projector,second:Projector,targetPoint?:(shape:Cubic,t:number)=>Point2,tolerance=.00004):Projector {
 const combine=(a:GeometryFit|undefined,b:GeometryFit|undefined):GeometryFit|undefined=>!a?b:!b?a:{...b,shape:retainCageSplitShapeRange(a.shape,b.shape),parameters:composeCurveParameterMaps(a.parameters,b.parameters),maxError:a.maxError+b.maxError};
 const measured=(input:{pieces:{shape:Cubic;owners:string[];joinId?:string}[]},fits:(GeometryFit|undefined)[])=>fits.map((fit,i)=>{if(!fit||!targetPoint)return fit;let maxError=0;for(let j=0;j<=256;j++){const t=j/256,p=point(fit.shape,mappedParameter(t,fit.parameters)),target=targetPoint(input.pieces[i].shape,t);maxError=Math.max(maxError,Math.hypot(p[0]-target[0],p[1]-target[1]));}return {...fit,maxError};});
 const diagnostics=(input:{pieces:{owners:string[];joinId?:string}[]},fits:(GeometryFit|undefined)[])=>fits.flatMap((fit,pieceIndex)=>fit?[{owners:input.pieces[pieceIndex].owners,joinId:input.pieces[pieceIndex].joinId,pieceIndex,maxError:fit.maxError,tolerance,exceedsTolerance:fit.maxError>tolerance}]:[]);
 const projectGeometry:Projector['projectGeometry']=(geometry,include)=>{const a=first.projectGeometry(geometry,include),b=second.projectGeometry(a.geometry,include?piece=>include(geometry.pieces[a.geometry.pieces.indexOf(piece)]):undefined);const fits=measured(geometry,b.fits.map((fit,i)=>combine(a.fits[i],fit)));return {...b,fits,diagnostics:targetPoint?diagnostics(geometry,fits):[...a.diagnostics,...b.diagnostics]};};
 const projectMaterialField:Projector['projectMaterialField']=(field,include)=>{const a=first.projectMaterialField(field,include),b=second.projectMaterialField(a.field,include?piece=>include(field.geometry.pieces[a.field.geometry.pieces.indexOf(piece)]):undefined);const fits=measured(field.geometry,b.fits.map((fit,i)=>combine(a.fits[i],fit)));return {...b,fits,diagnostics:targetPoint?diagnostics(field.geometry,fits):[...a.diagnostics,...b.diagnostics]};};
 return {fit:shape=>{const a=first.fit(shape);return combine(a,second.fit(a.shape))!;},projectGeometry,projectMaterialField};
}
