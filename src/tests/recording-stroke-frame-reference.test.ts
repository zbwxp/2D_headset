import {describe,it,expect} from 'vitest';
import {emptyDrawing,type Point2} from '../domain/drawing/model';
import {identityScenePlacement} from '../domain/recordingScene/model';
import {applyScenePlacement} from '../domain/recordingScene/tracks';
import type {SnapshotEvaluation} from '../domain/recordingSnapshot/evaluation';
import {displayedSnapshotStrokeFrameCenter,snapshotStrokeFrameInOutputSpace} from '../domain/recordingSnapshot/strokeTransformFrame';
const near=(actual:Point2|null,expected:Point2)=>{expect(actual).not.toBeNull();expected.forEach((value,i)=>expect(actual![i]).toBeCloseTo(value,12));};
function fixture(){
 const source={...emptyDrawing(),nodes:[{id:'a',position:[2,4] as Point2},{id:'b',position:[4,8] as Point2}],curves:[{id:'c',nodes:['a','b'] as [string,string],handles:[[2.5,5],[3.5,7]] as [Point2,Point2],visible:true,locked:false,width:.01}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['c']}]};
 const element={...identityScenePlacement(),scaleX:0,scaleY:2,rotation:90,translation:[3,-1] as Point2},parent={...identityScenePlacement(),translation:[10,20] as Point2};
 const map=(p:Point2)=>applyScenePlacement(parent,applyScenePlacement(element,p));
 const drawing={...source,nodes:source.nodes.map(node=>({...node,position:map(node.position)})),curves:source.curves.map(curve=>({...curve,handles:curve.handles.map(map) as [Point2,Point2]}))};
 const evaluation={drawing,preElementPlacementDrawing:source,elementPlacements:{c:element},placements:{layer:parent},state:{layers:{},layerDomains:[]},angleSurface:{role:'basis'}} as unknown as SnapshotEvaluation;
 return {evaluation};
}
describe('shared displayed V-frame reference',()=>{
 it('maps the retained material center through zero-width rotation and parent placement without inversion',()=>{
  const {evaluation}=fixture();near(displayedSnapshotStrokeFrameCenter(evaluation,['c']),[1,19]);expect(snapshotStrokeFrameInOutputSpace(evaluation,['c'])).toBe(false);
 });
 it('uses the final frame for output-domain targets, as the V editor does',()=>{
  const {evaluation}=fixture();evaluation.state.layerDomains=[{id:'domain',kind:'affine',layerIds:['layer'],matrix:[1,0,0,1,0,0],postShape:{nodes:{},handles:{}}}];
  evaluation.drawing={...evaluation.drawing,nodes:evaluation.drawing.nodes.map(node=>({...node,position:[node.position[0]+7,node.position[1]-4] as Point2})),curves:evaluation.drawing.curves.map(curve=>({...curve,handles:curve.handles.map(p=>[p[0]+7,p[1]-4] as Point2) as [Point2,Point2]}))};
  expect(snapshotStrokeFrameInOutputSpace(evaluation,['c'])).toBe(true);near(displayedSnapshotStrokeFrameCenter(evaluation,['c']),[8,15]);
 });
 it('returns no reference for an empty selection',()=>{expect(displayedSnapshotStrokeFrameCenter(fixture().evaluation,[])).toBeNull();});
});
