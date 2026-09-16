import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {contourSource} from '../domain/contour/source';
import {silhouette,rasterSteps,traceSteps,CONTOUR_RESOLUTION,CONTOUR_SUBDIVISIONS,type Orientation} from '../domain/contour/silhouette';
import {silhouette as reference} from '../../tests/helpers/contour-v046-reference';
import {LatestJob} from '../domain/contour/jobs';
it('full-head 24/768 contour remains pixel-identical to V0.4.6 across orientations',()=>{
 const project=parseLandmarks(readFileSync('artifacts/surface-smooth/full-head-regression.json','utf8'));
 const {mesh}=contourSource(project);
 expect(CONTOUR_RESOLUTION).toBe(768);expect(CONTOUR_SUBDIVISIONS).toBe(24);
 for(const q of [[0,0,0,1],[0,Math.sin(.34),0,Math.cos(.34)],[.23,.31,.15,.9],[Math.SQRT1_2,0,0,Math.SQRT1_2]] as Orientation[])
 expect(silhouette(mesh,q)).toEqual(reference(mesh,q));
});
it('latest pending replaces intermediate requests and invalidates active work',async()=>{
 let release!:()=>void;const seen:number[]=[],stales:boolean[]=[];
 const jobs=new LatestJob<number>(async(n,stale)=>{seen.push(n);if(n===1)await new Promise<void>(r=>release=r);stales.push(stale());});
 jobs.submit(1);jobs.submit(2);jobs.submit(3);jobs.submit(4);release();
 await new Promise(r=>setTimeout(r,0));expect(seen).toEqual([1,4]);expect(stales).toEqual([true,false]);
});
it('surface replacement invalidates active and queued jobs',async()=>{
 let release!:()=>void;const seen:number[]=[],stales:boolean[]=[];
 const jobs=new LatestJob<number>(async(n,stale)=>{seen.push(n);if(n===1)await new Promise<void>(r=>release=r);stales.push(stale());});
 jobs.submit(1);jobs.submit(2);jobs.invalidate();jobs.submit(3);release();
 await new Promise(r=>setTimeout(r,0));expect(seen).toEqual([1,3]);expect(stales).toEqual([true,false]);
});
it('raster and exterior tracing expose cancellable chunks before full completion',()=>{
 const triangles=Array.from({length:2048},(_,i)=>({indices:[0,1,2] as [number,number,number],patchId:'p',triangleId:i}));
 const steps=rasterSteps([[0,0],[768,0],[0,768]],triangles);
 expect(steps.next().done).toBe(false);steps.return(new Uint8Array());
 const trace=traceSteps(new Uint8Array(768*768),768);expect(trace.next().done).toBe(false);trace.return([]);
});
