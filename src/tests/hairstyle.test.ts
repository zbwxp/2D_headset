import {describe,it,expect,vi} from 'vitest';
import {defaultHairstyle,parseHairstyle,addHairStrands,regenerateHair,type Vec3} from '../domain/hairstyle/model';
import {generateHair,frontCubics,dot,hairFrontArcPoint,hairOpeningAngle} from '../domain/hairstyle/geometry';
import {projectHairCubics,projectHairContours} from '../domain/hairstyle/projection';
import {syncHairDrawing,projectHairDrawing} from '../domain/hairstyle/drawing';
import {seededHairRandom,centerAngles,hairCapacity} from '../domain/hairstyle/random';
import {strokeFor} from '../domain/drawing/strokes';
import {strokeInk,arcField} from '../domain/drawing/appearance';
import {addFrontBang} from '../domain/hairstyle/bake';
import {parseDrawing,shapeOf} from '../domain/drawing/model';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import {createEmptyProject} from '../app/emptyProject';
import {parseLandmarks} from '../domain/landmarks/persistence';
const wideHair=()=>{const h=defaultHairstyle();return syncHairDrawing({...h,leaf:{...h.leaf,leftAngle:90,rightAngle:90},bang:{version:1,mode:'SECTION',seed:23456}});};
const cubicAt=(c:ReturnType<typeof frontCubics>[0],t:number)=>[0,1].map(k=>(1-t)**3*c[0][k]+3*t*(1-t)**2*c[1][k]+3*t*t*(1-t)*c[2][k]+t**3*c[3][k]);

describe('spherical front bang and isolated hair layers',()=>{
 it('generates front heights, a shared lower random tip and 10–20% tails in both angle modes',()=>{
  for(const mode of ['SECTION','FRONT'] as const)for(const radii of [[1,1,1],[.5,2,.5],[2,.5,2]])for(const tipY of [-.8,-.2,.5]){
   const base=wideHair(),h=syncHairDrawing({...base,bang:{version:1,mode,seed:12345},net:{...base.net,radiusX:radii[0],radiusY:radii[1],radiusZ:radii[2]},leaf:{...base.leaf,tipY}}),g=generateHair(h),ids=h.generated!.centerIds!;
   const centers=ids.map(id=>h.drawing.curves.find(c=>c.id===id)!);
   expect(h.drawing.curves).toHaveLength(4);expect(centers[0].nodes[1]).toBe(centers[1].nodes[1]);
   const ends=g.arcs.map(a=>hairFrontArcPoint(a.cubic,a.inkRange[1]));
   expect(Math.abs(ends[0][1]-ends[1][1])).toBeLessThanOrEqual(.05*radii[0]+1e-8);
   const drop=Math.min(...ends.map(p=>p[1]))-g.centerTip[1];expect(drop).toBeGreaterThanOrEqual(.01*radii[0]-1e-8);expect(drop).toBeLessThanOrEqual(.05*radii[0]+1e-8);
   for(const a of g.centerArcs){
    expect(a.cubics).toHaveLength(1);expect(a.cubic[0]).toEqual(g.crown);expect(a.cubic[3]).toEqual(g.centerTip);
    expect(a.inkRange[0]).toBeGreaterThanOrEqual(.8);expect(a.inkRange[0]).toBeLessThanOrEqual(.9);expect(a.inkRange[1]).toBe(1);
    if(mode==='FRONT')expect(hairOpeningAngle(a.cubic)).toBeCloseTo(a.requestedAngle,4);
    expect(Math.abs(a.requestedAngle)).toBeGreaterThanOrEqual(20);expect(Math.abs(a.requestedAngle)).toBeLessThanOrEqual(40);
    for(const p of a.points)expect(p.reduce((sum,v,k)=>sum+(v/radii[k])**2,0)).toBeCloseTo(1,8);
   }
   const centerStroke=strokeFor(h.drawing,ids[0]);expect(centerStroke.segments.map(s=>s.id).sort()).toEqual([...ids].sort());
   const runs=strokeInk(h.drawing,centerStroke);expect(runs).toHaveLength(1);expect(runs[0].shapes).toHaveLength(2);
   for(const view of [{yaw:0,pitch:0},{yaw:45,pitch:30},{yaw:135,pitch:-45}]){const d=projectHairDrawing(h,g,view);expect(shapeOf(d,ids[0])[3]).toEqual(shapeOf(d,ids[1])[3]);expect(parseDrawing(d)).toEqual(d);}
  }
 });
 it('upgrades old two-boundary recipes once, without replacing strand IDs, private artwork or saved snapshots',()=>{
  const modern=addHairStrands(wideHair(),5,seededHairRandom('old')),center=new Set(modern.generated!.centerIds);
  const curves=modern.drawing.curves.filter(c=>!center.has(c.id)),used=new Set(curves.flatMap(c=>c.nodes));
  const oldDrawing=addFrontBang({...modern.drawing,curves,nodes:modern.drawing.nodes.filter(n=>used.has(n.id)),joins:[],layers:modern.drawing.layers.map(l=>({...l,items:l.items.filter(id=>!center.has(id))})),displayIntervals:modern.drawing.displayIntervals!.filter(t=>!center.has(t.anchor.id)).map(t=>({...t,ranges:[{...t.ranges[0],end:.99}]}))},frontCubics(modern));
  const {centerIds,...generated}=modern.generated!;void centerIds;
  const saved=saveDrawingSnapshot({drawing:oldDrawing},'原发型'),legacy={...modern,drawing:oldDrawing,generated:{...generated,curveIds:generated.curveIds.filter(id=>!center.has(id))},drawingSnapshots:saved.drawingSnapshots},before=JSON.stringify(legacy);
  const next=parseHairstyle(legacy);expect(parseHairstyle(legacy)).toEqual(next);expect(parseHairstyle(JSON.parse(JSON.stringify(next)))).toEqual(next);
  expect(next.interior).toEqual(modern.interior);expect(next.generated!.boundaryIds).toEqual(modern.generated!.boundaryIds);expect(next.generated!.centerIds).toHaveLength(2);
  expect(next.drawingSnapshots).toEqual(saved.drawingSnapshots);expect(next.drawing.layers[0]).toEqual(oldDrawing.layers[0]);
  for(const id of oldDrawing.layers[0].items)expect(next.drawing.curves.find(c=>c.id===id)).toEqual(oldDrawing.curves.find(c=>c.id===id));
  for(const c of next.interior!.curves){const r=next.drawing.displayIntervals!.find(t=>t.anchor.id===c.id)!.ranges[0];expect(r.start).toBeGreaterThanOrEqual(.8);expect(r.start).toBeLessThanOrEqual(.9);expect(r.end).toBe(1);}
  expect(JSON.stringify(legacy)).toBe(before);
 });
 it('projects the same 3D cubics continuously with the construction camera, without rewriting saved curves',()=>{
  const h=defaultHairstyle(),g=generateHair(h),saved=JSON.stringify(h),geometry=JSON.stringify(g);
  expect(projectHairCubics(g,{yaw:0,pitch:0})).toEqual(frontCubics(h));
  const side=projectHairCubics(g,{yaw:90,pitch:0}),above=projectHairCubics(g,{yaw:0,pitch:90});
  for(let i=0;i<2;i++)for(let j=0;j<4;j++){const p=g.arcs[i].cubic[j];expect(side[i][j][0]).toBeCloseTo(-p[2],12);expect(side[i][j][1]).toBeCloseTo(p[1],12);expect(above[i][j][1]).toBeCloseTo(-p[2],12);}
  for(const pitch of [-80,0,65])for(let yaw=-180;yaw<180;yaw+=5){const a=projectHairCubics(g,{yaw,pitch}),b=projectHairCubics(g,{yaw:yaw+.01,pitch});expect(a.flat(2).every(Number.isFinite)).toBe(true);expect(Math.max(...a.flat(2).map((v,i)=>Math.abs(v-b.flat(2)[i])))).toBeLessThan(.001);}
  expect(JSON.stringify(h)).toBe(saved);expect(JSON.stringify(g)).toBe(geometry);
 });
 it('reflects live angle, tip and net edits even when the private saved drawing is unchanged',()=>{
  const h=defaultHairstyle(),view={yaw:32,pitch:-15},base=projectHairCubics(generateHair(h),view);
  const left={...h,leaf:{...h.leaf,leftAngle:15}},right={...h,leaf:{...h.leaf,rightAngle:30}},tip={...h,leaf:{...h.leaf,tipX:-.08}},net={...h,net:{...h.net,radiusZ:1.5}};
  const l=projectHairCubics(generateHair(left),view),r=projectHairCubics(generateHair(right),view);
  expect(l[0]).not.toEqual(base[0]);expect(l[1]).toEqual(base[1]);expect(r[0]).toEqual(base[0]);expect(r[1]).not.toEqual(base[1]);
  const shifted=projectHairCubics(generateHair(tip),view);expect(shifted[0][3]).not.toEqual(base[0][3]);expect(shifted[0][3]).toEqual(shifted[1][3]);expect(shifted[0][0]).toEqual(base[0][0]);
  expect(projectHairCubics(generateHair(net),view)).not.toEqual(base);
  for(const edited of [left,right,tip,net])expect(edited.drawing).toBe(h.drawing);
 });
 it('has only two section arcs sharing A/B, at the requested crown/brow positions',()=>{
  const h=defaultHairstyle(),g=generateHair(h);
  expect(g.crown).toEqual([0,.8,.6]);expect(g.tip[0]).toBe(.03);expect(g.tip[1]).toBe(-.2);expect(g.arcs).toHaveLength(2);
  for(const a of g.arcs){expect(a.points[0]).toEqual(g.crown);expect(a.points.at(-1)).toEqual(g.tip);expect(a.points.every(p=>p[2]>0)).toBe(true);}
  const a=g.crown,b=g.tip,sides=g.arcs.map(a=>a.points[32]).map(p=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]));expect(sides[0]).toBeLessThan(0);expect(sides[1]).toBeGreaterThan(0);
 });
 it('every sampled point belongs to the full ellipsoid and its rotated plane',()=>{
  for(const leftAngle of [15,25,30])for(const tipX of [-.1,0,.1]){
   const base=defaultHairstyle(),h={...base,leaf:{tipX,leftAngle,rightAngle:30},net:{...base.net,center:[.1,.2,-.3] as Vec3,radiusX:1.6,radiusY:.8,radiusZ:1.2}},g=generateHair(h);
   for(const a of g.arcs)for(const p of a.points){const q=p.map((v,k)=>v-h.net.center[k]) as Vec3;expect(q.reduce((s,v,k)=>s+(v/[1.6,.8,1.2][k])**2,0)).toBeCloseTo(1,10);expect(dot(a.normal,q)).toBeCloseTo(a.planeOffset,10);}
   expect(dot(g.arcs[0].normal,g.arcs[1].normal)).toBeCloseTo(Math.cos((leftAngle+30)*Math.PI/180),10);
  }
 });
 it('approximates each projected circle with one editable cubic per hair and coincident, independent endpoints',()=>{
  const h=defaultHairstyle(),g=generateHair(h),d=h.drawing,cs=frontCubics(h);
  expect(d.layers.map(l=>l.name)).toEqual(['正刘海']);expect(d.curves).toHaveLength(4);expect(d.nodes).toHaveLength(7);expect(d.curves[0].nodes).not.toEqual(d.curves[1].nodes);expect(shapeOf(d,d.curves[0].id)[0]).toEqual(shapeOf(d,d.curves[1].id)[0]);
  for(let i=0;i<2;i++){expect(shapeOf(d,d.curves[i].id)).toEqual(cs[i]);for(let j=0;j<=40;j++){const p=cubicAt(cs[i],j/40),distance=Math.min(...g.arcs[i].points.map(q=>Math.hypot(p[0]-q[0],p[1]-q[1])));expect(distance).toBeLessThan(.012);}}
  expect(parseDrawing(d)).toEqual(d);
 });
 it('adds later generations without replacing manually edited hair layers',()=>{
  const h=defaultHairstyle(),base={...h.drawing,curves:h.drawing.curves.map(c=>({...c,visible:false}))},before=JSON.stringify(base),next=addFrontBang(base,frontCubics({...h,leaf:{...h.leaf,leftAngle:15}}));
  expect(JSON.stringify(base)).toBe(before);expect(next.curves.slice(0,4)).toEqual(base.curves);expect(next.layers).toHaveLength(2);expect(next.curves).toHaveLength(6);expect(parseDrawing(next)).toEqual(next);
 });
 it('retires legacy hair from project loading, preserving original drawing; standalone archived parser still validates',()=>{
  const base=createEmptyProject(),hair=defaultHairstyle(),saved=saveDrawingSnapshot({drawing:hair.drawing},'正刘海初始'),h={...hair,...saved};
  const p=parseLandmarks(JSON.stringify({...base,drawing:hair.drawing,hairstyle:h}));expect(p.hairstyle).toBeUndefined();expect(p.drawing).toEqual(hair.drawing);expect(parseHairstyle(h).drawingSnapshots).toEqual(h.drawingSnapshots);
  const old={version:1,generator:1,net:{...hair.net,hemisphereCutY:0,crownOffset:[.01,0,.1]},seed:123,frontSeed:123,sideSeed:123};
  const migrated=parseLandmarks(JSON.stringify({...base,drawing:hair.drawing,hairstyle:old}));expect(migrated.drawing).toEqual(hair.drawing);expect(migrated.hairstyle).toBeUndefined();
  expect(()=>parseHairstyle({...hair,leaf:{...hair.leaf,leftAngle:91}})).toThrow();expect(()=>parseHairstyle({...hair,net:{...hair.net,radiusX:Infinity}})).toThrow();
 });
 it('keeps both 90-degree sections continuous on scaled shells and at vertical tip extremes',()=>{
  for(const radii of [[1,1,1],[.5,2,.5],[2,.5,2],[1.6,.8,1.2]])for(const tipY of [-.8,-.2,.5])for(const tipX of [-.1,.1]){
   const base=defaultHairstyle(),h={...base,net:{...base.net,radiusX:radii[0],radiusY:radii[1],radiusZ:radii[2]},leaf:{tipX,tipY,leftAngle:90,rightAngle:90}},g=generateHair(h),near=generateHair({...h,leaf:{...h.leaf,leftAngle:89.999,rightAngle:89.999}});
   expect(parseHairstyle(h).leaf).toEqual(h.leaf);
   for(let i=0;i<2;i++){
    const arc=g.arcs[i];expect(arc.points[0]).toEqual(g.crown);expect(arc.points.at(-1)).toEqual(g.tip);
    for(let j=0;j<arc.points.length;j++){const p=arc.points[j];expect(p.reduce((s,v,k)=>s+(v/radii[k])**2,0)).toBeCloseTo(1,9);expect(dot(arc.normal,p)).toBeCloseTo(arc.planeOffset,9);expect(Math.hypot(...p.map((v,k)=>v-near.arcs[i].points[j][k]))).toBeLessThan(.002);}
    expect(arc.cubics).toHaveLength(1);expect(arc.cubic.flat().every(Number.isFinite)).toBe(true);for(const p of arc.cubic){expect(dot(arc.normal,p)).toBeCloseTo(arc.planeOffset,9);expect(Math.hypot(...p.map((v,k)=>v/radii[k]))).toBeLessThan(8);}expect(Math.max(...arc.cubic.flat().map((v,k)=>Math.abs(v-near.arcs[i].cubic.flat()[k])))).toBeLessThan(.002);
   }
  }
 });
 it('adds exactly N stable surface curves between the section angles, with tips bounded by the scatter radius',()=>{
  const base=defaultHairstyle();let i=0;const random=()=>((++i*37)%101)/101;
  const h=addHairStrands({...base,leaf:{...base.leaf,leftAngle:90,rightAngle:70,tipY:.5},net:{...base.net,radiusX:.5,radiusY:2,radiusZ:1.3},interior:{radius:.2,curves:[]}},12,random),g=generateHair(h);
  expect(g.interiorArcs).toHaveLength(12);expect(new Set(h.interior!.curves.map(c=>c.id)).size).toBe(12);
  for(const arc of g.interiorArcs){expect(arc.angle).toBeGreaterThan(-70);expect(arc.angle).toBeLessThan(90);expect(arc.points[0]).toEqual(g.crown);const tip=arc.points.at(-1)!;expect(Math.hypot(...tip.map((v,k)=>v-g.centerTip[k]))).toBeLessThanOrEqual(.2*h.net.radiusX+1e-10);for(const p of arc.points){expect((p[0]/.5)**2+(p[1]/2)**2+(p[2]/1.3)**2).toBeCloseTo(1,9);expect(dot(arc.normal,p)).toBeCloseTo(arc.planeOffset,9);}}
  expect(generateHair(h)).toEqual(g);expect(projectHairContours(g,{yaw:30,pitch:-12})).toHaveLength(16);
  const loaded=parseHairstyle(JSON.parse(JSON.stringify(h)));expect(loaded).toEqual(h);expect(generateHair(loaded)).toEqual(g);
  const more=addHairStrands(h,2,random);expect(more.interior!.curves.slice(0,12)).toEqual(h.interior!.curves);expect(more.drawing.curves).toHaveLength(18);expect(more.drawing.displayIntervals!.slice(0,16)).toEqual(h.drawing.displayIntervals);expect(base.interior).toBeUndefined();
 });
 it('keeps random angles and offsets while changing tip position/radius, and migrates missing Y',()=>{
  const base=wideHair(),h=addHairStrands(base,3,()=>.25),before=JSON.stringify(h.interior!.curves);
  const zero={...h,interior:{...h.interior!,radius:0}},g0=generateHair(zero);for(const arc of g0.interiorArcs)expect(arc.points.at(-1)).toEqual(g0.centerTip);
  const moved={...h,leaf:{...h.leaf,tipY:-.7,tipX:-.1}},g=generateHair(moved);expect(g.tip).not.toEqual(generateHair(h).tip);expect(JSON.stringify(moved.interior!.curves)).toBe(before);expect(moved.drawing).toBe(h.drawing);
  const legacy={...base,leaf:{tipX:base.leaf.tipX,leftAngle:base.leaf.leftAngle,rightAngle:base.leaf.rightAngle}};expect(generateHair(parseHairstyle(legacy)).arcs).toEqual(generateHair(base).arcs);
  expect(()=>parseHairstyle({...h,leaf:{...h.leaf,tipY:2}})).toThrow();expect(()=>parseHairstyle({...h,interior:{...h.interior!,radius:-1}})).toThrow();expect(()=>addHairStrands(h,101)).toThrow();expect(()=>addHairStrands(h,1.5)).toThrow();
 });
 it('stratifies outside the central pair with a five degree minimum including boundaries',()=>{
  for(let seed=1;seed<=15;seed++){
   const h=addHairStrands({...wideHair(),bang:{version:1,mode:'SECTION',seed}},50,seededHairRandom(String(seed))),g=generateHair(h),center=centerAngles(h.bang);
   expect(h.interior!.curves.length).toBe(hairCapacity(h.leaf,h.bang).reduce((a,b)=>a+b,0));
   for(const side of [0,1]){
    const angles=[center[side],...g.interiorArcs.map(a=>a.requestedAngle).filter(a=>side===0?a>0:a<0).map(Math.abs),90].sort((a,b)=>a-b);
    for(let i=1;i<angles.length;i++)expect(angles[i]-angles[i-1]).toBeGreaterThanOrEqual(5-1e-8);
   }
   const narrow=syncHairDrawing({...h,leaf:{...h.leaf,leftAngle:15,rightAngle:15}}),hidden=projectHairDrawing(narrow,generateHair(narrow),{yaw:0,pitch:0});
   expect(narrow.interior).toEqual(h.interior);expect(narrow.generated).toEqual(h.generated);expect(generateHair(narrow).interiorArcs).toHaveLength(0);
   for(const c of h.interior!.curves)expect(hidden.curves.find(x=>x.id===c.id)?.visible).toBe(false);
   const restored=syncHairDrawing({...narrow,leaf:h.leaf});expect(generateHair(restored)).toEqual(g);
  }
 });
 it('keeps physical trim locations on the same cubic parameters through arbitrary camera projections',()=>{
  const h=addHairStrands(wideHair(),5,seededHairRandom('drawing')),before=JSON.stringify(h),ids=h.drawing.curves.map(c=>c.id),g=generateHair(h);
  for(const yaw of [-90,-30,0,45,90,180])for(const pitch of [-60,0,60]){
   const d=projectHairDrawing(h,g,{yaw,pitch});expect(d.curves.map(c=>c.id)).toEqual(ids);expect(parseDrawing(d)).toEqual(d);
   for(const [i,c] of d.curves.entries()){
    const shape=shapeOf(d,c.id);expect(shape).toEqual(projectHairContours(g,{yaw,pitch})[i][0]);expect(projectHairContours(g,{yaw,pitch})[i]).toHaveLength(1);
    const r=d.displayIntervals!.find(t=>t.anchor.id===c.id)!.ranges[0],saved=h.drawing.displayIntervals!.find(t=>t.anchor.id===c.id)!.ranges[0];
    for(const end of ['start','end'] as const)expect(arcField([shape]).at(r[end]).t).toBeCloseTo(arcField([shapeOf(h.drawing,c.id)]).at(saved[end]).t,8);
    if(h.generated!.centerIds!.includes(c.id))continue;
    const runs=strokeInk(d,strokeFor(d,c.id));expect(runs).toHaveLength(1);expect(runs[0].shapes).toHaveLength(1);
    const expected=arcField([shape]).at(r.end).p;expect(Math.hypot(...runs[0].shapes[0][3].map((v,k)=>v-expected[k]))).toBeLessThan(1e-8);
   }
  }
  expect(JSON.stringify(h)).toBe(before);
 });
 it('switches angle interpretation without resampling, refitting the requested front tangent angles',()=>{
  const section=addHairStrands(wideHair(),8,seededHairRandom('mode'));
  const front=syncHairDrawing({...section,bang:{...section.bang!,mode:'FRONT'}}),g=generateHair(front);
  expect(front.interior).toBe(section.interior);expect(front.generated).toEqual(section.generated);
  for(const a of [...g.arcs,...g.centerArcs,...g.interiorArcs])expect(hairOpeningAngle(a.cubic)).toBeCloseTo(a.requestedAngle,4);
  expect(g.arcs).not.toEqual(generateHair(section).arcs);
  const back=syncHairDrawing({...front,bang:{...front.bang!,mode:'SECTION'}});expect(back).toEqual(section);
  const shifted=syncHairDrawing({...front,leaf:{...front.leaf,tipX:-.08,tipY:.3}});
  for(const a of generateHair(shifted).centerArcs)expect(hairOpeningAngle(a.cubic)).toBeCloseTo(a.requestedAngle,4);
  expect(parseHairstyle(JSON.parse(JSON.stringify(front)))).toEqual(front);
  expect(()=>parseHairstyle({...front,bang:{...front.bang!,mode:'BAD'}})).toThrow();
 });
 it('rerolls the tip in both axes and interval lengths only on regeneration',()=>{
  const base=addHairStrands(wideHair(),5,seededHairRandom('base')),x=new Set<number>(),y=new Set<number>();
  for(const seed of ['one','two','three','four']){
   const h=regenerateHair(base,seededHairRandom(seed)),g=generateHair(h);x.add(g.centerTip[0]);y.add(g.centerTip[1]);
   for(const a of g.interiorArcs){expect(a.inkRange[0]).toBeGreaterThanOrEqual(.8);expect(a.inkRange[0]).toBeLessThanOrEqual(.9);expect(a.inkRange[1]).toBe(1);}
   expect(h.generated).toEqual(base.generated);expect(generateHair(h)).toEqual(g);expect(parseHairstyle(h)).toEqual(h);
   const otherView=projectHairDrawing(h,g,{yaw:45,pitch:30});expect(otherView.curves).not.toEqual(h.drawing.curves);expect(generateHair(h)).toEqual(g);
  }
  expect(x.size).toBe(4);expect(y.size).toBe(4);
 });
 it('regenerates samples without replacing identities and preserves captured view snapshots on clear',()=>{
  const h=addHairStrands(wideHair(),8,seededHairRandom('before')),d=projectHairDrawing(h,generateHair(h),{yaw:35,pitch:-12});
  const saved=saveDrawingSnapshot({drawing:d},'35 degrees'),withSnapshot={...h,drawingSnapshots:saved.drawingSnapshots};
  const next=regenerateHair(withSnapshot,seededHairRandom('after'));
  expect(next.generated).toEqual(h.generated);expect(next.interior!.curves.map(c=>c.id)).toEqual(h.interior!.curves.map(c=>c.id));expect(next.interior!.curves).not.toEqual(h.interior!.curves);
  expect(next.drawing.displayIntervals!.map(t=>[t.id,t.ranges[0].id])).toEqual(h.drawing.displayIntervals!.map(t=>[t.id,t.ranges[0].id]));expect(next.drawing.displayIntervals).not.toEqual(h.drawing.displayIntervals);
  const cleared=syncHairDrawing({...next,interior:{...next.interior!,curves:[]}});expect(cleared.drawing.curves).toHaveLength(4);expect(cleared.drawing.displayIntervals).toHaveLength(4);expect(cleared.drawing.nodes).toHaveLength(7);expect(parseHairstyle(cleared)).toEqual(cleared);
  expect(cleared.drawingSnapshots).toBe(saved.drawingSnapshots);expect(cleared.drawingSnapshots!.items[0].drawing).toEqual(d);
 });
 it('migrates legacy curve randomness once with deterministic intervals and without changing other layers',()=>{
  const base=wideHair(),oldDrawing=addFrontBang(undefined,frontCubics(base)),privateExtra=addFrontBang(oldDrawing,frontCubics(base));
  privateExtra.layers[0].name='手动画稿';const {generated,...rest}=base;void generated;
  const legacy={...rest,drawing:privateExtra,interior:{radius:.04,curves:[{id:'legacy-hair',angleT:.5,offset:[0,0]}]}};
  const a=parseHairstyle(legacy),b=parseHairstyle(legacy);expect(a).toEqual(b);expect(parseHairstyle(JSON.parse(JSON.stringify(a)))).toEqual(a);
  expect(a.drawing.layers[0]).toEqual(privateExtra.layers[0]);for(const id of privateExtra.layers[0].items)expect(a.drawing.curves.find(c=>c.id===id)).toEqual(privateExtra.curves.find(c=>c.id===id));
  expect(Math.abs(generateHair(a).interiorArcs[0].requestedAngle)).toBeGreaterThan(20);
 });
 it('routes edits, snapshots, undo and redo exclusively to the hair document',async()=>{
  vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
  try{
   const {useEditor}=await import('../app/store'),{hairWorkspace,hairDrawingSession}=await import('../ui/drawing/workspace'),{useDrawing}=await import('../ui/drawing/session');
   const e=()=>useEditor.getState(),hair=defaultHairstyle(),main=saveDrawingSnapshot({drawing:defaultHairstyle().drawing},'主画稿');e().load({...createEmptyProject(),...main});e().setHairstyle(hair);e().endEdit(); // Exercise the archived adapter explicitly; production loading retires hair.
   const before=e().project,edited={...hair.drawing,layers:hair.drawing.layers.map(l=>({...l,name:'发型独立修改'}))};hairWorkspace.commitDrawing(edited);
   expect(e().project.hairstyle?.drawing).toBe(edited);expect(e().project.drawing).toBe(before.drawing);expect(e().project.drawingSnapshots).toBe(before.drawingSnapshots);
   hairWorkspace.commitDrawingSnapshot(s=>saveDrawingSnapshot(s,'发型快照'));expect(e().project.hairstyle?.drawingSnapshots?.items[0].name).toBe('发型快照');expect(e().project.drawingSnapshots).toBe(before.drawingSnapshots);expect(e().project.poseRecording).toBe(before.poseRecording);
   e().undo();expect(e().project.hairstyle?.drawingSnapshots).toBeUndefined();e().undo();expect(e().project.hairstyle?.drawing).toBe(hair.drawing);expect(e().project.drawing).toBe(before.drawing);e().redo();expect(e().project.hairstyle?.drawing).toBe(edited);
   const mainSelection=useDrawing.getState().selection;hairDrawingSession.getState().set({selection:{ids:[edited.curves[0].id]},showFills:false});expect(useDrawing.getState().selection).toBe(mainSelection);expect(useDrawing.getState().showFills).toBe(true);
  }finally{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();}
 });
});
