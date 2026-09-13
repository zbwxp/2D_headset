import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {PerspectiveCamera,Vector3} from 'three';
const fixture=()=>{
 const p=JSON.parse(readFileSync('artifacts/basic-patch/adjusted-source.json','utf8'));p.landmarks=[];p.curves=[];p.centerlineOrder=[];p.lockedViews=[];p.patches=[];p.version='landmarks-0.4.0';p.patchDisplay={opacity2d:.9,opacity3d:1};let serial=0;const uuid=()=>`00000000-0000-4000-8000-${(++serial).toString().padStart(12,'0')}`;
 for(let k=0;k<2;k++){
 // Near patch faces away from the camera; rear patch faces toward it.
 const xy=k?[[.1,-.7],[1.5,-.7],[1.5,.7],[.1,.7]]:[[.1,-.7],[.1,.7],[1.5,.7],[1.5,-.7]];
 const left:string[]=[],right:string[]=[];
 for(const [x,y] of xy){const a=uuid(),b=uuid();left.push(a);right.push(b);p.landmarks.push({id:a,name:`左${a}`,type:'LEFT',position:[x,y,-k*.3],mirrorPartnerId:b,viewLocks:{}},{id:b,name:`右${b}`,type:'RIGHT',position:[-x,y,-k*.3],mirrorPartnerId:a,viewLocks:{}});}
 const edges:string[]=[],mirrors:string[]=[];
 for(let i=0;i<4;i++){const a=uuid(),b=uuid();edges.push(a);mirrors.push(b);p.curves.push({id:a,name:`边${a}`,startLandmarkId:left[i],endLandmarkId:left[(i+1)%4],mirrorPartnerCurveId:b,role:'canonical',shape:{planeNormal:[0,0,1],startHandle:{along:1/3,offset:0},endHandle:{along:1/3,offset:0}}},{id:b,name:`边${b}`,startLandmarkId:right[i],endLandmarkId:right[(i+1)%4],mirrorPartnerCurveId:a,role:'mirror',canonicalCurveId:a});}
 const a=uuid(),b=uuid();p.patches.push({id:a,type:'quad',boundaryEdgeIds:edges,mirrorPartnerId:b},{id:b,type:'quad',boundaryEdgeIds:mirrors,mirrorPartnerId:a,canonicalId:a});
 }return p;
};
test('opaque near back-facing patch fully hides selected far front-facing patch',async({page})=>{
 const p=fixture();await page.goto('/');await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'depth.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});
 const canvas=page.getByTestId('point-inspect').locator('canvas'),r=await canvas.boundingBox();if(!r)throw Error('canvas');const c=new PerspectiveCamera(34,r.width/r.height,.1,100);c.position.set(3,1.25,4.6);c.lookAt(0,0,0);c.updateMatrixWorld();const v=new Vector3(.75,0,0).project(c);const clip={x:Math.round(r.x+(v.x+1)*r.width/2)-5,y:Math.round(r.y+(1-v.y)*r.height/2)-5,width:10,height:10};
 const before=await page.screenshot({clip});
 await page.getByTestId(`patch-row-${p.patches[2].id}`).getByRole('button').first().click();
 const behindSelected=await page.screenshot({clip});expect(behindSelected.equals(before)).toBeTruthy();
 await page.getByRole('slider',{name:'3D Patch 不透明度',exact:true}).fill('70');const translucent=await page.screenshot({clip});expect(translucent.equals(before)).toBeFalsy();
 await page.getByRole('slider',{name:'3D Patch 不透明度',exact:true}).fill('100');expect((await page.screenshot({clip})).equals(before)).toBeTruthy();
});
