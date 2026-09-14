import {count,timed} from '../geometry/diagnostics';
import type {LandmarkProject} from '../landmarks/model';
import {getSmoothResult,installSmoothResult,solveKey} from './evaluation';
import type {SmoothResult} from './field';
let worker:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined;
let desired='',pending:LandmarkProject|undefined,inflight:{key:string;p:LandmarkProject}|undefined;
function dispatch(){
 if(inflight||!pending)return;
 const p=pending,key=solveKey(p);pending=undefined;if(key!==desired)return;
 try{
  if(!worker){worker=new Worker(new URL('./smooth.worker.ts',import.meta.url),{type:'module'});
   worker.onmessage=(e:MessageEvent<SmoothResult>)=>{const job=inflight;inflight=undefined;if(job&&job.key===desired)installSmoothResult(job.p,e.data);dispatch();};
   worker.onerror=e=>{const job=inflight;inflight=undefined;worker?.terminate();worker=undefined;if(job&&job.key===desired)failure(job.p,e.message||'Smooth Worker 失败');dispatch();};
  }
  inflight={key,p};const end=timed('workerInputPreparation');count('smoothDispatches');worker.postMessage({...p,views:[],meta:{name:'smooth',createdAt:0,updatedAt:0}});end();
 }catch(e){inflight=undefined;failure(p,(e as Error).message);}
}
function failure(p:LandmarkProject,message:string){installSmoothResult(p,{fields:{},diagnostics:{before:0,after:0,maxDisplacement:0,averageDisplacement:0,iterations:0,relativeResidual:0,variables:0,seamSamples:0,warnings:[]},error:message});}
export function ensureSmooth(p:LandmarkProject){
 if(!p.surfaceSmooth?.enabled||p.surfaceSmooth.strength===0){desired='';pending=undefined;clearTimeout(timer);return;}
 const key=solveKey(p);if(key===desired)return;desired=key;pending=undefined;clearTimeout(timer);
 if(getSmoothResult(p))return;
 timer=setTimeout(()=>{if(desired===key){pending=p;dispatch();}},60);
}
