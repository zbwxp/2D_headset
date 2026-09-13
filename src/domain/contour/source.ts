import {installSmoothResult} from "../smooth/evaluation";
import type {SmoothResult} from "../smooth/field";
import type {LandmarkProject} from '../landmarks/model';
import {tessellate} from '../patches/geometry';
import {CONTOUR_SUBDIVISIONS,type ContourMesh} from './silhouette';
export type ContourSource=Pick<LandmarkProject,'landmarks'|'curves'|'patches'|'surfaceSmooth'> & {smoothResult?:SmoothResult};
export function contourSource(source:ContourSource){
 const {smoothResult,...data}=source;
 const project:LandmarkProject={...data,version:'landmarks-0.4.1',meta:{name:'contour',createdAt:0,updatedAt:0},views:[],centerlineOrder:[]};
 if(smoothResult)installSmoothResult(project,smoothResult);
 const mesh:ContourMesh={vertices:[],triangles:[]},invalid:string[]=[];
 for(const patch of source.patches??[]){
 const m=tessellate(project,patch,CONTOUR_SUBDIVISIONS);
 if(m.invalid){invalid.push(patch.id+': '+m.invalid);continue;}
 const offset=mesh.vertices.length;mesh.vertices.push(...m.vertices);
 m.triangles.forEach((indices,triangleId)=>mesh.triangles.push({indices:indices.map(i=>i+offset) as [number,number,number],patchId:patch.id,triangleId}));
 }
 return {mesh,invalid};
}
