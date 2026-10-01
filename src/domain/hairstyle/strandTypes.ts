/** Authored base value and an additive random interval. [0,0] is fully fixed. */
export interface HairRange {value:number;random:[number,number]}
export interface HairEndpoint {id:string;x:HairRange;y:HairRange;sample:[number,number];side?:1|-1}
/** Authoritative 2D handles in the last editing view, relative to their endpoints
 * in radiusX units. Depth controls only choose the existing ray/shell branch.
 * V1 stores the old orbit frame; V2 stores head-local pitch. Keep V1 geometry
 * in its original frame until an edit explicitly rebases it to the new view. */
export interface HairSurfaceCurve {version:1|2;view:{yaw:number;pitch:number};handles:[[number,number],[number,number]];depths:[number,number,number,number]}
export interface HairStrandRule {id:string;nodes:[string,string];angle:number;start:HairRange;end:HairRange;sample:[number,number];surface?:HairSurfaceCurve}
export interface HairStrandSet {version:1;endpoints:HairEndpoint[];curves:HairStrandRule[]}
export const fixedHairRange=(value:number):HairRange=>({value,random:[0,0]});
export const resolveHairRange=(r:HairRange,u:number)=>r.value+r.random[0]+(r.random[1]-r.random[0])*u;
export function hairEndpointPosition(e:HairEndpoint):[number,number,number] {
 let x=resolveHairRange(e.x,e.sample[0]),y=resolveHairRange(e.y,e.sample[1]);
 const scale=Math.max(1,Math.hypot(x,y)/(e.side===undefined?.995:1));x/=scale;y/=scale;
 return [x,y,(e.side??1)*Math.sqrt(Math.max(0,1-x*x-y*y))];
}
export function parseHairStrandSet(value:unknown):HairStrandSet {
 const s=value as HairStrandSet,fail=():never=>{throw Error('发丝参数无效 / Invalid hair strand parameters');};
 const range=(r:HairRange,bound:number)=>r&&Number.isFinite(r.value)&&Math.abs(r.value)<=bound&&Array.isArray(r.random)&&r.random.length===2&&r.random.every(v=>Number.isFinite(v)&&Math.abs(v)<=2)&&r.random[0]<=r.random[1];
 const sample=(u:number[])=>Array.isArray(u)&&u.length===2&&u.every(v=>Number.isFinite(v)&&v>=0&&v<=1);
 if(!s||s.version!==1||!Array.isArray(s.endpoints)||!Array.isArray(s.curves)||s.curves.length>1000||s.endpoints.length>2000)return fail();
 const ids=new Set<string>(),curves=new Set<string>();
 for(const e of s.endpoints){if(!e||typeof e.id!=='string'||!e.id||ids.has(e.id)||!range(e.x,1)||!range(e.y,1)||!sample(e.sample)||e.side!==undefined&&e.side!==1&&e.side!==-1)return fail();ids.add(e.id);}
 for(const c of s.curves){if(!c||typeof c.id!=='string'||!c.id||curves.has(c.id)||!Array.isArray(c.nodes)||c.nodes.length!==2||c.nodes.some(id=>!ids.has(id))||!Number.isFinite(c.angle)||Math.abs(c.angle)>90||!range(c.start,1)||!range(c.end,1)||c.start.value<0||c.end.value<0||!sample(c.sample))return fail();
  if(c.surface!==undefined){const g=c.surface;if(!g||![1,2].includes(g.version)||!g.view||![g.view.yaw,g.view.pitch].every(x=>Number.isFinite(x)&&Math.abs(x)<=360)||!Array.isArray(g.handles)||g.handles.length!==2||g.handles.some(p=>!Array.isArray(p)||p.length!==2||p.some(x=>!Number.isFinite(x)||Math.abs(x)>20)))return fail();if(!Array.isArray(g.depths)||g.depths.length!==4||g.depths.some(x=>!Number.isFinite(x)||Math.abs(x)>20))return fail();}
  curves.add(c.id);}
 const result=structuredClone(s);
 // Discard the withdrawn V0.14.10 strand-lift experiment on load.
 for(const c of result.curves)delete (c as HairStrandRule&{lift?:unknown}).lift;
 return result;
}
