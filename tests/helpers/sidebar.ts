import {expect,type Page} from '@playwright/test';
export const pairRow=(p:Page,id:string)=>p.locator(`[data-pair-primary="${id}"], [data-pair-mirror="${id}"]`);
export async function selectSidebar(p:Page,kind:'landmark'|'curve'|'patch',nameOrId:string){
 const project=await p.evaluate(()=>(window as any).__editorPerfStore.getState().project);
 const object=project[kind==='landmark'?'landmarks':kind==='curve'?'curves':'patches'].find((x:any)=>x.id===nameOrId||x.name===nameOrId);
 if(!object)throw Error(`Missing ${kind}: ${nameOrId}`);
 if(kind==='landmark'&&await p.locator('.curve-create-note').count()){
  await p.getByTestId(`landmark-${object.name}`).dispatchEvent('pointerdown',{button:0,pointerId:1});return;
 }
 if(kind==='curve'&&await p.getByRole('button',{name:'退出绘制面（Esc）'}).count()){
  await p.getByTestId(`curve-hit-${object.id}`).dispatchEvent('pointerdown',{button:0,pointerId:1,clientX:600,clientY:400});return;
 }
 const section=p.locator(kind==='landmark'?'.landmark-section':kind==='curve'?'.curve-panel':'.patch-panel');
 const heading=section.locator('.section-heading');
 if(await heading.count()&&await heading.getAttribute('aria-expanded')==='false')await heading.click();
 const row=pairRow(p,object.id);
 for(let i=0;i<2&&await row.getAttribute('data-active-id')!==object.id;i++){await row.click();await p.waitForTimeout(450);}
 await expect(row).toHaveAttribute('data-active-id',object.id);await row.focus();
}
export async function openPatch(p:Page){const heading=p.locator('.patch-panel .section-heading');if(await heading.getAttribute('aria-expanded')==='false')await heading.click();}
