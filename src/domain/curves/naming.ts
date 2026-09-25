import type {LandmarkProject} from '../landmarks/model';
const numberOf=(name:string)=>/^(?:左|右)?结构线\s+(\d+)$/.exec(name)?.[1];
/** Mirror partners share a number. Object count must never determine names. */
export function nextCurveName(p:Pick<LandmarkProject,'curves'>):string{
 const max=p.curves.reduce((n,c)=>Math.max(n,Number(numberOf(c.name)??0)),0);
 return `结构线 ${max+1}`;
}
/** Repair only colliding automatic names; retain UUIDs, topology and custom names. */
export function repairCurveNames(p:LandmarkProject):LandmarkProject{
 let next=Number(nextCurveName(p).split(' ')[1]);
 const owners=new Map<string,string>(),replacement=new Map<string,number>();
 for(const c of p.curves){const n=numberOf(c.name);if(n===undefined)continue;
  const owner=c.role==='mirror'?c.canonicalCurveId:c.id;
  const prior=owners.get(n);if(prior===undefined)owners.set(n,owner);
  else if(prior!==owner&&!replacement.has(owner))replacement.set(owner,next++);
 }
 if(!replacement.size)return p;
 return {...p,curves:p.curves.map(c=>{const n=replacement.get(c.role==='mirror'?c.canonicalCurveId:c.id);if(n===undefined||numberOf(c.name)===undefined)return c;const prefix=/^[左右]/.exec(c.name)?.[0]??'';return {...c,name:`${prefix}结构线 ${n}`};})};
}
