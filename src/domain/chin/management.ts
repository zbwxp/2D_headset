import type {LandmarkProject,SemanticLandmark} from '../landmarks/model';
import type {Vec3} from '../project/types';
import {isChin,isClosedSource,isFree3DShape} from '../curves/model';
import {evaluationContext,pointPosition} from '../geometry/evaluation';
import {dependencyGraph} from '../geometry/dependencies';
import {mirrorPoint,spatialPlacement,toRelative} from '../head/frame';
import {add,sub,scale} from '../geometry/core';
import {createCurve} from '../curves/management';
import {handleToLocal} from '../curves/free3d';
import {ensureChin,slots,seamId,slotNames,type ChinSlot} from './model';
import {chinGeometry} from './geometry';
import {unitDirection} from '../head/surfacePoint';

export function addChinPoint(p:LandmarkProject,direction:Vec3,centerline=false){
 if(!p.chinScaffold)throw Error('请先创建下巴辅助壳');
 const d=unitDirection(centerline?[0,direction[1],direction[2]]:direction);if(d[1]>1e-8)throw Error('下巴定位点必须位于下半壳');
 const id=crypto.randomUUID(),partner=crypto.randomUUID(),n=p.landmarks.filter(l=>l.placement.kind==='CHIN_SURFACE'&&!l.systemRole).length+1;
 const make=(id:string,q:Vec3,type:SemanticLandmark['type'],mirrorPartnerId?:string):SemanticLandmark=>({id,name:(type==='CENTERLINE'?'中线':type==='RIGHT'?'右':'左')+'下巴面定位点 '+n,type,placement:{kind:'CHIN_SURFACE',direction:q},viewLocks:{},...(mirrorPartnerId?{mirrorPartnerId}:{})});
 const side=d[0]<0?'LEFT':'RIGHT',points=centerline?[make(id,d,'CENTERLINE')]:[make(id,d,side,partner),make(partner,[-d[0],d[1],d[2]],side==='RIGHT'?'LEFT':'RIGHT',id)];
 return {selectedId:id,project:{...p,landmarks:[...p.landmarks,...points],centerlineOrder:centerline?[...p.centerlineOrder,id]:p.centerlineOrder}};
}

export function bindChinCurve(p:LandmarkProject,slot:ChinSlot,curveId?:string):LandmarkProject{
 if(!p.chinScaffold||!slots.includes(slot))throw Error('请先创建下巴辅助壳');
 const bindings=p.chinScaffold.bindings.filter(b=>b.slot!==slot);
 if(!curveId)return {...p,chinScaffold:{...p.chinScaffold,bindings}};
 const c=p.curves.find(c=>c.id===curveId);if(!c||isChin(c)||isClosedSource(c)||p.geometryModules?.[c.id]==='EYES')throw Error('请选择独立的 HeadSet 开放曲线');
 const graph=dependencyGraph(p),seen=new Set<string>();const depends=(key:import('../geometry/dependencies').DependencyKey):boolean=>{if(key==='chin:head')return true;if(seen.has(key))return false;seen.add(key);return (graph.dependencies.get(key)??[]).some(depends);};
 if(depends(`curve:${curveId}`))throw Error('这条线依赖下巴壳，不能反过来约束宿主。请使用“创建控制线”生成独立源线。');
 const g=evaluationContext(p).curve(curveId),reflect=toRelative(p,g.evaluate(.5))[0]<-1e-8;
 const norm=(v:Vec3)=>{const q=toRelative(p,v);if(reflect)q[0]*=-1;return q;};
 const reference=evaluationContext({...p,chinScaffold:{...p.chinScaffold,bindings}}).curve(seamId(slot));
 const a=norm(g.evaluate(0)),b=norm(g.evaluate(1)),r0=toRelative(p,reference.evaluate(0)),r1=toRelative(p,reference.evaluate(1)),d=(a:Vec3,b:Vec3)=>Math.hypot(...sub(a,b));
 const reversed=d(a,r1)+d(b,r0)<d(a,r0)+d(b,r1);
 const next={...p,chinScaffold:{...p.chinScaffold,bindings:[...bindings,{slot,curveId,reversed,reflect}]}};
 dependencyGraph(next);const result=chinGeometry(next);if(result.diagnostic)throw Error(result.diagnostic);return next;
}

/** Copy the currently seen seam into independent editable source geometry. The
 * template remains derived from that source, never a feedback dependency. */
export function createChinControl(p:LandmarkProject,slot:ChinSlot){
 if(!p.chinScaffold)p=ensureChin(p);
 const old=p.chinScaffold!.bindings.find(b=>b.slot===slot);if(old)return {project:p,selectedId:old.curveId};
 const g=evaluationContext(p).curve(seamId(slot)),a=g.evaluate(0),b=g.evaluate(1),center=slot==='CENTER';
 const baseName=slotNames[slot]+'控制线';let name=baseName,n=2;while(p.curves.some(c=>c.name.replace(/^[左右]/,'')===name))name=baseName+' '+n++;
 let next=p;
 const make=(v:Vec3,suffix:string)=>{
  // Existing independent endpoint sources are reused when two slots meet.
  for(const binding of p.chinScaffold!.bindings){const c=p.curves.find(c=>c.id===binding.curveId)!;for(const id of [c.startLandmarkId,c.endLandmarkId])if(id){const l=p.landmarks.find(l=>l.id===id)!;if(l.type!=='LEFT'&&Math.hypot(...sub(pointPosition(p,id),v))<1e-6)return id;}}
  const isCenter=Math.abs(toRelative(p,v)[0])<1e-8,id=crypto.randomUUID(),mirrorId=crypto.randomUUID(),name=slotNames[slot]+'控制'+suffix;
  const point:SemanticLandmark={id,name:(isCenter?'':'右')+name,type:isCenter?'CENTERLINE':'RIGHT',placement:spatialPlacement(p,v),viewLocks:{},...(!isCenter?{mirrorPartnerId:mirrorId}:{})};
  const points=[point];if(!isCenter)points.push({...point,id:mirrorId,name:'左'+name,type:'LEFT',mirrorPartnerId:id,placement:spatialPlacement(p,mirrorPoint(p,v))});
  next={...next,landmarks:[...next.landmarks,...points]};return id;
 };
 const aId=make(a,'起点'),bId=make(b,'终点'),created=createCurve(next,aId,bId,p.views[0],name);next=created.project;
 // Cubic least squares fit to the displayed seam, with fixed endpoints.
 let aa=0,ab=0,bb=0;let ya:Vec3=[0,0,0],yb:Vec3=[0,0,0];for(let i=1;i<32;i++){const t=i/32,u=1-t,w0=3*u*u*t,w1=3*u*t*t,q=sub(g.evaluate(t),add(scale(a,u**3),scale(b,t**3)));aa+=w0*w0;ab+=w0*w1;bb+=w1*w1;ya=add(ya,scale(q,w0));yb=add(yb,scale(q,w1));}
 const det=aa*bb-ab*ab,h0=scale(sub(scale(ya,bb),scale(yb,ab)),1/det),h1=scale(sub(scale(yb,aa),scale(ya,ab)),1/det),startHandleOffset=handleToLocal(p,sub(h0,a)),endHandleOffset=handleToLocal(p,sub(h1,b));
 if(center){startHandleOffset[0]=0;endHandleOffset[0]=0;}
 next={...next,curves:next.curves.map(c=>c.id===created.selectedId&&c.role==='canonical'&&!isChin(c)&&c.shape&&isFree3DShape(c.shape)?{...c,shape:{kind:'FREE_3D' as const,startHandleOffset,endHandleOffset}}:c)};
 return {project:bindChinCurve(next,slot,created.selectedId),selectedId:created.selectedId};
}
