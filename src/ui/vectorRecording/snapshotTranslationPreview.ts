import type {WorkspaceView} from '../../app/workspaceView';
import type {SnapshotEvaluation} from '../../domain/recordingSnapshot/evaluation';
import type {RecordingSnapshot,SnapshotRecording} from '../../domain/recordingSnapshot/model';

/** This is only a display capability. The existing setLayerPlacement batch is
 * still the sole authoring command. Require the whole current dependency
 * closure; a partial selection must retain the normal evaluated preview. */
export function canPreviewSnapshotTranslation(evaluation:SnapshotEvaluation,snapshot:RecordingSnapshot|undefined,recording:SnapshotRecording,layerIds:readonly string[],basis:boolean,onionEnabled:boolean):boolean {
 if(!basis||onionEnabled||!snapshot||snapshot.id!==evaluation.snapshotId||!layerIds.length)return false;
 if(evaluation.angleSurface&&evaluation.angleSurface.role!=='basis'||evaluation.endpointPair?.role==='correction')return false;
 if(evaluation.state.layerDomains?.some(domain=>domain.enabled!==false))return false;
 // These recipes run after placement and can change the resulting material.
 if(recording.angleGraph?.materialBasisRecipes?.[snapshot.id])return false;
 const {drawing}=evaluation,selected=new Set(layerIds),layers=new Set(drawing.layers.map(layer=>layer.id));
 if(selected.size!==layerIds.length||selected.size!==layers.size||snapshot.layers.length!==layers.size||snapshot.layers.some(layer=>!selected.has(layer.id))||drawing.layers.some(layer=>!selected.has(layer.id)||layer.locked))return false;
 const objects=[...drawing.curves,...drawing.fills,...drawing.offsets],owned=new Set(drawing.layers.flatMap(layer=>layer.items));
 if(objects.some(object=>object.locked||!owned.has(object.id)))return false;
 const curves=new Set(drawing.curves.map(curve=>curve.id)),nodes=new Set(drawing.nodes.map(node=>node.id));
 if(drawing.curves.some(curve=>curve.nodes.some(id=>!nodes.has(id))))return false;
 if([...drawing.joins,...drawing.endpointLinks??[]].some(link=>!curves.has(link.a.curveId)||!curves.has(link.b.curveId)))return false;
 if(drawing.fills.some(fill=>fill.boundary.some(use=>!curves.has(use.id)))||drawing.offsets.some(offset=>offset.source.some(use=>!curves.has(use.id))))return false;
 if(drawing.displayIntervals?.some(track=>!curves.has(track.anchor.id)||track.displayRoute?.seed.segments.some(use=>!curves.has(use.id))))return false;
 return !evaluation.diagnostics.some(diagnostic=>['LAYER_DOMAIN','SOURCE_MATERIAL','RELATION_CONFLICT'].includes(diagnostic.code));
}

/** Guide snaps include intersections with the current drawing. Freezing that
 * drawing would change their targets, even if Alt happened to start the drag. */
export function translationPreviewNeedsCanonicalSnapping(view:WorkspaceView):boolean {
 return view.guidesVisible&&view.snappingEnabled&&view.guides.length>0;
}
