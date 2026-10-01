import {describe,test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import * as paint from '../domain/drawing/paintCommands';
import {emptyDrawing,parseDrawing,type Cubic,type DrawingDocument as Doc,type Point2,type StrokeDisplayIntervals,type DisplayInterval} from '../domain/drawing/model';
import {displayField,localDisplayPath,displayPath} from '../domain/drawing/displayIntervals';
import {createDisplayRouteField,resolveDisplayRoute} from '../domain/drawing/displayRoutes';
import {adoptDisplayRoute,detachDisplayRoute} from '../domain/drawing/displayRouteAuthoring';
import {fillGeometry} from '../domain/drawing/appearance';
import {depthPaintBatches} from '../domain/drawing/depth';
const line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
function fixture(){
 let d=emptyDrawing();
 for(const [name,points] of [['a',[[-1,0],[0,0],[-1,1]]],['b',[[0,0],[0,1],[1,0]]]] as const){
  d=c.addLayer(d,name);const layer=d.layers[0].id;
  for(let i=0;i<3;i++)d=c.createCurve(d,layer,line([...points[i]],[...points[(i+1)%3]]),.01,name+i,name+i);
  for(let i=0;i<3;i++)d=c.connect(d,{curveId:name+i,end:1},{curveId:name+((i+1)%3),end:0},'POSITION');
  d=paint.createFill(d,[name+'0',name+'1',name+'2'],'white');
 }
 d=c.linkEndpoints(d,{curveId:'a0',end:1},{curveId:'b0',end:0});return {d,id:d.endpointLinks![0].id};
}
const range=(id:string,start:number,end:number,mode:'SHOW'|'HIDE'='SHOW',enabled?:boolean):DisplayInterval=>({id,start,end,mode,...(enabled===undefined?{}:{enabled}),inkEnds:[{taper:.017,extension:.003},{taperWidthScale:3,extension:.007}]});
const track=(id:string,anchor:string,ranges:DisplayInterval[],reverse=false):StrokeDisplayIntervals=>({id,anchor:{id:anchor,reverse},ranges});
const has=(mask:{start:number;end:number}[]|undefined,s:number)=>!mask||mask.some(r=>s>r.start-1e-9&&s<r.end+1e-9);
function sameCoverage(before:Doc,after:Doc){
 const target=displayField(after,displayPath(after,'a0')),routed=createDisplayRouteField(after,after.displayIntervals!.find(t=>t.displayRoute)!.displayRoute!);
 for(const curve of before.curves){
  const path=localDisplayPath(before,curve.id),old=displayField(before,path),material=createDisplayRouteField(before,{seed:path,throughLinkIds:[]});
  for(let i=0;i<137;i++){
   const ref={kind:'curve' as const,curveId:curve.id,t:(i+.314159)/137},a=material.positionOf(ref),b=routed.positionOf(ref);if(a===undefined||b===undefined)continue;
   expect(has(target.inkSpans,b),`${curve.id} t=${ref.t}`).toBe(has(old.inkSpans,a));
  }
 }
}
function sameLocalCoverage(before:Doc,after:Doc){
 for(const curve of before.curves){
  const beforePath=localDisplayPath(before,curve.id),afterPath=localDisplayPath(after,curve.id),a=displayField(before,beforePath),b=displayField(after,afterPath),aa=createDisplayRouteField(before,{seed:beforePath,throughLinkIds:[]}),bb=createDisplayRouteField(after,{seed:afterPath,throughLinkIds:[]});
  for(let i=0;i<83;i++){const material={kind:'curve' as const,curveId:curve.id,t:(i+.2718)/83};expect(has(b.inkSpans,bb.positionOf(material)!)).toBe(has(a.inkSpans,aa.positionOf(material)!));}
 }
}
describe('explicit adoption of per-stroke display ranges',()=>{
 test('adopting after authoring a SHOW preserves physical coverage and adds editable baseline for the other loop',()=>{
  const {d,id}=fixture(),source={...d,displayIntervals:[track('ta','a0',[range('ra',.07,.2)])]},snapshot=JSON.stringify(source),out=adoptDisplayRoute(source,'ta',id);
  sameCoverage(source,out.document);expect(out.document.endpointLinks![0].throughDisplay).toBe(true);expect(out.affectedTrackIds).toEqual(['ta']);expect(out.generatedRangeIds).toHaveLength(1);
  const ranges=out.document.displayIntervals![0].ranges;expect(ranges[0].id).toBe('ra');expect(ranges[1]).toMatchObject({name:'保留原可见范围',mode:'SHOW'});expect(ranges[0].inkEnds).toEqual(source.displayIntervals[0].ranges[0].inkEnds);
  expect(JSON.stringify(source)).toBe(snapshot);expect(parseDrawing(out.document)).toEqual(out.document);
 });
 test('two independently authored SHOW tracks retain IDs and union-equivalent original coverage',()=>{
  const {d,id}=fixture(),source={...d,displayIntervals:[track('ta','a0',[range('ra',.1,.2)]),track('tb','b0',[range('rb',.2,.6)])]},out=adoptDisplayRoute(source,'ta',id);
  sameCoverage(source,out.document);expect(out.generatedRangeIds).toEqual([]);expect(out.affectedTrackIds).toEqual(['ta','tb']);expect(out.document.displayIntervals!.map(t=>t.id)).toEqual(['ta','tb']);expect(out.document.displayIntervals!.every(t=>JSON.stringify(t.displayRoute)===JSON.stringify(out.route))).toBe(true);
 });
 test('HIDE-only source paths keep their implicit full base without unnecessary baseline SHOW',()=>{
  const {d,id}=fixture(),source={...d,displayIntervals:[track('ta','a0',[range('ha',.2,.8,'HIDE')]),track('tb','b0',[range('hb',.1,.3,'HIDE')])]},out=adoptDisplayRoute(source,'ta',id);
  sameCoverage(source,out.document);expect(out.document.displayIntervals!.flatMap(t=>t.ranges).every(r=>r.mode==='HIDE')).toBe(true);expect(out.document.displayIntervals!.flatMap(t=>t.ranges).some(r=>r.name==='保留原可见范围')).toBe(false);
 });
 test('HIDE-only plus SHOW preserves the full implicit base and retains original HIDE toggling',()=>{
  const {d,id}=fixture(),source={...d,displayIntervals:[track('ta','a0',[range('ha',.2,.8,'HIDE')]),track('tb','b0',[range('sb',.1,.3)])]},out=adoptDisplayRoute(source,'ta',id);
  sameCoverage(source,out.document);expect(out.document.displayIntervals!.flatMap(t=>t.ranges).some(r=>r.name==='保留原可见范围')).toBe(true);
  const disable=(doc:Doc)=>({...doc,displayIntervals:doc.displayIntervals!.map(t=>({...t,ranges:t.ranges.map(r=>r.id==='ha'||r.originId==='ha'?{...r,enabled:false}:r)}))});sameCoverage(disable(source),disable(out.document));
 });
 test('disabled ranges remain disabled and do not accidentally become a SHOW base',()=>{
  const {d,id}=fixture(),source={...d,displayIntervals:[track('ta','a0',[range('disabled',.1,.7,'SHOW',false),range('hidden',.3,.5,'HIDE')]),track('tb','b0',[range('other',.2,.6)])]},out=adoptDisplayRoute(source,'ta',id);
  sameCoverage(source,out.document);const related=out.document.displayIntervals!.flatMap(t=>t.ranges).filter(r=>r.id==='disabled'||r.originId==='disabled');expect(related.every(r=>r.enabled===false&&r.mode==='SHOW')).toBe(true);
  expect(related.flatMap(r=>r.inkEnds??[])).toEqual(expect.arrayContaining(source.displayIntervals[0].ranges[0].inkEnds!));
 });
 test('a wrapped old closed range splits without revealing inserted material; extras retain authored origin',()=>{
  const {d,id}=fixture(),source={...d,displayIntervals:[track('ta','a1',[range('wrapped',.9,.2)]),track('tb','b0',[range('b-hide',0,1,'HIDE')])]},out=adoptDisplayRoute(source,'ta',id);
  sameCoverage(source,out.document);const ranges=out.document.displayIntervals!.find(t=>t.id==='ta')!.ranges;expect(ranges[0].id).toBe('wrapped');expect(ranges.filter(r=>r.originId==='wrapped').length).toBeGreaterThan(0);expect(out.generatedRangeIds).toEqual(expect.arrayContaining(ranges.filter(r=>r.originId==='wrapped').map(r=>r.id)));
 });
 test('reverse anchor and unordered open range conventions keep their original visible material',()=>{
  const {d,id}=fixture(),source={...d,displayIntervals:[track('ta','a0',[range('reverse',.07,.4)],true),track('tb','b0',[range('bhide',.6,.2,'HIDE')])]},out=adoptDisplayRoute(source,'ta',id);sameCoverage(source,out.document);
  expect(out.route.seed.segments.find(u=>u.id==='a0')!.reverse).toBe(true);
 });
 test('full loops do not awaken dormant terminal styles on newly open route boundaries',()=>{
  const {d,id}=fixture(),source={...d,displayIntervals:[track('ta','a0',[range('full',0,1)]),track('tb','b0',[range('bhide',0,1,'HIDE')])]},out=adoptDisplayRoute(source,'ta',id);sameCoverage(source,out.document);
  expect(out.document.displayIntervals![0].ranges.find(r=>r.id==='full')!.inkEnds).toEqual([{taper:0,extension:0},{taper:0,extension:0}]);
 });
 test.each(['SHOW','HIDE'] as const)('explicit fullLoop at an arbitrary anchor migrates and detaches complete %s material without carrying a whole-frame flag',mode=>{
  const {d,id}=fixture(),source={...d,displayIntervals:[track('ta','a0',[{...range('full',.3,.3,mode),fullLoop:true}]),track('tb','b0',[range('bhide',.2,.6,'HIDE')])]},out=adoptDisplayRoute(source,'ta',id);
  sameCoverage(source,out.document);expect(out.document.displayIntervals!.flatMap(t=>t.ranges).every(r=>r.fullLoop===undefined)).toBe(true);expect(parseDrawing(out.document)).toEqual(out.document);
  const detached=detachDisplayRoute(out.document,'ta').document;sameLocalCoverage(source,detached);expect(detached.displayIntervals!.flatMap(t=>t.ranges).every(r=>r.fullLoop===undefined)).toBe(true);expect(parseDrawing(detached)).toEqual(detached);
 });
 test('zero-length inactive markers preserve their source material position',()=>{
  const {d,id}=fixture(),source={...d,displayIntervals:[track('ta','a0',[range('empty',.1,.1,'HIDE',false)])]},out=adoptDisplayRoute(source,'ta',id),r=out.document.displayIntervals![0].ranges[0];
  sameCoverage(source,out.document);expect(r.start).toBe(r.end);expect(r.enabled).toBe(false);expect(r.id).toBe('empty');
 });
 test('CURVE scoped tracks remain local, unchanged, while routed coverage respects their old local cuts',()=>{
  const {d,id}=fixture(),scoped={...track('local','a1',[range('local-cut',.3,.7,'HIDE')]),scope:'CURVE' as const},source={...d,displayIntervals:[track('ta','a0',[range('show',.1,.8)]),scoped]},out=adoptDisplayRoute(source,'ta',id);
  sameCoverage(source,out.document);expect(out.document.displayIntervals![1]).toBe(scoped);expect(out.affectedTrackIds).toEqual(['ta']);expect(()=>adoptDisplayRoute(source,'local',id)).toThrow(/单曲线/);
 });
 test('repeated adoption does not duplicate baseline ranges or their IDs',()=>{
  const {d,id}=fixture(),source={...d,displayIntervals:[track('ta','a0',[range('show',.1,.3)])]},first=adoptDisplayRoute(source,'ta',id),second=adoptDisplayRoute(first.document,'ta',id);
  expect(second.generatedRangeIds).toEqual([]);expect(second.document.displayIntervals!.flatMap(t=>t.ranges).map(r=>r.id)).toEqual(first.document.displayIntervals!.flatMap(t=>t.ranges).map(r=>r.id));
  expect(second.document.displayIntervals!.flatMap(t=>t.ranges).filter(r=>r.name==='保留原可见范围')).toHaveLength(1);
 });
 test('source geometry, two independent fills and original depth slots are unchanged',()=>{
  const {d,id}=fixture(),source={...d,displayIntervals:[track('ta','a0',[range('show',.1,.3)])]},fills=source.fills.map(f=>fillGeometry(source,f)),depth=depthPaintBatches(source),out=adoptDisplayRoute(source,'ta',id).document;
  expect(out.curves).toBe(source.curves);expect(out.nodes).toBe(source.nodes);expect(out.layers).toBe(source.layers);expect(out.fills).toBe(source.fills);expect(out.joins).toBe(source.joins);expect(out.fills.map(f=>fillGeometry(out,f))).toEqual(fills);
  const after=depthPaintBatches(out);expect(after.filter(b=>b.item.kind==='fill')).toEqual(depth.filter(b=>b.item.kind==='fill'));
  for(const original of depth.filter(b=>b.item.kind==='stroke'))expect(after.find(b=>b.item.id===original.item.id)!.position).toBe(original.position);
 });
 test('implicit open-path baseline and full SHOW inherit the original exterior末端笔触',()=>{
  let d=c.addLayer(emptyDrawing(),'A');d=c.createCurve(d,d.layers[0].id,line([-1,0],[0,0]),.01,'A','a');d=c.addLayer(d,'B');d=c.createCurve(d,d.layers[0].id,line([0,0],[1,0]),.01,'B','b');d=c.linkEndpoints(d,{curveId:'a',end:1},{curveId:'b',end:0});
  d=paint.setInkEnd(d,'a',0,{taper:.12,extension:.03});d=paint.setInkEnd(d,'b',1,{taper:.2,extension:.04});d={...d,displayIntervals:[track('t','a',[{id:'show',mode:'SHOW',start:0,end:1}])]};
  const out=adoptDisplayRoute(d,'t',d.endpointLinks![0].id),field=displayField(out.document,resolveDisplayRoute(out.document,out.route).path);
  expect(field.inkSpans).toHaveLength(1);expect(field.inkSpans![0].ends).toEqual([{taper:.12,extension:.03},{taper:.2,extension:.04}]);
  const baseline=out.document.displayIntervals![0].ranges.find(r=>r.name==='保留原可见范围')!;expect(baseline.inkEnds![1]).toEqual({taper:.2,extension:.04});
 });
});

describe('explicit brush adoption limits and atomic failure',()=>{
 test('HIDE-only hidden closures migrate while a newly requested ARC generates the visible chin brush',()=>{
  const {d,id}=fixture();const tracks=['a','b'].map(name=>track('t'+name,name+'0',[range('h'+name,0,1,'HIDE')]));
  let source:Doc={...d,displayIntervals:tracks,endpointLinks:d.endpointLinks!.map(l=>({...l,joinBrush:{kind:'ARC',trimDistance:.2}}))};
  source={...source,displayIntervals:tracks.map(t=>{
   const path=localDisplayPath(source,t.anchor.id),f=displayField(source,path),material=createDisplayRouteField(source,{seed:path,throughLinkIds:[]}),position=material.positionOf({kind:'curve',curveId:t.anchor.id,t:1})!;
   return {...t,ranges:t.ranges.map(r=>({...r,start:f.relative(t,position),end:1}))};
  })};
  const snapshot=JSON.stringify(source),out=adoptDisplayRoute(source,'ta',id),field=createDisplayRouteField(out.document,out.route);
  expect(field.brushes.links[0].resolved).toBe(true);expect(field.geometry.pieces.some(p=>p.joinId)).toBe(true);expect(out.document.displayIntervals!.flatMap(t=>t.ranges).every(r=>r.mode==='HIDE')).toBe(true);expect(JSON.stringify(source)).toBe(snapshot);
 });
 test('an arbitrary authored cut in the new ARC influence area rejects without partial writes',()=>{
  const {d,id}=fixture(),source:Doc={...d,endpointLinks:d.endpointLinks!.map(l=>({...l,joinBrush:{kind:'ARC',trimDistance:.2}})),displayIntervals:[track('ta','a0',[range('show',.1,.3)])]},snapshot=JSON.stringify(source);
  expect(()=>adoptDisplayRoute(source,'ta',id)).toThrow(/材料|接笔/);expect(JSON.stringify(source)).toBe(snapshot);expect(source.endpointLinks![0].throughDisplay).toBeUndefined();
 });
 test('unsupported widths, locks, unknown tracks/links leave source untouched',()=>{
  const {d,id}=fixture(),source={...d,displayIntervals:[track('ta','a0',[range('show',.1,.3)])]},snapshot=JSON.stringify(source);
  expect(()=>adoptDisplayRoute({...source,curves:source.curves.map(c=>c.id==='b1'?{...c,width:.02}:c)},'ta',id)).toThrow(/线宽/);
  expect(()=>adoptDisplayRoute({...source,curves:source.curves.map(c=>c.id==='b1'?{...c,locked:true}:c)},'ta',id)).toThrow(/锁定/);
  expect(()=>adoptDisplayRoute(source,'missing',id)).toThrow(/不存在/);expect(()=>adoptDisplayRoute(source,'ta','missing')).toThrow(/不存在/);expect(JSON.stringify(source)).toBe(snapshot);
 });
});

describe('safe explicit release to original local paths',()=>{
 test('releases the whole shared component and preserves independent local coverage/fills/geometry',()=>{
  const {d,id}=fixture(),source={...d,displayIntervals:[track('ta','a0',[range('show-a',.1,.4)]),track('tb','b0',[range('hide-b',.1,.4,'HIDE')])]},adopted=adoptDisplayRoute(source,'ta',id).document,snapshot=JSON.stringify(adopted),out=detachDisplayRoute(adopted,'ta');
  sameLocalCoverage(source,out.document);expect(out.document.displayIntervals!.every(t=>!t.displayRoute)).toBe(true);expect(out.affectedTrackIds).toEqual(['ta','tb']);expect(out.document.endpointLinks![0].throughDisplay).toBe(false);
  expect(out.document.endpointLinks![0].a).toEqual(adopted.endpointLinks![0].a);expect(out.document.curves).toBe(adopted.curves);expect(out.document.nodes).toBe(adopted.nodes);expect(out.document.fills).toBe(adopted.fills);expect(JSON.stringify(adopted)).toBe(snapshot);expect(parseDrawing(out.document)).toEqual(out.document);
 });
 test('routed visible ranges spanning multiple local paths create explicit local tracks without duplicate IDs',()=>{
  const {d,id}=fixture(),source={...d,displayIntervals:[track('ta','a0',[range('show',.1,.4)])]},adopted=adoptDisplayRoute(source,'ta',id).document;
  const all={...adopted,displayIntervals:adopted.displayIntervals!.map(t=>({...t,ranges:[range('whole',.1,.9)]}))},out=detachDisplayRoute(all,'ta');
  expect(out.generatedTrackIds.length).toBeGreaterThan(0);const ranges=out.document.displayIntervals!.flatMap(t=>t.ranges);expect(ranges.filter(r=>r.id==='whole')).toHaveLength(1);expect(ranges.some(r=>r.originId==='whole')).toBe(true);expect(new Set(ranges.map(r=>r.id)).size).toBe(ranges.length);expect(parseDrawing(out.document)).toEqual(out.document);
 });
 test('a component with no global SHOW coverage stays hidden via an editable empty SHOW retention range',()=>{
  const {d,id}=fixture(),source={...d,displayIntervals:[track('ta','a0',[range('show',.1,.2)])]},adopted=adoptDisplayRoute(source,'ta',id).document;
  const noBaseline={...adopted,displayIntervals:adopted.displayIntervals!.map(t=>({...t,ranges:t.ranges.filter(r=>r.name!=='保留原可见范围')}))},out=detachDisplayRoute(noBaseline,'ta');
  const b=displayField(out.document,localDisplayPath(out.document,'b0'));expect(b.inkSpans).toEqual([]);expect(out.document.displayIntervals!.flatMap(t=>t.ranges).some(r=>r.name==='保留原可见范围'&&r.start===r.end&&r.mode==='SHOW')).toBe(true);
 });
 test('disabled and CURVE scoped tracks survive release without activating or retargeting them',()=>{
  const {d,id}=fixture(),local={...track('local','a1',[range('local-hide',.1,.3,'HIDE')]),scope:'CURVE' as const},source={...d,displayIntervals:[track('ta','a0',[range('show',.1,.2),range('off',.6,.7,'HIDE',false)]),local]},adopted=adoptDisplayRoute(source,'ta',id).document,out=detachDisplayRoute(adopted,'ta');
  expect(out.document.displayIntervals!.find(t=>t.id==='local')).toBe(local);expect(out.document.displayIntervals!.flatMap(t=>t.ranges).filter(r=>r.id==='off'||r.originId==='off').every(r=>r.enabled===false)).toBe(true);sameLocalCoverage(source,out.document);
 });
 test('HIDE-only closure coverage can release a cross-layer ARC while retaining its saved brush on the geometric link',()=>{
  const {d,id}=fixture(),t=['a','b'].map(n=>track('t'+n,n+'0',[range('h'+n,1/(2+Math.SQRT2),1,'HIDE')])),source:Doc={...d,displayIntervals:t,endpointLinks:d.endpointLinks!.map(l=>({...l,joinBrush:{kind:'ARC',trimDistance:.2}}))};
  const adopted=adoptDisplayRoute(source,'ta',id).document,out=detachDisplayRoute(adopted,'ta');expect(out.document.displayIntervals!.every(t=>!t.displayRoute)).toBe(true);expect(out.document.endpointLinks![0]).toMatchObject({throughDisplay:false,joinBrush:{kind:'ARC',trimDistance:.2}});sameLocalCoverage(source,out.document);
 });
 test('explicit coverage of a new cross-layer ARC rejects release atomically',()=>{
  const {d,id}=fixture(),source:Doc={...d,displayIntervals:[track('ta','a0',[range('h',1/(2+Math.SQRT2),1,'HIDE')])],endpointLinks:d.endpointLinks!.map(l=>({...l,joinBrush:{kind:'ARC',trimDistance:.2}}))},adopted=adoptDisplayRoute(source,'ta',id).document;
  const full={...adopted,displayIntervals:adopted.displayIntervals!.map(t=>({...t,ranges:[range('new-full',0,1)]}))},snapshot=JSON.stringify(full);expect(()=>detachDisplayRoute(full,'ta')).toThrow(/跨层接笔/);expect(JSON.stringify(full)).toBe(snapshot);
 });
 test('release of a local track is a no-op and locked routed members reject without partial writes',()=>{
  const {d,id}=fixture(),source={...d,displayIntervals:[track('ta','a0',[range('show',.1,.2)])]};expect(detachDisplayRoute(source,'ta').document).toBe(source);
  const adopted=adoptDisplayRoute(source,'ta',id).document,locked={...adopted,curves:adopted.curves.map(c=>c.id==='b1'?{...c,locked:true}:c)},snapshot=JSON.stringify(locked);expect(()=>detachDisplayRoute(locked,'ta')).toThrow(/锁定/);expect(JSON.stringify(locked)).toBe(snapshot);
 });
});
