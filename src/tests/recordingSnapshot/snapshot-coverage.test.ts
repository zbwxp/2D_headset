import {describe,it,expect} from 'vitest';
import {emptyDrawing,type DrawingDocument} from '../../domain/drawing/model';
import {createSnapshotTriangulation} from '../../domain/recordingSnapshot/triangulation';
import {prepareSnapshotCoverage,snapshotCoverageEditableDrawing} from '../../domain/recordingSnapshot/snapshotCoverage';

function drawing(ids:string[],x=0):DrawingDocument{
 const d=emptyDrawing();for(const id of ids){d.nodes.push({id:`${id}/a`,position:[x,0]},{id:`${id}/b`,position:[x+1,0]});d.curves.push({id,name:id,nodes:[`${id}/a`,`${id}/b`],handles:[[x+.25,0],[x+.75,0]],visible:true,locked:false,width:.01});}d.layers=[{id:'layer',name:'Layer',visible:true,locked:false,items:ids}];return d;
}
describe('per-curve recording coverage preview',()=>{
 it('keeps one real sample fixed and red everywhere else without editable membership',()=>{
  const mesh=createSnapshotTriangulation([{snapshotId:'sixty',angle:{x:60,y:0}}]);
  const coverage=prepareSnapshotCoverage(mesh,[{snapshotId:'sixty',drawing:drawing(['ear'],2)}]);
  const exact=coverage.evaluate({x:60,y:0}),elsewhere=coverage.evaluate({x:30,y:0});
  expect(exact.normal!.drawing.curves[0].id).toBe('ear');expect(exact.outsideCurves).toHaveLength(0);
  expect(elsewhere.normal).toBeUndefined();expect(snapshotCoverageEditableDrawing(elsewhere)).toBeUndefined();expect(elsewhere.outsideCurves[0]).toMatchObject({curveId:'ear',requestedAngle:{x:30,y:0},evaluatedAngle:{x:60,y:0},readonly:true});expect(elsewhere.outsideCurves[0].cubic[0]).toEqual([2,0]);
 });
 it('turns a matching-ID pasted basis black while wrong IDs coexist with red references',()=>{
  const mesh=createSnapshotTriangulation([{snapshotId:'zero',angle:{x:0,y:0}},{snapshotId:'ninety',angle:{x:90,y:0}}]);
  const wrong=prepareSnapshotCoverage(mesh,[{snapshotId:'zero',drawing:drawing(['original'])},{snapshotId:'ninety',drawing:drawing(['different'],3)}]).evaluate({x:90,y:0});
  expect(wrong.normal!.drawing.curves.map(c=>c.id)).toEqual(['different']);expect(wrong.outsideCurves.map(c=>c.curveId)).toEqual(['original']);
  const right=prepareSnapshotCoverage(mesh,[{snapshotId:'zero',drawing:drawing(['original'])},{snapshotId:'ninety',drawing:drawing(['original'],3)}]).evaluate({x:90,y:0});
  expect(right.normal!.drawing.curves.map(c=>c.id)).toEqual(['original']);expect(right.outsideCurves).toHaveLength(0);
 });
 it('projects onto each curve’s valid edge, rather than the nearest whole snapshot',()=>{
  const mesh=createSnapshotTriangulation([{snapshotId:'a',angle:{x:0,y:0}},{snapshotId:'b',angle:{x:90,y:0}},{snapshotId:'c',angle:{x:0,y:90}}]);
  const coverage=prepareSnapshotCoverage(mesh,[{snapshotId:'a',drawing:drawing(['common','edge'],0)},{snapshotId:'b',drawing:drawing(['common','edge'],9)},{snapshotId:'c',drawing:drawing(['common'],0)}]);
  const result=coverage.evaluate({x:30,y:30});
  expect(result.normal!.drawing.curves.map(c=>c.id)).toEqual(['common']);expect(result.outsideCurves).toHaveLength(1);expect(result.outsideCurves[0].evaluatedAngle).toEqual({x:30,y:0});expect(result.outsideCurves[0].cubic[0][0]).toBeCloseTo(3,14);
 });
 it('keeps red preview controls separate when topology correspondence is broken',()=>{
  const mesh=createSnapshotTriangulation([{snapshotId:'a',angle:{x:0,y:0}},{snapshotId:'b',angle:{x:90,y:0}}]);
  const a=drawing(['curve']),b=drawing(['curve'],4);b.nodes[0].id='changed';b.curves[0].nodes[0]='changed';
  const result=prepareSnapshotCoverage(mesh,[{snapshotId:'a',drawing:a},{snapshotId:'b',drawing:b}]).evaluate({x:20,y:0});
  expect(result.normal!.drawing.curves).toEqual([]);expect(result.outsideCurves).toHaveLength(1);expect(result.outsideCurves[0].evaluatedAngle).toEqual({x:0,y:0});expect(result.diagnostics.join(' ')).toContain('topology');
 });
});
