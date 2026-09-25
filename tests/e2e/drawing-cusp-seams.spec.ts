import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const hair=JSON.parse(readFileSync('src/tests/fixtures/drawing-cusp-hair.json','utf8'));

test('hair display intervals have solid cusp roots in the actual rendered ink',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');await page.getByTestId('drawing-room-toggle').click();
 const roots=await page.evaluate(async(hair)=>{
  const m=await import('/src/domain/drawing/model.ts' as string),s=await import('/src/domain/drawing/strokes.ts' as string),a=await import('/src/domain/drawing/appearance.ts' as string),ranges=await import('/src/domain/drawing/displayIntervals.ts' as string);
  let d=m.parseDrawing(hair);
  for(const stroke of s.strokes(d,d.layers[0].id)){d=ranges.addDisplayInterval(d,stroke.id);const t=d.displayIntervals.at(-1),r=t.ranges[0];d=ranges.changeDisplayInterval(d,t.id,r.id,{start:.001,end:.999});d=ranges.setDisplayIntervalEnd(d,t.id,r.id,0,{taper:.002});d=ranges.setDisplayIntervalEnd(d,t.id,r.id,1,{taper:.002});}
  (window as any).__editorPerfStore.getState().setDrawing(d);
  return s.strokes(d,d.layers[0].id).flatMap((stroke:any)=>a.strokeInk(d,stroke)).filter((run:any)=>!run.uniform).flatMap((run:any)=>run.tips.flatMap((tip:number[][])=>{
   const p=tip[0],v=[tip[2][0]-p[0],tip[2][1]-p[1]],len=Math.hypot(...v);
   return [tip[1],tip[3]].flatMap(base=>[.25,.5].map(f=>[p[0]+f*(base[0]-p[0])-.0001*v[0]/len,p[1]+f*(base[1]-p[1])-.0001*v[1]/len]));
  }));
 },hair);
 await page.getByRole('button',{name:'Fit',exact:true}).click();await page.getByRole('button',{name:'Hide editing helpers',exact:true}).click();
 // Filled ink and its pointed corner are now one path, with no antialiased seam.
 await expect(page.getByTestId('drawing-cusp-tip')).toHaveCount(0);
 const checks=await page.evaluate(async(roots)=>{
  const {strokes}=await import('/src/domain/drawing/strokes.ts' as string),{strokeInk}=await import('/src/domain/drawing/appearance.ts' as string),d=(window as any).__editorPerfStore.getState().project.drawing;
  const svg=document.querySelector('[data-testid="drawing-canvas"]') as SVGSVGElement,r=svg.getBoundingClientRect(),copy=svg.cloneNode(true) as SVGSVGElement,ink=svg.querySelector('[data-testid="drawing-ink"]')!,stroke=strokes(d,d.layers[0].id).find((s:any)=>s.id===ink.getAttribute('data-stroke')),outline=strokeInk(d,stroke)[0].outline,xy=ink.getAttribute('d')!.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
  // Recover the displayed affine map from its first two distinct outline vertices.
  const k=outline.findIndex((p:number[])=>Math.hypot(p[0]-outline[0][0],p[1]-outline[0][1])>1e-6),unit=Math.hypot(xy[2*k]-xy[0],xy[2*k+1]-xy[1])/Math.hypot(outline[k][0]-outline[0][0],outline[k][1]-outline[0][1]),origin=[xy[0]-outline[0][0]*unit,xy[1]+outline[0][1]*unit];
  copy.setAttribute('width',String(r.width));copy.setAttribute('height',String(r.height));const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(copy))));await image.decode();
  const canvas=document.createElement('canvas');canvas.width=r.width;canvas.height=r.height;const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,r.width,r.height);ctx.drawImage(image,0,0);
  return roots.map(([x,y]:number[])=>({point:[x,y],red:ctx.getImageData(Math.floor(origin[0]+x*unit),Math.floor(origin[1]-y*unit),1,1).data[0]}));
 },roots);
 expect(checks.length).toBeGreaterThan(20);for(const sample of checks)expect(sample.red,`white seam at ${sample.point}`).toBeLessThan(80);
 await page.screenshot({path:'artifacts/drawing-arc/cusp-connected-hair.png'});
});
