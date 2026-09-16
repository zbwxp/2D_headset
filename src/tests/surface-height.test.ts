import {expect,test} from 'vitest';
import {surfaceHeightDirection} from '../ui/head/surfaceHeight';
test('height holds lateral position, moves across longitude and remains on sphere',()=>{
 const d:[number,number,number]=[.6,0,.8],q=surfaceHeightDirection(d,.5,1);
 expect(q[0]).toBe(.6);expect(q[1]).toBe(.5);expect(Math.hypot(...q)).toBeCloseTo(1,14);
 expect(Math.atan2(q[0],q[2])).not.toBe(Math.atan2(d[0],d[2]));
});
test('height clamps to slice and preserves back-side branch through its extreme',()=>{
 const q=surfaceHeightDirection([.6,0,-.8],2,-1);expect(q[1]).toBe(.8);
 const next=surfaceHeightDirection(q,.2,-1);expect(next[2]).toBeLessThan(0);expect(next[0]).toBe(.6);
 expect(surfaceHeightDirection([1,0,0],1,1)).toEqual([1,0,0]);
});
