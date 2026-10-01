import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {parseDrawing,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {createWarpGrid,moveWarpNode} from '../../domain/vectorWarp/model';
import {deformDrawing,fitWarpedCubic} from '../../domain/vectorWarp/evaluation';

it('evaluates the archived 208-segment face without source changes or hidden subdivision',()=>{
 const project=JSON.parse(readFileSync(new URL('../../../docs/assets/front-face-v1/基础脸模·正面·v1.json',import.meta.url),'utf8'));
 const source:DrawingDocument=parseDrawing(project.drawing),serialized=JSON.stringify(source),points=source.nodes.map(n=>n.position);
 const min:Point2=[Math.min(...points.map(p=>p[0]))-.1,Math.min(...points.map(p=>p[1]))-.1],max:Point2=[Math.max(...points.map(p=>p[0]))+.1,Math.max(...points.map(p=>p[1]))+.1];
 let grid=createWarpGrid({min,max},3,3);grid=moveWarpNode(grid,5,[grid.nodes[5].position[0]+.25,grid.nodes[5].position[1]+.1]);
 const previewStart=performance.now(),preview=deformDrawing(source,grid,{diagnostics:'preview'}),previewElapsed=performance.now()-previewStart;
 const start=performance.now(),result=deformDrawing(source,grid),elapsed=performance.now()-start;expect(preview.drawing).toEqual(result.drawing);expect(preview.diagnosticStage).toBe('preview');expect(result.maxError).toBeGreaterThanOrEqual(preview.maxError);
 const neutralStart=performance.now(),neutral=deformDrawing(source,createWarpGrid({min,max},3,3)),neutralElapsed=performance.now()-neutralStart;expect(neutral.warningCurveIds).toEqual([]);expect(neutral.diagnostics.every(d=>d.validationKind==='identity-exact'||d.maxError<1e-10)).toBe(true);
 expect(source.curves).toHaveLength(208);expect(result.diagnostics).toHaveLength(208);expect(result.drawing.curves).toHaveLength(208);expect(JSON.stringify(source)).toBe(serialized);
 expect(result.diagnostics.every(d=>d.cubic.length===4&&Number.isFinite(d.maxError))).toBe(true);expect(result.drawing.fills).toEqual(source.fills);expect(result.drawing.endpointLinks).toEqual(source.endpointLinks);
 const frames:number[]=[];for(let frame=0;frame<6;frame++){const g=moveWarpNode(grid,5,[grid.nodes[5].position[0]+frame*.002,grid.nodes[5].position[1]]),begin=performance.now();deformDrawing(source,g,{diagnostics:'preview'});frames.push(performance.now()-begin);}frames.sort((a,b)=>a-b);
 console.info(`208-curve vectorWarp fixture: full ${elapsed.toFixed(1)} ms; preview cold ${previewElapsed.toFixed(1)} ms / warm median ${frames[3].toFixed(1)} ms; neutral ${neutralElapsed.toFixed(1)} ms; ${result.warningCurveIds.length} warned segments; max logical error ${result.maxError.toFixed(6)}`);
},10000);

it('reports numerical overflow independently from an intentional finite fold',()=>{
 const grid=createWarpGrid({min:[-1,-1],max:[1,1]},1,1);grid.nodes[0].handleU=[1e200,1e200];
 const result=fitWarpedCubic([[-.8,-.5],[-.3,.5],[.3,-.5],[.8,.5]],[grid,grid]);
 expect(result.nonFinite).toBe(true);expect(result.warning).toBe(true);expect(result.maxError).toBe(Infinity);expect(result.cubic).toHaveLength(4);expect(result.cubic.every(p=>p.every(Number.isFinite))).toBe(true);
});
