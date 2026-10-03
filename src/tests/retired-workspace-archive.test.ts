import {expect,test} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {serializeProject} from '../app/autosave';
import {createAssembly} from '../domain/assembly/model';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {emptyDrawing} from '../domain/drawing/model';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';

test('valid Assembly data is archived verbatim without reviving the retired workspace',()=>{
 const assembly={...createAssembly(),unrecognizedRecoveryData:{keep:['all',null,{nested:true}]}};
 const source=ensureRecordingSnapshots({...createEmptyProject(),...saveDrawingSnapshot({drawing:emptyDrawing()},'Source')});
 const loaded=parseLandmarks(JSON.stringify({...source,assembly}));
 expect(loaded).not.toHaveProperty('assembly');expect(loaded.legacyWorkspaces?.assembly).toEqual(assembly);
 expect(loaded.drawing).toEqual(source.drawing);expect(loaded.drawingSnapshots).toEqual(source.drawingSnapshots);expect(loaded.recordingSnapshots).toEqual(source.recordingSnapshots);
 const exported=JSON.parse(serializeProject(loaded));expect(exported).not.toHaveProperty('assembly');expect(exported.legacyWorkspaces.assembly).toEqual(assembly);
 const reloaded=parseLandmarks(JSON.stringify(exported));expect(reloaded).not.toHaveProperty('assembly');expect(reloaded.legacyWorkspaces).toEqual(loaded.legacyWorkspaces);
});

test.each([null,['old','unknown','layout'],{drawing:'not a current drawing',bindings:[{unknown:true}]}])('archived Assembly payloads remain opaque and recoverable: %j',assembly=>{
 const archive={assembly,recording:{rawCurveChannels:[1,2,3]},hairstyle:{originalPixels:'preserved'}};
 const loaded=parseLandmarks(JSON.stringify({...createEmptyProject(),legacyWorkspaces:archive}));
 expect(loaded).not.toHaveProperty('assembly');expect(loaded.legacyWorkspaces).toEqual(archive);
 expect(parseLandmarks(serializeProject(loaded)).legacyWorkspaces).toEqual(archive);
});
