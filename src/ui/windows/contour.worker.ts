import {projection,depthSteps,tangentChains,visibilitySteps} from '../../domain/contour/visible';
import {contourSource,type ContourSource} from '../../domain/contour/source';
import {rasterSteps,traceSteps,CONTOUR_RESOLUTION,type Orientation} from '../../domain/contour/silhouette';
import {LatestJob} from '../../domain/contour/jobs';
import type {JobTiming} from './contourProfile';
export type ContourCameraRequest={type:'RENDER';id:number;revision:string;orientation:Orientation};
export type ContourRequest=ContourCameraRequest|{type:'SET_SURFACE';revision:string;source:ContourSource};
let revision='',geometry:ReturnType<typeof contourSource>|undefined;
// MessageChannel yields to incoming camera messages without nested timer throttling.
const channel=new MessageChannel();let resume:(()=>void)|undefined;
channel.port1.onmessage=()=>{const r=resume;resume=undefined;r?.();};
const yieldTask=()=>new Promise<void>(resolve=>{resume=resolve;channel.port2.postMessage(null);});
const jobs=new LatestJob<ContourCameraRequest>(async(request,stale)=>{
 if(import.meta.env.DEV)self.postMessage({type:'STARTED',id:request.id,revision:request.revision});
 const started=performance.now(),timing:JobTiming={projection:0,raster:0,trace:0,total:0,cancelled:false};
 const mesh=geometry;
 const cancelled=()=>stale()||request.revision!==revision;
 // Yield after a chunk crosses the 4ms budget (a single chunk can exceed it).
 const consume=async<T>(steps:Generator<void,T>,phase:'raster'|'trace')=>{
  let slice=performance.now(),next:IteratorResult<void,T>;
  do{
   const t=performance.now();next=steps.next();timing[phase]+=performance.now()-t;
   if(performance.now()-slice>=4){await yieldTask();slice=performance.now();}
   if(cancelled())return undefined;
  }while(!next.done);
  return next.value;
 };
 try{
  if(!mesh||request.revision!==revision)throw Error('轮廓源未准备');
  const t=performance.now(),projected=projection(mesh.mesh,request.orientation),points=projected.points;timing.projection=performance.now()-t;
  await yieldTask();
  const mask=cancelled()?undefined:await consume(rasterSteps(points.map(p=>[p[0],p[1]]),mesh.mesh.triangles),'raster');
  const paths=mask&&!cancelled()?await consume(traceSteps(mask,CONTOUR_RESOLUTION),'trace'):undefined;
  const depth=paths&&!cancelled()?await consume(depthSteps(points,mesh.mesh),'raster'):undefined;
  let openPaths;
  if(depth&&!cancelled()){
   const lines=mesh.mesh.boundaries??[],flat=projection(mesh.mesh,request.orientation,CONTOUR_RESOLUTION,lines.flat()).points;let at=0;const boundary=lines.map(line=>{const q=flat.slice(at,at+line.length);at+=line.length;return q;});
   openPaths=await consume(visibilitySteps([...tangentChains(mesh.mesh,points),...boundary],depth,projected.epsilon),'trace');
  }
  // Drain incoming camera updates before publishing, including those arriving during trace.
  await yieldTask();
  if(!paths||!openPaths||cancelled()){
   timing.cancelled=true;timing.total=performance.now()-started;
   self.postMessage({type:'CANCELLED',id:request.id,revision:request.revision,timing});return;
  }
  let coveredPixels=0;for(let i=0;i<mask!.length;i++)coveredPixels+=mask![i];
  timing.total=performance.now()-started;
  self.postMessage({type:'RESULT',id:request.id,revision:request.revision,orientation:request.orientation,paths,openPaths,resolution:CONTOUR_RESOLUTION,coveredPixels,invalid:mesh.invalid,triangleCount:mesh.mesh.triangles.length,timing});
 }catch(e){self.postMessage({type:'RESULT',id:request.id,revision:request.revision,error:(e as Error).message,timing});}
});
self.onmessage=(event:MessageEvent<ContourRequest>)=>{
 const request=event.data;
 if(request.type==='SET_SURFACE'){
  if(revision===request.revision)return;
  jobs.invalidate();revision=request.revision;
  try{geometry=contourSource(request.source);}catch(e){geometry=undefined;self.postMessage({type:'SURFACE_ERROR',revision,error:(e as Error).message});}
 }else jobs.submit(request);
};
