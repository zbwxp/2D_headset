import {setDepthOffset,depthPaintBatches} from '../domain/drawing/depth';
import {createVectorEditingApi} from '../app/vectorEditingApi';
import type {LandmarkProject} from '../domain/landmarks/model';
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {parseDrawing} from '../domain/drawing/model';
import {adoptDisplayRoute} from '../domain/drawing/displayRouteAuthoring';
import {displayField,displayPath} from '../domain/drawing/displayIntervals';
import {compileDisplayRouteBrushes} from '../domain/drawing/displayRouteBrush';
import {resolveDisplayRoute} from '../domain/drawing/displayRoutes';
import {displayRouteInk} from '../domain/drawing/displayRouteInk';
import {fillGeometry} from '../domain/drawing/appearance';
import {createArtworkRig,acceptArtworkSource,applyVisibility,evaluatePose,saveKeyform} from '../domain/vectorRecording/model';
import {emptyVectorRecording} from '../domain/vectorRecording/model';
import {createEmptyProject} from '../app/emptyProject';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {serializeProject} from '../app/autosave';
const source=()=>parseDrawing(JSON.parse(readFileSync(new URL('./fixtures/two-face-closed-hidden-draft.json',import.meta.url),'utf8')));
const linkId='ed1131ae-74c5-4534-9b6b-6395e37b1a58',trackId='841ef5a3-46a6-4a12-822b-e4bfb6601bdf';
function adopted(){const d=source();d.endpointLinks=d.endpointLinks!.map(l=>l.id===linkId?{...l,joinBrush:{kind:'ARC',trimDistance:.05257222158088604}}:l);return adoptDisplayRoute(d,trackId,linkId);}
test('actual browser-authored two-face HIDE draft adopts exact requested ARC without a chin taper gap or fill/source edits',()=>{
 const original=source(),r=adopted(),d=r.document,compiled=compileDisplayRouteBrushes(d,resolveDisplayRoute(d,r.route)),field=displayField(d,displayPath(d,d.endpointLinks!.find(l=>l.id===linkId)!.a.curveId)),plan=displayRouteInk(d,r.route,new Map());
 expect(d.curves).toEqual(original.curves);expect(d.nodes).toEqual(original.nodes);expect(d.layers).toEqual(original.layers);expect(d.fills).toEqual(original.fills);expect(d.offsets).toEqual(original.offsets);expect(d.fills.map(f=>fillGeometry(d,f))).toEqual(original.fills.map(f=>fillGeometry(original,f)));
 expect(r.generatedRangeIds).toEqual([]);expect(plan.diagnostics).toEqual([]);const arc=compiled.links.find(l=>l.linkId===linkId)!;expect(arc.resolved).toBe(true);expect(arc.geometry!.shapes).toHaveLength(2);expect(arc.geometry!.shapes[0][3]).toEqual([-.3294804514288924,-.3496499991375761]);
 const pieces=field.geometry.pieces.flatMap((p,i)=>p.joinId===arc.joinId?[field.parts[i]]:[]),start=pieces[0].start/field.total,end=(pieces.at(-1)!.start+pieces.at(-1)!.length)/field.total;
 expect(field.inkSpans!.some(s=>s.start<start&&s.end>end)).toBe(true);expect(plan.runs.get(d.endpointLinks!.find(l=>l.id===linkId)!.a.curveId)!.some(r=>r.shapes.length>0)).toBe(true);expect(parseDrawing(d)).toEqual(d);
});
test('routed artifact, angle interval overrides and exact source IDs survive full-project serialization',()=>{
 const d=adopted().document;let rig=createArtworkRig('$working',d);rig={...rig,angle:{x:90,y:0},draft:{...evaluatePose(rig,{x:90,y:0},d),intervalOverrides:d.displayIntervals}};rig=saveKeyform(rig,'Side',d);const p={...createEmptyProject(),drawing:d,vectorRecording:{...emptyVectorRecording(),rigs:[rig]}},reloaded=parseLandmarks(serializeProject(p));expect(reloaded.drawing).toEqual(d);expect(applyVisibility(d,evaluatePose(rig,{x:45,y:0},d)).curves).toEqual(d.curves);
});
test('accepting split-origin range metadata propagates old angle enable flags without overwriting explicit child state',()=>{
 const d=source(),base=d.displayIntervals![0],old=base.ranges[0],newSource={...d,displayIntervals:d.displayIntervals!.map(t=>t===base?{...t,ranges:[old,{...old,id:'split-off',originId:old.id}]}:t)};let rig=createArtworkRig('$working',d);rig.keys[0].intervals={[old.id]:false};rig.keys[1].intervals={[old.id]:false,'split-off':true};const next=acceptArtworkSource(rig,newSource);expect(next.keys[0].intervals['split-off']).toBe(false);expect(next.keys[1].intervals['split-off']).toBe(true);
});

test('actual visible-console two-command batch preserves source and adopts continuous ARC atomically',()=>{let project:LandmarkProject={...createEmptyProject(),drawing:source()},commits=0;const api=createVectorEditingApi({getState:()=>({project,past:[],future:[]}),getMode:()=>"drawing",commitDrawing:drawing=>{project={...project,drawing};commits++;},undo(){},redo(){}}),before=project;const commands=[{op:'setLinkJoinBrush' as const,linkId,brush:{kind:'ARC' as const,trimDistance:.05257222158088604}},{op:'adoptDisplayRoute' as const,trackId,linkId}];expect(api.execute({commands,dryRun:true})).toMatchObject({ok:true,value:{applied:false}});expect(project).toBe(before);const result=api.execute({commands});expect(result).toMatchObject({ok:true,value:{applied:true}});expect(commits).toBe(1);expect(project.drawing!.curves).toEqual(before.drawing!.curves);const plan=displayRouteInk(project.drawing!,project.drawing!.displayIntervals!.find(t=>t.id===trackId)!.displayRoute!,new Map());expect(plan.diagnostics).toEqual([]);});

test('the back jaw can paint above the overlapping front white fill using its existing layer depth control',()=>{const d=adopted().document,id='1a723ec7-9bbe-4c56-8c0f-680d03741aa6',fill='4b61b3d4-912d-4f72-be51-099d53f2ee16',before=depthPaintBatches(d),next=setDepthOffset(d,id,1,'LAYER'),after=depthPaintBatches(next);expect(before.find(b=>b.owner===id)!.position).toBeGreaterThan(before.find(b=>b.item.id===fill)!.position);expect(after.find(b=>b.owner===id)!.position).toBeLessThan(after.find(b=>b.item.id===fill)!.position);expect(next.nodes).toEqual(d.nodes);expect(next.fills).toEqual(d.fills);expect(next.layers).toEqual(d.layers);expect(next.curves.map(c=>[c.id,c.nodes,c.handles])).toEqual(d.curves.map(c=>[c.id,c.nodes,c.handles]));});
