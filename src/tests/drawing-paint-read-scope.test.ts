import {expect,test} from 'vitest';
import {createHash} from 'node:crypto';
import {forEachPaintCase,paintMarkup,publicPaintDrawing,addNuisanceCurves,styledPaintDrawing,domainPaintDrawing} from './fixtures/paint-read-scope';
import expected from './fixtures/paint-read-scope-baseline.json';
import coldExpected from './fixtures/paint-products-baseline.json';
import {drawingReadContextStats,preparedDrawingReadContext,withDrawingReadScope} from '../domain/drawing/readContext';
import {evaluatedAffine,evaluatedAffineSource} from '../domain/drawing/evaluatedAffine';
import {evaluatedDeformationSource,evaluatedMaterialProgram} from '../domain/drawing/evaluatedDeformation';
import {makeFixture,RECORDING_ID} from '../../tests/fixtures/recording-renderer-benchmark-fixture';
import {createPaintProductReader} from '../ui/drawing/paintProducts';
import {displayInkSampling} from '../domain/drawing/appearance';
import {prepareRecordingContext} from '../domain/recordingSnapshot/evaluation';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const paths=(value:string)=>(value.match(/<path/g)??[]).length;

// Mutable ARC/offset reference uses an independent 0ea573e cold facade: its
// prior same-object WeakMap caches retained old geometry after in-place edits.
// Linked-ARC updates affect only derived fill contours and their cutout/selection
// paths. Other SVG bytes retain the independent previous renderer's baseline.
test('Drawing and Recording SVG match the verified baseline across visibility, topology, materials and domains',()=>{
 const seen:string[]=[];
 forEachPaintCase((name,d,options)=>{
  const original=JSON.stringify(d),svg=paintMarkup(d,options),baseline=name.startsWith('mutable-')?coldExpected[name as keyof typeof coldExpected]:expected[name as keyof typeof expected];
  expect(baseline,name).toBeDefined();expect(hash(svg),name).toBe(baseline.hash);expect(svg.length,name).toBe(baseline.length);expect(paths(svg),name).toBe(baseline.paths);
  // Opaque object/control metadata and every authoring field remain unchanged.
  expect(JSON.stringify(d),name).toBe(original);expect(preparedDrawingReadContext(d),name).toBeUndefined();seen.push(name);
 });
 expect(seen.sort()).toEqual(Object.keys(expected).sort());
},30000);

test('121-curve Recording render removes repeated signature/connection work without dropping geometry or hit paths',()=>{
 const {workspace}=makeFixture(),context=prepareRecordingContext(workspace,{immutableInputs:true,useDraft:true,diagnostics:'preview'}),frame=context.sample(RECORDING_ID,{angle:{x:37.137,y:14.713}}),d=frame.drawing,options={paintBatches:frame.paintBatches};
 expect(d.curves).toHaveLength(121);expect(d.curves.filter(c=>!c.visible)).toHaveLength(24);
 const first=paintMarkup(d,options),before=drawingReadContextStats(),second=paintMarkup(d,options),after=drawingReadContextStats();
 expect(second).toBe(first);expect(paths(second)).toBe(157);expect(second).toContain('data-testid="drawing-hit"');
 expect(after.strokeKeys-before.strokeKeys).toBe(0);expect(after.localConnectionBuilds-before.localConnectionBuilds).toBe(0);expect(after.strokeBuilds-before.strokeBuilds).toBe(0);
 expect(after.contexts-before.contexts).toBe(2);expect(after.topologyKeys-before.topologyKeys).toBe(2);expect(after.topologyRetains-before.topologyRetains).toBe(2);
 expect(preparedDrawingReadContext(d)).toBeUndefined();
});

test('a new topology compiles real work once and shares it with the visibility wrapper',()=>{
 const d=publicPaintDrawing();d.layers.forEach(layer=>{layer.id=`cold-paint:${layer.id}`;});
 const before=drawingReadContextStats(),svg=paintMarkup(d),after=drawingReadContextStats();
 expect(paths(svg)).toBeGreaterThan(100);expect(after.contexts-before.contexts).toBe(2);expect(after.topologyPlans-before.topologyPlans).toBe(1);
 expect(after.strokeKeys-before.strokeKeys).toBe(0);expect(after.localConnectionBuilds-before.localConnectionBuilds).toBe(1);
 expect(after.strokeBuilds-before.strokeBuilds).toBe(d.layers.length);expect(after.preparedStrokeMisses-before.preparedStrokeMisses).toBe(d.layers.length);
 expect(preparedDrawingReadContext(d)).toBeUndefined();
});

test('visible nuisance curves still paint while topology work is shared once per transient scope',()=>{
 const base=publicPaintDrawing(),plain=paintMarkup(base),d=addNuisanceCurves(publicPaintDrawing()),first=paintMarkup(d),before=drawingReadContextStats();
 const next=paintMarkup(d),after=drawingReadContextStats();expect(d.curves).toHaveLength(201);expect(paths(next)).toBe(paths(plain)+160);expect(next).toBe(first);
 for(const id of ['nuisance:0','nuisance:79'])expect(next).toContain(`data-id="${id}"`);
 expect(after.strokeKeys-before.strokeKeys).toBe(0);expect(after.localConnectionBuilds-before.localConnectionBuilds).toBe(0);expect(after.strokeBuilds-before.strokeBuilds).toBe(0);expect(after.contexts-before.contexts).toBe(2);
 const originalNodes=d.nodes,originalCurves=d.curves;d.nodes.at(-1)!.position[0]+=.03;
 expect(paintMarkup(d)).not.toBe(next);expect(d.nodes).toBe(originalNodes);expect(d.curves).toBe(originalCurves);expect(preparedDrawingReadContext(d)).toBeUndefined();
});

test('each mutable render sees in-place coordinate, visibility, membership and route edits',()=>{
 const d=styledPaintDrawing(),arrays=[d.nodes,d.curves,d.layers,d.endpointLinks],seen=[paintMarkup(d)];
 for(const edit of [()=>{d.curves[0].handles[0][1]+=.04;},()=>{d.curves[0].visible=false;},()=>{d.curves[1].nodes[0]='nb1';},()=>{d.curves[1].nodes[0]='na1';d.layers.reverse();},()=>{d.endpointLinks![0].throughDisplay=false;}]){
  edit();const svg=paintMarkup(d);expect(svg).not.toBe(seen.at(-1));seen.push(svg);expect(preparedDrawingReadContext(d)).toBeUndefined();
 }
 [d.nodes,d.curves,d.layers,d.endpointLinks].forEach((array,i)=>expect(array).toBe(arrays[i]));
});

test.each(['line','layer'] as const)('%s affine, quad and Coons retain runtime source/control metadata',scope=>{
 for(const kind of ['affine','quad','coons'] as const){
  const d=domainPaintDrawing(kind,scope),id=scope==='line'?'c':'a0',affine=evaluatedAffine(d,id),source=evaluatedAffineSource(d),deformation=evaluatedDeformationSource(d),program=evaluatedMaterialProgram(d,id),original=JSON.stringify(d);
  expect(affine||deformation).toBeTruthy();
  const read=(scale:number)=>withDrawingReadScope(()=>createPaintProductReader(d,displayInkSampling(scale))),first=read(250),zoomed=read(750);
  expect(first.drawing).toBe(d);expect(zoomed.drawing).toBe(d);
  expect(zoomed.offset(d.offsets[0])).toBe(first.offset(d.offsets[0]));
  const rendered=paintMarkup(d,{showFills:true});expect(rendered.length).toBeGreaterThan(1000);
  expect(evaluatedAffine(d,id)).toBe(affine);expect(evaluatedAffineSource(d)).toBe(source);expect(evaluatedDeformationSource(d)).toBe(deformation);expect(evaluatedMaterialProgram(d,id)).toEqual(program);expect(JSON.stringify(d)).toBe(original);
 }
});

test('a failed projection disposes the render scope, including nested synchronous reads',()=>{
 const d=styledPaintDrawing();expect(()=>paintMarkup(d,{screen:()=>{throw Error('projection failed');}})).toThrow('projection failed');expect(preparedDrawingReadContext(d)).toBeUndefined();
 const before=paintMarkup(d);d.nodes[1].position[0]-=.2;expect(paintMarkup(d)).not.toBe(before);
 expect(withDrawingReadScope(()=>paintMarkup(d))).toBe(paintMarkup(d));expect(preparedDrawingReadContext(d)).toBeUndefined();
});
