import {test,expect} from 'vitest';
import {createAssembly,bindLayer,locatorProjection,layerTransform,rotateLocal,projectWorld,parseAssembly,type Vec3} from '../../domain/assembly/model';
import {layerCardProjection,cardGeometryChanged} from '../../domain/assembly/cards';
import {addLayer,createCurve} from '../../domain/drawing/commands';
import {emptyDrawing,type Point2} from '../../domain/drawing/model';

const near=(a:number[],b:number[])=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],8));
const apply=(m:number[],[x,y]:Point2):Point2=>{const w=m[3]*x+m[7]*y+m[15];return [(m[0]*x+m[4]*y+m[12])/w,(m[1]*x+m[5]*y+m[13])/w];};
function fixture(){let d=addLayer(emptyDrawing(),'Eye');d=createCurve(d,d.layers[0].id,[[-.5,0],[-.4,.2],[.2,.4],[.5,0]],.01);return bindLayer(createAssembly(d),d.layers[0].id,'eye-l',[-.4,.35]);}

test('card homography matches direct 3D perspective, including offset, calibration and screen navigation',()=>{
 const base=fixture(),id=base.drawing.layers[0].id,unit=317,screen=([x,y]:Point2):Point2=>[462+x*unit,380-y*unit];
 for(const [yaw,pitch,roll] of [[0,0,0],[60,25,30],[90,0,0],[135,-35,-20],[-90,90,45],[180,0,0]]){
  const a={...base,followAxisRotation:true,pose:{...base.pose,yaw,pitch,roll,position:[.2,-.3,.1] as Vec3},bindings:base.bindings.map(b=>({...b,offset:[.13,-.1] as Point2}))};
  const b=a.bindings[0],p=locatorProjection(a,b.locatorId),t=layerTransform(a,id),matrix=layerCardProjection(a,id,screen,unit)!;
  const anchor:Point2=[b.anchor[0]+p.point[0]-b.reference[0]+b.offset[0],b.anchor[1]+p.point[1]-b.reference[1]+b.offset[1]];
  for(const q of [b.anchor,[-.65,.8],[.35,-.5],[.6,.7]] as Point2[]){
   const delta=rotateLocal([(q[0]-b.anchor[0])/b.referenceScale,(q[1]-b.anchor[1])/b.referenceScale,0],a.pose);
   const projected=projectWorld(p.world.map((v,i)=>v+delta[i]) as Vec3,a.pose).point;
   const expected=screen([anchor[0]+projected[0]-p.point[0],anchor[1]+projected[1]-p.point[1]]);
   near(apply(matrix,screen(q.map((v,i)=>v*t.scale+t.translation[i]) as Point2)),expected);
  }
 }
});
test('enabling away from front never captures a new neutral orientation, and the front view remains identical',()=>{
 const base=fixture(),id=base.drawing.layers[0].id,screen=(p:Point2)=>p;
 expect(layerCardProjection(base,id,screen,1)).toBeUndefined();
 let a={...base,followAxisRotation:true,pose:{...base.pose,yaw:60,pitch:20}};
 const before=JSON.stringify(a),matrix=layerCardProjection(a,id,screen,1)!;
 expect(matrix).not.toEqual([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);expect(JSON.stringify(a)).toBe(before);
 a={...a,pose:{...a.pose,yaw:0,pitch:0,roll:0}};
 const front=layerCardProjection(a,id,screen,1)!;
 for(const p of [[0,0],[-1,1],[.5,.25]] as Point2[])near(apply(front,p),p);
 expect(layerCardProjection(a,'unbound',screen,1)).toBeUndefined();
 const loaded=parseAssembly(JSON.parse(JSON.stringify({...a,pose:{...a.pose,yaw:60,pitch:20}})));
 near(layerCardProjection(loaded,id,screen,1)!,matrix);expect(loaded.drawing).toEqual(base.drawing);
 expect(parseAssembly(base).followAxisRotation).toBeUndefined();expect(()=>parseAssembly({...base,followAxisRotation:'yes'})).toThrow();
});
test('near/far edges receive distinct perspective scale, and rotation is not baked into the source vectors',()=>{
 const base=fixture(),id=base.drawing.layers[0].id,a={...base,followAxisRotation:true,pose:{...base.pose,yaw:65}};
 const m=layerCardProjection(a,id,p=>p,1)!;
 const verticalLength=(x:number)=>{const lo=apply(m,[x,-.5]),hi=apply(m,[x,.5]);return Math.hypot(hi[0]-lo[0],hi[1]-lo[1]);};
 expect(Math.abs(verticalLength(-.7)-verticalLength(.7))).toBeGreaterThan(.1);
 expect(a.drawing).toBe(base.drawing);expect(a.bindings).toBe(base.bindings);
});
test('metadata and appearance can change in preview, while coordinate edits require the normal editor',()=>{
 const d=fixture().drawing;
 expect(cardGeometryChanged(d,{...d,curves:d.curves.map(c=>({...c,visible:false,width:c.width*2})),layers:d.layers.map(l=>({...l,name:'Renamed'}))})).toBe(false);
 expect(cardGeometryChanged(d,{...d,nodes:d.nodes.map(n=>({...n,position:[n.position[0]+.1,n.position[1]]}))})).toBe(true);
 expect(cardGeometryChanged(d,{...d,curves:d.curves.map(c=>({...c,handles:[[0,0],c.handles[1]]}))})).toBe(true);
});
