import {expect,it} from 'vitest';
import {solveBoundedSnapshotBasisAdjustment,SNAPSHOT_BASIS_RESPONSE_TRUST_RADIUS} from '../../domain/recordingSnapshot/boundedBasisInverse';

it('finds finite signed responses for a singular basis, balancing shape and response change',()=>{
 const scalar={span:0,target:.1,weight:2/3,kind:'handle' as const},result=solveBoundedSnapshotBasisAdjustment([scalar],[],1)!;
 expect(result).toBeDefined();expect(result.deltas[0]*result.weights[0]).toBeCloseTo(.1,10);
 expect(Math.abs(result.weights[0]-scalar.weight)).toBeLessThan(SNAPSHOT_BASIS_RESPONSE_TRUST_RADIUS);
 expect(Math.abs(result.deltas[0])).toBeGreaterThan(.1/(scalar.weight+SNAPSHOT_BASIS_RESPONSE_TRUST_RADIUS));
});
it('normalizes the objective and permits preexisting signed overshoot',()=>{
 const a={span:.02,target:.5,weight:25,kind:'node' as const};
 const first=solveBoundedSnapshotBasisAdjustment([a],[],1)!,scaled=solveBoundedSnapshotBasisAdjustment([{...a,span:20,target:500}],[],1000)!;
 expect(first.deltas).toEqual([0]);expect(first.weights).toEqual([25]);expect(scaled.weights).toEqual(first.weights);expect(scaled.deltas).toEqual([0]);
});
it('gives a larger displacement cost to nodes and rejects targets outside the finite envelope',()=>{
 const handle=solveBoundedSnapshotBasisAdjustment([{span:0,target:.1,weight:.5,kind:'handle'}],[],1)!,node=solveBoundedSnapshotBasisAdjustment([{span:0,target:.1,weight:.5,kind:'node'}],[],1)!;
 expect(node.cost).toBeGreaterThan(handle.cost);expect(Math.abs(node.deltas[0])).toBeLessThan(Math.abs(handle.deltas[0]));
 expect(solveBoundedSnapshotBasisAdjustment([{span:0,target:100,weight:.5,kind:'handle'}],[],1)).toBeUndefined();
});
