import {chinSurfaces} from '../domain/chin/geometry';
import {helmetSurfaces} from '../domain/head/helmet';
import {capMesh} from '../domain/head/caps';
import {regionMesh} from '../domain/head/regions';
import {evaluationContext} from '../domain/geometry/evaluation';
import type {CurveProvider} from '../domain/geometry/curveProvider';
/** Application adapter: the only ordinary Main 2D rendering entry into geometry evaluation.
 * Per-entity kernel caches remain authoritative; this adapter packs their final results.
 */
import type {LandmarkProject} from '../domain/landmarks/model';
import {tessellate,type PatchMesh} from '../domain/patches/geometry';
import {controls,bezier,type ControlPoints} from '../domain/curves/geometry';
import type {EditRenderSnapshot,CurveRenderData,SurfaceRenderData} from '../rendering/edit2d/types';
import {count} from '../domain/geometry/diagnostics';
let revision=0;
const packedSurfaces=new WeakMap<PatchMesh,SurfaceRenderData>();
const packedCurves=new WeakMap<CurveProvider,Map<number,CurveRenderData>>();
export function finalSurfaceRenderData(p:LandmarkProject,subdivisions:number):SurfaceRenderData[]{
 return [...chinSurfaces(p),...helmetSurfaces(p),...(p.patches??[]).map(patch=>({id:patch.id,mesh:tessellate(p,patch,subdivisions)})),...(p.loomisRegions??[]).map(r=>({id:r.id,mesh:regionMesh(p,r)})),...(p.loomisCaps??[]).map(c=>({id:c.id,mesh:capMesh(p,c)}))].map(({id,mesh})=>{
 let data=packedSurfaces.get(mesh);
  if(!data){count('surfaceRenderBufferBuilds');const positions=new Float32Array(mesh.vertices.flat()),indices=new Uint32Array(mesh.triangles.flat());data={id,positions,indices,normals:surfaceNormals(positions,indices),geometryToken:'surface:'+ ++revision,warning:mesh.warning,invalid:mesh.invalid};packedSurfaces.set(mesh,data);}
  return data;
 });
}
export function editRenderSnapshot(p:LandmarkProject,options:{subdivisions:number;curveSegments:number;includeSurface:boolean}):EditRenderSnapshot{
 const surface=options.includeSurface?finalSurfaceRenderData(p,options.subdivisions):[];
 const curves=p.curves.map(c=>{
  const cp=evaluationContext(p).curve(c.id);let cache=packedCurves.get(cp);if(!cache){cache=new Map();packedCurves.set(cp,cache);}
  let data=cache.get(options.curveSegments);
  if(!data){count('curveRenderBufferBuilds');const samples=new Float32Array((options.curveSegments+1)*3);for(let i=0;i<=options.curveSegments;i++)samples.set(cp.evaluate(i/options.curveSegments),i*3);
   data={id:c.id,samples,dashed:'systemRole' in c&&!!c.systemRole?.startsWith('MAIN_'),geometryToken:'curve:'+ ++revision};cache.set(options.curveSegments,data);}
  return data;
 });
 return {surface,curves,geometryToken:[...surface,...curves].map(x=>x.geometryToken).join('|')};
}

/** Area-weighted normals, cached with the final per-patch packed mesh. */
export function surfaceNormals(positions:ArrayLike<number>,indices:ArrayLike<number>):Float32Array{
 const n=new Float32Array(positions.length);
 for(let i=0;i<indices.length;i+=3){const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
  const ux=positions[b]-positions[a],uy=positions[b+1]-positions[a+1],uz=positions[b+2]-positions[a+2],vx=positions[c]-positions[a],vy=positions[c+1]-positions[a+1],vz=positions[c+2]-positions[a+2];
  const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;for(const k of [a,b,c]){n[k]+=x;n[k+1]+=y;n[k+2]+=z;}
 }
 for(let i=0;i<n.length;i+=3){const l=Math.hypot(n[i],n[i+1],n[i+2]);if(l){n[i]/=l;n[i+1]/=l;n[i+2]/=l;}}
 return n;
}
