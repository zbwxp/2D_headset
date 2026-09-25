import {test,expect} from 'vitest';
import data from './fixtures/chin-junction-head.json';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {chinAttachments} from '../domain/chin/junction';
import {chinSurfaces} from '../domain/chin/geometry';
import {addPatch} from '../domain/patches/model';
import {pointId} from '../domain/chin/model';
import {evaluator} from '../domain/patches/geometry';
import {dirtyDescendants} from '../domain/geometry/dependencies';

test('V0.9.6 cap project migrates to a single vertex, never an invisible fourth edge',()=>{
 const p=parseLandmarks(JSON.stringify(data));expect(chinSurfaces(p)).toEqual([]);
 const x=p.patches!.find(x=>x.name==='下颌面'&&!x.canonicalId)!;
 expect(x.type).toBe('tri');expect(x.boundaryUses).toHaveLength(3);
 expect(x.boundaryUses.filter(b=>b.startLandmarkId===pointId('CHIN_M')||b.endLandmarkId===pointId('CHIN_M'))).toHaveLength(2);
 const without={...p,patches:p.patches!.filter(q=>q.id!==x.id&&q.id!==x.mirrorPartnerId)},q=addPatch(without,x.boundaryUses);
 expect(q.patches!.at(-2)?.type).toBe('tri');expect(q.patches!.at(-2)?.boundaryUses).toHaveLength(3);
 expect(parseLandmarks(JSON.stringify(q)).patches).toEqual(q.patches);
});
test('each arm range dirties all jointly fitted curves and their surfaces, without writing source handles',()=>{
 const p=parseLandmarks(JSON.stringify(data)),q={...p,chinScaffold:{...p.chinScaffold!,ranges:{...p.chinScaffold!.ranges!,UPPER_PAIR:.04}}};
 const dirty=dirtyDescendants(p,q);for(const a of chinAttachments(p))expect(dirty.curves.has(a.curveId)).toBe(true);
 expect(q.curves).toBe(p.curves);
 const x=p.patches!.find(x=>x.name==='下颌面'&&!x.canonicalId)!;expect(dirty.patches.has(x.id)).toBe(true);
 expect(evaluator(p,x)).not.toBe(evaluator(q,x));
});
