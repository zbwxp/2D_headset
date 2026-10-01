import {parseHairStudio,type HairStudio} from './studio';
import {parseDrawing,type DrawingDocument} from '../drawing/model';
import {parseDrawingSnapshots,type DrawingSnapshots} from '../drawing/snapshots';
import {frontCubics} from './geometry';
import {addFrontBang} from './bake';
import {syncHairDrawing,type HairGenerated} from './drawing';
import {randomUnit,seededHairRandom,hairCapacity} from './random';
import {parseHairStrandSet,type HairStrandSet} from './strandTypes';
import {parseHairProfile,type HairShellProfile} from './profile';
export type Vec3=[number,number,number];
export interface HairNet {version:1;center:Vec3;radiusX:number;radiusY:number;radiusZ:number;profile?:HairShellProfile|null}
export interface HairLeaf {tipX:number;tipY?:number;leftAngle:number;rightAngle:number}
export interface HairBang {version:1;mode:'SECTION'|'FRONT';seed:number}
/** Stable jitter and unit-disk tip samples, unaffected by view or angle mode. */
export interface HairStrand {id:string;angleT:number;offset:[number,number]}
export interface HairInterior {radius:number;curves:HairStrand[];distribution?:1}
export const MAX_HAIR_STRANDS=100;
export const DEFAULT_HAIR_TIP_RADIUS=.04;
/** Hair owns its editor documents. Nothing aliases project.drawing or its snapshots. */
export interface Hairstyle {version:2;generator:2;net:HairNet;leaf:HairLeaf;bang?:HairBang;interior?:HairInterior;generated?:HairGenerated;strandSet?:HairStrandSet;drawing:DrawingDocument;drawingSnapshots?:DrawingSnapshots;studio?:HairStudio}
export const defaultHairNet=():HairNet=>({version:1,center:[0,0,0],radiusX:1,radiusY:1,radiusZ:1});
export function defaultHairstyle(net=defaultHairNet()):Hairstyle {
 const leaf:HairLeaf={tipX:.03,tipY:-.2,leftAngle:25,rightAngle:25};
 return syncHairDrawing({version:2,generator:2,net,leaf,drawing:addFrontBang(undefined,frontCubics({net,leaf}))},Math.random);
}
export function parseHairNet(value:unknown):HairNet {
 const n=value as HairNet;
 if(!n||n.version!==1||!Array.isArray(n.center)||n.center.length!==3||!n.center.every(x=>Number.isFinite(x)&&Math.abs(x)<=10)||![n.radiusX,n.radiusY,n.radiusZ].every(x=>Number.isFinite(x)&&x>=.5&&x<=2))throw Error('发网数据无效 / Invalid hair net');
 return {version:1,center:[...n.center],radiusX:n.radiusX,radiusY:n.radiusY,radiusZ:n.radiusZ,...(n.profile!==undefined?{profile:parseHairProfile(n.profile)}:{})};
}
export function parseHairstyle(value:unknown):Hairstyle {
 const h=value as Hairstyle,net=parseHairNet(h?.net);
 const fail=():never=>{throw Error('发型生成间数据无效 / Invalid hairstyle data');};
 // V0.14.0 random cards were explicitly discarded. Migrate only the private hair
 // recipe; never remove baked curves or snapshots from the main Drawing document.
 if((h as {version:number}).version===1&&(h as {generator:number}).generator===1)return defaultHairstyle(net);
 if(h.version!==2||h.generator!==2||!h.leaf||!Number.isFinite(h.leaf.tipX)||Math.abs(h.leaf.tipX)>.1||!Number.isFinite(h.leaf.tipY??-.2)||(h.leaf.tipY??-.2)<-.8||(h.leaf.tipY??-.2)>.5||![h.leaf.leftAngle,h.leaf.rightAngle].every(x=>Number.isFinite(x)&&x>=15&&x<=90))return fail();
 let interior:HairInterior|undefined;
 if(h.interior!==undefined){
  const p=h.interior;if(!p||!Number.isFinite(p.radius)||p.radius<0||p.radius>.2||!Array.isArray(p.curves)||p.curves.length>MAX_HAIR_STRANDS)return fail();
  const ids=new Set<string>();
  const curves=p.curves.map(c=>{if(!c||typeof c.id!=='string'||!c.id||ids.has(c.id)||!Number.isFinite(c.angleT)||c.angleT<=0||c.angleT>=1||!Array.isArray(c.offset)||c.offset.length!==2||!c.offset.every(Number.isFinite)||Math.hypot(...c.offset)>1+1e-10)return fail();ids.add(c.id);return {id:c.id,angleT:c.angleT,offset:[...c.offset] as [number,number]};});
  if(p.distribution!==undefined&&p.distribution!==1)return fail();
  interior={radius:p.radius,curves,...(p.distribution?{distribution:p.distribution}:{})};
 }
 const drawing=parseDrawing(h.drawing);
 if(h.generated&&!h.strandSet){
  const g=h.generated,validPair=(p:unknown):p is [string,string]=>Array.isArray(p)&&p.length===2&&p.every(id=>typeof id==='string'&&!!id)&&new Set(p).size===2;
  if(typeof g.layerId!=='string'||!drawing.layers.some(l=>l.id===g.layerId)||!validPair(g.boundaryIds)||g.centerIds!==undefined&&!validPair(g.centerIds)||!Array.isArray(g.curveIds))return fail();
  const expected=[...g.boundaryIds,...(g.centerIds??[]),...(interior?.curves.map(c=>c.id)??[])];
  if(g.curveIds.length!==expected.length||new Set(expected).size!==expected.length||new Set(g.curveIds).size!==g.curveIds.length||expected.some(id=>!g.curveIds.includes(id))||g.curveIds.some(id=>!drawing.layers.find(l=>l.id===g.layerId)!.items.includes(id)||!drawing.curves.some(c=>c.id===id)))return fail();
 }
 const result:Hairstyle={version:2,generator:2,net,leaf:{...h.leaf},...(interior?{interior}:{}),...(h.generated?{generated:structuredClone(h.generated)}:{}),drawing,...(h.drawingSnapshots?{drawingSnapshots:parseDrawingSnapshots(h.drawingSnapshots)}:{})};
 if(h.studio!==undefined)result.studio=parseHairStudio(h.studio,parseHairNet);
 if(h.bang!==undefined){if(!h.bang||h.bang.version!==1||!['SECTION','FRONT'].includes(h.bang.mode)||!Number.isInteger(h.bang.seed)||h.bang.seed<0||h.bang.seed>0xffffffff)return fail();result.bang={...h.bang};}
 if(h.strandSet){
  result.strandSet=parseHairStrandSet(h.strandSet);
  if(result.strandSet.curves.some(c=>{const curve=drawing.curves.find(x=>x.id===c.id);return !curve||c.nodes.some((id,i)=>id!==curve.nodes[i]);}))return fail();
  delete result.generated;
  return result;
 }
 if(result.bang&&result.generated?.centerIds&&(!interior||interior.distribution===1))return result;
 const random=seededHairRandom(drawing.curves.map(c=>c.id).join('|'));
 if(interior)result.interior={...interior,distribution:1};
 return syncHairDrawing(result,random);
}
/** Only Add/Regenerate sample randomness. Existing strands retain their slots. */
export function addHairStrands(h:Hairstyle,count:number,random:()=>number=Math.random):Hairstyle {
 const old=h.interior??{radius:DEFAULT_HAIR_TIP_RADIUS,curves:[]};
 if(!Number.isInteger(count)||count<1||old.curves.length+count>MAX_HAIR_STRANDS)throw Error('内部曲线数量应为 1–100 / Interior curves must total 1–100');
 const capacity=hairCapacity(h.leaf,h.bang).reduce((a,b)=>a+b,0);
 const angles=Array.from({length:Math.min(count,Math.max(0,capacity-old.curves.length))},()=>randomUnit(random));
 const added=angles.map(angleT=>{const r=Math.sqrt(randomUnit(random)),phi=randomUnit(random)*Math.PI*2;return {id:crypto.randomUUID(),angleT,offset:[r*Math.cos(phi),r*Math.sin(phi)] as [number,number]};});
 return syncHairDrawing({...h,interior:{...old,distribution:1,curves:[...old.curves,...added]}},random);
}
/** Re-randomization deliberately retains object/interval IDs and snapshot contents. */
export function regenerateHair(h:Hairstyle,random:()=>number=Math.random):Hairstyle {
 const old=h.interior??{radius:DEFAULT_HAIR_TIP_RADIUS,curves:[]},bang:HairBang={version:1,mode:h.bang?.mode??'SECTION',seed:Math.floor(randomUnit(random)*0x100000000)};
 const curves=old.curves.map(c=>{const r=Math.sqrt(randomUnit(random)),phi=randomUnit(random)*Math.PI*2;return {...c,angleT:randomUnit(random),offset:[r*Math.cos(phi),r*Math.sin(phi)] as [number,number]};});
 return syncHairDrawing({...h,bang,interior:{...old,distribution:1,curves}},random);
}
