import {it,expect} from 'vitest';
import {emptyDrawing,shapeOf,type Point2,type Cubic} from '../../domain/drawing/model';
import {addLayer,createCurve} from '../../domain/drawing/commands';
import {createWarpGrid,moveWarpNode} from '../../domain/vectorWarp/model';
import {deformDrawing,cubicPoint} from '../../domain/vectorWarp/evaluation';

const sourceCurve:Cubic=[[-.9,-.5],[-.7,.9],[.5,-.8],[.9,.7]];
function artwork(reverse=false){let d=addLayer(emptyDrawing(),'Ink');d=createCurve(d,d.layers[0].id,sourceCurve,.01,'Source','curve');d.displayIntervals=[{id:'track',scope:'CURVE',anchor:{id:'curve',reverse},ranges:[{id:'range',start:.23,end:.71,mode:'HIDE',enabled:true,inkEnds:[{taperWidthScale:14},{taperWidthScale:7}]}]}];return d;}
/** Independent dense polyline arc inversion, with a different resolution from
 * the reusable authoring transport's adaptive arc table. */
function tAtArc(curve:Cubic,s:number){const count=12000,dist=[0];let previous=cubicPoint(curve,0);for(let i=1;i<=count;i++){const p=cubicPoint(curve,i/count);dist.push(dist[i-1]+Math.hypot(p[0]-previous[0],p[1]-previous[1]));previous=p;}const target=s*dist[count];let i=dist.findIndex(x=>x>=target);if(i<=0)return 0;return (i-1+(target-dist[i-1])/(dist[i]-dist[i-1]))/count;}

it.each([false,true])('transports material cuts instead of retaining arc percentages (reverse=%s)',reverse=>{
 const source=artwork(reverse),saved=JSON.stringify(source),grid=moveWarpNode(createWarpGrid({min:[-1,-1],max:[1,1]},3,3),5,[-.1,.38]);
 const preview=deformDrawing(source,grid,{diagnostics:'preview'}),full=deformDrawing(source,grid),track=full.drawing.displayIntervals![0],range=track.ranges[0];
 expect(preview.drawing).toEqual(full.drawing);expect(JSON.stringify(source)).toBe(saved);expect(full.intervalTransportErrors).toEqual([]);expect(track.id).toBe('track');expect(track.anchor).toEqual(source.displayIntervals![0].anchor);expect(range.id).toBe('range');expect(range.inkEnds).toEqual(source.displayIntervals![0].ranges[0].inkEnds);expect(range.enabled).toBe(true);expect(range.mode).toBe('HIDE');
 for(const endpoint of ['start','end'] as const){const original=source.displayIntervals![0].ranges[0][endpoint],before=tAtArc(sourceCurve,reverse?1-original:original),after=tAtArc(shapeOf(full.drawing,'curve'),reverse?1-range[endpoint]:range[endpoint]);expect(after).toBeCloseTo(before,3);}
 expect(Math.abs(range.start-.23)+Math.abs(range.end-.71)).toBeGreaterThan(.01);
});
it('retains unchanged identity ranges and isolates returned range objects',()=>{
 const source=artwork(),result=deformDrawing(source,[]);expect(result.drawing.displayIntervals).toEqual(source.displayIntervals);result.drawing.displayIntervals![0].ranges[0].start=.5;expect(source.displayIntervals![0].ranges[0].start).toBe(.23);
});
it('reports undefined material transport on a fully collapsed field without crashing or splitting',()=>{
 const source=artwork(),grid=createWarpGrid({min:[-1,-1],max:[1,1]},2,2);for(const n of grid.nodes){n.position=[0,0];n.handleU=[0,0];n.handleV=[0,0];n.twist=[0,0];}
 const result=deformDrawing(source,grid);expect(result.drawing.curves).toHaveLength(1);expect(result.intervalTransportErrors).toHaveLength(1);expect(result.intervalTransportErrors[0].trackId).toBe('track');expect(result.warningCurveIds).toEqual(['curve']);expect(result.diagnostics[0].appearanceWarning).toBeTruthy();expect(result.diagnostics[0].warning).toBe(true);
});
