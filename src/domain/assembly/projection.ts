import {layerTransform,type AssemblyDocument} from './model';
import {layerCardProjection} from './cards';
import {resolvedPerspectives} from './deformRecording';
import {bendEvaluation,bendPoint,inverseBend} from './bending';
import {identity3,multiply3,inverse3,map3,fromCSS,perspectiveMatrix,sourcePoint,normalizedPoint,type Matrix3} from './perspective';
import type {Point2} from '../drawing/model';
export interface ProjectionView {width:number;height:number;unit:number;pan:Point2}
/** Fixed pipeline: normalized boundary bend -> perspective -> rig placement/card.
 * Painting applies this to centerlines, then constructs ink at authored width. */
export function layerProjection(a:AssemblyDocument,id:string,v:ProjectionView){
 const {width,height,unit,pan}=v,screen=([x,y]:Point2):Point2=>[width/2+pan[0]+unit*x,height/2+pan[1]-unit*y];
 const t=layerTransform(a,id),origin=screen(t.translation),s=unit*t.scale;
 const sourceToScreen:Matrix3=[s,0,origin[0],0,-s,origin[1],0,0,1];
 const usePerspective=!a.timeline||!a.timeline.editingBase&&['PERSPECTIVE','BEND','REFINE'].includes(a.timeline.stage);
 const card=usePerspective?layerCardProjection(a,id,screen,unit):undefined,cardMatrix=card?fromCSS(card):identity3();
 const p=usePerspective?resolvedPerspectives(a).find(p=>p.layerId===id):undefined,manual=p?.enabled?perspectiveMatrix(p):identity3();
 const bend=['BEND','REFINE'].includes(a.timeline?.stage??'')&&!a.timeline?.editingBase&&p?bendEvaluation(a,id).value:undefined;
 const placement=multiply3(cardMatrix,sourceToScreen),manualPlacement=multiply3(placement,manual);
 const mapCanonical=(q:Point2):Point2=>map3(manualPlacement,bend&&p?sourcePoint(p.source,bendPoint(bend,normalizedPoint(p.source,q))):q);
 const mapDrawing=(q:Point2)=>mapCanonical([(q[0]-t.translation[0])/t.scale,(q[1]-t.translation[1])/t.scale]);
 const inverseDrawing=(q:Point2):Point2=>{let v=map3(inverse3(manualPlacement),q);if(bend&&p)v=sourcePoint(p.source,inverseBend(bend,normalizedPoint(p.source,v)));return [v[0]*t.scale+t.translation[0],v[1]*t.scale+t.translation[1]];};
 return {placement,manualPlacement,sourceToScreen,mapCanonical,mapDrawing,inverseDrawing,matrix:multiply3(manualPlacement,inverse3(sourceToScreen)),active:!!(p?.enabled||card||bend)};
}
