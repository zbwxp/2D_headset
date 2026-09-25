import type {LandmarkProject,SemanticLandmark} from '../landmarks/model';
import type {CurveEdge} from '../curves/model';
import type {Vec3} from '../project/types';
import type {HeadFrame} from '../head/frame';
export const chinId=(n:number)=>`09500000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const CHIN=chinId(1);
export const slots=['CENTER','FRONT','REAR','SIDE','FRONT_RIM','REAR_RIM'] as const;
export type ChinSlot=typeof slots[number];
export const slotNames:Record<ChinSlot,string>={CENTER:'下巴中线',FRONT:'前横弧',REAR:'后横弧',SIDE:'侧连接弧',FRONT_RIM:'前开口弧',REAR_RIM:'后开口弧'};
export interface ChinParameters {width:number;depth:number;height:number;y:number;z:number;pitch:number;roundness:number;frontBulge:number;rearBulge:number;pinchToNeck:number}
export const defaults:ChinParameters={width:.06,depth:.05,height:.03,y:-.83,z:.33,pitch:0,roundness:.5,frontBulge:.12,rearBulge:0,pinchToNeck:.25};
export const parameterRanges:Record<keyof ChinParameters,[number,number]>={width:[.01,.1],depth:[.01,.1],height:[.01,.1],y:[-1.8,-.2],z:[-.4,1.2],pitch:[-90,90],roundness:[0,1],frontBulge:[0,.6],rearBulge:[0,.6],pinchToNeck:[0,.7]};
export interface ChinBinding {slot:ChinSlot;curveId:string;reversed:boolean;reflect:boolean}
export type ChinArm = 'UP'|'DOWN'|'UPPER_PAIR'|'LOWER_PAIR';
export const armNames:Record<ChinArm,string>={UP:'上线影响范围',DOWN:'下线影响范围',UPPER_PAIR:'上左右线影响范围',LOWER_PAIR:'下左右线影响范围'};
export const defaultRanges:Record<ChinArm,number>={UP:.08,DOWN:.08,UPPER_PAIR:.08,LOWER_PAIR:.08};
/** Version 3 is one vertex. Legacy shell parameters are retained only for reading
 * older projects; only y/z locate the point. No independent chin surface exists. */
export interface ChinScaffold {version:2|3;visible:boolean;parameters:ChinParameters;bindings:ChinBinding[];ranges?:Record<ChinArm,number>;arms?:Record<string,ChinArm>}
export const isChinNode=(p:LandmarkProject)=>p.chinScaffold?.version===3;
export const chinRoles=['CHIN_C','CHIN_M','CHIN_N','CHIN_F','CHIN_B','CHIN_RF','CHIN_LF','CHIN_RR','CHIN_LR'] as const;
export type ChinPointRole=typeof chinRoles[number];
const r=Math.sqrt(.75);
export const chinDirections:Record<ChinPointRole,Vec3>={CHIN_C:[0,0,1],CHIN_M:[0,-1,0],CHIN_N:[0,0,-1],CHIN_F:[0,-r,.5],CHIN_B:[0,-r,-.5],CHIN_RF:[r,0,.5],CHIN_LF:[-r,0,.5],CHIN_RR:[r,0,-.5],CHIN_LR:[-r,0,-.5]};
const ends:Record<ChinSlot,[ChinPointRole,ChinPointRole]>={CENTER:['CHIN_C','CHIN_N'],FRONT:['CHIN_F','CHIN_RF'],REAR:['CHIN_B','CHIN_RR'],SIDE:['CHIN_RF','CHIN_RR'],FRONT_RIM:['CHIN_C','CHIN_RF'],REAR_RIM:['CHIN_RR','CHIN_N']};
export const pointId=(role:ChinPointRole)=>chinId(100+chinRoles.indexOf(role));
export const seamId=(slot:ChinSlot,left=false)=>chinId(10+slots.indexOf(slot)*2+(left?1:0));
export function seamDirection(slot:ChinSlot,t:number):Vec3{
 t=Math.max(0,Math.min(1,t));
 if(slot==='CENTER')return [0,-Math.sin(Math.PI*t),Math.cos(Math.PI*t)];
 if(slot==='FRONT'||slot==='REAR')return [r*Math.sin(Math.PI*t/2),-r*Math.cos(Math.PI*t/2),slot==='FRONT'?.5:-.5];
 const a=slot==='SIDE'?Math.PI/3+Math.PI*t/3:slot==='FRONT_RIM'?Math.PI*t/3:2*Math.PI/3+Math.PI*t/3;
 return [Math.sin(a),0,Math.cos(a)];
}
export function parseChin(input:unknown,frame?:HeadFrame):ChinScaffold|undefined{
 if(input===undefined)return;const q=input as ChinScaffold;
 const legacy=(q as {version?:number})?.version===1;
 if(!q||!legacy&&q.version!==2&&q.version!==3||typeof q.visible!=='boolean'||!q.parameters||!Array.isArray(q.bindings))throw Error('下巴辅助壳数据无效');
 const oldRanges={width:[.15,1],depth:[.15,.9],height:[.08,.6]} as const;
 const parameters={...defaults};for(const key of Object.keys(defaults) as (keyof ChinParameters)[]){
  const n=legacy&&key==='pitch'?0:q.parameters[key],[lo,hi]=legacy&&key in oldRanges?oldRanges[key as keyof typeof oldRanges]:q.version===3&&(key==='y'||key==='z')?[-2,2]:parameterRanges[key];
  if(!Number.isFinite(n)||n<lo||n>hi)throw Error('下巴辅助壳参数超出范围');parameters[key]=n;
 }
 if(legacy){
  // Old dimensions used each ellipsoid axis independently. V2 uses one R,
  // shrinking oversized templates together so their proportions survive.
  parameters.width*=2;
  parameters.depth*=2*(frame?.radiusZ??1)/(frame?.radiusX??1);
  parameters.height*=(frame?.radiusY??1)/(frame?.radiusX??1);
  const factor=Math.min(1,.1/Math.max(parameters.width,parameters.depth,parameters.height));
  for(const key of ['width','depth','height'] as const)parameters[key]=Math.max(.01,Math.min(.1,parameters[key]*factor));
 }
 const seen=new Set<string>();const bindings=q.bindings.map(b=>{if(!b||!slots.includes(b.slot)||seen.has(b.slot)||typeof b.curveId!=='string'||typeof b.reversed!=='boolean'||typeof b.reflect!=='boolean')throw Error('下巴曲线约束数据无效');seen.add(b.slot);return {slot:b.slot,curveId:b.curveId,reversed:b.reversed,reflect:b.reflect};});
 if(q.version===3){
  if(!q.ranges||Object.keys(defaultRanges).some(k=>!Number.isFinite(q.ranges![k as ChinArm])||q.ranges![k as ChinArm]<.01||q.ranges![k as ChinArm]>.1))throw Error('下巴平滑影响范围无效');
  if(q.arms&&Object.values(q.arms).some(v=>!(v in defaultRanges)))throw Error('下巴连接方向无效');
  return {version:3,visible:q.visible,parameters,bindings:[],ranges:{...q.ranges},arms:{...q.arms}};
 }
 return {version:2,visible:q.visible,parameters,bindings};
}
export function ensureChin(p:LandmarkProject):LandmarkProject{
 if(!p.headFrame)throw Error('下巴辅助壳需要 HeadFrame');
 const chinScaffold=parseChin(p.chinScaffold,p.headFrame)??{version:3 as const,visible:true,parameters:{...defaults},bindings:[],ranges:{...defaultRanges},arms:{}};
 if(chinScaffold.version===3){const id=pointId('CHIN_M');return {...p,version:'landmarks-0.9.7',chinScaffold,landmarks:[...p.landmarks.filter(l=>l.id!==id),{id,name:'下巴',systemRole:'CHIN_M',type:'CENTERLINE',placement:{kind:'CHIN_SURFACE',direction:[0,-1,0]},viewLocks:{}}]};}
 const labels=['下巴前尖','颌底中心','前颈中心','前弧中心','后弧中心','右前挂接点','左前挂接点','右后挂接点','左后挂接点'];
 const landmarks:SemanticLandmark[]=chinRoles.map((role,i)=>({id:pointId(role),name:labels[i],systemRole:role,type:i<5?'CENTERLINE':i%2?'RIGHT':'LEFT',placement:{kind:'CHIN_SURFACE',direction:chinDirections[role]},viewLocks:{},...(i>=5?{mirrorPartnerId:pointId(chinRoles[i+(i%2?1:-1)])}:{})}));
 const curves:CurveEdge[]=slots.flatMap<CurveEdge>(slot=>{const [a,b]=ends[slot],id=seamId(slot),mirrorId=seamId(slot,true),base={id,name:(slot==='CENTER'?'':'右')+slotNames[slot],geometryType:'CHIN_SEAM' as const,systemRole:'CHIN_'+slot,slot,startLandmarkId:pointId(a),endLandmarkId:pointId(b)};
 if(slot==='CENTER')return [{...base,role:'canonical' as const}];
 const mirror=(role:ChinPointRole)=>role==='CHIN_RF'?'CHIN_LF':role==='CHIN_RR'?'CHIN_LR':role;
 return [{...base,role:'canonical' as const,mirrorPartnerCurveId:mirrorId},{...base,id:mirrorId,name:'左'+slotNames[slot],role:'mirror' as const,canonicalCurveId:id,mirrorPartnerCurveId:id,startLandmarkId:pointId(mirror(a)),endLandmarkId:pointId(mirror(b))}];});
 const merge=<T extends {id:string;name:string;contourRole?:'NONE'|'OPEN_EDGE'}>(old:T[],generated:T[])=>[...old.filter(x=>!generated.some(y=>x.id===y.id)),...generated.map(x=>({...x,name:old.find(y=>y.id===x.id)?.name??x.name,...(old.find(y=>y.id===x.id)?.contourRole?{contourRole:old.find(y=>y.id===x.id)!.contourRole}:{})}))];
 return {...p,version:'landmarks-0.9.5',chinScaffold,landmarks:merge(p.landmarks,landmarks),curves:merge(p.curves,curves)};
}
