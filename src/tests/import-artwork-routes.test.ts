import {expect,test} from 'vitest';
import {importArtworkLayers,planArtworkLayerImport,ArtworkLayerDependencyError} from '../domain/drawing/importArtworkLayers';
import {addLayer,createCurve,connect,linkEndpoints} from '../domain/drawing/commands';
import {createFill} from '../domain/drawing/paintCommands';
import {adoptDisplayRoute} from '../domain/drawing/displayRouteAuthoring';
import {createDisplayRouteField,resolveDisplayRoute} from '../domain/drawing/displayRoutes';
import {displayField,displayPath} from '../domain/drawing/displayIntervals';
import {emptyDrawing,parseDrawing,shapeOf,type Cubic,type Point2,type DrawingDocument} from '../domain/drawing/model';
import {fillGeometry} from '../domain/drawing/appearance';

const line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
function fixture(){
 let d=emptyDrawing();const layers:string[]=[];
 for(const [name,points] of [['a',[[-1,0],[0,0],[-1,1]]],['b',[[0,0],[0,1],[1,0]]]] as const){
  d=addLayer(d,name);const layer=d.layers[0].id;layers.push(layer);for(let i=0;i<3;i++)d=createCurve(d,layer,line([...points[i]],[...points[(i+1)%3]]),.01,name+i,name+i);
  for(let i=0;i<3;i++)d=connect(d,{curveId:name+i,end:1},{curveId:name+((i+1)%3),end:0},'POSITION',undefined,true);d=createFill(d,[name+'0',name+'1',name+'2'],'white');
 }
 d=linkEndpoints(d,{curveId:'a0',end:1},{curveId:'b0',end:0},true);const link=d.endpointLinks![0].id;
 d={...d,displayIntervals:[{id:'ta',anchor:{id:'a1',reverse:false},ranges:[{id:'wrapped',start:.9,end:.2,mode:'SHOW',inkEnds:[{taper:.017,extension:.003},{taperWidthScale:3,extension:.007}]}]},{id:'tb',anchor:{id:'b0',reverse:false},ranges:[{id:'b-hide',start:0,end:1,mode:'HIDE',enabled:false}]}]};
 d=adoptDisplayRoute(d,'ta',link).document;d.displayIntervals![1].ranges.push({id:'history',originId:'prior-deleted-range',start:.1,end:.2,mode:'HIDE',enabled:false});
 return {d:parseDrawing(d),a:layers[0],b:layers[1],link};
}
const ids=(d:DrawingDocument)=>[...d.layers,...d.curves,...d.nodes,...d.fills,...d.offsets,...d.joins,...(d.endpointLinks??[]),...(d.displayIntervals??[]),...(d.displayIntervals??[]).flatMap(t=>t.ranges)].map(x=>x.id);

test('routed layer import explicitly closes dependencies and remaps all route, port and range provenance references',()=>{
 const {d,a,b,link}=fixture(),before=JSON.stringify(d),plan=planArtworkLayerImport(d,[a]);expect(plan.additionalLayerIds).toEqual([b]);expect(plan.dependencies.some(x=>x.kind==='displayRoute')).toBe(true);expect(()=>importArtworkLayers(emptyDrawing(),d,[a])).toThrow(ArtworkLayerDependencyError);
 const r=importArtworkLayers(emptyDrawing(),d,[a],{includeDependencies:true}),map=r.idMap,out=r.document;
 expect(out.layers).toHaveLength(2);expect(out.curves).toHaveLength(6);expect(out.fills).toHaveLength(2);expect(new Set(ids(out)).size).toBe(ids(out).length);expect(ids(out).some(id=>ids(d).includes(id))).toBe(false);
 for(const old of d.displayIntervals!){const next=out.displayIntervals!.find(t=>t.id===map[old.id])!;expect(next.displayRoute).toEqual({seed:{closed:old.displayRoute!.seed.closed,segments:old.displayRoute!.seed.segments.map(u=>({...u,id:map[u.id]}))},throughLinkIds:old.displayRoute!.throughLinkIds.map(id=>map[id])});expect(resolveDisplayRoute(out,next.displayRoute!).diagnostics).toEqual([]);
  for(const range of old.ranges){const copied=next.ranges.find(x=>x.id===map[range.id])!;expect(copied).toEqual({...range,id:map[range.id],...(range.originId===undefined?{}:{originId:map[range.originId]??range.originId})});}
 }
 expect(out.endpointLinks![0]).toEqual({...d.endpointLinks![0],id:map[link],a:{...d.endpointLinks![0].a,curveId:map[d.endpointLinks![0].a.curveId]},b:{...d.endpointLinks![0].b,curveId:map[d.endpointLinks![0].b.curveId]}});
 expect(out.displayIntervals!.flatMap(t=>t.ranges).filter(r=>r.originId===map.wrapped).length).toBeGreaterThan(0);expect(out.displayIntervals!.flatMap(t=>t.ranges).find(r=>r.id===map.history)!.originId).toBe('prior-deleted-range');expect(JSON.stringify(d)).toBe(before);
});

test('imported routed material coverage, source controls and fills match without binding to original target IDs',()=>{
 const {d,a}=fixture(),r=importArtworkLayers(d,d,[a],{includeDependencies:true}),map=r.idMap,out=r.document,old=d.displayIntervals![0],next=out.displayIntervals!.find(t=>t.id===map[old.id])!;
 const oldField=createDisplayRouteField(d,old.displayRoute!),newField=createDisplayRouteField(out,next.displayRoute!);expect(newField.geometry.shapes).toEqual(oldField.geometry.shapes);expect(newField.total).toBe(oldField.total);
 expect(displayField(out,displayPath(out,map.a1)).inkSpans).toEqual(displayField(d,displayPath(d,'a1')).inkSpans);
 for(const c of d.curves)expect(shapeOf(out,map[c.id])).toEqual(shapeOf(d,c.id));for(const f of d.fills)expect(fillGeometry(out,out.fills.find(x=>x.id===map[f.id])!).shapes).toEqual(fillGeometry(d,f).shapes);
 expect(out.displayIntervals!.slice(0,d.displayIntervals!.length)).toEqual(d.displayIntervals);expect(parseDrawing(out)).toEqual(out);
});

test('malformed routed references reject before ID allocation instead of copying a dangling route',()=>{
 const {d,a}=fixture(),bad=structuredClone(d);bad.displayIntervals![0].displayRoute!.throughLinkIds=['missing'];let generated=0;expect(()=>importArtworkLayers(emptyDrawing(),bad,[a],{includeDependencies:true,idFactory:()=>`id-${++generated}`})).toThrow();expect(generated).toBe(0);
});

test('fresh imported links retain the authored ARC brush and identical derived ink geometry',()=>{
 const source=fixture(),d=parseDrawing({...source.d,endpointLinks:source.d.endpointLinks!.map(l=>({...l,joinBrush:{kind:'ARC' as const,trimDistance:.03}}))}),r=importArtworkLayers(emptyDrawing(),d,[source.a],{includeDependencies:true}),map=r.idMap;
 expect(r.document.endpointLinks!.find(l=>l.id===map[source.link])!.joinBrush).toEqual({kind:'ARC',trimDistance:.03});
 const before=createDisplayRouteField(d,d.displayIntervals![0].displayRoute!),after=createDisplayRouteField(r.document,r.document.displayIntervals![0].displayRoute!);expect(before.diagnostics).toEqual([]);expect(after.diagnostics).toEqual([]);expect(after.geometry.shapes).toEqual(before.geometry.shapes);expect(after.brushes.links[0].linkId).toBe(map[source.link]);expect(after.brushes.links[0].geometry!.distance).toBe(before.brushes.links[0].geometry!.distance);
});
