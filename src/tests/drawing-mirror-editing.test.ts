import {test,expect} from 'vitest';
import * as cmd from '../domain/drawing/commands';
import {dragNode} from '../domain/drawing/nodeDrag';
import {deformDrawing} from '../domain/drawing/deform';
import {emptyDrawing,shapeOf,curveById,nodeAt,add,sub,length,type DrawingDocument,type Point2,type Cubic} from '../domain/drawing/model';
import {applyMirrorEditing,validateMirrorEditing,constrainMirrorNodePosition,mirrorWritesForCurves,type MirrorDrawing,type MirrorEditingConfig} from '../domain/drawing/mirrorEditing';

const axis=-.3294804514288924;
const reflect=([x,y]:Point2):Point2=>[2*axis-x,y];
const near=(a:Point2,b:Point2)=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],11));
function fixture(reverse=false):MirrorDrawing{
 let d=cmd.addLayer({...emptyDrawing(),mirrorAxisX:axis},'Left');
 const shape:Cubic=[[axis-1,0],[axis-.8,.4],[axis-.4,.2],[axis,-.1]];
 d=cmd.createCurve(d,d.layers[0].id,shape,.01,'Left','left');d=cmd.addLayer(d,'Right');
 d=cmd.createCurve(d,d.layers[0].id,(reverse?[...shape].reverse():shape).map(reflect) as Cubic,.023,'Right','right');
 return {...d,mirrorEditing:{enabled:true,curvePairs:[{id:'pair',a:'left',b:'right',reverse}]}};
}
function symmetric(d:DrawingDocument,reverse=false){shapeOf(d,'left').forEach((p,i)=>near(reflect(p),shapeOf(d,'right')[reverse?3-i:i]));validateMirrorEditing(d);}
const node=(d:DrawingDocument,id:string,end:0|1)=>nodeAt(d,{curveId:id,end}).id;
const withoutMirror=(d:MirrorDrawing):DrawingDocument=>{const {mirrorEditing:_,...plain}=d;return plain;};
const withGeometry=(d:DrawingDocument,values:{nodeId:string;position:Point2}[])=>({...d,nodes:d.nodes.map(n=>{const w=values.find(w=>w.nodeId===n.id);return w?{...n,position:w.position}:n;})});

test('legacy and disabled documents are exact pass-through; enabling validates without changing source',()=>{
 const d=fixture(),off={...d,mirrorEditing:{...d.mirrorEditing!,enabled:false}},next=cmd.moveHandle(off,{curveId:'left',end:0},[axis-1,.8]);
 expect(applyMirrorEditing(off,next,{handles:[{curveId:'left',end:0,position:[axis-1,.8]}]})).toBe(next);
 expect(validateMirrorEditing(next).enabled).toBe(false);
 const before=structuredClone(next);expect(validateMirrorEditing(next,{...off.mirrorEditing!,enabled:true}).enabled).toBe(true);expect(next).toEqual(before);
 const legacy={...d};delete legacy.mirrorEditing;expect(applyMirrorEditing(legacy,next)).toBe(next);
});

test.each([false,true])('either side drives stable node/handle pairing with reverse=%s',reverse=>{
 const d=fixture(reverse),original=structuredClone(d);
 for(const id of ['left','right'])for(const end of [0,1] as const){
  const nodeId=node(d,id,end),position=add(nodeAt(d,{curveId:id,end}).position,[.12,.17]),raw=cmd.moveNode(d,nodeId,position),n=applyMirrorEditing(d,raw,{nodes:[{nodeId,position}]});symmetric(n,reverse);
  const handle=add(curveById(d,id).handles[end],[.03,-.18]),h=applyMirrorEditing(d,cmd.moveHandle(d,{curveId:id,end},handle),{handles:[{curveId:id,end,position:handle}]});symmetric(h,reverse);
 }
 expect(d).toEqual(original);
});

test('stable IDs survive curve/layer order and names; no geometric or name rematching',()=>{
 const d=fixture(),reordered={...d,curves:[...d.curves].reverse().map(c=>({...c,name:'same name'})),layers:[...d.layers].reverse()};
 const h:Point2=[axis-.7,.7],n=applyMirrorEditing(reordered,cmd.moveHandle(reordered,{curveId:'left',end:0},h),{handles:[{curveId:'left',end:0,position:h}]});symmetric(n);
});

test('only geometry follows: distinct widths, depth, visible flags, brushes, fills, intervals and ownership remain authored',()=>{
 const d=fixture();d.curves[1]={...d.curves[1],depthOffset:1,depthScope:'LAYER',visible:false,profile:'TAPER_END',inkEnds:[{extension:.04},{taper:.08}]};
 d.fills=[{id:'fill',name:'Intentional white',visible:true,locked:false,color:'white',boundary:[{id:'left',reverse:false}]}];
 d.displayIntervals=[{id:'track',anchor:{id:'left',reverse:false},ranges:[{id:'range',mode:'HIDE',start:.2,end:.4}]}];
 const h:Point2=[axis-.9,.7],raw=cmd.moveHandle(d,{curveId:'left',end:0},h),n=applyMirrorEditing(d,raw,{handles:[{curveId:'left',end:0,position:h}]});
 symmetric(n);for(const key of ['layers','fills','offsets','displayIntervals','endpointLinks','joins'] as const)expect(n[key]).toBe(raw[key]);
 for(const c of n.curves){const {handles:_,...appearance}=c,{handles:__,...old}=curveById(d,c.id);expect(appearance).toEqual(old);}
});

test('linked chin nodes move freely together without projection or merging IDs',()=>{
 let d=fixture();d=cmd.linkEndpoints(d,{curveId:'left',end:1},{curveId:'right',end:1},true) as MirrorDrawing;
 const id=node(d,'left',1),other=node(d,'right',1),target=constrainMirrorNodePosition(d,id,[axis+.2,-.4]);expect(target).toEqual([axis+.2,-.4]);
 const raw=dragNode(d,id,target,.65),n=applyMirrorEditing(d,raw,{nodes:[{nodeId:id,position:target}]});
 expect(nodeAt(n,{curveId:'left',end:1}).position).toEqual(target);expect(nodeAt(n,{curveId:'right',end:1}).position).toEqual(target);expect(id).not.toBe(other);expect(n.endpointLinks).toBe(raw.endpointLinks);
});

test('true linked-node conflicting direct targets still fail atomically',()=>{
 let d=fixture();d=cmd.linkEndpoints(d,{curveId:'left',end:1},{curveId:'right',end:1},true) as MirrorDrawing;
 const before=structuredClone(d),a=node(d,'left',1),b=node(d,'right',1);
 expect(()=>applyMirrorEditing(d,d,{nodes:[{nodeId:a,position:[axis+.2,-.4]},{nodeId:b,position:[axis+.3,-.4]}]})).toThrow(/联动节点/);expect(d).toEqual(before);
});

test('legacy axis-node metadata never clamps either independent endpoint',()=>{
 const d=fixture();d.mirrorEditing!.axisNodeIds=[node(d,'left',1)];
 expect(validateMirrorEditing(d).axisNodeIds).toHaveLength(2);
 const id=node(d,'right',1),p=constrainMirrorNodePosition(d,id,[axis+.4,.5]),n=applyMirrorEditing(d,cmd.moveNode(d,id,p),{nodes:[{nodeId:id,position:p}]});symmetric(n);expect(p[0]).toBe(axis+.4);
});

test('self-paired axial curve permits free endpoints and handles',()=>{
 let d=cmd.addLayer({...emptyDrawing(),mirrorAxisX:axis});d=cmd.createCurve(d,d.layers[0].id,[[axis,0],[axis,.1],[axis,.2],[axis,.3]],.01,'Nose','nose');
 const base:MirrorDrawing={...d,mirrorEditing:{enabled:true,curvePairs:[{id:'self',a:'nose',b:'nose',reverse:false}]}},h:Point2=[axis+.3,.12];
 const n=applyMirrorEditing(base,cmd.moveHandle(base,{curveId:'nose',end:0},h),{handles:[{curveId:'nose',end:0,position:h}]});
 expect(curveById(n,'nose').handles[0]).toEqual(h);validateMirrorEditing(n);
});

test('self-paired reversed cubic has opposite end and handle partners, not four axis constraints',()=>{
 let d=cmd.addLayer({...emptyDrawing(),mirrorAxisX:axis});d=cmd.createCurve(d,d.layers[0].id,[[axis-1,0],[axis-.3,.5],[axis+.3,.5],[axis+1,0]],.01,'Arch','arch');
 const base:MirrorDrawing={...d,mirrorEditing:{enabled:true,curvePairs:[{id:'self',a:'arch',b:'arch',reverse:true}]}},h:Point2=[axis-.6,.8];
 const n=applyMirrorEditing(base,cmd.moveHandle(base,{curveId:'arch',end:0},h),{handles:[{curveId:'arch',end:0,position:h}]});
 near(curveById(n,'arch').handles[1],reflect(h));expect(validateMirrorEditing(n).axisNodeIds).toEqual([]);
});

test('whole-side affine transforms mirror final controls and preserve source metadata',()=>{
 const d=fixture(),raw=cmd.transform(d,['left'],([x,y])=>[x*1.2+.15,y*.8+.3]),n=applyMirrorEditing(d,raw,mirrorWritesForCurves(raw,['left']));symmetric(n);expect(shapeOf(n,'left')).toEqual(shapeOf(raw,'left'));expect(n.layers).toBe(raw.layers);
});

test('finalization occurs after node-follow rotations, not just after the underlying moveNode',()=>{
 const d=fixture(),id=node(d,'left',0),p:Point2=[axis-.7,-.4],raw=dragNode(d,id,p,.8),n=applyMirrorEditing(d,raw,{nodes:[{nodeId:id,position:p}]});
 symmetric(n);expect(curveById(n,'left').handles).toEqual(curveById(raw,'left').handles);expect(curveById(raw,'left').handles).not.toEqual(curveById(cmd.moveNode(d,id,p),'left').handles);
});

test('finalization mirrors the fitted projective handles, preserving one cubic per source curve',()=>{
 const d=fixture(),raw=deformDrawing(d,['left'],{min:[axis-1,-.1],max:[axis,.4]},[[axis-1.1,-.2],[axis+.1,-.1],[axis-.1,.55],[axis-.9,.4]]).document;
 const n=applyMirrorEditing(d,raw,mirrorWritesForCurves(raw,['left']));symmetric(n);expect(shapeOf(n,'left')).toEqual(shapeOf(raw,'left'));expect(n.curves.map(c=>c.id)).toEqual(d.curves.map(c=>c.id));
});

test('two explicitly authored sides preserve their distinct node and handle targets',()=>{
 const d=fixture(),left=node(d,'left',0),right=node(d,'right',0),a:Point2=[axis-1.2,.3],b:Point2=[axis+1.4,.3];
 const raw=cmd.moveNode(cmd.moveNode(d,left,a),right,reflect(a)),before=structuredClone(raw),n=applyMirrorEditing(d,raw,{nodes:[{nodeId:left,position:a},{nodeId:right,position:b}]});
 expect(nodeAt(n,{curveId:'left',end:0}).position).toEqual(a);expect(nodeAt(n,{curveId:'right',end:0}).position).toEqual(b);expect(raw).toEqual(before);
 const h:Point2=[axis-.6,.7],other:Point2=[axis+.8,.7],rawH=cmd.moveHandle(d,{curveId:'left',end:0},h),out=applyMirrorEditing(d,rawH,{handles:[{curveId:'left',end:0,position:h},{curveId:'right',end:0,position:other}]});
 expect(curveById(out,'left').handles[0]).toEqual(h);expect(curveById(out,'right').handles[0]).toEqual(other);
});

test('the last authored value for the SAME control wins, without erasing the counterpart intent',()=>{
 const d=fixture(),id=node(d,'left',0),a:Point2=[axis-1.2,.3],b:Point2=[axis-1.3,.4],raw=cmd.moveNode(d,id,b);
 symmetric(applyMirrorEditing(d,raw,{nodes:[{nodeId:id,position:a},{nodeId:id,position:b}]}));
});

test('whole selections transform freely and moving the mirror guide preserves geometry',()=>{
 const d=fixture(),raw=cmd.transform(d,['left','right'],([x,y])=>[x*1.2+.2,y*.8+.1]),n=applyMirrorEditing(d,raw,mirrorWritesForCurves(raw,['left','right']));
 expect(n.nodes).toEqual(raw.nodes);expect(n.curves).toEqual(raw.curves);
 const guide={...d,mirrorAxisX:axis+.1};expect(applyMirrorEditing(d,guide)).toBe(guide);
});

test('locked mirrored curves and linked followers reject the entire finalization atomically',()=>{
 const d=fixture();d.curves[1]={...d.curves[1],locked:true};const h:Point2=[axis-.6,.7],raw=cmd.moveHandle(d,{curveId:'left',end:0},h),saved=structuredClone(raw);
 expect(()=>applyMirrorEditing(d,raw,{handles:[{curveId:'left',end:0,position:h}]})).toThrow(/锁定/);expect(raw).toEqual(saved);
 let linked=fixture();linked=cmd.createCurve(linked,linked.layers[0].id,[[axis+1,0],[axis+1.2,.2],[axis+1.3,.3],[axis+1.4,.4]],.01,'Follower','follower') as MirrorDrawing;
 linked=cmd.linkEndpoints(linked,{curveId:'right',end:0},{curveId:'follower',end:0},true) as MirrorDrawing;
 linked=cmd.curveChange(linked,'follower',{locked:true}) as MirrorDrawing;
 const id=node(linked,'left',0),p:Point2=[axis-1.1,.1],next=cmd.moveNode(linked,id,p);
 expect(()=>applyMirrorEditing(linked,next,{nodes:[{nodeId:id,position:p}]})).toThrow(/锁定/);
});

test('position-linked followers translate adjacent handles once while their far endpoints and styles stay independent',()=>{
 let d=fixture();d=cmd.createCurve(d,d.layers[0].id,[[axis+1,0],[axis+1.2,.2],[axis+1.3,.3],[axis+1.4,.4]],.03,'Follower','follower') as MirrorDrawing;
 d=cmd.linkEndpoints(d,{curveId:'right',end:0},{curveId:'follower',end:0},true) as MirrorDrawing;
 const id=node(d,'left',0),p:Point2=[axis-1.2,.1],n=applyMirrorEditing(d,cmd.moveNode(d,id,p),{nodes:[{nodeId:id,position:p}]});
 symmetric(n);expect(shapeOf(n,'follower').slice(2)).toEqual(shapeOf(d,'follower').slice(2));near(sub(shapeOf(n,'follower')[1],shapeOf(n,'follower')[0]),sub(shapeOf(d,'follower')[1],shapeOf(d,'follower')[0]));
});

test('invalid identities and duplicate curve membership reject while shared-node routing is allowed',()=>{
 const d=fixture();const testConfig=(config:MirrorEditingConfig)=>()=>validateMirrorEditing(d,config);
 expect(testConfig({enabled:true,curvePairs:[{id:'x',a:'left',b:'missing',reverse:false}]})).toThrow(/不存在/);
 expect(testConfig({enabled:true,curvePairs:[...d.mirrorEditing!.curvePairs,{id:'another',a:'right',b:'right',reverse:true}]})).toThrow(/一个镜像配对/);
 expect(testConfig({enabled:true,curvePairs:[],axisNodeIds:['missing']})).toThrow(/引用无效/);
 expect(()=>validateMirrorEditing({...d,mirrorAxisX:NaN})).toThrow(/镜像轴/);
 let source=cmd.createCurve(d,d.layers[1].id,[shapeOf(d,'left')[0],[axis-.7,-.2],[axis-.5,-.3],[axis-.2,-.4]],.01,'Left branch','branch') as MirrorDrawing;
 source=cmd.connect(withoutMirror(source),{curveId:'left',end:0},{curveId:'branch',end:0},'POSITION') as MirrorDrawing;
 source=cmd.createCurve(source,source.layers[0].id,shapeOf(source,'branch').map(reflect) as Cubic,.01,'Unshared counterpart','branchR') as MirrorDrawing;
 expect(validateMirrorEditing(source,{enabled:true,curvePairs:[...d.mirrorEditing!.curvePairs,{id:'branchPair',a:'branch',b:'branchR',reverse:false}]}).pairCount).toBe(2);
});

test('paired topology edits prune obsolete metadata and coordinates must remain finite',()=>{
 const d=fixture(),split=cmd.splitCurve(d,'left',.4).document;
 expect(split.mirrorEditing!.curvePairs).toEqual([]);expect(applyMirrorEditing(d,split)).toBe(split);
 expect(()=>applyMirrorEditing(d,d,{nodes:[{nodeId:node(d,'left',0),position:[NaN,0]}]})).toThrow();
 expect(()=>applyMirrorEditing(d,d,{handles:[{curveId:'missing',end:0,position:[0,0]}]})).toThrow();
});

test('pure configuration serialization preserves explicit direction and disabled editing',()=>{
 const d=fixture(true),parsed=JSON.parse(JSON.stringify(d)) as MirrorDrawing;expect(validateMirrorEditing(parsed)).toMatchObject({enabled:true,pairCount:1});expect(parsed.mirrorEditing).toEqual(d.mirrorEditing);
});

test('no geometry change keeps result identity and leaves input graphs unmodified',()=>{
 const d=fixture(),before=structuredClone(d);expect(applyMirrorEditing(d,d)).toBe(d);expect(d).toEqual(before);
});

test('small valid control displacements are mirrored rather than swallowed by validation tolerance',()=>{
 const d=fixture(),h=add(curveById(d,'left').handles[0],[0,2e-10]),raw=cmd.moveHandle(d,{curveId:'left',end:0},h),n=applyMirrorEditing(d,raw,{handles:[{curveId:'left',end:0,position:h}]});
 expect(curveById(n,'right').handles[0]).toEqual(reflect(h));expect(n).not.toBe(raw);
});

test.each([1e-10,1e-8])('repeated tiny edits of %s preserve reflection without legacy axis projection',amount=>{
 let d=fixture();for(let i=0;i<30;i++){
  const h=add(curveById(d,'left').handles[0],[0,amount]),raw=cmd.moveHandle(d,{curveId:'left',end:0},h);d=applyMirrorEditing(d,raw,{handles:[{curveId:'left',end:0,position:h}]}) as MirrorDrawing;
  expect(curveById(d,'right').handles[0]).toEqual(reflect(h));
 }
 d.mirrorEditing!.axisNodeIds=[node(d,'left',1)];const id=node(d,'left',1),p:Point2=[axis+amount,0];
 const n=applyMirrorEditing(d,cmd.moveNode(d,id,p),{nodes:[{nodeId:id,position:p}]});expect(nodeAt(n,{curveId:'left',end:1}).position[0]).toBe(axis+amount);expect(nodeAt(n,{curveId:'right',end:1}).position[0]).toBeCloseTo(axis-amount,14);
});

test('unpaired creation and deletion do not invalidate unrelated persistent pairs',()=>{
 const d=fixture(),added=cmd.createCurve(d,d.layers[0].id,[[3,0],[3,.1],[3,.2],[3,.3]],.01,'Unpaired','extra');
 expect(applyMirrorEditing(d,added)).toBe(added);const removed=cmd.deleteObjects(added,['extra']);expect(applyMirrorEditing(added,removed)).toBe(removed);symmetric(removed);
});

test('a mirrored handle follows an existing smooth partner while preserving its authored length',()=>{
 let d=fixture();const end={curveId:'right',end:0 as const},p=nodeAt(d,end).position;
 d=cmd.createCurve(d,d.layers[0].id,[p,add(p,[.2,-.4]),add(p,[.5,-.5]),add(p,[.7,-.7])],.023,'Smooth follower','follower') as MirrorDrawing;
 const config=d.mirrorEditing;d={...cmd.connect(withoutMirror(d),end,{curveId:'follower',end:0},'SMOOTH'),mirrorEditing:config};
 const oldLength=length(sub(curveById(d,'follower').handles[0],p)),h:Point2=[axis-.85,.7],raw=cmd.moveHandle(d,{curveId:'left',end:0},h),n=applyMirrorEditing(d,raw,{handles:[{curveId:'left',end:0,position:h}]});
 symmetric(n);const a=sub(curveById(n,'right').handles[0],p),b=sub(curveById(n,'follower').handles[0],p);near([a[0]/length(a),a[1]/length(a)],[-b[0]/length(b),-b[1]/length(b)]);expect(length(b)).toBeCloseTo(oldLength,12);
});

test('an existing smooth join governs its shared endpoint without adding a mirror angle constraint',()=>{
 let d=fixture(true);d=cmd.moveHandle(d,{curveId:'left',end:1},[axis-.4,-.1]) as MirrorDrawing;d=cmd.moveHandle(d,{curveId:'right',end:0},[axis+.4,-.1]) as MirrorDrawing;
 d=cmd.moveToLayer(d,['right'],d.layers[1].id) as MirrorDrawing;
 const config=d.mirrorEditing;d={...cmd.connect(withoutMirror(d),{curveId:'left',end:1},{curveId:'right',end:0},'SMOOTH'),mirrorEditing:config};
 const h:Point2=[axis-.3,.1],raw=cmd.moveHandle(d,{curveId:'left',end:1},h),n=applyMirrorEditing(d,raw,{handles:[{curveId:'left',end:1,position:h}]});
 expect(n.curves).toEqual(raw.curves);expect(n.joins).toEqual(d.joins);
 expect(()=>applyMirrorEditing(d,raw,{handles:[{curveId:'left',end:1,position:h},{curveId:'right',end:0,position:[axis+.3,.1]}]})).toThrow(/平滑接笔/);
});


test('re-enabled asymmetric geometry retains its offset through node and handle delta edits',()=>{
 const base=fixture(),off={...base,mirrorEditing:{...base.mirrorEditing!,enabled:false}};
 const free=cmd.moveHandle(cmd.moveNode(off,node(off,'right',0),[axis+1.2,.15]),{curveId:'right',end:0},[axis+.7,.8]);
 const d={...free,mirrorEditing:{...free.mirrorEditing!,enabled:true}},snapshot=structuredClone(d);
 expect(validateMirrorEditing(d).enabled).toBe(true);
 const nodeId=node(d,'left',0),p=add(nodeAt(d,{curveId:'left',end:0}).position,[.1,.2]),raw=cmd.moveNode(d,nodeId,p),n=applyMirrorEditing(d,raw,{nodes:[{nodeId,position:p}]});
 near(nodeAt(n,{curveId:'right',end:0}).position,add(nodeAt(d,{curveId:'right',end:0}).position,[-.1,.2]));
 near(curveById(n,'right').handles[0],add(curveById(d,'right').handles[0],[-.1,.2]));
 const h=add(curveById(n,'left').handles[0],[.07,.09]),out=applyMirrorEditing(n,cmd.moveHandle(n,{curveId:'left',end:0},h),{handles:[{curveId:'left',end:0,position:h}]});
 near(curveById(out,'right').handles[0],add(curveById(n,'right').handles[0],[-.07,.09]));expect(d).toEqual(snapshot);
});
