import {validateIntervalOverrides} from './intervals';
import {finitePoint} from '../drawing/model';
import {validateWarpGrid,type WarpGrid} from '../vectorWarp/model';
import type {VectorRecording,VectorPose} from './model';
const fail=():never=>{throw Error('矢量录制数据无效');};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const name=(v:unknown)=>typeof v==='string'&&v.trim().length>0&&v.length<=120;
function grid(v:WarpGrid){
 validateWarpGrid(v);
 if(!object(v)||!Number.isInteger(v.rows)||!Number.isInteger(v.columns)||v.rows<1||v.columns<1||v.rows>16||v.columns>16||!object(v.bounds)||!finitePoint(v.bounds.min)||!finitePoint(v.bounds.max)||v.bounds.max.some((x,i)=>x<=v.bounds.min[i])||!Array.isArray(v.nodes)||v.nodes.length!==(v.rows+1)*(v.columns+1))fail();
 for(const n of v.nodes)if(!object(n)||![n.position,n.handleU,n.handleV,n.twist].every(finitePoint))fail();
}
function pose(p:VectorPose,ids:Set<string>,base:Map<string,WarpGrid>){
 if(!object(p)||!object(p.grids)||!object(p.visibility)||!object(p.intervals))fail();
 for(const [id,g] of Object.entries(p.grids)){if(!ids.has(id))fail();grid(g);const b=base.get(id)!;if(g.rows!==b.rows||g.columns!==b.columns||JSON.stringify(g.bounds)!==JSON.stringify(b.bounds))fail();}
 if(p.intervalOverrides!==undefined)validateIntervalOverrides(p.intervalOverrides);
 for(const flags of [p.visibility,p.intervals])if(Object.entries(flags).some(([id,value])=>!id||typeof value!=='boolean'))fail();
}
export function parseVectorRecording(value:unknown):VectorRecording{
 const v=value as VectorRecording;
 if(!object(v)||v.version!==1||!Array.isArray(v.rigs)||v.rigs.length>500||!finite(v.tolerance)||v.tolerance<.000001||v.tolerance>1)fail();
 const rigIds=new Set<string>(),artworkIds=new Set<string>();
 for(const r of v.rigs){
  if(!object(r)||!name(r.id)||!name(r.artworkId)||rigIds.has(r.id)||artworkIds.has(r.artworkId)||!Array.isArray(r.deformers)||r.deformers.length>200||!object(r.bindings)||!Array.isArray(r.keys)||!r.keys.length||r.keys.length>500)fail();rigIds.add(r.id);artworkIds.add(r.artworkId);
  const angle=(a:unknown)=>object(a)&&finite(a.x)&&finite(a.y)&&Math.abs(a.x)<=90&&Math.abs(a.y)<=90;
  if(!angle(r.angle)||r.sourceSignature!==undefined&&!name(r.sourceSignature)||r.sourceStructureSignature!==undefined&&!name(r.sourceStructureSignature))fail();
  if(r.sourceIntervalFrames!==undefined){if(!object(r.sourceIntervalFrames)||Object.keys(r.sourceIntervalFrames).length>4096)fail();for(const [id,f] of Object.entries(r.sourceIntervalFrames)){if(!id||!object(f)||typeof f.signature!=='string'||f.signature.length>1000000||![f.curveIds,f.rangeIds].every(xs=>Array.isArray(xs)&&xs.length<=16384&&xs.every(x=>typeof x==='string'&&x.length>0&&x.length<=1024)))fail();}}
  const ids=new Set<string>();for(const d of r.deformers){if(!object(d)||!name(d.id)||!name(d.name)||ids.has(d.id))fail();ids.add(d.id);grid(d.grid);}
  for(const d of r.deformers){let next=d.parentId;const seen=new Set([d.id]);while(next){if(!ids.has(next)||seen.has(next))fail();seen.add(next);next=r.deformers.find(d=>d.id===next)!.parentId;}}
  for(const [layer,id] of Object.entries(r.bindings))if(!layer||typeof id!=='string'||!ids.has(id))fail();
  const keys=new Set<string>(),angles=new Set<string>();for(const k of r.keys){if(!object(k)||!name(k.id)||!name(k.name)||!angle(k.angle)||keys.has(k.id))fail();keys.add(k.id);const a=`${k.angle.x},${k.angle.y}`;if(angles.has(a))fail();angles.add(a);pose(k,ids,new Map(r.deformers.map(d=>[d.id,d.grid])));}
  // These five anchors make the entire front hemisphere well-defined.
  for(const a of ['0,0','-90,0','90,0','0,-90','0,90'])if(!angles.has(a))fail();
  if(r.draft)pose(r.draft,ids,new Map(r.deformers.map(d=>[d.id,d.grid])));
  if(r.driver&&(!object(r.driver)||!['manual','external'].includes(r.driver.kind)||!name(r.driver.parameterX)||!name(r.driver.parameterY)))fail();
 }
 return structuredClone(v);
}
