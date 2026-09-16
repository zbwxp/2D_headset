import {test,expect} from 'vitest';
import {visibilitySteps,tangentChains,localEdges,type Depth,type ContourChain} from '../domain/contour/visible';
import type {ContourMesh} from '../domain/contour/silhouette';
function finish<T>(g:Generator<void,T>):T{let n=g.next();while(!n.done)n=g.next();return n.value;}
function fixture(width=2,face=7,gap=.00004){
 const size=32,d:Depth={size,values:new Float64Array(size*size).fill(-1),dx:new Float64Array(size*size),dy:new Float64Array(size*size),face:new Int32Array(size*size).fill(-1)};
 for(let x=12;x<12+width;x++){d.values[16*size+x]=gap;d.face[16*size+x]=face;}
 const c:ContourChain={points:[[2,16,0],[28,16,0]],localFaces:[[7,8]]};return {d,c};
}
test('tiny local self-depth gap is repaired along existing chain',()=>{
 const {d,c}=fixture();expect(finish(visibilitySteps([c],d,1e-5))).toHaveLength(1);
 expect(finish(visibilitySteps([c.points],d,1e-5))).toHaveLength(2);
});
test('other surface, distant same-surface face, large depth or long gap remain hidden',()=>{
 for(const [width,face,gap] of [[2,99,.00004],[2,7,.02],[8,7,.00004]]){
  const {d,c}=fixture(width,face,gap);expect(finish(visibilitySteps([c],d,1e-5))).toHaveLength(2);
 }
});
test('repair does not extrapolate chain endpoints or join disconnected chains',()=>{
 const {d,c}=fixture();c.points=[[12,16,0],[28,16,0]];
 expect(finish(visibilitySteps([c],d,1e-5))[0][0][0]).toBeGreaterThanOrEqual(14);
});
test('mesh-adjacent transition edges form one chain with provenance',()=>{
 const m:ContourMesh={vertices:[[0,0,0],[1,0,0],[2,0,0],[0,1,0],[1,1,0],[2,1,0],[0,1,1],[1,1,1],[2,1,1]],triangles:[]};
 for(const indices of [[0,1,3],[1,4,3],[1,2,4],[2,5,4],[1,0,6],[7,1,6],[2,1,7],[8,2,7]] as [number,number,number][])m.triangles.push({indices,patchId:'a',triangleId:m.triangles.length});
 m.edges=localEdges(m);const chains=tangentChains(m,m.vertices);
 expect(chains).toHaveLength(1);expect(chains[0].points).toHaveLength(3);expect(chains[0].localFaces).toHaveLength(2);
});
