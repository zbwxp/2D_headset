import {test,expect,type Page} from '@playwright/test';
import {writeFileSync,readFileSync} from 'node:fs';
import {createLandmarkProject} from '../../src/domain/landmarks/presets';
import {emptyDrawing} from '../../src/domain/drawing/model';
import {addLayer,createCurve} from '../../src/domain/drawing/commands';
import {saveDrawingSnapshot} from '../../src/domain/drawing/snapshots';

function fixture(){
 let d=addLayer(emptyDrawing(),'Face');d=createCurve(d,d.layers[0].id,[[-.5,0],[-.3,.4],[.3,.4],[.5,0]],.012,'Face','face');
 let s=saveDrawingSnapshot({drawing:d},'正面');
 const side=structuredClone(d);side.nodes.forEach(n=>n.position[0]+=.1);side.curves.forEach(c=>c.handles.forEach(h=>h[0]+=.1));
 s=saveDrawingSnapshot({...s,drawing:createCurve(side,side.layers[0].id,[[.2,.6],[.3,.6],[.4,.5],[.4,.4]],.01,'Extra hair','hair')},'微侧13');
 return {...createLandmarkProject(),...s};
}
async function angle(p:Page,value:string){
 const slider=p.getByRole('slider',{name:'录制 Yaw',exact:true});
 await slider.locator('..').getByTitle('双击输入数值').dblclick();
 const input=p.getByRole('textbox',{name:'录制 Yaw 数值',exact:true});await input.fill(value);await input.press('Enter');
}
test('snapshot-only recording, head reference, frozen extra element, placement, Undo and save/reload',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');const sourceProject=fixture(),file=info.outputPath('poses.json');writeFileSync(file,JSON.stringify(sourceProject));
 await page.locator('header input[type=file]').setInputFiles(file);
 await page.getByTestId('room-toggle').click();
 await expect(page.getByTestId('recording-head-reference').locator('canvas')).toBeVisible();
 await expect(page.getByRole('button',{name:'新建录制语义点',exact:true})).toHaveCount(0);
 await page.getByTestId('pose-source').selectOption({label:'正面'});await page.getByTestId('pose-capture').click();
 const ink=page.getByTestId('recording-artwork').locator('path').first(),beforePlacement=await ink.getAttribute('d');
 await expect(page.getByTestId('recording-artwork-copy')).toHaveAttribute('href','#'+await page.getByTestId('recording-artwork').getAttribute('id'));
 const x=page.getByRole('spinbutton',{name:'姿态平移 X',exact:true}),y=page.getByRole('spinbutton',{name:'姿态平移 Y',exact:true});
 await x.fill('.2');await expect(x).toBeFocused();await expect(ink).not.toHaveAttribute('d',beforePlacement!);
 await x.fill('.35');await x.press('Enter');await page.getByRole('button',{name:'撤销',exact:true}).click();
 await expect(x).toHaveValue('0');await expect(ink).toHaveAttribute('d',beforePlacement!);
 await y.fill('-.3');await expect(y).toBeFocused();await expect(ink).not.toHaveAttribute('d',beforePlacement!);
 await y.press('Escape');await expect(y).toHaveValue('0');await expect(ink).toHaveAttribute('d',beforePlacement!);
 await page.locator('.pose-reference-scale .numeric-slider-value').dblclick();
 await page.getByRole('textbox',{name:'头壳大小 数值',exact:true}).fill('75');await page.getByRole('textbox',{name:'头壳大小 数值',exact:true}).press('Enter');
 await expect(ink).toHaveAttribute('d',beforePlacement!);await expect(page.getByRole('slider',{name:'头壳大小',exact:true})).toHaveValue('0.75');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByRole('slider',{name:'头壳大小',exact:true})).toHaveValue('1');
 await page.getByRole('button',{name:'重做',exact:true}).click();
 await angle(page,'15');await page.getByTestId('pose-source').selectOption({label:'微侧13'});await page.getByTestId('pose-capture').click();
 await expect(page.getByTestId('pose-row')).toHaveCount(2);
 await angle(page,'7.5');await expect(page.getByTestId('pose-frozen')).toHaveCount(1);
 await expect(page.getByTestId('recording-artwork')).toHaveAttribute('data-quality','full');
 await expect(page.getByTestId('recording-final').locator('[data-testid="drawing-ink"]')).toHaveCount(0); // shared SVG instance, not a second renderer
 const ghost=await page.getByTestId('pose-frozen').getAttribute('d');
 await angle(page,'5');await expect(page.getByTestId('pose-frozen')).toHaveAttribute('d',ghost!);
 await expect(page.getByTestId('recording-final').getByTestId('pose-frozen')).toHaveCount(0);
 await page.getByTestId('pose-row').filter({hasText:'微侧13'}).click();await expect(page.getByTestId('pose-frozen')).toHaveCount(0);
 const box=(await page.getByTestId('recording-canvas').boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+30,box.y+box.height/2+20,{steps:5});await page.mouse.up();
 await expect(page.getByRole('spinbutton',{name:'姿态平移 X',exact:true})).not.toHaveValue('0');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByRole('spinbutton',{name:'姿态平移 X',exact:true})).toHaveValue('0');
 await page.getByRole('button',{name:'重做',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'保存 JSON',exact:true}).click();
 const savedPath=(await (await download).path())!,saved=JSON.parse(readFileSync(savedPath,'utf8'));
 expect(saved.poseRecording.poses).toHaveLength(2);expect(saved.recording).toBeUndefined();
 expect(saved.poseRecording.referenceScale).toBe(.75);
 expect(saved.poseRecording.poses[1].offset[0]).toBeGreaterThan(0);expect(saved.drawingSnapshots).toEqual(sourceProject.drawingSnapshots);
 await page.locator('header input[type=file]').setInputFiles(savedPath);await expect(page.getByTestId('pose-row')).toHaveCount(2);
 await page.getByTestId('pose-row').filter({hasText:'微侧13'}).click();await page.getByTestId('pose-delete').click();await expect(page.getByTestId('pose-row')).toHaveCount(1);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByTestId('pose-row')).toHaveCount(2);
 expect(errors).toEqual([]);
});
