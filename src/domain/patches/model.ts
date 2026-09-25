import {dependencyGraph} from '../geometry/dependencies';
import {completeChinBoundary} from '../chin/junction';
import {wholeBoundary,validateBoundary,boundaryKey,canonicalBoundary,mirrorBoundary,boundaryGeometry,reverseBoundary,type SpanBoundaryUse,type PatchBoundaryUse} from './boundary';
export type {PatchBoundaryUse} from './boundary';
import type { LandmarkProject } from '../landmarks/model';
export interface SurfacePatch {
    id: string;
    name?: string; // Optional pair-wide display name; old projects keep automatic labels.
    type: 'tri' | 'quad' | 'loop' | 'lens';
    boundaryUses: PatchBoundaryUse[];
    mirrorPartnerId?: string;
    canonicalId?: string;
    fullness?: number; // Only canonical/self-symmetric records own this value.
}
export const patchQualityLevels = {
    veryLow: { label: '极低', subdivisions: 4, curveSegments: 16 },
    low: { label: '低', subdivisions: 6, curveSegments: 24 },
    medium: { label: '中', subdivisions: 12, curveSegments: 48 },
    high: { label: '高', subdivisions: 24, curveSegments: 96 },
} as const;
export type PatchQuality = keyof typeof patchQualityLevels;
export const patchSampling = (display?: PatchDisplay) => patchQualityLevels[display?.quality === 'ultra' ? 'high' : display?.quality ?? 'high'];
export interface PatchDisplay {
    quality?: PatchQuality | 'ultra'; // Read-only compatibility with older saves.
    visible?: boolean;
    opacity2d: number;
    opacity3d: number;
}
export const defaultDisplay: PatchDisplay = { opacity2d: .75, opacity3d: .7 };
export function loop(p:LandmarkProject, input:(string|PatchBoundaryUse)[]) {
 const uses=input.map(x=>{const b=typeof x==='string'?wholeBoundary(p,x):x;if(b.kind==='closed')throw Error('完整闭环请使用环形 Patch');return b;});
 uses.forEach(b=>validateBoundary(p,b));
 if(![2,3,4].includes(uses.length)||new Set(uses.map(b=>boundaryKey(p,b))).size!==uses.length)throw Error('请选择 2、3 或 4 条不同的边界');
 const degree=new Map<string,number>();for(const b of uses)for(const id of [b.startLandmarkId,b.endLandmarkId])degree.set(id,(degree.get(id)??0)+1);
 if(degree.size!==uses.length||[...degree.values()].some(n=>n!==2))throw Error('所选边未组成连续闭环');
 let vertex=[...degree.keys()].sort()[0];const result:{id:string;curveId:string;reverse:boolean;vertex:string;use:PatchBoundaryUse}[]=[];
 for(let i=0;i<uses.length;i++){
 const b=uses.filter(b=>!result.some(r=>r.id===boundaryKey(p,b))&&(b.startLandmarkId===vertex||b.endLandmarkId===vertex)).sort((a,b)=>a.curveId.localeCompare(b.curveId)||boundaryKey(p,a).localeCompare(boundaryKey(p,b)))[0];
 if(!b)throw Error('边界不连通');const c=canonicalBoundary(p,b),reverse=c.endLandmarkId===vertex;
 const use=(b.startLandmarkId===vertex?b:reverseBoundary(p,b)) as SpanBoundaryUse;
 result.push({id:boundaryKey(p,b),curveId:b.curveId,reverse,vertex,use});vertex=use.endLandmarkId;
 }
 if(vertex!==result[0].vertex)throw Error('边界未闭合');return result;
}
const key=(p:LandmarkProject,bs:PatchBoundaryUse[])=>JSON.stringify(bs.map(b=>boundaryKey(p,b)).sort());
export function addPatch(p:LandmarkProject,input:(string|PatchBoundaryUse)[]):LandmarkProject {
 const bs=completeChinBoundary(p,input.map(b=>typeof b==='string'?wholeBoundary(p,b):{...b}));loop(p,bs);bs.forEach(b=>boundaryGeometry(p,b));const patches=p.patches??[];
 if(patches.some(x=>key(p,x.boundaryUses)===key(p,bs)))throw Error('该闭环已有 Patch');
 const a:SurfacePatch={id:crypto.randomUUID(),type:bs.length===2?'lens':bs.length===3?'tri':'quad',boundaryUses:bs,fullness:0},added=[a];
 let mirrored:PatchBoundaryUse[]|undefined;try{mirrored=bs.map(b=>mirrorBoundary(p,b));}catch{/* Unpaired topology remains a single patch. */}
 if(mirrored&&key(p,mirrored)!==key(p,bs)){
 loop(p,mirrored);if(patches.some(x=>key(p,x.boundaryUses)===key(p,mirrored!)))throw Error('镜像闭环已有 Patch');
 const b:SurfacePatch={id:crypto.randomUUID(),type:a.type,boundaryUses:mirrored,canonicalId:a.id,mirrorPartnerId:a.id};a.mirrorPartnerId=b.id;added.push(b);
 }
 const next:LandmarkProject={...p,version:'landmarks-0.4.9',patches:[...patches,...added]};dependencyGraph(next);return next;
}
export function prunePatches(p:LandmarkProject):LandmarkProject {
 if(!p.patches)return p;const bad=new Set<string|undefined>();for(const x of p.patches)try{x.boundaryUses.forEach(b=>validateBoundary(p,b));}catch{bad.add(x.id);bad.add(x.mirrorPartnerId);}
 return {...p,patches:p.patches.filter(x=>!bad.has(x.id))};
}
export function parsePatches(value:unknown,p:LandmarkProject,geometryCheck=true):SurfacePatch[]{
 if(value===undefined)return [];if(!Array.isArray(value))throw Error('Patch 数据无效');const ids=new Set<string>(),keys=new Set<string>();
 const result=value.map(x=>{
 if(!x||typeof x.id!=='string'||ids.has(x.id))throw Error('Patch 数据无效');
 const input=x.boundaryUses??x.boundaryEdgeIds;if(!Array.isArray(input))throw Error('Patch 边界无效');if(geometryCheck&&x.boundaryUses!==undefined)input.forEach(b=>validateBoundary(p,b));
 // Preserve legacy loop's smallest vertex + curve UUID tie-break exactly.
 const ordered=!geometryCheck?input.map(b=>typeof b==='string'?wholeBoundary(p,b):b):x.type==='loop'?validateLoopUses(p,input):loop(p,input).map(r=>r.use),bs:PatchBoundaryUse[]=x.type==='loop'?ordered.map(b=>({kind:'closed',curveId:b.curveId,...(b.reversed!==undefined?{reversed:b.reversed}:{})})):x.boundaryUses?x.boundaryUses.map((b:PatchBoundaryUse)=>({...b})):ordered,k=key(p,bs);
 if(x.type!==(bs.length===2?(bs.every(b=>b.kind==='closed')?'loop':'lens'):bs.length===3?'tri':'quad')||keys.has(k))throw Error('Patch 类型或重复边界无效');
 if(x.name!==undefined&&(typeof x.name!=='string'||!x.name.trim()||x.name.length>80))throw Error('Patch 名称无效');
 if(x.fullness!==undefined&&(x.canonicalId||!Number.isFinite(x.fullness)||x.fullness< -1||x.fullness>1))throw Error('Fullness 数据无效');
 ids.add(x.id);keys.add(k);return {id:x.id,type:x.type,boundaryUses:bs,...(x.name===undefined?{}:{name:x.name}),...(x.fullness===undefined?{}:{fullness:x.fullness}),...(x.mirrorPartnerId?{mirrorPartnerId:x.mirrorPartnerId}:{}),...(x.canonicalId?{canonicalId:x.canonicalId}:{})} as SurfacePatch;
 });
 for(const x of result){if(x.mirrorPartnerId){const m=result.find(y=>y.id===x.mirrorPartnerId);if(!m||m.mirrorPartnerId!==x.id||m.id===x.id||!!m.canonicalId===!!x.canonicalId||(x.canonicalId&&x.canonicalId!==m.id))throw Error('Patch 镜像关系无效');if(geometryCheck&&key(p,x.boundaryUses.map(b=>mirrorBoundary(p,b)))!==key(p,m.boundaryUses))throw Error('Patch 镜像边界不匹配');}else if(x.canonicalId)throw Error('Patch canonical 无效');}
 return result;
}

export function renamePatch(p:LandmarkProject,id:string,value:string):LandmarkProject {
 const name=value.trim();if(!name||name.length>80)throw Error('曲面名称需为 1–80 个字符。');
 const source=p.patches?.find(x=>x.id===id);if(!source)return p;
 return {...p,patches:p.patches!.map(x=>x.id===id||x.id===source.mirrorPartnerId?{...x,name}:x)};
}

export function validateLoopUses(p:LandmarkProject,bs:PatchBoundaryUse[]){
 if(bs.length!==2||bs.some(b=>b.kind!=='closed')||bs[0].curveId===bs[1].curveId)throw Error('请选择两条不同的完整闭合曲线');
 bs.forEach(b=>validateBoundary(p,b));return bs;
}
/** Compare traversal once at authoring; canonical starts are never shifted. */
export function orientLoopUses(p:LandmarkProject,bs:PatchBoundaryUse[]){
 validateLoopUses(p,bs);const a=boundaryGeometry(p,bs[0]),b=boundaryGeometry(p,{...bs[1],reversed:false});
 const cost=(rev:boolean)=>Array.from({length:32},(_,i)=>{const s=i/32,A=a.evaluate(s),B=b.evaluate(rev?1-s:s);return A.reduce((n,x,k)=>n+(x-B[k])**2,0);}).reduce((a,b)=>a+b,0);
 return [bs[0],{...bs[1],reversed:cost(true)<cost(false)}];
}
export function addLoopPatch(p:LandmarkProject,bs:PatchBoundaryUse[]):LandmarkProject {
 validateLoopUses(p,bs);const patches=p.patches??[];
 if(patches.some(x=>key(p,x.boundaryUses)===key(p,bs)))throw Error('两闭环之间已有 Patch');
 const a:SurfacePatch={id:crypto.randomUUID(),type:'loop',boundaryUses:bs.map(b=>({...b})),fullness:0},added=[a];
 let mb:PatchBoundaryUse[]|undefined;try{mb=bs.map(b=>mirrorBoundary(p,b));}catch{}
 if(mb&&key(p,mb)!==key(p,bs)){
 if(patches.some(x=>key(p,x.boundaryUses)===key(p,mb!)))throw Error('镜像闭环已有 Patch');
 const b:SurfacePatch={id:crypto.randomUUID(),type:'loop',boundaryUses:mb,canonicalId:a.id,mirrorPartnerId:a.id};a.mirrorPartnerId=b.id;added.push(b);
 }
 const next={...p,patches:[...patches,...added]};dependencyGraph(next);return next;
}
