import fs from 'node:fs';
import assert from 'node:assert/strict';
import {parseLandmarks} from '/Users/bowen/Documents/headset/src/domain/landmarks/persistence';
import {duplicateLandmark} from '/Users/bowen/Documents/headset/src/domain/landmarks/management';
import {createCurve,renameCurve} from '/Users/bowen/Documents/headset/src/domain/curves/management';
import {controls,followEndpoints} from '/Users/bowen/Documents/headset/src/domain/curves/geometry';
import {mirror,modelStateCode} from '/Users/bowen/Documents/headset/src/domain/landmarks/model';
import {add,sub,scale,dot,cross,normalize} from '/Users/bowen/Documents/headset/src/domain/geometry/core';
import {resolveNetwork} from '/Users/bowen/Documents/headset/src/domain/junctions/resolve';
const root='/Users/bowen/Documents/headset/artifacts/head-neck-refinement';
let p=parseLandmarks(fs.readFileSync('/Users/bowen/Documents/headset/artifacts/lineart-match/matched.json','utf8'));
const prev=p;p={...p,landmarks:p.landmarks.map(l=>l.name==='颅壳中轴·后颈连接点'?{...l,position:[0,-125.1598994038166/160,l.position[2]]}:l)};p=followEndpoints(prev,p);console.log('reconstructed latest',modelStateCode(p));fs.writeFileSync(root+'/before.json',JSON.stringify(p,null,2));
const byname=(name:string)=>p.landmarks.find(l=>l.name===name)!; const point=(id:string)=>p.landmarks.find(l=>l.id===id)!;
const moved=p;p={...p,landmarks:p.landmarks.map(l=>{const z=l.name.includes('面壳前边界·额颞')?.67:l.name.includes('面壳前边界·颧颊')?.70:l.name.includes('面壳前边界·下颊')?.63:null;return z===null?l:{...l,position:[l.position[0],l.position[1],z]};})};p=followEndpoints(moved,p);
function dup(source:string,name:string,pos:any){const r=duplicateLandmark(p,byname(source).id,name);p=r.project;const l=point(r.selectedId);p={...p,landmarks:p.landmarks.map(x=>x.id===l.id?{...x,position:pos}:x.id===l.mirrorPartnerId?{...x,position:mirror(pos)}:x)};return l.id;}
const uf=dup('面壳中轴·下巴前端点','头颈交界·颏颈转折点',[0,-1.06,.17]);
const us=dup('左颈部接口·侧向连接点','头颈交界·侧向连接点',[.33,-.92,-.14]);
const lr=dup('颅壳中轴·后颈连接点','颈部接口·后中点',[0,-1.32,-.49]);
const ur=byname('颅壳中轴·后颈连接点').id,lf=byname('颈部接口·前中点').id,ls=byname('左颈部接口·侧向连接点').id,chin=byname('面壳中轴·下巴前端点').id;
const neckPrev=p;p={...p,landmarks:p.landmarks.map(l=>l.id===lf?{...l,position:[0,-1.43,.16]}:l.id===ls?{...l,position:[.31,-1.38,-.16]}:l.id===point(ls).mirrorPartnerId?{...l,position:[-.31,-1.38,-.16]}:l)};p=followEndpoints(neckPrev,p);
function rewire(name:string,a:string,b:string,newName:string){let c=p.curves.find(c=>c.name===name)!;p={...p,curves:p.curves.map(x=>x.id===c.id?{...x,startLandmarkId:a,endLandmarkId:b}:x.id===c.mirrorPartnerCurveId?{...x,startLandmarkId:point(a).mirrorPartnerId??a,endLandmarkId:point(b).mirrorPartnerId??b}:x)};p=renameCurve(p,c.id,newName);}
rewire('颏下中轴·下巴至颈前',chin,uf,'颏下轮廓·下巴至颏颈转折');
rewire('左颈口边界·侧点至后中点',ls,lr,'颈部下环·侧点至后中点');
for(const name of ['左颈口边界·前中点至侧点'])p=renameCurve(p,p.curves.find(c=>c.name===name)!.id,'颈部下环·前中点至侧点');
rewire('左侧面下缘·下颌角至颈口',byname('左面壳后边界·下颌角定位点').id,us,'下颌至头颈上环·侧向连接');
function make(a:string,b:string,n:string){p=createCurve(p,a,b,p.views.find(v=>v.id==='side')!,n).project;}
make(uf,us,'头颈上环·前中点至侧点');make(us,ur,'头颈上环·侧点至后中点');make(uf,lf,'颈前纵线·上环至下环');make(us,ls,'颈侧纵线·上环至下环');make(ur,lr,'颈后纵线·上环至下环');
function handles(c:any,h1:any,h2:any){const A=point(c.startLandmarkId).position,B=point(c.endLandmarkId).position,d=normalize(sub(B,A)),L=Math.hypot(...sub(B,A));let n=normalize(cross(sub(h1,A),sub(B,A)));if(Math.hypot(...n)<1e-6)n=normalize(cross(sub(h2,A),sub(B,A)));const b=normalize(cross(n,d));c.shape={planeNormal:n,startHandle:{along:dot(sub(h1,A),d)/L,offset:dot(sub(h1,A),b)/L},endHandle:{along:-dot(sub(h2,B),d)/L,offset:dot(sub(h2,B),b)/L}};}
for(const c of p.curves){if(c.role!=='canonical')continue;const A=point(c.startLandmarkId).position,B=point(c.endLandmarkId).position;
 if(c.name.includes('颅壳后侧弧')){const K=[B[0],B[1],A[2]] as any;handles(c,add(A,scale(sub(K,A),.66)),add(B,scale(sub(K,B),.66)));}
 if(c.name.includes('头颈上环·')||c.name.includes('颈部下环·')){const front=c.name.includes('前中点');const K=(front?[B[0],(A[1]+B[1])/2,A[2]]:[A[0],(A[1]+B[1])/2,B[2]]) as any;handles(c,add(A,scale(sub(K,A),.60)),add(B,scale(sub(K,B),.60)));}
 if(c.name==='颏下轮廓·下巴至颏颈转折')handles(c,[0,A[1]-.07,A[2]-.16],[0,B[1]+.08,B[2]]);
 if(c.name.includes('纵线·')){c.shape={planeNormal:c.name.includes('颈侧')?[0,0,1]:[1,0,0],startHandle:{along:1/3,offset:0},endHandle:{along:1/3,offset:0}};let n=c.shape.planeNormal,d=normalize(sub(B,A));c.shape.planeNormal=normalize(sub(n,scale(d,dot(n,d))));}
 if(c.name.includes('下颌至头颈上环')){const d=normalize(sub(B,A));c.shape={planeNormal:normalize(cross(d,[0,1,0])),startHandle:{along:1/3,offset:0},endHandle:{along:1/3,offset:0}};}
}
// Keep the explicit guide traversal from posterior skull around to the anterior neck.
p.centerlineOrder=p.centerlineOrder.filter(id=>id!==lr&&id!==uf);const ci=p.centerlineOrder.indexOf(chin);p.centerlineOrder.splice(ci+1,0,uf);p.centerlineOrder.unshift(lr);
p.meta={...p.meta,name:'头壳调整—前脸转折与双层颈环',updatedAt:Date.now()};p=parseLandmarks(JSON.stringify(p));
let residual=0;for(const c of p.curves){const cp=controls(p,c);if(c.role==='canonical')for(const q of cp)residual=Math.max(residual,Math.abs(dot(sub(q,cp[0]),c.shape.planeNormal)));}
assert(residual<1e-8);for(const l of p.landmarks)if(l.mirrorPartnerId)assert.deepEqual(point(l.mirrorPartnerId).position,mirror(l.position));
const net=resolveNetwork(p);assert(net.junctions.every(j=>j.state==='VALID'));
for(const label of ['头颈上环·','颈部下环·']){const edges=p.curves.filter(c=>c.name.replace(/^[左右]/,'').startsWith(label)),counts=new Map();for(const c of edges)for(const id of [c.startLandmarkId,c.endLandmarkId])counts.set(id,(counts.get(id)||0)+1);assert.equal(edges.length,4);assert.equal(counts.size,4);assert([...counts.values()].every(n=>n===2));}
fs.writeFileSync(root+'/refined.json',JSON.stringify(p,null,2));fs.writeFileSync(root+'/evaluation.json',JSON.stringify({curves:p.curves.map(c=>({name:c.name,controls:controls(p,c)})),spans:net.spans}));fs.writeFileSync(root+'/validation.json',JSON.stringify({points:p.landmarks.length,curves:p.curves.length,planeResidual:residual,closedRings:2,validJunctions:net.junctions.length,modelState:modelStateCode(p)},null,2));console.log(p.landmarks.length,p.curves.length,modelStateCode(p));
