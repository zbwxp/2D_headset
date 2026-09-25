import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const fixture=readFileSync('src/tests/fixtures/chin-junction-head.json','utf8');
test('old cap save becomes a three-edge jaw face and ordinary patch authoring needs no rim',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');
 await page.evaluate(async text=>{const f='/src/domain/landmarks/persistence.ts',s=(window as any).__editorPerfStore.getState();s.load((await import(f)).parseLandmarks(text));s.selectObject(null);},fixture);
 const result=await page.evaluate(()=>{
  let s=(window as any).__editorPerfStore.getState();const x=s.project.patches.find((x:any)=>x.name==='下颌面'&&!x.canonicalId),uses=x.boundaryUses;s.deletePatch(x.id);s=(window as any).__editorPerfStore.getState();const count=s.project.patches.length,past=s.past.length;s.startPatch();for(const use of uses)(window as any).__editorPerfStore.getState().addPatchBoundary(use);s=(window as any).__editorPerfStore.getState();return {uses,count,now:s.project.patches.length,past,after:s.past.length,pending:s.patchCreation.uses.length,type:s.project.patches.at(-2).type};
 });
 expect(result.uses).toHaveLength(3);expect(result.type).toBe('tri');expect(result.now).toBe(result.count+2);expect(result.after).toBe(result.past+1);expect(result.pending).toBe(0);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.patches.length)).toBe(result.count);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.patches.length)).toBe(result.now);expect(errors).toEqual([]);
});
