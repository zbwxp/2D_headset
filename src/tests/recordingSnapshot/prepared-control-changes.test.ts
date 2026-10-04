import {describe,it,expect} from 'vitest';
import {emptyRecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {registerPreparedControlChanges,retainPreparedControlChanges,preparedControlChangesBetween} from '../../domain/recordingSnapshot/preparedControlChanges';
import type {SnapshotScalarTarget} from '../../domain/recordingSnapshot/simplexGeometry';

describe('completed immutable control revision provenance',()=>{
 it('unions the actual basis and response writes through intermediate control-only stages',()=>{
  const start=emptyRecordingSnapshotWorkspace(),basis={...start},response={...basis},node:SnapshotScalarTarget={kind:'node',nodeId:'a'},handle:SnapshotScalarTarget={kind:'handle',curveId:'c',end:1};
  registerPreparedControlChanges(start,basis,'r',{structureUnchanged:true,basisControls:new Map([['side',[node]]]),responseControls:[]});
  registerPreparedControlChanges(basis,response,'r',{structureUnchanged:true,basisControls:new Map(),responseControls:[node,handle,node]});
  const result=preparedControlChangesBetween(start,response,'r')!;
  expect(result.basisControls.get('side')).toEqual([node]);expect(result.responseControls).toEqual([node,handle]);
  expect(preparedControlChangesBetween(start,response,'other')).toBeUndefined();
 });
 it('does not infer an untouched structure from untracked edits, imports or an unrelated history state',()=>{
  const start=emptyRecordingSnapshotWorkspace(),next={...start};
  registerPreparedControlChanges(start,next,'r',{structureUnchanged:true,basisControls:new Map(),responseControls:[]});
  expect(preparedControlChangesBetween(start,{...next},'r')).toBeUndefined();
  expect(preparedControlChangesBetween(start,structuredClone(next),'r')).toBeUndefined();
  expect(preparedControlChangesBetween({...start},next,'r')).toBeUndefined();
 });
 it('retains addresses through validated copies and owns immutable target values',()=>{
  const start=emptyRecordingSnapshotWorkspace(),next={...start},validated={...next},targets:SnapshotScalarTarget[]=[{kind:'node',nodeId:'a'}];
  registerPreparedControlChanges(start,next,'r',{structureUnchanged:true,basisControls:new Map([['side',targets]]),responseControls:targets});
  (targets[0] as {nodeId:string}).nodeId='changed';targets.push({kind:'node',nodeId:'b'});
  retainPreparedControlChanges(validated,next);
  const result=preparedControlChangesBetween(start,validated,'r')!;
  expect(result.basisControls.get('side')).toEqual([{kind:'node',nodeId:'a'}]);expect(result.responseControls).toEqual([{kind:'node',nodeId:'a'}]);
 });
 it('fails closed on a cyclic or interrupted provenance chain',()=>{
  const start=emptyRecordingSnapshotWorkspace(),a={...start},b={...start},changes={structureUnchanged:true as const,basisControls:new Map(),responseControls:[]};
  registerPreparedControlChanges(a,b,'r',changes);registerPreparedControlChanges(b,a,'r',changes);
  expect(preparedControlChangesBetween(start,b,'r')).toBeUndefined();
 });
});
