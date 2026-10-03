import {expect,test} from 'vitest';
import {drawingDeformProjection,quadProjection,rectQuad,type Quad} from '../../domain/deformation/cageField';
import {assertBend,neutralBend} from '../../domain/deformation/coons';
import type {Point2} from '../../domain/drawing/model';
import {layerCageDomainProjection,mergeLayerCageDomains,remapLayerCageDomains,validateLayerCageDomain,validateLayerCageDomains,type SnapshotLayerCageDomain} from '../../domain/recordingSnapshot/layerCageDomain';

const domain=(id='cage',layerIds=['layer']):SnapshotLayerCageDomain=>({kind:'h-coons',id,layerIds,restRect:{min:[0,0],max:[1,1]},quad:[[0,0],[1,0],[1,1],[0,1]]});
const bowed=()=>{const bend=neutralBend();bend.handles[1][0][0]=bend.handles[1][1][0]=1.2;return bend;};
const near=(a:Point2,b:Point2)=>a.forEach((value,i)=>expect(value).toBeCloseTo(b[i],11));

test('standalone JSON round trip preserves only the fixed authored cage and live layer IDs',()=>{
 const authored={...domain('fixed',['empty-layer','populated-layer']),bend:bowed(),enabled:false},before=structuredClone(authored),json:unknown=JSON.parse(JSON.stringify(authored));
 validateLayerCageDomain(json);expect(json).toEqual(authored);expect(authored).toEqual(before);
 expect(Object.keys(json).sort()).toEqual(['bend','enabled','id','kind','layerIds','quad','restRect']);
 expect(()=>validateLayerCageDomains([])).not.toThrow();expect(()=>validateLayerCageDomains([json])).not.toThrow();
});

test('strict JSON validation rejects missing fields, unknown state, malformed coordinates and scope',()=>{
 const patches:Record<string,unknown>[]=[
  {kind:'quad'},{kind:undefined},{id:''},{id:3},{id:'x'.repeat(16385)},
  {layerIds:[]},{layerIds:['layer','layer']},{layerIds:['']},{layerIds:['layer',null]},{layerIds:'layer'},
  {restRect:null},{restRect:{min:[0,0]}},{restRect:{min:[0,0,0],max:[1,1]}},{restRect:{min:[0,'0'],max:[1,1]}},
  {restRect:{min:[0,0],max:[0,1]}},{restRect:{min:[1,0],max:[0,1]}},{restRect:{min:[0,0],max:[1e-8,1]}},
  {restRect:{min:[0,0],max:[1,1],autoFit:true}},{quad:[]},{quad:[[0,0],[1,0],[1,1],[0]]},{quad:[[0,0],[1,0],[1,1],[0,'1']]},
  {enabled:0},{enabled:null},{bend:null},{bend:{handles:[],enabled:false}},{bend:{...neutralBend(),enabled:'false'}},
  {bend:{...neutralBend(),cachedGeometry:[]}},{members:[]},{bakedCurves:[]},{postShape:{}},
 ];
 for(const patch of patches){const invalid=JSON.parse(JSON.stringify({...domain(),...patch}));expect(()=>validateLayerCageDomain(invalid),JSON.stringify(patch)).toThrow();}
 const oversizedScope={...domain(),layerIds:Array.from({length:16385},(_,i)=>`layer-${i}`)};expect(()=>validateLayerCageDomain(oversizedScope)).toThrow();
});

test('validation rejects nonfinite runtime values, sparse arrays and overflowing finite arithmetic',()=>{
 for(const value of [NaN,Infinity,-Infinity]){
  const rect=domain();rect.restRect.min[0]=value;expect(()=>validateLayerCageDomain(rect)).toThrow();
  const quad=domain();quad.quad[0][0]=value;expect(()=>validateLayerCageDomain(quad)).toThrow();
  const bend={...domain(),bend:neutralBend()};bend.bend.handles[0][0][0]=value;expect(()=>validateLayerCageDomain(bend)).toThrow();
 }
 const sparse=domain();delete (sparse.quad[0] as number[])[0];expect(()=>validateLayerCageDomain(sparse)).toThrow();
 const sparseScope=domain();delete sparseScope.layerIds[0];expect(()=>validateLayerCageDomain(sparseScope)).toThrow();
 const overflow=domain();overflow.restRect={min:[-1e308,0],max:[1e308,1]};expect(()=>validateLayerCageDomain(overflow)).toThrow();
 const huge=domain();huge.quad=[[-1e308,-1e308],[1e308,-1e308],[1e308,1e308],[-1e308,1e308]];expect(()=>validateLayerCageDomain(huge)).toThrow();
});

test('crossed, collapsed, folded and composed-horizon cages are invalid even when the domain is disabled',()=>{
 const folded=neutralBend();folded.handles[1][0][0]=folded.handles[1][1][0]=-2;
 const horizon=neutralBend();horizon.handles[0][0][1]=horizon.handles[0][1][1]=-.5;
 expect(()=>assertBend(horizon)).not.toThrow();
 const invalid:SnapshotLayerCageDomain[]=[
  {...domain(),quad:[[0,0],[1,1],[1,0],[0,1]]},
  {...domain(),quad:[[0,0],[1,0],[1,0],[0,0]]},
  {...domain(),bend:folded},
  {...domain(),quad:[[0,0],[1,0],[.6,1],[.4,1]],bend:horizon},
 ];
 for(const value of invalid)for(const enabled of [true,false]){
  const authored={...value,enabled},before=structuredClone(authored);
  expect(()=>validateLayerCageDomain(authored)).toThrow();expect(()=>layerCageDomainProjection(authored)).toThrow();expect(authored).toEqual(before);
 }
 const malformed={...domain(),enabled:false,bend:{...neutralBend(),enabled:false}};malformed.bend.handles[0][0][0]=9;expect(()=>validateLayerCageDomain(malformed)).toThrow();
 const threshold={...domain(),restRect:{min:[0,0] as Point2,max:[1e-7,1e-7] as Point2}};threshold.quad=rectQuad(threshold.restRect);expect(()=>validateLayerCageDomain(threshold)).not.toThrow();
});

test('bounded lists reject duplicate IDs and malformed entries, including disabled ones',()=>{
 for(const value of [null,{},[null],[domain(),domain()],new Array(1)])expect(()=>validateLayerCageDomains(value)).toThrow();
 const domains=Array.from({length:1000},(_,i)=>domain(`cage-${i}`));expect(()=>validateLayerCageDomains(domains)).not.toThrow();
 expect(()=>validateLayerCageDomains([...domains,domain('overflow')])).toThrow();
 expect(()=>mergeLayerCageDomains(domains,[domain('overflow')])).toThrow();
 expect(()=>mergeLayerCageDomains(domains,[{...domain('cage-500'),enabled:false}])).not.toThrow();
 expect(()=>remapLayerCageDomains([{...domain(),enabled:false,layerIds:[]}],id=>id,()=>false)).toThrow();
});

test('stable-ID replacement preserves order and disabled authored state without sharing mutable values',()=>{
 const first=domain('first',['a','b']),second={...domain('second'),bend:bowed()},third=domain('third');
 const replacement={...second,enabled:false},before=JSON.stringify([first,second,replacement,third]);
 const merged=mergeLayerCageDomains([first,second],[third,replacement]);
 expect(merged.map(value=>value.id)).toEqual(['first','second','third']);expect(merged[1]).toEqual(replacement);expect(merged[1].bend).toEqual(second.bend);
 merged[0].layerIds.push('new');merged[0].restRect.min[0]=-5;merged[0].quad[0][0]=-5;merged[1].bend!.handles[0][0][0]=.2;
 expect(JSON.stringify([first,second,replacement,third])).toBe(before);
 expect(mergeLayerCageDomains()).toEqual([]);
});

test('scope remapping filters selected source layers, preserves order and returns an empty list when none remain',()=>{
 const first={...domain('first',['b','a','removed']),bend:bowed(),enabled:false},empty=domain('empty',['empty-layer']),source=[first,empty],before=structuredClone(source);
 const copy=remapLayerCageDomains(source,id=>`copy:${id}`,id=>id!=='removed');
 expect(copy.map(value=>[value.id,value.layerIds])).toEqual([['copy:first',['copy:b','copy:a']],['copy:empty',['copy:empty-layer']]]);
 expect(copy[0].enabled).toBe(false);expect(copy[0].restRect).toEqual(first.restRect);expect(copy[0].quad).toEqual(first.quad);expect(copy[0].bend).toEqual(first.bend);
 copy[0].restRect.min[0]=-2;copy[0].quad[0][0]=-2;copy[0].bend!.handles[0][0][0]=.2;expect(source).toEqual(before);
 expect(remapLayerCageDomains(source,id=>id,id=>id==='empty-layer').map(value=>value.id)).toEqual(['empty']);
 expect(remapLayerCageDomains(source,id=>id,()=>false)).toEqual([]);expect(remapLayerCageDomains([],id=>id)).toEqual([]);
 expect(()=>remapLayerCageDomains(source,()=>'' )).toThrow();expect(()=>remapLayerCageDomains(source,()=> 'same')).toThrow();
});

test('the projection uses the authored rest rectangle and shared H(Coons) field without rebinding to later geometry',()=>{
 const authored:SnapshotLayerCageDomain={...domain(),restRect:{min:[2,-3],max:[6,-1]},quad:[[3,-2],[8,-2],[7,2],[2,1]],bend:bowed()},before=structuredClone(authored);
 const actual=layerCageDomainProjection(authored),expected=drawingDeformProjection(before.restRect,before.quad,before.bend),samples:Point2[]=[[2,-3],[3,-2.5],[4,-2],[6,-1],[5,-1.5]];
 for(const p of samples){near(actual.map(p),expected.map(p));near(actual.vector(p,[.2,-.3]),expected.vector(p,[.2,-.3]));expect(actual.denominator(p)).toBe(expected.denominator(p));}
 expect(actual.affine).toBe(false);expect(authored).toEqual(before);
 authored.restRect.max[0]=12;authored.quad[1][0]=15;authored.bend!.handles[1][0][0]=1.3;
 for(const p of samples)near(actual.map(p),expected.map(p));
 const straight={...before,bend:undefined},fixed=layerCageDomainProjection(straight),target=fixed.map([4,-2]);
 straight.restRect.min[0]=1;straight.quad[0][0]=0;expect(fixed.map([4,-2])).toEqual(target);
});

test('neutral bends preserve the exact homography; disabling and reenabling retains the authored cage',()=>{
 const quad:Quad=[[0,0],[1,0],[.8,1],[.2,1]],authored={...domain(),quad,bend:bowed()},before=structuredClone(authored),p:Point2=[.4,.6],v:Point2=[.2,-.1];
 const active=layerCageDomainProjection(authored),off=layerCageDomainProjection({...authored,enabled:false});
 expect(off.map(p)).toEqual(p);expect(off.vector(p,v)).toEqual(v);expect(off.denominator(p)).toBe(1);expect(off.affine).toBe(true);
 expect(layerCageDomainProjection({...authored,enabled:true}).map(p)).toEqual(active.map(p));expect(authored).toEqual(before);
 const homography=quadProjection(authored.restRect,quad);
 for(const bend of [undefined,neutralBend(),{...bowed(),enabled:false}]){
  const field=layerCageDomainProjection({...authored,bend});expect(field.map(p)).toEqual(homography.map(p));expect(field.vector(p,v)).toEqual(homography.vector(p,v));expect(field.denominator(p)).toBe(homography.denominator(p));
 }
});
