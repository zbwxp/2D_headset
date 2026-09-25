import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const fixture=readFileSync('src/tests/fixtures/chin-point-head.json','utf8');
test('actual chin save: one point, four influence controls, no cap, Undo/Redo and reload',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('contour.ui-language','en'));await page.goto('/');
 await page.evaluate(async text=>{const f='/src/domain/landmarks/persistence.ts',s=(window as any).__editorPerfStore.getState();s.load((await import(f)).parseLandmarks(text));s.selectObject(null);},fixture);
 const section=page.getByTestId('chin-construction');await section.getByRole('button',{name:/Chin Junction/}).click();
 await expect(section.getByRole('slider')).toHaveCount(4);await expect(section.getByTestId('chin-attachment-count')).toHaveText('Attached curves：5');
 const source=await page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project.curves));
 const slider=section.getByRole('slider',{name:'Upper Side Lines Range',exact:true});await slider.locator('..').locator('.numeric-slider-value').dblclick();const input=section.getByRole('textbox',{name:'Upper Side Lines Range value'});await input.fill('.06');await input.press('Enter');
 expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.chinScaffold.ranges.UPPER_PAIR)).toBe(.06);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await page.evaluate(()=>(window as any).__editorPerfStore.getState().project.chinScaffold.ranges.UPPER_PAIR)).toBe(.08);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await page.evaluate(()=>JSON.stringify((window as any).__editorPerfStore.getState().project.curves))).toBe(source);
 await page.evaluate(async()=>{const f='/src/domain/landmarks/persistence.ts',s=(window as any).__editorPerfStore.getState();s.load((await import(f)).parseLandmarks(JSON.stringify(s.project)));s.selectObject(null);});
 await page.getByRole('button',{name:'Set Pitch',exact:true}).click();await page.getByRole('spinbutton',{name:'Pitch Value',exact:true}).fill('-35');await page.getByRole('spinbutton',{name:'Pitch Value',exact:true}).press('Enter');
 await page.getByRole('checkbox',{name:'Show Contour panel',exact:true}).check();
 await expect(page.getByTestId('contour-preview')).toHaveAttribute('aria-busy','false',{timeout:20000});
 if(await section.getByRole('button',{name:/Chin Junction/}).getAttribute('aria-expanded')==='false')await section.getByRole('button',{name:/Chin Junction/}).click();
 await page.screenshot({path:'artifacts/chin-point/editor.png'});
 await page.evaluate(async()=>{
  const tf='/node_modules/three/build/three.module.js',gf='/src/domain/patches/geometry.ts',ef='/src/domain/geometry/evaluation.ts';
  const T=await import(tf),{tessellate}=await import(gf),{evaluationContext,pointPosition}=await import(ef),p=(window as any).__editorPerfStore.getState().project;
  const center=pointPosition(p,'09500000-0000-4000-8000-000000000101');
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(35,1,0.001,10);camera.position.set(center[0]+.15,center[1]-.15,center[2]+.3);camera.lookAt(...center);
  const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(900,900);renderer.setClearColor(0x20272d);renderer.domElement.id='chin-closeup';Object.assign(renderer.domElement.style,{position:'fixed',top:'0',left:'0',zIndex:'9999'});document.body.append(renderer.domElement);
  for(const x of p.patches.filter((x:any)=>x.name==='下颌面')){const mesh=tessellate(p,x,128),g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(mesh.vertices.flat(),3));g.setIndex(mesh.triangles.flat());g.computeVertexNormals();scene.add(new T.Mesh(g,new T.MeshStandardMaterial({color:0x9fbdc6,side:T.DoubleSide,roughness:.8})));}
  const ctx=evaluationContext(p);for(const c of p.curves.filter((x:any)=>x.name.includes('下颌线')||x.name.includes('侧脸线'))){const g=new T.BufferGeometry().setFromPoints(ctx.curve(c.id).sample(600).map((v:any)=>new T.Vector3(...v)));scene.add(new T.Line(g,new T.LineBasicMaterial({color:0xffc75c})));}
  scene.add(new T.HemisphereLight(0xffffff,0x334452,2));const light=new T.DirectionalLight(0xffffff,2);light.position.set(-2,1,3);scene.add(light);renderer.render(scene,camera);
 });
 await page.locator('#chin-closeup').screenshot({path:'artifacts/chin-point/closeup.png'});
 expect(errors).toEqual([]);
});
