import {it,expect} from 'vitest';
import {pairRows} from '../ui/shared/pairRows';
import {renamePatch} from '../domain/patches/model';
import type {LandmarkProject} from '../domain/landmarks/model';
it('groups reciprocal pairs right-first without guessing names; singles remain',()=>{
 const items=[{id:'l',other:'r',side:'LEFT' as const,name:'unrelated'},{id:'c',side:undefined},{id:'r',other:'l',side:'RIGHT' as const,name:'different'}];
 const before=JSON.stringify(items),rows=pairRows(items,x=>x.other,x=>x.side);
 expect(rows.map(r=>[r.primary.id,r.mirror?.id])).toEqual([['r','l'],['c',undefined]]);expect(JSON.stringify(items)).toBe(before);
 expect(pairRows(items,x=>x.id==='l'?undefined:x.other,x=>x.side)).toHaveLength(3);
});
it('patch rename only changes names of both members',()=>{
 const p={patches:[{id:'a',mirrorPartnerId:'b',type:'tri',boundaryUses:['1','2','3'].map(curveId=>({curveId,startLandmarkId:'a',endLandmarkId:'b'}))},{id:'b',mirrorPartnerId:'a',type:'tri',boundaryUses:['4','5','6'].map(curveId=>({curveId,startLandmarkId:'c',endLandmarkId:'d'}))}]} as LandmarkProject;
 const next=renamePatch(p,'b','  颊部  ');expect(next.patches?.map(x=>x.name)).toEqual(['颊部','颊部']);
 expect(next.patches?.map(({name,...rest})=>rest)).toEqual(p.patches);expect(()=>renamePatch(p,'a',' ')).toThrow();
});

import {readFileSync} from 'node:fs';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {addPatch} from '../domain/patches/model';
import {landmarkRows,curveRows,patchRows} from '../ui/shared/pairRows';
it('real source pairs collapse without modifying UUIDs and optional Patch names roundtrip',()=>{
 const base=parseLandmarks(readFileSync('artifacts/basic-patch/adjusted-source.json','utf8'));
 const names=['左面壳前边界·颧颊至下颊','左颊部体积线·颧颊至颊峰','左颊部体积线·颊峰至下颊'];
 const p=addPatch(base,names.map(n=>base.curves.find(c=>c.name===n)!.id));
 const before=JSON.stringify(p);
 expect(landmarkRows(p).length).toBe(p.landmarks.filter(x=>x.type!=='LEFT').length);
 expect(curveRows(p).length).toBe(p.curves.filter(c=>c.role==='canonical').length);
 expect(patchRows(p)).toHaveLength(1);expect(JSON.stringify(p)).toBe(before);
 const renamed=renamePatch(p,p.patches![1].id,'测试曲面');
 const loaded=parseLandmarks(JSON.stringify(renamed));expect(loaded.patches).toEqual(renamed.patches);
 expect(loaded.landmarks).toEqual(p.landmarks);expect(loaded.curves).toEqual(p.curves);
 expect(parseLandmarks(before).patches).toEqual(p.patches);
});
