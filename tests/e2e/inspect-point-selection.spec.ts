import {test,expect} from '@playwright/test';
import {PerspectiveCamera,Vector3} from 'three';
import {readFileSync} from 'node:fs';
import {parseLandmarks} from '../../src/domain/landmarks/persistence';
import {pointPosition,evaluationContext} from '../../src/domain/geometry/evaluation';
test('3D ordinary point selection takes priority over incident edges, drag still orbits',async({page})=>{
 const p=parseLandmarks(readFileSync('artifacts/basic-patch/adjusted-source.json','utf8'));
 await page.goto('/');await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({name:'point-picking.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});
 const canvas=page.getByTestId('point-inspect').locator('canvas');const rect=await canvas.boundingBox();if(!rect)throw Error('canvas');
 const camera=new PerspectiveCamera(34,rect.width/rect.height,.1,100);camera.position.set(3,1.25,4.6);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const loaded=await page.evaluate(()=>window.__editorPerfStore.getState().project);
 const candidates=loaded.landmarks.map(l=>({id:l.id,type:l.type,kind:l.placement.kind,q:new Vector3(...pointPosition(loaded,l.id)).project(camera)})).filter(l=>Math.abs(l.q.x)<.8&&Math.abs(l.q.y)<.8);
 const target=candidates.find(l=>l.type==='CENTERLINE'&&l.kind!=='LOOMIS_SCAFFOLD'&&candidates.every(o=>o.id===l.id||Math.hypot((o.q.x-l.q.x)*rect.width/2,(o.q.y-l.q.y)*rect.height/2)>25));if(!target)throw Error('no isolated point');
 const x=rect.x+(target.q.x+1)*rect.width/2,y=rect.y+(1-target.q.y)*rect.height/2;
 await page.mouse.move(x+4,y+2);await expect(canvas).toHaveAttribute('data-hover-point',target.id);
 await page.mouse.click(x,y);await expect.poll(()=>page.evaluate(()=>window.__editorPerfStore.getState().selectedId)).toBe(target.id);
 expect(await page.evaluate(()=>window.__editorPerfStore.getState().selectedCurveId)).toBeNull();
 // Hover a curve away from endpoints, without changing selection.
 const ctx=evaluationContext(loaded);let lineHit=false;
 for(const edge of loaded.curves){const q=new Vector3(...ctx.curve(edge.id).evaluate(.47)).project(camera);if(Math.abs(q.x)>.8||Math.abs(q.y)>.8||candidates.some(p=>Math.hypot((p.q.x-q.x)*rect.width/2,(p.q.y-q.y)*rect.height/2)<25))continue;
 await page.mouse.move(rect.x+(q.x+1)*rect.width/2,rect.y+(1-q.y)*rect.height/2);if(await canvas.getAttribute('data-hover-curve')){lineHit=true;break;}}
 expect(lineHit).toBe(true);expect(await page.evaluate(()=>window.__editorPerfStore.getState().selectedId)).toBe(target.id);
 await page.mouse.move(rect.x+3,rect.y+3);await expect(canvas).not.toHaveAttribute('data-hover-point');
 const before=await page.evaluate(()=>JSON.stringify(window.__editorPerfStore.getState().project));
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+50,y+25,{steps:8});await page.mouse.up();
 expect(await page.evaluate(()=>window.__editorPerfStore.getState().selectedId)).toBe(target.id);expect(await page.evaluate(()=>JSON.stringify(window.__editorPerfStore.getState().project))).toBe(before);
});
