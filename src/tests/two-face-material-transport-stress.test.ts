import {expect,test} from 'vitest';
import rawSource from '../assets/hairless-symmetric-two-face.json';
import {createVectorEditingApi} from '../app/vectorEditingApi';
import {createEmptyProject} from '../app/emptyProject';
import type {LandmarkProject} from '../domain/landmarks/model';
import {nodeAt,parseDrawing,type DrawingDocument as Doc,type Point2} from '../domain/drawing/model';
import {displayField,displayPath} from '../domain/drawing/displayIntervals';
import {createDisplayRouteField} from '../domain/drawing/displayRoutes';
import {displayRouteInk,displayRouteInkSupport} from '../domain/drawing/displayRouteInk';
import {depthPaintBatches} from '../domain/drawing/depth';
import {curveSamples} from '../domain/drawing/curveProvenance';
import {createWarpGrid,moveWarpNode,deformDrawing} from '../domain/vectorWarp';

// Exact final browser artifact, including the left-jaw +1 LAYER paint setting.
// Its HIDE boundaries lie one ULP on opposite sides of actual source-piece seams.
const source=parseDrawing(rawSource),link=source.endpointLinks!.find(l=>l.throughDisplay)!,owners=[link.a.curveId,link.b.curveId];
const route=source.displayIntervals!.find(t=>t.displayRoute)!.displayRoute!,chin=nodeAt(source,link.a),original=createDisplayRouteField(source,route);
const faceLayers=source.layers.filter(l=>l.items.some(id=>owners.includes(id))),faceIds=new Set(faceLayers.flatMap(l=>l.items));
const distance=(a:Point2,b:Point2)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const ordinary:Point2[]=[...[-.03,-.01,.01,.03].flatMap(v=>[[v,0],[0,v]] as Point2[]),...[-.03,.03].flatMap(x=>[-.03,.03].map(y=>[x,y] as Point2))];
// Zero proves the identity fast path, tiny edits prove the transport path cannot
// reinterpret a material seam merely because geometry changed by a small amount.
const deltas:Point2[]=[[0,0],[1e-8,0],[0,1e-8],...ordinary];
const identity=createWarpGrid({min:[chin.position[0]-1,chin.position[1]-1.4],max:[chin.position[0]+1,chin.position[1]+1.4]},2,2);

function assertStable(d:Doc){
 expect(distance(nodeAt(d,link.a).position,nodeAt(d,link.b).position)).toBe(0);
 expect(d.layers).toEqual(source.layers);expect(d.fills).toEqual(source.fills);expect(d.curves.map(c=>[c.id,c.nodes,c.depthOffset,c.depthScope])).toEqual(source.curves.map(c=>[c.id,c.nodes,c.depthOffset,c.depthScope]));
 expect(displayRouteInkSupport(d,route)).toEqual([]);
 const field=displayField(d,displayPath(d,owners[0])),material=createDisplayRouteField(d,route),batches=depthPaintBatches(d),positions=new Map(batches.filter(b=>b.owner).map(b=>[b.owner!,b.position]));
 const plan=displayRouteInk(d,route,positions);expect(plan.diagnostics).toEqual([]);expect(field.mask).toHaveLength(1);
 const arcParts=field.geometry.pieces.flatMap((p,i)=>p.joinId?[field.parts[i]]:[]);expect(arcParts).toHaveLength(2);
 expect(distance(arcParts[0].shape[3],arcParts[1].shape[0])).toBe(0);
 expect(field.mask![0][0]).toBeLessThan(arcParts[0].start/field.total);
 expect(field.mask![0][1]).toBeGreaterThan((arcParts[1].start+arcParts[1].length)/field.total);
 for(const track of source.displayIntervals!.filter(t=>t.displayRoute))for(const range of track.ranges){
  const next=d.displayIntervals!.find(t=>t.id===track.id)!.ranges.find(r=>r.id===range.id)!;
  for(const side of ['start','end'] as const){const ref=original.materialAt(range[side])!,expected=material.positionOf(ref);expect(expected).toBeDefined();expect(next[side],`${range.id} ${side}`).toBeCloseTo(expected!,11);}
 }
 const pending=owners.flatMap(id=>plan.runs.get(id)!.filter(r=>r.shapes.some(s=>new Set(curveSamples(s,.5).map(p=>p.id)).size===2)));
 expect(pending.length).toBeGreaterThanOrEqual(2);let end=arcParts[0].shape[0],previous:typeof pending[number]|undefined;
 // A non-symmetric biarc's geometric junction need not be its ownership
 // midpoint: three partition fragments are valid. Follow actual joined ends.
 while(pending.length){
  const i=pending.findIndex(r=>distance(r.shapes[0][0],end)<1e-10);expect(i).toBeGreaterThanOrEqual(0);const run=pending.splice(i,1)[0],half=run.outline.length/2;
  if(previous){const n=previous.outline.length/2;expect(distance(previous.outline[n-1],run.outline[0])).toBeLessThan(1e-10);expect(distance(previous.outline[n],run.outline.at(-1)!)).toBeLessThan(1e-10);}
  expect(distance(run.outline[0],run.outline.at(-1)!)).toBeCloseTo(.008,10);expect(distance(run.outline[half-1],run.outline[half])).toBeCloseTo(.008,10);
  end=run.shapes.at(-1)![3];previous=run;
 }
 expect(distance(end,arcParts.at(-1)!.shape[3])).toBeLessThan(1e-10);
 // Both halves stay above both independent face fills; changing a pose never
 // needs another paint offset. Other foreground fills are outside this chin.
 for(const fill of source.fills.filter(f=>faceLayers.some(l=>l.items.includes(f.id))))for(const id of owners)expect(positions.get(id)!).toBeLessThan(batches.find(b=>b.item.id===fill.id)!.position);
}

test.each(deltas)('actual source API chin move (%s,%s) preserves material coverage, linked ARC and one-step Undo',(x,y)=>{
 const before=JSON.stringify(source);let project:LandmarkProject={...createEmptyProject(),drawing:source};const past:LandmarkProject[]=[];let commits=0;
 const api=createVectorEditingApi({getState:()=>({project,past,future:[]}),getMode:()=> 'drawing',commitDrawing(drawing){past.push(project);project={...project,drawing};commits++;},undo(){const p=past.pop();if(p)project=p;},redo(){}});
 const result=api.execute({commands:[{op:'moveNode',nodeId:chin.id,position:[chin.position[0]+x,chin.position[1]+y]}]});expect(result.ok,JSON.stringify(result)).toBe(true);expect(commits).toBe(x||y?1:0);assertStable(project.drawing!);
 if(x||y){expect(api.undo().ok).toBe(true);expect(project.drawing).toBe(source);}expect(JSON.stringify(source)).toBe(before);
});

test.each(deltas)('actual shared-cage Warp chin move (%s,%s) preserves coverage without source edits or per-pose paint repairs',(x,y)=>{
 const before=JSON.stringify(source),grid=moveWarpNode(identity,4,[identity.nodes[4].position[0]+x,identity.nodes[4].position[1]+y]);
 const evaluated=deformDrawing(source,id=>faceIds.has(id)?[grid]:[],{diagnostics:'full'});
 expect(evaluated.intervalTransportErrors).toEqual([]);expect(evaluated.conflictingNodeIds).toEqual([]);expect(evaluated.warningCurveIds).toEqual([]);assertStable(evaluated.drawing);expect(JSON.stringify(source)).toBe(before);
});

test.each(deltas)('actual admissible independent-piece Warp (%s,%s) preserves coverage while keeping the linked chin fixed',(x,y)=>{
 const before=JSON.stringify(source),grids=faceLayers.map((_,i)=>{const index=i?5:3,sign=i?-1:1;return moveWarpNode(identity,index,[identity.nodes[index].position[0]+sign*x,identity.nodes[index].position[1]+sign*y]);});
 const owner=new Map(faceLayers.flatMap((l,i)=>l.items.map(id=>[id,i] as const))),evaluated=deformDrawing(source,id=>owner.has(id)?[grids[owner.get(id)!]]:[],{diagnostics:'full'});
 expect(evaluated.intervalTransportErrors).toEqual([]);expect(evaluated.conflictingNodeIds).toEqual([]);expect(evaluated.warningCurveIds).toEqual([]);expect(distance(nodeAt(evaluated.drawing,link.a).position,chin.position)).toBeLessThan(1e-12);assertStable(evaluated.drawing);expect(JSON.stringify(source)).toBe(before);
});
