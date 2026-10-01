import {describe,it,expect} from 'vitest';
import {bracket,latticeWeights} from '../../domain/vectorRecording/interpolation';
describe('parameter lattice',()=>{
 it('holds exact keys and clamps the authored front hemisphere',()=>{
  expect(latticeWeights([{x:30,y:45}],{x:30,y:45})).toEqual([{angle:{x:30,y:45},weight:1}]);
  expect(latticeWeights([],{x:100,y:-100})).toEqual([{angle:{x:90,y:-90},weight:1}]);
 });
 it('uses local bilinear weights rather than inverse-distance drift',()=>{
  const r=latticeWeights([],{x:45,y:45});expect(r).toHaveLength(4);expect(r.every(x=>x.weight===.25)).toBe(true);
  expect(bracket([-90,0,30,90],15)).toEqual([0,30,.5]);
 });
});
