import {chinSurfaces} from '../chin/geometry';
import {CHIN,seamId} from '../chin/model';
import {ownerOf,type GeometryModule} from '../modules/ownership';
import {irisRims} from '../eyes/gaze';
import {boundaryIntervals,helmetBoundaryIntervals,exposedIntervals} from './boundaries';
import {evaluationContext} from '../geometry/evaluation';
import {HELMET} from '../head/scaffold';
import {localEdges} from './visible';
import {closedBoundary,wholeBoundary} from '../patches/boundary';
import {helmetSurfaces} from '../head/helmet';
import {capMesh} from '../head/caps';
import {regionMesh} from '../head/regions';
import {installSmoothResult} from "../continuity/evaluation";
import type {ContinuityResult} from "../continuity/solver";
import type {LandmarkProject} from '../landmarks/model';
import {tessellate} from '../patches/geometry';
import {CONTOUR_SUBDIVISIONS,type ContourMesh} from './silhouette';
export type ContourSource=Pick<LandmarkProject,'geometryModules'|'gazeEyeball'|'eyeScaffold'|'curveSmoothJoins'|'landmarks'|'curves'|'patches'|'surfaceContinuity'|'chinScaffold'|'headPerspective'|'headFrame'|'loomisRegions'|'loomisCaps'|'loomisScaffold'> & {hiddenModules?:GeometryModule[];smoothResult?:ContinuityResult};
export function contourSource(source:ContourSource){
 const {smoothResult,hiddenModules=[],...data}=source;
 const project:LandmarkProject={...data,version:'landmarks-0.4.1',meta:{name:'contour',createdAt:0,updatedAt:0},views:[],centerlineOrder:[]};
 if(smoothResult)installSmoothResult(project,smoothResult);
 const displayVertices:{start:number;count:number;id:string}[]=[];
 const displayBoundaries:{index:number;id:string}[]=[];
 const mesh:ContourMesh={vertices:[],triangles:[],edges:[],boundaries:[]},invalid:string[]=[],valid=new Set<string>();
 const boundaryUses=(source.patches??[]).flatMap(x=>x.boundaryUses.map(use=>({id:x.id,use}))).concat((source.loomisCaps??[]).map(c=>({id:c.id,use:closedBoundary(project,c.hostSectionCurveId)})));
 if(project.chinScaffold?.version===2)for(const slot of ['FRONT_RIM','SIDE','REAR_RIM'] as const)for(const left of [false,true])boundaryUses.push({id:CHIN,use:wholeBoundary(project,seamId(slot,left))});
 for(const {id,m} of [...chinSurfaces(project).map(x=>({id:x.id,m:x.mesh})),...helmetSurfaces(project).map(x=>({id:x.id,m:x.mesh})),...(source.patches??[]).map(patch=>({id:patch.id,m:tessellate(project,patch,CONTOUR_SUBDIVISIONS)})),...(source.loomisRegions??[]).map(r=>({id:r.id,m:regionMesh(project,r)})),...(source.loomisCaps??[]).map(c=>({id:c.id,m:capMesh(project,c)}))]){
 if(hiddenModules.includes(ownerOf(project,id)))continue;
 if(m.invalid){invalid.push(id+': '+m.invalid);continue;}
 valid.add(id);const offset=mesh.vertices.length,faceOffset=mesh.triangles.length;mesh.vertices.push(...m.vertices);displayVertices.push({start:offset,count:m.vertices.length,id});
 const local:ContourMesh={vertices:m.vertices,triangles:m.triangles.map((indices,triangleId)=>({indices:indices as [number,number,number],patchId:id,triangleId}))},edges=localEdges(local);
 mesh.edges!.push(...edges.map(e=>({a:e.a+offset,b:e.b+offset,faces:e.faces.map(f=>f+faceOffset)})));
 // Analytic auxiliary surfaces have no Patch BoundaryUses. Recover only their real
 // trimmed mesh perimeter after local chart-vertex identification, never soup edges.
 if(id!==HELMET&&!boundaryUses.some(b=>b.id===id))for(const e of edges.filter(e=>e.faces.length===1)){displayBoundaries.push({index:mesh.boundaries!.length,id});mesh.boundaries!.push([m.vertices[e.a],m.vertices[e.b]]);}
 m.triangles.forEach((indices,triangleId)=>mesh.triangles.push({indices:indices.map(i=>i+offset) as [number,number,number],patchId:id,triangleId}));
 }
 const intervals=boundaryUses.filter(b=>valid.has(b.id)).flatMap(b=>boundaryIntervals(project,b.id,b.use));
 if(valid.has(HELMET))intervals.push(...helmetBoundaryIntervals(project));
 const exposed=exposedIntervals(intervals),ctx=evaluationContext(project);
 for(const b of exposed){displayBoundaries.push({index:mesh.boundaries!.length,id:b.curveId});const g=ctx.curve(b.curveId);mesh.boundaries!.push(Array.from({length:257},(_,i)=>g.evaluate(b.lo+(b.hi-b.lo)*i/256)));}
 for(const c of project.curves)if(c.contourRole==='OPEN_EDGE'&&!hiddenModules.includes(ownerOf(project,c.id)))try{const line=ctx.curve(c.id).sample(512);displayBoundaries.push({index:mesh.boundaries!.length,id:c.id});mesh.boundaries!.push(line);displayVertices.push({start:mesh.vertices.length,count:line.length,id:c.id});mesh.vertices.push(...line);}catch(e){invalid.push(c.id+': '+(e as Error).message);}
 mesh.alwaysLines=hiddenModules.includes('EYES')?[]:irisRims(project);mesh.vertices.push(...mesh.alwaysLines.flat());
 return {mesh,invalid,displayVertices,baseVertices:mesh.vertices,displayBoundaries,baseBoundaries:mesh.boundaries!,project};
}
