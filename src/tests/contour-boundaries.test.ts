import {test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {boundaryIntervals,helmetBoundaryIntervals,exposedIntervals} from '../domain/contour/boundaries';
import {HELMET,RING_Y} from '../domain/head/scaffold';
import {contourSource} from '../domain/contour/source';
test('whole vs subspan removes only shared coverage, independent of direction and anchor identity',()=>{
 const b=(owner:string,lo:number,hi:number)=>({owner,curveId:'c',lo,hi});
 expect(exposedIntervals([b('a',0,1),b('b',0,.54)])).toEqual([b('a',.54,1)]);
 expect(exposedIntervals([b('a',0,1),b('b',0,.4),b('c',.4,1)])).toEqual([]);
 expect(exposedIntervals([b('a',0,1),b('a',0,.4)])).toEqual([b('a',0,1)]);
});
test('actual saved head: curve 26 shared interval and quad 2 Helmet arc disappear on both sides',()=>{
 const p=parseLandmarks(readFileSync('tests/fixtures/contour-span-head.json','utf8')),before=JSON.stringify(p);
 const all=p.patches!.flatMap(x=>x.boundaryUses.flatMap(b=>boundaryIntervals(p,x.id,b)));
 all.push(...helmetBoundaryIntervals(p));const exposed=exposedIntervals(all);
 for(const name of ['左结构线 26','右结构线 26']){
  const c=p.curves.find(c=>c.name===name)!;
  const tri=p.patches!.find(x=>x.type==='tri'&&x.boundaryUses.some(b=>b.curveId===c.id))!;
  const use=tri.boundaryUses.find(b=>b.curveId===c.id)!,range=boundaryIntervals(p,tri.id,use)[0];
  const remaining=exposed.filter(b=>b.curveId===c.id);
  expect(remaining).toHaveLength(1);expect(remaining[0].lo).toBeCloseTo(range.hi,10);expect(remaining[0].hi).toBe(1);
 }
 for(const patch of p.patches!.filter(x=>x.type==='quad'&&x.boundaryUses.some(b=>b.curveId===RING_Y))){
  const b=patch.boundaryUses.find(b=>b.curveId===RING_Y)!;
  for(const span of boundaryIntervals(p,patch.id,b)){
   const t=(span.lo+span.hi)/2;
   expect(all.some(x=>x.owner===HELMET&&x.curveId===RING_Y&&t>x.lo&&t<x.hi)).toBe(true);
   expect(exposed.some(x=>x.curveId===RING_Y&&t>x.lo&&t<x.hi)).toBe(false);
  }
 }
 expect(contourSource(p).invalid).toEqual([]);expect(JSON.stringify(p)).toBe(before);
 // Hiding Helmet restores the otherwise open Patch arc; do not blanket-hide Rings.
 const hidden={...p,loomisScaffold:{...p.loomisScaffold!,visible:false}};
 expect(helmetBoundaryIntervals(hidden)).toEqual([]);
 expect(exposedIntervals(all.filter(x=>x.owner!==HELMET)).some(x=>x.curveId===RING_Y)).toBe(true);
});
