// Run from the repository root, after starting instrumented archives on 5175/5176.
const {chromium}=await import(process.cwd()+'/node_modules/playwright-core/index.mjs');
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
for(const [version,port] of [['045',5175],['046',5176]]){
 const page=await browser.newPage({viewport:{width:1800,height:1100}});
 page.on('pageerror',e=>console.log(version,e.stack));
 await page.goto(`http://127.0.0.1:${port}`);
 await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles(process.cwd()+'/artifacts/surface-smooth/full-head-regression.json');
 await page.getByRole('checkbox',{name:'显示 Contour 窗口',exact:true}).check();
 await page.waitForTimeout(12000);
 await page.waitForFunction(()=>document.querySelector('[data-testid=contour-preview]')?.getAttribute('aria-busy')==='false');
 const b=await page.getByTestId('point-inspect').locator('canvas').boundingBox();
 await page.mouse.move(b.x+b.width*.5,b.y+b.height*.5);await page.mouse.down();
 await page.evaluate(()=>{const m=window.__contourProfile;for(const k in m)m[k]=Array.isArray(m[k])?[]:0;window.__geometryPerformance?.reset();});
 const start=Date.now();let n=0;
 while(Date.now()-start<3000){const t=(Date.now()-start)/3000;await page.mouse.move(b.x+b.width*(.5+.23*Math.sin(t*8)),b.y+b.height*(.5+.12*Math.sin(t*5)));await page.waitForTimeout(16);n++;}
 const during=await page.evaluate(()=>({profile:window.__contourProfile,geometry:window.__geometryPerformance?.snapshot()}));
 await page.mouse.up();await page.waitForTimeout(3000);
 const after=await page.evaluate(()=>({profile:window.__contourProfile,geometry:window.__geometryPerformance?.snapshot()}));
 writeFileSync(`artifacts/contour-camera/v${version}.json`,JSON.stringify({n,duration:3000,during,after},null,2));
 console.log(version,JSON.stringify({...during.profile,stages:during.profile.stages.reduce((a,s)=>{for(const k in s)a[k]=(a[k]||0)+s[k]/during.profile.stages.length;return a;},{})}),during.geometry);
 await page.close();
}
await browser.close();
