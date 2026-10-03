import {it,expect} from 'vitest';
import savedFixture from '../fixtures/recording-local-route-browser-failure.json';
import {resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {adoptDisplayRoute} from '../../domain/drawing/displayRouteAuthoring';
import {parseDrawing} from '../../domain/drawing/model';
import {prepareSnapshotDrawingTopologyEdit} from '../../domain/recordingSnapshot/drawingTopology';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {createDisplayRouteField} from '../../domain/drawing/displayRoutes';
it('adopts the browser-authored local route without serializing its outer cut above one',()=>{
 // Reduced from v60's Save JSON: two local Pen cubics, link, and one interval.
 // Keep the actual IDs, coordinates, residuals, reverse anchor and old UI hit
 // distance fields. The failure was a generated end=1.0000000000000002.
 const workspace=parseRecordingSnapshots(structuredClone(savedFixture)),snapshotId='aeba7fd1-b0eb-4668-b42f-5be75904e38d';
 const current=resolveSnapshot(workspace,snapshotId,{useDraft:true,diagnostics:'preview'}).drawing,link=current.endpointLinks![0],track=current.displayIntervals![0];
 expect(()=>parseDrawing(current)).not.toThrow();
 const styled={...current,endpointLinks:current.endpointLinks!.map(value=>value.id===link.id?{...value,joinBrush:{kind:'SHARP' as const}}:value)},target=adoptDisplayRoute(styled,track.id,link.id).document;
 expect(()=>parseDrawing(target),JSON.stringify(target.displayIntervals)).not.toThrow();
 expect(target.displayIntervals![0].ranges.at(-1)!.end).toBe(1);
 const field=createDisplayRouteField(target,target.displayIntervals![0].displayRoute!);
 expect(field.positionOf({kind:'curve',curveId:link.b.curveId,t:0})).toBe(1);
 expect(field.positionOf({kind:'curve',curveId:link.b.curveId,t:1+Number.EPSILON})).toBeUndefined();
 expect(field.positionOf({kind:'curve',curveId:link.b.curveId,t:NaN})).toBeUndefined();
 const result=prepareSnapshotDrawingTopologyEdit(workspace,{recordingId:'dc557247-caba-4d87-8d03-87f9b445235f',snapshotId,angle:{x:0,y:0},beforeDrawing:current,drawing:target});
 expect(resolveSnapshot(result.workspace,snapshotId).drawing.displayIntervals?.[0].displayRoute).toBeDefined();
 const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(result.workspace)));
 expect(()=>parseDrawing(resolveSnapshot(loaded,snapshotId).drawing)).not.toThrow();
});
