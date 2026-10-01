import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {createVectorEditingApi,type VectorEditingHost,type VectorCommand} from '../app/vectorEditingApi';
import {createEmptyProject} from '../app/emptyProject';
import {addLayer,createCurve,ellipse} from '../domain/drawing/commands';
import {createFill} from '../domain/drawing/paintCommands';
import {emptyDrawing,parseDrawing} from '../domain/drawing/model';
import {strokes} from '../domain/drawing/strokes';
import type {LandmarkProject} from '../domain/landmarks/model';

const guide=readFileSync(new URL('../../docs/ai-authoring-guide.md',import.meta.url),'utf8');
const examples=[...guide.matchAll(/<!-- tested: ([a-z-]+) -->\s*```json\s*([\s\S]*?)```/g)].map(m=>({name:m[1],request:JSON.parse(m[2])}));

function harness(){
 let drawing=addLayer(emptyDrawing(),'右眼内结构');const sourceLayer=drawing.layers[0].id,e=ellipse(drawing,sourceLayer,[-.9,-.2],[-.5,.2],.008);drawing=createFill(e.document,e.ids,'white');drawing.curves[0].visible=false;
 drawing=addLayer(drawing,'鼻部');drawing=createCurve(drawing,drawing.layers[0].id,[[-.329,0],[-.329,.03],[-.329,.06],[-.329,.09]],.008,'鼻尖短线','nose');
 drawing=addLayer(drawing,'右下颌');drawing=createCurve(drawing,drawing.layers[0].id,[[-.7,0],[-.7,-.2],[-.5,-.6],[-.329,-.7]],.008,'右下颌','right-jaw');
 drawing=addLayer(drawing,'左下颌');drawing=createCurve(drawing,drawing.layers[0].id,[[.042,0],[.042,-.2],[-.158,-.6],[-.329,-.7]],.008,'左下颌','left-jaw');drawing.mirrorAxisX=-.3294804514288924;
 let project:LandmarkProject={...createEmptyProject(),drawing},past:LandmarkProject[]=[],future:LandmarkProject[]=[];
 const host:VectorEditingHost={getState:()=>({project,past,future}),getMode:()=> 'drawing',commitDrawing(drawing){past.push(project);future=[];project={...project,drawing};},commitArtwork(state){past.push(project);future=[];project={...project,...state};},undo(){const p=past.pop();if(p){future.unshift(project);project=p;}},redo(){const p=future.shift();if(p){past.push(project);project=p;}}};
 return {api:createVectorEditingApi(host),sourceLayer,state:()=>project};
}

test('every declared guide JSON example is syntactically valid and uniquely named',()=>{
 expect(examples.map(x=>x.name)).toEqual(['inspect-nose','create-layer','mirror-layer','closed-piece','link-ports','hide-range','save-copy','list-artworks','preview']);expect(new Set(examples.map(x=>x.name)).size).toBe(examples.length);
});

for(const example of examples)test(`guide example ${example.name} executes through the actual fixed API`,()=>{
 const h=harness(),replacements:Record<string,string>={SOURCE_LAYER_ID:h.sourceLayer,RIGHT_JAW_ID:'right-jaw',LEFT_JAW_ID:'left-jaw',PATH_CURVE_ID:'nose',LATEST_REVISION:h.api.inspect().revision};
 const replace=(x:unknown):unknown=>typeof x==='string'?(Object.hasOwn(replacements,x)?replacements[x]:x):Array.isArray(x)?x.map(replace):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,replace(v)])):x;
 const request=replace(example.request) as {method?:string;request?:any;commands?:VectorCommand[]};const before=h.state();
 const result=request.method==='inspect'?h.api.inspect(request.request):request.method==='preview'?h.api.preview(request.request):request.method==='artwork'?h.api.artwork(request.request):request.method==='inspectArtworks'?h.api.inspectArtworks(request.request):h.api.execute(request as {commands:VectorCommand[]});
 expect(result.ok,result.ok?'':JSON.stringify(result.error)).toBe(true);expect(()=>parseDrawing(h.state().drawing)).not.toThrow();
 if(example.name==='inspect-nose'){const inspected=h.api.inspect({layerNames:['鼻部'],includeRecording:false});expect(inspected.ok&&inspected.value.curves.length).toBe(1);}
 if(example.name==='create-layer')expect(h.state()).toBe(before);
 if(example.name==='closed-piece'){const d=h.state().drawing!,layer=d.layers.find(l=>l.name==='闭合脸片示例')!;expect(strokes(d,layer.id)[0].closed).toBe(true);expect(new Set(d.curves.filter(c=>layer.items.includes(c.id)).flatMap(c=>c.nodes)).size).toBe(3);}
 if(example.name==='preview'){expect(result.ok&&'svg'in result.value&&result.value.svg).toContain('<svg');expect(h.state()).toBe(before);}
});

test('the recorded real two-face recipe replays using returned IDs instead of stale session IDs',()=>{
 const recipe=JSON.parse(readFileSync(new URL('../../docs/examples/two-face-executed-api-recipe.json',import.meta.url),'utf8'));
 const path=new URL('../assets/hairless-symmetric-skull-hide-interval.json',import.meta.url),raw=readFileSync(path,'utf8'),source=parseDrawing(JSON.parse(raw));let project:LandmarkProject={...createEmptyProject(),drawing:source};const past:LandmarkProject[]=[];
 const api=createVectorEditingApi({getState:()=>({project,past,future:[]}),getMode:()=> 'drawing',commitDrawing(drawing){past.push(project);project={...project,drawing};},undo(){},redo(){}});
 const first=api.execute({...recipe.phase1,expectedRevision:api.inspect().revision});expect(first.ok,first.ok?'':JSON.stringify(first.error)).toBe(true);if(!first.ok)throw Error(first.error.message);
 const refs=new Map(first.value.created.filter(c=>c.ref).map(c=>[c.ref,c.id]));
 const idMap=new Map<string,string>(recipe.phase1Result.value.created.filter((c:{ref?:string})=>c.ref).map((c:{id:string;ref:string})=>[c.id,refs.get(c.ref)!]));
 const replace=(x:unknown):unknown=>typeof x==='string'?(idMap.get(x)??x):Array.isArray(x)?x.map(replace):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,replace(v)])):x;
 const second=api.execute({commands:replace(recipe.phase2.commands) as VectorCommand[],expectedRevision:api.inspect().revision});expect(second.ok,second.ok?'':JSON.stringify(second.error)).toBe(true);
 const d=project.drawing!;expect(d.curves).toHaveLength(121);expect(d.layers).toHaveLength(13);expect(d.fills).toHaveLength(20);for(const side of ['right','left']){const layer=refs.get(side)!;expect(strokes(d,layer)[0].closed).toBe(true);expect(new Set(d.curves.filter(c=>d.layers.find(l=>l.id===layer)!.items.includes(c.id)).flatMap(c=>c.nodes)).size).toBe(3);}
 const oldFace=source.layers.find(l=>l.name==='面部底形')!;expect(source.curves.filter(c=>!oldFace.items.includes(c.id)).every(c=>JSON.stringify(c)===JSON.stringify(d.curves.find(x=>x.id===c.id)))).toBe(true);expect(past).toHaveLength(2);expect(readFileSync(path,'utf8')).toBe(raw);
});
