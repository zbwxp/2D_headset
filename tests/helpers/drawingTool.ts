import type {Page} from '@playwright/test';
/** Connection tools live in a remembered flyout slot, like a grouped desktop toolbar. */
export async function drawingTool(page:Page,tool:string){
 const direct=page.getByTestId(`drawing-tool-${tool}`);if(await direct.count()){await direct.click();return;}
 await page.locator('[data-tool-group=connections]').click({button:'right'});await page.getByTestId(`drawing-tool-choice-${tool}`).click();
}
