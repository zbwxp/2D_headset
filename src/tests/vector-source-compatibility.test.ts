import {expect,test} from 'vitest';
import {addLayer,createCurve,linkEndpoints} from '../domain/drawing/commands';
import {emptyDrawing,shapeOf,type Cubic,type DrawingDocument} from '../domain/drawing/model';
import {point,arcField} from '../domain/drawing/sampling';
import {displayField,displayPath} from '../domain/drawing/displayIntervals';
import {createDisplayRouteField} from '../domain/drawing/displayRoutes';
import {createArtworkRig,addDeformer,drawingSignature} from '../domain/vectorRecording/model';
import {sourceStructureSignature,synchronizeCompatibleSource} from '../domain/vectorRecording/sourceCompatibility';

const line=(x=0,y=0):Cubic=>[[x,y],[x+1/3,y],[x+2/3,y],[x+1,y]];
function fixture(){
 let d=addLayer(emptyDrawing(),'A');d=createCurve(d,d.layers[0].id,line(),.01,'A','a');d=createCurve(d,d.layers[0].id,line(0,2),.01,'B','b');
 d={...d,displayIntervals:[{id:'track',anchor:{id:'a',reverse:false},ranges:[{id:'range',start:.2,end:.8,inkEnds:[{taper:.05},{extension:.02}]}]}]};
 let rig=addDeformer(createArtworkRig('art',d),d,[d.layers[0].id]);
 rig={...rig,keys:rig.keys.map((k,i)=>i? k:{...k,intervalOverrides:structuredClone(d.displayIntervals)})};
 return {d,rig};
}
const changed=(d:DrawingDocument,id='a'):DrawingDocument=>({...d,curves:d.curves.map(c=>c.id===id?{...c,handles:[[.15,.5],[.9,-.2]]}:c)});

test('compatible source geometry transports authored material and preserves all rig control identities',()=>{
 const {d,rig}=fixture(),after=changed(d),snapshot=JSON.stringify([d,after,rig]),next=synchronizeCompatibleSource(rig,d,after)!;
 expect(next).toBeDefined();expect(next.sourceSignature).toBe(drawingSignature(after));expect(next.sourceStructureSignature).toBe(sourceStructureSignature(after));
 expect(next.deformers).toBe(rig.deformers);expect(next.bindings).toBe(rig.bindings);expect(next.keys[0].grids).toBe(rig.keys[0].grids);expect(next.keys[1]).toBe(rig.keys[1]);expect(next.keys[0].id).toBe(rig.keys[0].id);expect(next.keys[0].angle).toBe(rig.keys[0].angle);
 const range=next.keys[0].intervalOverrides![0].ranges[0],field=arcField([shapeOf(after,'a')]);
 // Original straight line has material t=s. Independent dense arc integration
 // verifies the moved cuts follow the same source t after a nonlinear edit.
 const dense=(t:number)=>{let sum=0,last=point(shapeOf(after,'a'),0);for(let i=1;i<=8192;i++){const p=point(shapeOf(after,'a'),t*i/8192);sum+=Math.hypot(p[0]-last[0],p[1]-last[1]);last=p;}return sum;};
 expect(range.start).toBeCloseTo(dense(.2)/dense(1),4);expect(range.end).toBeCloseTo(dense(.8)/dense(1),4);expect(field.total).toBeGreaterThan(1);
 expect(range.inkEnds).toEqual(d.displayIntervals![0].ranges[0].inkEnds);expect(JSON.stringify([d,after,rig])).toBe(snapshot);
});

test('an unrelated source edit preserves exact key and draft references and values',()=>{
 const {d,rig}=fixture(),draft={...rig.keys[0]},withDraft={...rig,draft},next=synchronizeCompatibleSource(withDraft,d,changed(d,'b'))!;
 expect(next.keys).toBe(rig.keys);expect(next.draft).toBe(draft);expect(JSON.stringify(next.keys)).toBe(JSON.stringify(rig.keys));
});

test('the structural signature excludes geometry and paint but records material identity and ownership',()=>{
 const {d}=fixture(),signature=sourceStructureSignature(d),style={...changed(d),curves:d.curves.map(c=>({...c,name:'Renamed',width:.02,visible:false,depthOffset:4})),displayIntervals:d.displayIntervals!.map(t=>({...t,ranges:t.ranges.map(r=>({...r,start:.3,end:.7,mode:'HIDE' as const}))}))};
 expect(signature.length).toBeLessThan(120);
 expect(sourceStructureSignature(style)).toBe(signature);
 expect(sourceStructureSignature({...d,curves:[...d.curves].reverse(),nodes:[...d.nodes].reverse()})).toBe(signature);
 expect(sourceStructureSignature({...d,curves:d.curves.map(c=>c.id==='a'?{...c,nodes:[...c.nodes].reverse() as [string,string]}:c)})).not.toBe(signature);
 expect(sourceStructureSignature({...d,displayIntervals:d.displayIntervals!.map(t=>({...t,ranges:[...t.ranges,{id:'extra',start:0,end:0}]}))})).not.toBe(signature);
 expect(sourceStructureSignature({...d,layers:d.layers.map(l=>({...l,id:'other-owner'}))})).not.toBe(signature);
});

test('precise synchronization declines unknown baselines and structural edits without mutating the rig',()=>{
 const {d,rig}=fixture(),before=JSON.stringify(rig);
 expect(synchronizeCompatibleSource({...rig,sourceSignature:'unknown'},d,changed(d))).toBeUndefined();
 expect(synchronizeCompatibleSource({...rig,sourceStructureSignature:'wrong'},d,changed(d))).toBeUndefined();
 expect(synchronizeCompatibleSource(rig,d,createCurve(d,d.layers[0].id,line(0,3),.01,'New','new'))).toBeUndefined();
 const legacy={...rig};delete legacy.sourceStructureSignature;expect(synchronizeCompatibleSource(legacy,d,changed(d))).toBeDefined();
 expect(JSON.stringify(rig)).toBe(before);
});

test('a collapsed interval path declines precise material transport instead of silently rebasing cuts',()=>{
 const {d,rig}=fixture(),after={...d,nodes:d.nodes.map(n=>d.curves[0].nodes.includes(n.id)?{...n,position:[0,0] as [number,number]}:n),curves:d.curves.map(c=>c.id==='a'?{...c,handles:[[0,0],[0,0]] as [[number,number],[number,number]]}:c)};
 expect(sourceStructureSignature(after)).toBe(sourceStructureSignature(d));expect(synchronizeCompatibleSource(rig,d,after)).toBeUndefined();
});

test('geometry edits that trim away an authored cut at an ARC decline precise synchronization',()=>{
 let d=addLayer(emptyDrawing(),'A');d=createCurve(d,d.layers[0].id,[[-1,0],[-2/3,0],[-1/3,0],[0,0]],.01,'A','a');d=addLayer(d,'B');d=createCurve(d,d.layers[0].id,[[0,0],[0,1/3],[0,2/3],[0,1]],.01,'B','b');d=linkEndpoints(d,{curveId:'a',end:1},{curveId:'b',end:0});
 d={...d,endpointLinks:d.endpointLinks!.map(l=>({...l,throughDisplay:true,joinBrush:{kind:'ARC' as const,trimDistance:.2}}))};
 const route={seed:{segments:[{id:'a',reverse:false}],closed:false},throughLinkIds:[d.endpointLinks![0].id]},f=createDisplayRouteField(d,route),start=f.positionOf({kind:'curve',curveId:'a',t:.75})!;
 d={...d,displayIntervals:[{id:'track',anchor:{id:'a',reverse:false},displayRoute:route,ranges:[{id:'range',start,end:1}]}]};
 const rig=createArtworkRig('art',d);rig.keys[0].intervalOverrides=structuredClone(d.displayIntervals);
 const after={...d,nodes:d.nodes.map(n=>({...n,position:[n.position[0]*.5,n.position[1]*.5] as [number,number]})),curves:d.curves.map(c=>({...c,handles:c.handles.map(p=>[p[0]*.5,p[1]*.5]) as [[number,number],[number,number]]}))};
 expect(displayField(after,displayPath(after,'a')).geometry.error).toBeUndefined();
 expect(synchronizeCompatibleSource(rig,d,after)).toBeUndefined();
});
