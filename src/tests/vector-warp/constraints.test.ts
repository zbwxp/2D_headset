import {expect,test} from 'vitest';
import rawFace from '../../assets/hairless-symmetric-two-face.json';
import {nodeAt,parseDrawing,type Point2} from '../../domain/drawing/model';
import {pinWarpPoint,WarpPinError,type WarpPointPin} from '../../domain/vectorWarp/constraints';
import {blendWarpGrids,createWarpGrid,moveWarpNode,type WarpGrid} from '../../domain/vectorWarp/model';
import {createWarpMapper,deformDrawing,mapPoint,warpPatchControlPoints} from '../../domain/vectorWarp/evaluation';
import {latticeWeights} from '../../domain/vectorRecording/interpolation';

const bounds={min:[-1,-1] as Point2,max:[1,1] as Point2};
const near=(a:Point2,b:Point2,digits=11)=>a.forEach((x,i)=>expect(x).toBeCloseTo(b[i],digits));
const request=(sourcePoint:Point2,targetPoint:Point2,rest:Partial<WarpPointPin>={}):WarpPointPin=>({sourcePoint,targetPoint,gridParentId:'head',targetParentId:'head',...rest});
function edited(seed:number,rows=3,columns=3):WarpGrid{
 const grid=createWarpGrid(bounds,rows,columns);
 for(let i=0;i<grid.nodes.length;i++){
  const n=grid.nodes[i];for(const key of ['position','handleU','handleV'] as const){n[key][0]+=.14*Math.sin(i*2.3+seed);n[key][1]+=.1*Math.cos(i*1.7+seed);}
  n.handleU[1]+=.023*Math.sin(seed+i);n.handleV[0]-=.017*Math.cos(seed-i);n.twist=[.03*Math.sin(seed+i),.02*Math.cos(seed-i)];
 }
 return grid;
}

test('an already satisfied pin is a detached no-op; tiny intended edits are not ignored',()=>{
 const grid=createWarpGrid(bounds,2,2),same=pinWarpPoint(grid,request([0,0],[0,0]));
 expect(same.grid).toEqual(grid);expect(same.grid).not.toBe(grid);expect(same.changes).toEqual([]);expect(same.iterations).toBe(0);
 const tiny=pinWarpPoint(grid,request([0,0],[1e-10,-1e-10]));
 near(tiny.afterPoint,[1e-10,-1e-10],15);expect(tiny.maxControlDelta).toBeGreaterThan(0);expect(tiny.withinTolerance).toBe(true);
});

test('a corner pin moves only that node and its handles; derivatives and twist remain',()=>{
 const grid=createWarpGrid(bounds,2,2),result=pinWarpPoint(grid,request([-1,-1],[-.8,-.9]));
 expect(result.changes.map(x=>x.nodeIndex)).toEqual([0]);near(result.afterPoint,[-.8,-.9]);
 near(result.grid.nodes[0].handleU,[grid.nodes[0].handleU[0]+.2,grid.nodes[0].handleU[1]+.1]);
 expect(result.grid.nodes.slice(1)).toEqual(grid.nodes.slice(1));expect(result.grid.nodes[0].twist).toEqual([0,0]);
 expect(result.squaredControlDelta).toBeCloseTo(3*(.2**2+.1**2),12);
});

test('interior pin is the minimum-norm four-node translation and preserves unrelated controls',()=>{
 const grid=edited(1),before=structuredClone(grid),source:Point2=[.12,.16],target:Point2=[.4,.32],result=pinWarpPoint(grid,request(source,target));
 expect(result.changes).toHaveLength(4);expect(result.residualNorm).toBeLessThan(1e-12);expect(result.withinTolerance).toBe(true);
 const error:Point2=[target[0]-result.beforePoint[0],target[1]-result.beforePoint[1]],den=result.changes.reduce((sum,s)=>sum+s.weight*s.weight,0);
 for(const s of result.changes){near(s.delta,[error[0]*s.weight/den,error[1]*s.weight/den]);const a=before.nodes[s.nodeIndex],b=result.grid.nodes[s.nodeIndex];
  for(const key of ['handleU','handleV'] as const)near([b[key][0]-b.position[0],b[key][1]-b.position[1]],[a[key][0]-a.position[0],a[key][1]-a.position[1]]);
 }
 const changed=new Set(result.changes.map(s=>s.nodeIndex));grid.nodes.forEach((n,i)=>{if(!changed.has(i))expect(result.grid.nodes[i]).toEqual(n);expect(result.grid.nodes[i].twist).toEqual(n.twist);});
 expect(grid).toEqual(before);expect(result.grid.bounds).toEqual(grid.bounds);expect(result.grid.rows).toBe(grid.rows);expect(result.grid.columns).toBe(grid.columns);
 const oneCornerCost=3*Math.hypot(...error)**2/Math.max(...result.changes.map(s=>s.weight))**2;
 expect(result.squaredControlDelta).toBeLessThan(oneCornerCost);
});

test('shared patch edges keep exact positions and matching first derivatives',()=>{
 const g=pinWarpPoint(edited(3,4,4),request([.11,-.13],[.31,.2])).grid;
 for(let r=0;r<g.rows;r++)for(let c=0;c<g.columns-1;c++){
  const a=warpPatchControlPoints(g,r,c),b=warpPatchControlPoints(g,r,c+1);
  for(let j=0;j<4;j++){near(a[j*4+3],b[j*4],13);near([a[j*4+3][0]-a[j*4+2][0],a[j*4+3][1]-a[j*4+2][1]],[b[j*4+1][0]-b[j*4][0],b[j*4+1][1]-b[j*4][1]],13);}
 }
 for(let r=0;r<g.rows-1;r++)for(let c=0;c<g.columns;c++){
  const a=warpPatchControlPoints(g,r,c),b=warpPatchControlPoints(g,r+1,c);
  for(let i=0;i<4;i++){near(a[12+i],b[i],13);near([a[12+i][0]-a[8+i][0],a[12+i][1]-a[8+i][1]],[b[4+i][0]-b[i][0],b[4+i][1]-b[i][1]],13);}
 }
});

test('edge, seam and maximum-boundary pins remain bounded and accurate',()=>{
 for(const p of [[-1,.2],[1,.2],[.2,-1],[.2,1],[0,0],[1,1]] as Point2[]){const result=pinWarpPoint(edited(2,2,2),request(p,[.2,.3]));near(result.afterPoint,[.2,.3]);expect(result.changes.length).toBeLessThanOrEqual(2);expect(result.changes.every(c=>c.nodeIndex<9)).toBe(true);}
});

test('folded and singular grids use forward evaluation without an invertibility requirement',()=>{
 const folded=moveWarpNode(edited(4),5,[1.8,-1.3]);
 for(const n of folded.nodes){n.position[1]=0;n.handleU[1]=0;n.handleV[1]=0;n.twist[1]=0;}
 const result=pinWarpPoint(folded,request([.2,.3],[.4,.2])),map=createWarpMapper([result.grid]);near(result.afterPoint,[.4,.2]);
 for(let i=0;i<=40;i++)for(let j=0;j<=20;j++)expect(map.mapPoint([-1+i/20,-1+j/10]).every(Number.isFinite)).toBe(true);
});

test('target may leave child rest bounds but must remain inside an explicitly supplied parent domain',()=>{
 const g=createWarpGrid(bounds);near(pinWarpPoint(g,request([.2,.3],[2,.4],{parentBounds:{min:[-3,-3],max:[3,3]}})).afterPoint,[2,.4]);
 expect(()=>pinWarpPoint(g,request([.2,.3],[2,.4],{parentBounds:bounds}))).toThrow('parent-domain extrapolation');
});

test('invalid hierarchy, bounds, values and topology fail without mutations',()=>{
 const g=createWarpGrid(bounds),before=structuredClone(g);
 const invalid:WarpPointPin[]=[request([0,0],[0,0],{targetParentId:'other'}),request([1.00001,0],[0,0]),request([0,-1.00001],[0,0]),request([NaN,0],[0,0]),request([0,0],[Infinity,0]),request([0,0],[0,0],{tolerance:-1}),request([0,0],[0,0],{parentBounds:{min:[1,1],max:[0,0]}})];
 for(const pin of invalid)expect(()=>pinWarpPoint(g,pin)).toThrow(WarpPinError);
 expect(()=>pinWarpPoint({...g,nodes:[]},request([0,0],[0,0]))).toThrow();expect(g).toEqual(before);
});

test('actual linked two-face chin coincides throughout 0/30/60/90 key blending and a common parent',()=>{
 const source=parseDrawing(rawFace),original=structuredClone(source),link=source.endpointLinks!.find(l=>l.id==='ed1131ae-74c5-4534-9b6b-6395e37b1a58')!,a=nodeAt(source,link.a),b=nodeAt(source,link.b);
 expect(a.position).toEqual(b.position);const rest=a.position,angles=[0,30,60,90],targets=angles.map(x=>[rest[0]+.25*Math.sin(x*Math.PI/180),rest[1]+.04*Math.sin(x*Math.PI/90)] as Point2);
 const keys=angles.map((x,i)=>({angle:{x,y:0},left:pinWarpPoint(edited(i+.2),request(rest,targets[i],{parentBounds:bounds})).grid,right:pinWarpPoint(edited(i+2.8,4,2),request(rest,targets[i],{parentBounds:bounds})).grid}));
 const parent=edited(.7,2,2);
 for(let angle=0;angle<=90;angle++){
  const samples=latticeWeights(keys.map(k=>k.angle),{x:angle,y:0}),left=blendWarpGrids(samples.map(s=>({grid:keys.find(k=>k.angle.x===s.angle.x)!.left,weight:s.weight}))),right=blendWarpGrids(samples.map(s=>({grid:keys.find(k=>k.angle.x===s.angle.x)!.right,weight:s.weight})));
  const expected:Point2=[0,0];samples.forEach(s=>{const target=targets[angles.indexOf(s.angle.x)];expected[0]+=s.weight*target[0];expected[1]+=s.weight*target[1];});
  near(mapPoint(left,rest),expected);near(mapPoint(right,rest),expected);near(createWarpMapper([left,parent]).mapPoint(rest),createWarpMapper([right,parent]).mapPoint(rest));
  if(angle%15===0){
   const leftLayer=source.layers.find(l=>l.items.includes(link.a.curveId))!,rightLayer=source.layers.find(l=>l.items.includes(link.b.curveId))!;
   const out=deformDrawing(source,id=>leftLayer.items.includes(id)?[left,parent]:rightLayer.items.includes(id)?[right,parent]:[],{diagnostics:'preview'});
   expect(out.conflictingNodeIds).not.toContain(a.id);expect(out.conflictingNodeIds).not.toContain(b.id);
   near(out.drawing.nodes.find(n=>n.id===a.id)!.position,out.drawing.nodes.find(n=>n.id===b.id)!.position);
   expect(out.diagnostics).toHaveLength(source.curves.length);expect(out.drawing.fills).toEqual(source.fills);
  }
 }
 expect(source).toEqual(original);
});

test('the same fixed target survives signed X+Y-neutral grid blending',()=>{
 const source:Point2=[.17,-.26],target:Point2=[.31,-.12],grids=[1,2,3].map(i=>pinWarpPoint(edited(i),request(source,target)).grid);
 const blend=blendWarpGrids(grids.map((grid,i)=>({grid,weight:i===2?-1:1})));near(mapPoint(blend,source),target);
});
