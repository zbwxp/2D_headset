import {boundaryIntervals,helmetBoundaryIntervals,exposedIntervals} from './boundaries';
import {evaluationContext} from '../geometry/evaluation';
import {HELMET} from '../head/scaffold';
import {localEdges} from './visible';
import {closedBoundary} from '../patches/boundary';
import {helmetSurfaces} from '../head/helmet';
import {capMesh} from '../head/caps';
import {regionMesh} from '../head/regions';
import {installSmoothResult} from "../continuity/evaluation";
import type {ContinuityResult} from "../continuity/solver";
import type {LandmarkProject} from '../landmarks/model';
import {tessellate} from '../patches/geometry';
import {CONTOUR_SUBDIVISIONS,type ContourMesh} from './silhouette';
export type ContourSource=Pick<LandmarkProject,'landmarks'|'curves'|'patches'|'surfaceContinuity'|'headFrame'|'loomisRegions'|'loomisCaps'|'loomisScaffold'> & {smoothResult?:ContinuityResult};
export function contourSource(source:ContourSource){
 const {smoothResult,...data}=source;
 const project:LandmarkProject={...data,version:'landmarks-0.4.1',meta:{name:'contour',createdAt:0,updatedAt:0},views:[],centerlineOrder:[]};
 if(smoothResult)installSmoothResult(project,smoothResult);
 const mesh:ContourMesh={vertices:[],triangles:[],edges:[],boundaries:[]},invalid:string[]=[],valid=new Set<string>();
 const boundaryUses=(source.patches??[]).flatMap(x=>x.boundaryUses.map(use=>({id:x.id,use}))).concat((source.loomisCaps??[]).map(c=>({id:c.id,use:closedBoundary(project,c.hostSectionCurveId)})));
 for(const {id,m} of [...helmetSurfaces(project).map(x=>({id:x.id,m:x.mesh})),...(source.patches??[]).map(patch=>({id:patch.id,m:tessellate(project,patch,CONTOUR_SUBDIVISIONS)})),...(source.loomisRegions??[]).map(r=>({id:r.id,m:regionMesh(project,r)})),...(source.loomisCaps??[]).map(c=>({id:c.id,m:capMesh(project,c)}))]){
 if(m.invalid){invalid.push(id+': '+m.invalid);continue;}
 valid.add(id);const offset=mesh.vertices.length,faceOffset=mesh.triangles.length;mesh.vertices.push(...m.vertices);
 const local:ContourMesh={vertices:m.vertices,triangles:m.triangles.map((indices,triangleId)=>({indices:indices as [number,number,number],patchId:id,triangleId}))},edges=localEdges(local);
 mesh.edges!.push(...edges.map(e=>({a:e.a+offset,b:e.b+offset,faces:e.faces.map(f=>f+faceOffset)})));
 // Analytic auxiliary surfaces have no Patch BoundaryUses. Recover only their real
 // trimmed mesh perimeter after local chart-vertex identification, never soup edges.
 if(id!==HELMET&&!boundaryUses.some(b=>b.id===id))mesh.boundaries!.push(...edges.filter(e=>e.faces.length===1).map(e=>[m.vertices[e.a],m.vertices[e.b]]));
 m.triangles.forEach((indices,triangleId)=>mesh.triangles.push({indices:indices.map(i=>i+offset) as [number,number,number],patchId:id,triangleId}));
 }
 const intervals=boundaryUses.filter(b=>valid.has(b.id)).flatMap(b=>boundaryIntervals(project,b.id,b.use));
 if(valid.has(HELMET))intervals.push(...helmetBoundaryIntervals(project));
 const exposed=exposedIntervals(intervals),ctx=evaluationContext(project);
 for(const b of exposed){const g=ctx.curve(b.curveId);mesh.boundaries!.push(Array.from({length:257},(_,i)=>g.evaluate(b.lo+(b.hi-b.lo)*i/256)));}
 return {mesh,invalid};
}
