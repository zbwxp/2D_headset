import type {Page} from '@playwright/test';
/** Autosave is asynchronous; wait for the latest source snapshot, not an arbitrary sleep. */
export async function savedProject(page:Page){
 await page.waitForFunction(()=>{const live=(window as any).__editorPerfStore?.getState().project,raw=localStorage.getItem('contour.landmarks.v039');return raw&&live&&JSON.stringify(JSON.parse(raw))===JSON.stringify(live);});
 return page.evaluate(()=>JSON.parse(localStorage.getItem('contour.landmarks.v039')!));
}
