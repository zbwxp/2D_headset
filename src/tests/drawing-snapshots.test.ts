import {expect,test,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {saveDrawingSnapshot as save,restoreDrawingSnapshot as restore,renameDrawingSnapshot as rename,deleteDrawingSnapshot as remove,parseDrawingSnapshots,snapshotDrawing,snapshotMatches} from '../domain/drawing/snapshots';
import {addLayer,createCurve,transform} from '../domain/drawing/commands';
import {emptyDrawing} from '../domain/drawing/model';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {serializeProject} from '../app/autosave';

function fixture(){let d=addLayer(emptyDrawing(),'Face');d=createCurve(d,d.layers[0].id,[[2,3],[2,4],[3,4],[3,3]],.01,'Chin','chin');d.reference={name:'Nine views',dataUrl:'data:image/png;base64,AAAA',width:300,height:300,offset:[2,-1],scale:3,rotation:0,opacity:.4,visible:true,locked:true};return d;}
test('checkpoint retains absolute position and identity while later geometry/background edits stay independent',()=>{
 const d=fixture(),first=save({drawing:d},'正面'),id=first.drawingSnapshots!.activeId!;
 const edited=transform(d,['chin'],([x,y])=>[x+.7,y-.2]);edited.reference={...edited.reference!,offset:[-3,2],scale:6};
 const second=save({...first,drawing:edited},'近正面左视'),left=second.drawingSnapshots!.activeId!;
 expect(second.drawingSnapshots!.items.map(s=>s.drawing.curves[0].id)).toEqual(['chin','chin']);
 expect(second.drawingSnapshots!.images).toHaveLength(1);
 expect(restore(second,id).drawing).toEqual(d);expect(restore(second,left).drawing).toEqual(edited);
 expect(snapshotMatches(edited,second.drawingSnapshots!,left)).toBe(true);expect(snapshotMatches(edited,second.drawingSnapshots!,id)).toBe(false);
 const restored=restore(second,id);restored.drawing!.nodes[0].position[0]=99;
 expect(snapshotDrawing(second.drawingSnapshots!,id)).toEqual(d);expect(d.nodes[0].position[0]).toBe(2);
 expect(Object.keys(first.drawingSnapshots!.items[0]).sort()).toEqual(['drawing','id','name','reference']);
});
test('explicit overwrite, rename and deletion preserve other checkpoints and working data',()=>{
 let s=save({drawing:fixture()},'正面'),a=s.drawingSnapshots!.activeId!;s=save(s,'副本');const b=s.drawingSnapshots!.activeId!,before=s.drawingSnapshots!.items[0];
 s={...s,drawing:{...s.drawing!,mirrorAxisX:4}};s=save(s,'侧脸',b);expect(s.drawingSnapshots!.items[0]).toBe(before);expect(s.drawingSnapshots!.items).toHaveLength(2);
 s=rename(s,b,'近正面');expect(s.drawingSnapshots!.items[1].name).toBe('近正面');
 const doc=s.drawing;s=remove(s,b);expect(s.drawing).toBe(doc);expect(s.drawingSnapshots!.activeId).toBeUndefined();expect(s.drawingSnapshots!.images).toHaveLength(1);
 s=remove(s,a);expect(s.drawingSnapshots!.images).toEqual([]);expect(s.drawing).toBe(doc);
 expect(()=>save(s,'  ')).toThrow();expect(()=>restore(s,b)).toThrow();
});
test('reference replacement deduplicates images and reclaims only unused archived pixels',()=>{
 let s=save({drawing:fixture()},'A');const a=s.drawingSnapshots!.activeId!;s=save(s,'B');
 s={...s,drawing:{...s.drawing!,reference:{...s.drawing!.reference!,dataUrl:'data:image/png;base64,BBBB'}}};s=save(s,'A',a);
 expect(s.drawingSnapshots!.images).toHaveLength(2);s=remove(s,s.drawingSnapshots!.items[1].id);expect(s.drawingSnapshots!.images.map(x=>x.dataUrl)).toEqual(['data:image/png;base64,BBBB']);
});
test('full asset round trip preserves fills, hidden geometry, display intervals and depth without recentering',()=>{
 const asset=JSON.parse(readFileSync('docs/assets/front-face-v1/基础脸模·正面·v1.json','utf8'));
 // The checked-in accepted face exercises all actual rendering metadata.
 const state=save({drawing:asset.drawing},'正面'),project={...createLandmarkProject(),...state};
 const loaded=parseLandmarks(serializeProject(project));
 expect(restore(loaded,loaded.drawingSnapshots!.activeId!).drawing).toEqual(asset.drawing);
 expect(snapshotMatches(loaded.drawing!,loaded.drawingSnapshots!,loaded.drawingSnapshots!.activeId!)).toBe(true);
 expect(parseLandmarks(JSON.stringify(createLandmarkProject())).drawingSnapshots).toBeUndefined();
});
test('malformed library rejects duplicate IDs, missing images, invalid geometry and dangling active selection',()=>{
 const s=save({drawing:fixture()},'A').drawingSnapshots!;
 for(const alter of [(x:typeof s)=>{x.items.push(structuredClone(x.items[0]));},(x:typeof s)=>{x.images=[];},(x:typeof s)=>{x.items[0].drawing.nodes[0].position=[NaN,0];},(x:typeof s)=>{x.activeId='missing';},(x:typeof s)=>{(x.items[0].drawing as any).reference={};}]){const invalid=structuredClone(s);alter(invalid);expect(()=>parseDrawingSnapshots(invalid)).toThrow();}
 expect(parseDrawingSnapshots(JSON.parse(JSON.stringify(s)))).toEqual(s);
});
test('save, switch and overwrite are single Undo transactions, with drafts restored exactly',async()=>{
 vi.useFakeTimers();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 try{
  const {useEditor}=await import('../app/store'),{commitDrawing,commitDrawingSnapshot}=await import('../ui/drawing/edit');
  const editor=()=>useEditor.getState();editor().load({...createLandmarkProject(),drawing:fixture()});const initial=editor().project,n=editor().past.length;
  commitDrawingSnapshot(s=>save(s,'正面'));const first=editor().project,id=first.drawingSnapshots!.activeId!;expect(editor().past).toHaveLength(n+1);
  editor().undo();expect(editor().project).toBe(initial);editor().redo();expect(editor().project).toBe(first);
  commitDrawing({...first.drawing!,mirrorAxisX:.75});const draft=editor().project;
  commitDrawingSnapshot(s=>restore(save(s,'侧脸'),id));const switched=editor().project;expect(switched.drawing).toEqual(first.drawing);expect(switched.drawingSnapshots!.items).toHaveLength(2);
  editor().undo();expect(editor().project).toBe(draft);editor().redo();expect(editor().project).toBe(switched);
  commitDrawingSnapshot(s=>save(s,'正面',id));editor().undo();expect(editor().project).toBe(switched);
 }finally{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();}
});
