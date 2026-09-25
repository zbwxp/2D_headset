import {test,expect} from 'vitest';
import * as c from '../domain/drawing/commands';
import {emptyDrawing,parseDrawing,shapeOf,nodeAt,curveById,members,sub,length,add,type DrawingDocument as Doc,type Cubic,type Endpoint} from '../domain/drawing/model';
import {strokes,strokeFor,strokeIds,strokePath} from '../domain/drawing/strokes';
import {evaluate} from '../domain/geometry/bezier';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {parseLandmarks} from '../domain/landmarks/persistence';
const a:Endpoint={curveId:'a',end:1},b:Endpoint={curveId:'b',end:0};
const shape:Cubic=[[-.8,0],[-.5,.6],[-.2,.4],[0,0]];
function base(){let d=c.addLayer(emptyDrawing(),'Eye');for(const [id,dy] of [['a',0],['b',.7],['c',-.6],['d',-1.2]] as const)d=c.createCurve(d,d.layers[0].id,shape.map(([x,y])=>[x,y+dy]) as Cubic,.008,id,id);return d;}
const close=(p:number[],q:number[])=>p.forEach((v,i)=>expect(v).toBeCloseTo(q[i],10));
const vector=(d:Doc,e:Endpoint)=>sub(curveById(d,e.curveId).handles[e.end],nodeAt(d,e).position);
const direction=(d:Doc,e:Endpoint)=>{const v=vector(d,e);return v.map(x=>x/length(v));};
const valid=(d:Doc)=>expect(parseDrawing(JSON.parse(JSON.stringify(d)))).toEqual(JSON.parse(JSON.stringify(d)));
for(const ae of [0,1] as const)for(const be of [0,1] as const)for(const mode of ['SMOOTH'] as const)test(`${mode}: endpoint ${ae}/${be} preserves first side and length, bidirectional handle edits`,()=>{
 const d=base(),aa={curveId:'a',end:ae},bb={curveId:'b',end:be},len=length(vector(d,bb)),n=c.connect(d,aa,bb,mode);valid(n);
 expect(shapeOf(n,'a')).toEqual(shapeOf(d,'a'));expect(nodeAt(n,aa)).toBe(nodeAt(n,bb));expect(length(vector(n,bb))).toBeCloseTo(len,12);
 close(direction(n,bb),direction(n,aa).map(x=>x*(mode==='SMOOTH'?-1:1)));
 const la=length(vector(n,aa)),edited=c.moveHandle(n,bb,add(nodeAt(n,bb).position,[.2,.5]));expect(length(vector(edited,aa))).toBeCloseTo(la,12);valid(edited);
 const opposite=c.moveHandle(edited,bb,add(nodeAt(edited,bb).position,[-.2,-.5]));expect(opposite.joins[0].mode).toBe(mode);valid(opposite);
 expect(()=>c.moveHandle(n,aa,nodeAt(n,aa).position)).toThrow(/零/);
});
test('multiway shared point translates all adjacent handles, groups an unpaired branch without forcing its tangent',()=>{
 let d=c.connect(base(),a,b,'SMOOTH');d=c.connect(d,a,{curveId:'c',end:1},'POSITION');const before=structuredClone(d),node=nodeAt(d,a),n=c.moveNode(d,node.id,add(node.position,[.3,-.1]));
 expect(members(n,node.id)).toHaveLength(3);expect(strokes(n,n.layers[0].id)).toHaveLength(2);
 for(const e of members(n,node.id)){close(sub(curveById(n,e.curveId).handles[e.end],curveById(d,e.curveId).handles[e.end]),[.3,-.1]);expect(shapeOf(n,e.curveId)[e.end?0:3]).toEqual(shapeOf(d,e.curveId)[e.end?0:3]);}
 expect(d).toEqual(before);valid(n);expect(()=>c.connect(d,a,{curveId:'c',end:1},'SMOOTH')).toThrow(/已与/);
});
test('changing join mode is explicit; position-only and unbind preserve current shape',()=>{
 const d=c.connect(base(),a,b,'SMOOTH'),cusp=c.connect(d,a,b,'CUSP');expect(strokeIds(strokeFor(cusp,'a'))).toHaveLength(2);valid(cusp);
 const bound=c.removeJoin(cusp,cusp.joins[0].id);expect(shapeOf(bound,'a')).toEqual(shapeOf(cusp,'a'));expect(shapeOf(bound,'b')).toEqual(shapeOf(cusp,'b'));expect(strokes(bound,bound.layers[0].id)).toHaveLength(3);
 const free=c.unbind(bound,b);expect(nodeAt(free,a).id).not.toBe(nodeAt(free,b).id);expect(shapeOf(free,'b')).toEqual(shapeOf(bound,'b'));valid(free);
});
test('cycles are closed strokes with one start, one closed path and no duplicated nodes',()=>{
 const d=c.addLayer(emptyDrawing()),n=c.ellipse(d,d.layers[0].id,[-1,-.5],[1,.5],.01).document;
 expect(n.curves).toHaveLength(4);expect(n.nodes).toHaveLength(4);expect(n.joins).toHaveLength(4);const s=strokes(n,n.layers[0].id);expect(s).toHaveLength(1);expect(s[0].closed).toBe(true);const path=strokePath(n,s[0]);expect(path.match(/M/g)).toHaveLength(1);expect(path.match(/C/g)).toHaveLength(4);expect(path.endsWith(' Z')).toBe(true);valid(n);
});
test('exact split preserves shape and transfers both original endpoint relationships',()=>{
 let d=c.connect(base(),{curveId:'c',end:1},{curveId:'a',end:0},'SMOOTH');d=c.connect(d,a,b,'CUSP');const before=shapeOf(d,'a'),result=c.splitCurve(d,'a',.37),[left,right]=result.ids.map(id=>shapeOf(result.document,id));
 for(let i=0;i<=40;i++){const t=i/40,expected=evaluate(before.map(([x,y])=>[x,y,0]),t),actual=evaluate((t<=.37?left:right).map(([x,y])=>[x,y,0]),t<=.37?t/.37:(t-.37)/.63);close(actual,expected);}
 expect(result.ids[0]).toBe('a');expect(result.document.joins.some(j=>j.b.curveId==='b'&&j.a.curveId===result.ids[1])).toBe(true);valid(result.document);
});
test('join anchors whole chain at first-click position, and reorder never interleaves segments',()=>{
 let d=base();d={...d,layers:[{...d.layers[0],items:['a','c','b','d']}]};const n=c.connect(d,a,b,'SMOOTH');expect(n.layers[0].items).toEqual(['a','b','c','d']);
 const reverse=c.connect(d,b,a,'SMOOTH');expect(new Set(reverse.layers[0].items.slice(1,3))).toEqual(new Set(['a','b']));expect(reverse.layers[0].items[0]).toBe('c');
 const back=c.reorderStroke(n,'b','d',true);expect(back.layers[0].items.slice(0,2)).toEqual(['c','d']);expect(new Set(back.layers[0].items.slice(2))).toEqual(new Set(['a','b']));valid(back);
});
test('partial transform selects only actual one-hop neighbors; locked members never silently change',()=>{
 let d=c.connect(base(),a,b,'SMOOTH');d=c.connect(d,{curveId:'b',end:1},{curveId:'c',end:0},'SMOOTH');
 expect(()=>c.transform(d,['a'],p=>add(p,[.2,.3]))).toThrow(c.RelatedSelection);
 try{c.transform(d,['a'],p=>add(p,[.2,.3]));}catch(e){expect((e as c.RelatedSelection).ids).toEqual(['a','b']);}
 const n=c.transform(d,['a'],p=>add(p,[.2,.3]),true);expect(shapeOf(n,'c')).toEqual(shapeOf(d,'c'));expect(shapeOf(n,'b')[3]).toEqual(shapeOf(d,'b')[3]);valid(n);
 const locked=c.curveChange(d,'b',{locked:true});expect(()=>c.transform(locked,['a'],p=>add(p,[1,0]),true)).toThrow(/锁定/);expect(()=>c.moveNode(locked,nodeAt(locked,a).id,[.1,0])).toThrow(/锁定/);expect(()=>c.moveHandle(locked,a,[.2,.1])).toThrow(/锁定/);expect(()=>c.unbind(locked,a)).toThrow(/锁定/);expect(()=>c.deleteCurves(locked,['a'])).toThrow(/锁定/);
});
test('mirror/merge are one-shot; names and identities remain; shared shape operations stay constrained',()=>{
 const d=base(),n=c.merge(d,a,b);expect(n.joins).toHaveLength(0);expect(nodeAt(n,a).id).not.toBe(nodeAt(n,b).id);close(nodeAt(n,a).position,nodeAt(n,b).position);
 close(vector(n,b),vector(d,b));const mirrored=c.mirrorEdit(d,'a','b');expect(curveById(mirrored,'b').name).toBe('b');shapeOf(mirrored,'b').forEach((p,i)=>close(p,[-shapeOf(d,'a')[i][0],shapeOf(d,'a')[i][1]]));expect(shapeOf(mirrored,'a')).toEqual(shapeOf(d,'a'));valid(mirrored);
 const joined=c.connect(d,a,b,'SMOOTH');expect(()=>c.merge(joined,{curveId:'c',end:0},b)).toThrow(/已绑定/);
});
test('duplicate retains internal relations, never shares IDs; moving layer requires connected component',()=>{
 const d=c.connect(base(),a,b,'SMOOTH'),n=c.duplicateCurves(d,['a','b']);expect(n.document.joins).toHaveLength(2);expect(nodeAt(n.document,{curveId:n.ids[0],end:1}).id).not.toBe(nodeAt(d,a).id);valid(n.document);
 const layered=c.addLayer(d,'Hair');expect(()=>c.connect(layered,a,{curveId:'a',end:0},'POSITION')).not.toThrow();expect(()=>c.moveToLayer(layered,['a'],layered.layers[0].id)).toThrow(c.RelatedSelection);
 const moved=c.moveToLayer(layered,['a','b'],layered.layers[0].id);expect(moved.layers[0].items).toEqual(['a','b']);valid(moved);
 expect(()=>c.connect(moved,a,{curveId:'c',end:1},'POSITION')).toThrow(/图层/);
 const clonedLayer=c.duplicateLayer(d,d.layers[0].id);expect(clonedLayer.layers).toHaveLength(2);valid(clonedLayer);
});
test('locked chain member cannot be restyled indirectly through join; hidden geometry not editable',()=>{
 let d=c.connect(base(),a,b,'SMOOTH');d=c.curveChange(d,'a',{locked:true});expect(()=>c.connect(d,{curveId:'c',end:0},{curveId:'b',end:1},'SMOOTH')).toThrow(/锁定/);
 expect(()=>c.widthChange(d,['b'],.01)).toThrow(/锁定/);const fresh=base(),hidden=c.layerChange(fresh,fresh.layers[0].id,{visible:false});expect(c.createCurve(hidden,hidden.layers[0].id,shape).curves.at(-1)).toMatchObject({visible:true,locked:false});
});
test('invalid or zero handle constraints rejected; exact saved graph and old project load coexist',()=>{
 const d=base(),zero=c.moveHandle(d,a,nodeAt(d,a).position);expect(()=>c.connect(zero,a,b,'SMOOTH')).toThrow(/handle/);valid(zero);
 const n=c.connect(d,a,b,'SMOOTH'),p=createLandmarkProject(),loaded=parseLandmarks(JSON.stringify({...p,drawing:n}));expect(loaded.drawing).toEqual(n);expect(parseLandmarks(JSON.stringify(p)).drawing).toBeUndefined();
 for(const bad of [{...n,version:4},{...n,nodes:[]},{...n,layers:[...n.layers,...n.layers]},{...n,joins:[...n.joins,...n.joins]},{...n,curves:n.curves.map(x=>x.id==='a'?{...x,handles:[[5,4],[3,2]]}:x)}])expect(()=>parseDrawing(bad)).toThrow();
});
