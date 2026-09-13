import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {addPatch} from '../domain/patches/model';
import {contourSource} from '../domain/contour/source';
import {rasterUnion,traceExterior,silhouette,projectMesh,type ContourMesh,type ContourTriangle,type Point} from '../domain/contour/silhouette';
const tris=(indices:number[][]):ContourTriangle[]=>indices.map((x,i)=>({indices:x as [number,number,number],patchId:'patch',triangleId:i}));
const fill=(mask:Uint8Array,n:number,x0:number,y0:number,x1:number,y1:number)=>{for(let y=y0;y<y1;y++)mask.fill(1,y*n+x0,y*n+x1);};
it('union mask erases seams and diagonals, ignores winding/order/overlap',()=>{
 const points:Point[]=[[3,3],[25,3],[25,25],[3,25]],a=rasterUnion(points,tris([[0,1,2],[0,2,3]]),32),b=rasterUnion(points,tris([[3,1,0],[3,2,1],[0,1,3]]),32);
 expect(a).toEqual(b);expect(traceExterior(a,32)).toHaveLength(1);
 const path=traceExterior(a,32)[0];for(const [x,y] of path)expect(x===3||x===25||y===3||y===25).toBe(true);
});
it('enclosed holes have no contours; disconnected exterior islands remain',()=>{
 const n=64,mask=new Uint8Array(n*n);fill(mask,n,4,4,35,40);
 for(let y=12;y<30;y++)mask.fill(0,y*n+12,y*n+27);
 expect(traceExterior(mask,n)).toHaveLength(1);
 fill(mask,n,45,8,55,20);const paths=traceExterior(mask,n);expect(paths).toHaveLength(2);
 for(const path of paths)expect(path.every(([x,y])=>x===4||x===35||y===4||y===40||x===45||x===55||y===8||y===20)).toBe(true);
});
it('open notches remain visible, empty mask and diagonal contacts terminate',()=>{
 const n=32,mask=new Uint8Array(n*n);expect(traceExterior(mask,n)).toEqual([]);
 fill(mask,n,3,3,28,28);for(let y=0;y<18;y++)mask.fill(0,y*n+12,y*n+19);
 expect(traceExterior(mask,n)[0].some(([x,y])=>x===12&&y===18)).toBe(true);
 const diagonal=new Uint8Array(16);diagonal[5]=1;diagonal[10]=1;expect(traceExterior(diagonal,4)).toHaveLength(2);
});
it('projection is orthographic, uses up, deterministic and independent of translation/scale',()=>{
 const mesh:ContourMesh={vertices:[[-1,-.5,0],[1,-.5,0],[1,.5,0],[-1,.5,0]],triangles:tris([[0,1,2],[0,2,3]])};
 const p=projectMesh(mesh,[0,0,0,1],128);
 const translated={...mesh,vertices:mesh.vertices.map(v=>v.map((x,i)=>x*5+[4,7,10][i]) as [number,number,number])};
 projectMesh(translated,[0,0,0,1],128).forEach((v,i)=>v.forEach((x,j)=>expect(x).toBeCloseTo(p[i][j],10)));
 expect(silhouette(mesh,[0,0,0,1],128)).toEqual(silhouette(mesh,[0,0,0,1],128));
 const rolled=projectMesh(mesh,[0,0,Math.SQRT1_2,Math.SQRT1_2],128);
 expect(Math.abs(rolled[1][0]-rolled[0][0])).toBeLessThan(1e-10);
 expect(Math.abs(rolled[1][1]-rolled[0][1])).toBeGreaterThan(50);
});
it('final patch source includes Fullness, preserves provenance, ignores display settings',()=>{
 const base=parseLandmarks(readFileSync('artifacts/basic-patch/adjusted-source.json','utf8'));
 const names=['左面壳前边界·额颞至颧颊','左斜面带横向桥·额颞层','左面壳后边界·颞侧至颧弓','左斜面带横向桥·颧颊层'];
 const p=addPatch(base,names.map(n=>base.curves.find(c=>c.name===n)!.id)),before=JSON.stringify(p),a=contourSource(p);
 const b=contourSource({...p,patchDisplay:{visible:false,quality:'veryLow',opacity2d:0,opacity3d:0}} as typeof p);
 expect(a).toEqual(b);expect(a.mesh.triangles).toHaveLength(2304);
 expect(new Set(a.mesh.triangles.map(t=>t.patchId)).size).toBe(2);
 const q={...p,patches:p.patches!.map((x,i)=>i?x:{...x,fullness:1})},c=contourSource(q);
 expect(c.mesh.vertices).not.toEqual(a.mesh.vertices);
 const orientations=Array.from({length:12},(_,i)=>{const yaw=i*Math.PI/12;return [Math.sin(.35)*Math.cos(yaw),Math.cos(.35)*Math.sin(yaw),-Math.sin(.35)*Math.sin(yaw),Math.cos(.35)*Math.cos(yaw)] as [number,number,number,number];});
 expect(orientations.some(q=>JSON.stringify(silhouette(c.mesh,q,256).paths)!==JSON.stringify(silhouette(a.mesh,q,256).paths))).toBe(true);
 expect(JSON.stringify(p)).toBe(before);
});
