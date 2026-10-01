import {curveById,shapeOf,uid,type DrawingDocument as Doc,type Point2} from './model';
import {validateMirrorEditing,type MirrorEditingConfig,type MirrorCurvePair} from './mirrorEditing';
const config=(d:Doc):MirrorEditingConfig=>d.mirrorEditing??{enabled:false,curvePairs:[]};
function update(d:Doc,next:MirrorEditingConfig):Doc{const out={...d,mirrorEditing:next};validateMirrorEditing(out);return JSON.stringify(d.mirrorEditing)===JSON.stringify(next)?d:out;}
export function setMirrorEditingEnabled(d:Doc,enabled:boolean):Doc{if(typeof enabled!=='boolean')throw Error('镜像编辑开关无效。');const c=config(d);if(enabled&&!c.curvePairs.length&&!c.axisNodeIds?.length)throw Error('请先建立镜像配对，再开启镜像编辑。');return update(d,{...c,enabled});}
export function addMirrorCurvePair(d:Doc,a:string,b:string,reverse=false,id=uid()):Doc{if(!curveById(d,a)||!curveById(d,b)||typeof reverse!=='boolean'||!id)throw Error('镜像曲线配对无效。');const c=config(d);return update(d,{...c,curvePairs:[...c.curvePairs,{id,a,b,reverse}]});}
export function changeMirrorCurvePair(d:Doc,id:string,change:Partial<Pick<MirrorCurvePair,'a'|'b'|'reverse'>>):Doc{const c=config(d);if(!c.curvePairs.some(p=>p.id===id))throw Error('镜像配对不存在。');return update(d,{...c,curvePairs:c.curvePairs.map(p=>p.id===id?{...p,...change}:p)});}
export function removeMirrorCurvePair(d:Doc,id:string):Doc{const c=config(d),pairs=c.curvePairs.filter(p=>p.id!==id);return update(d,{...c,curvePairs:pairs,enabled:c.enabled&&(pairs.length>0||!!c.axisNodeIds?.length)});}
export function setMirrorAxisNodes(d:Doc,nodeIds:readonly string[]):Doc{if(!Array.isArray(nodeIds)||new Set(nodeIds).size!==nodeIds.length||nodeIds.some(id=>!d.nodes.some(n=>n.id===id)))throw Error('轴上节点引用无效。');const c=config(d);return update(d,{...c,axisNodeIds:[...nodeIds],enabled:c.enabled&&(c.curvePairs.length>0||nodeIds.length>0)});}
export interface MirrorPairProposal {pairs:Array<{a:string;b:string;reverse:boolean}>;unmatched:string[];ambiguous:string[]}
/** Setup aid only: unique exact reflected control geometry, never nearest-point
 * guessing or geometry repair. Ambiguous duplicates require explicit selection. */
export function proposeExactMirrorPairs(d:Doc,curveIds:readonly string[]=d.curves.map(c=>c.id)):MirrorPairProposal{
 const existing=new Set(config(d).curvePairs.flatMap(p=>[p.a,p.b])),ids=[...new Set(curveIds)].filter(id=>!existing.has(id));if(ids.some(id=>!curveById(d,id)))throw Error('镜像候选曲线不存在。');
 const axis=d.mirrorAxisX??0,shape=new Map(ids.map(id=>[id,shapeOf(d,id)])),near=(a:Point2,b:Point2)=>Math.hypot(a[0]-b[0],a[1]-b[1])<=1e-8,matches=new Map<string,Array<{id:string;reverse:boolean}>>();
 for(const a of ids){const reflected=shape.get(a)!.map(([x,y])=>[2*axis-x,y] as Point2),found:Array<{id:string;reverse:boolean}>=[];for(const b of ids){const s=shape.get(b)!;const normal=reflected.every((p,i)=>near(p,s[i])),reverse=reflected.every((p,i)=>near(p,s[3-i]));if(normal)found.push({id:b,reverse:false});else if(reverse)found.push({id:b,reverse:true});}matches.set(a,found);}
 const used=new Set<string>(),pairs:MirrorPairProposal['pairs']=[],unmatched:string[]=[],ambiguous:string[]=[];for(const a of ids){if(used.has(a))continue;const match=matches.get(a)!;if(!match.length){unmatched.push(a);continue;}if(match.length!==1||matches.get(match[0].id)?.length!==1){ambiguous.push(a);continue;}const b=match[0].id;pairs.push({a,b,reverse:match[0].reverse});used.add(a);used.add(b);}
 return {pairs,unmatched,ambiguous};
}
export function addExactMirrorPairs(d:Doc,curveIds?:readonly string[]){const proposal=proposeExactMirrorPairs(d,curveIds),c=config(d),next=update(d,{...c,curvePairs:[...c.curvePairs,...proposal.pairs.map(p=>({...p,id:uid()}))]});return {document:next,...proposal};}
/** Until paired split/delete/copy has an explicit provenance map, reject it. */
export function assertMirrorTopologyEditable(d:Doc,ids:readonly string[]):void{const selected=new Set(ids),c=d.mirrorEditing;if(!c)return;const nodes=new Set(ids.flatMap(id=>curveById(d,id)?.nodes??[]));if(c.curvePairs.some(p=>selected.has(p.a)||selected.has(p.b))||c.axisNodeIds?.some(id=>nodes.has(id)))throw Error('请先解除相关镜像配对或轴上约束，再修改拓扑或复制。');}
