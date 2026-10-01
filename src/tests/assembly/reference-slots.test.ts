import {test,expect} from 'vitest';
import {createAssembly,frameOf,parseAssembly} from '../../domain/assembly/model';
import {saveBackgroundState,applyBackgroundState,type RecordingReferenceImage} from '../../domain/recording/reference';
import {saveDrawingSnapshot,restoreDrawingSnapshot} from '../../domain/drawing/snapshots';
import {createLandmarkProject} from '../../domain/landmarks/presets';
import {parseLandmarks} from '../../domain/landmarks/persistence';
import {serializeProject} from '../../app/autosave';

test('assembly reference slots survive project and snapshot round trips, sharing pixels and leaving the rig untouched',()=>{
 let reference:RecordingReferenceImage={name:'sheet.png',dataUrl:'data:image/png;base64,AAAA',width:900,height:900,offset:[0,0],scale:1,rotation:0,opacity:.5,visible:true,locked:false};
 for(let i=0;i<12;i++)reference=saveBackgroundState({...reference,offset:[i/2,i===0?0:-i/3],scale:1+i/10},`slot-${i}`,`View ${i}`);
 const original=createAssembly(),a={...original,drawing:{...original.drawing,reference}};
 const saved=saveDrawingSnapshot({drawing:a.drawing},'Front');
 a.drawing={...a.drawing,reference:applyBackgroundState(a.drawing.reference,'slot-0')};
 const document={...a,drawingSnapshots:saved.drawingSnapshots,frames:{[saved.drawingSnapshots!.activeId!]:structuredClone(frameOf(a))}};
 const parsed=parseAssembly(JSON.parse(JSON.stringify(document)));
 const loaded=parseLandmarks(serializeProject({...createLandmarkProject(),assembly:document})).assembly!;
 expect(loaded).toEqual(parsed);expect(loaded.drawing.reference).toEqual(a.drawing.reference);
 const restored=restoreDrawingSnapshot(loaded,loaded.drawingSnapshots!.activeId!).drawing!.reference as RecordingReferenceImage;
 expect(restored.activeStateId).toBe('slot-11');expect(restored.states).toEqual(reference.states);
 expect(loaded.drawingSnapshots!.images).toHaveLength(1);expect(JSON.stringify(restored.states)).not.toContain('data:image');
 const locked=applyBackgroundState({...restored,locked:true},'slot-3');expect(locked.locked).toBe(true);expect(locked.offset).toEqual([1.5,-1]);
 expect(frameOf(loaded)).toEqual(frameOf(original));
});
