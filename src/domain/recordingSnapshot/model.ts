import type {DrawingDocument,DrawingNode,DrawingCurve,FillRegion,OffsetRelation,DrawingLayer,TangentJoin,EndpointLink,DrawingGroup,StrokeDisplayIntervals,Point2} from '../drawing/model';
import type {RecordingScene,ScenePlacementValue,SceneShapeValue,SceneIntervalValue,SceneTrack,WarpGrid,Angle} from '../recordingScene/model';
import type {SnapshotTriangulation} from './triangulation';
import type {InteriorResponseSample} from './triangularResponses';
import type {SnapshotMirrorOptions} from './snapshotMirror';

export type {Angle,WarpGrid,ScenePlacementValue,SceneShapeValue,SceneIntervalValue};

/** The sole stored original geometry. Canonical IDs include legacy asset scope. */
export interface CanonicalElementStore {
 nodes:Record<string,DrawingNode>;curves:Record<string,DrawingCurve>;
 fills:Record<string,FillRegion>;offsets:Record<string,OffsetRelation>;
}
export interface CanonicalElementRef {assetId:string;sourceId:string}
/** Original layers alone own membership. Referencing layers follow it live. */
export interface OriginalSnapshotLayer extends DrawingLayer {kind:'original'}
export interface ReferencedSnapshotLayer {
 kind:'reference';id:string;name:string;
 /** The parent is evaluated at its own saved state, never at the child's angle. */
 baseSnapshotId:string;baseLayerId:string;
 /** Child-only membership. Missing means full live inheritance. Geometry stays
  * canonical; excluding an ID never deletes its parent or stored original. */
 membership?:{addElementIds?:string[];excludeElementIds?:string[]};
}
export type SnapshotLayer=OriginalSnapshotLayer|ReferencedSnapshotLayer;
export interface SnapshotRelationCollection {
 joins:TangentJoin[];endpointLinks:EndpointLink[];groups:DrawingGroup[];
 displayIntervals:StrokeDisplayIntervals[];
}
/** Missing patch and empty arrays both mean no change. Deletion is explicit. */
export interface SnapshotRelationPatch<T extends {id:string}> {
 add?:T[];update?:T[];disable?:string[];
}
export interface SnapshotRelationOverrides {
 joins?:SnapshotRelationPatch<TangentJoin>;
 endpointLinks?:SnapshotRelationPatch<EndpointLink>;
 groups?:SnapshotRelationPatch<DrawingGroup>;
 displayIntervals?:SnapshotRelationPatch<StrokeDisplayIntervals>;
}
export interface SnapshotWarpState {id:string;name:string;parentId?:string;restGrid:WarpGrid;grid:WarpGrid}
export interface SnapshotWarpBinding {layerId:string;warpId:string}
/** Domain placement and Warp follow live layer membership. Direct shape offsets
 * are ID-specific: an independent new curve has zero node/handle corrections. */
export interface SnapshotLayerState {
 placement?:ScenePlacementValue;
 /** Post-shape, pre-layer curve-owned placement. Material controls remain live at zero. */
 elementPlacements?:Record<string,ScenePlacementValue>;
 shape?:SceneShapeValue;visibility?:Record<string,boolean|null>;
 intervals?:Record<string,SceneIntervalValue>;depth?:number;
}
export interface SnapshotMaterialIssue {sourceSnapshotId:string;sourceSignature:string;message:string}
export interface SnapshotRelationPositionState {sourceLinkIds:string[];offset:Point2}
/** Only this node's residual deformation, applied after its saved parent state. */
export interface SnapshotDeformationState {
 warps:SnapshotWarpState[];bindings:SnapshotWarpBinding[];
 layers:Record<string,SnapshotLayerState>;
 relationPositions:Record<string,SnapshotRelationPositionState>;
 /** Source interval ID to suspended inherited/static material channel. */
 intervalMaterialIssues?:Record<string,SnapshotMaterialIssue>;
}
export type SnapshotPoseChannel='placement'|'shape'|'visibility'|'interval'|'depth'|'warp'|'relationPosition';
/** Authorship is separate from inherited/evaluated state. Creating a view adds
 * no marks and therefore cannot increase any target's authored key count. */
export interface SnapshotAuthoredChannel {trackId:string;keyId:string}
export interface SnapshotTrackBase<T> extends SceneTrack<T> {
 id:string;targetId:string;elementId?:string;
}
export type SnapshotPoseTrack=
 | (SnapshotTrackBase<ScenePlacementValue>&{channel:'placement'})
 | (SnapshotTrackBase<SceneShapeValue>&{channel:'shape'})
 | (SnapshotTrackBase<boolean|null>&{channel:'visibility'})
 | (SnapshotTrackBase<SceneIntervalValue>&{channel:'interval';sourceTrackId:string;materialIssue?:SnapshotMaterialIssue})
 | (SnapshotTrackBase<number>&{channel:'depth'})
 | (SnapshotTrackBase<WarpGrid>&{channel:'warp'})
 | (SnapshotTrackBase<Point2>&{channel:'relationPosition'});
export interface SnapshotSourceMetadata {
 artworkId:string;originIds:Record<string,string>;
 reference?:DrawingDocument['reference'];mirrorAxisX?:number;mirrorEditing?:DrawingDocument['mirrorEditing'];
}
export interface RecordingSnapshot {
 id:string;name:string;kind:'drawing'|'sculpt'|'view'|'assembly';
 /** The sole semantic parent. Layer source addresses remain provenance. */
 parentSnapshotId?:string;
 /** Optional ordinary input-domain reflection of the sole semantic parent. */
 inputMirror?:SnapshotMirrorOptions;
 /** Presence opts this node into live whole-parent layer slots. Local deletions
  * and ordering remain authored choices, never regenerated on load. */
 parentLayers?:{excludedLayerIds?:string[];orderOverride?:boolean};
 /** Legacy evaluation adapter. A triangulated recorder owns its vertex angles. */
 angle:Angle;
 /** One ordered ownership list; there is no separate sorting container. */
 layers:SnapshotLayer[];
 relations:SnapshotRelationOverrides;
 deformation:SnapshotDeformationState;
 /** Captured residual fallback only, never original or baked geometry. */
 inheritedState?:SnapshotDeformationState;
 authored:SnapshotAuthoredChannel[];
 source?:SnapshotSourceMetadata;
 /** A draft belongs to this node's coordinate and remains outside the key index. */
 draft?:{angle:Angle;deformation:SnapshotDeformationState;channels:SnapshotAuthoredChannel[]};
}
export interface SnapshotRecording {
 id:string;name:string;angle:Angle;snapshotIds:string[];activeSnapshotId?:string;tolerance?:number;
 /** Explicit opt-in. Missing mode retains sparse pose-track evaluation. */
 mode?:'tracks'|'endpoint-pair'|'triangulated';
 endpointPair?:SnapshotEndpointPair;
 angleGraph?:SnapshotAngleGraph;
 /** Sole authority for authored sparse angle values; snapshots only refer to keys. */
 tracks:SnapshotPoseTrack[];
 /** A curve/layer-owned response between two saved views. This never authors
  * pose keys; exact keys and shared deformation domains keep their authority. */
 interpolationWeights?:SnapshotInterpolationWeight[];
 /** Only genuinely unresolvable or conflicting migrations use this fallback. */
 legacy?:{scene:RecordingScene;readOnly:true;reason:string};
}
/** Interior piecewise-linear [progress,response] constraints. Progress is in
 * (0,1); responses may be signed, unbounded and nonmonotone. The two exact
 * endpoint responses are always 0 and 1 and are never stored as constraints. */
export interface SnapshotControlResponse {x?:Point2[];y?:Point2[]}
export interface SnapshotEndpointResponses {
 /** Minimum canonical node ID in a shared-node/EndpointLink component. */
 nodes:Record<string,SnapshotControlResponse>;
 /** Final endpoint-space handle vectors H-P, never absolute handle positions. */
 handles:Record<string,[SnapshotControlResponse,SnapshotControlResponse]>;
}
export interface SnapshotEndpointPair {
 axis:'x';startSnapshotId:string;endSnapshotId:string;
 responses?:SnapshotEndpointResponses;
 /** Editing constraints remain separate from saved scalar responses. */
 draft?:{angle:Angle;responses:SnapshotEndpointResponses};
}
/** Scalar constraints in the owning triangle's persisted vertex order. */
export interface SnapshotTriangleControlResponse {x?:InteriorResponseSample[];y?:InteriorResponseSample[]}
export interface SnapshotTriangleResponses {
 nodes:Record<string,SnapshotTriangleControlResponse>;
 /** Each handle is relative to its resolved node, H-P. */
 handles:Record<string,[SnapshotTriangleControlResponse,SnapshotTriangleControlResponse]>;
}
/** Recorder-owned editing frame, never a snapshot or a geometric mesh vertex.
 * Draft collections replace the corresponding saved simplex response. */
export interface SnapshotCorrectionFrame {
 id:string;angle:Angle;status:'saved'|'draft';
 edgeResponses?:Record<string,SnapshotEndpointResponses>;
 triangleResponses?:Record<string,SnapshotTriangleResponses>;
}
/** Keep the exact old coordinate frame with retired constraints. Recovery does
 * not silently attach them to an unrelated live edge or triangle. */
export interface SnapshotOrphanedResponses {
 id:string;reason:'deleted-view'|'mesh-change'|'unhandled-rebind';message:string;
 mesh:SnapshotTriangulation;
 edgeResponses:Record<string,SnapshotEndpointResponses>;
 triangleResponses:Record<string,SnapshotTriangleResponses>;
 correctionFrames?:SnapshotCorrectionFrame[];
}
export interface SnapshotAngleGraph {
 version:1;mesh:SnapshotTriangulation;
 /** Every shared edge has the sole orientation saved in mesh.edges. */
 edgeResponses:Record<string,SnapshotEndpointResponses>;
 triangleResponses:Record<string,SnapshotTriangleResponses>;
 correctionFrames?:SnapshotCorrectionFrame[];
 orphanedResponses?:SnapshotOrphanedResponses[];
 /** Recovery evidence. The original recording and real snapshots also remain
  * in the workspace, byte-for-byte unchanged by copy migration. */
 migration?:{sourceRecordingId:string;sourceMode:'endpoint-pair';sourceRecordingJSON:string;sourceSnapshotsJSON:string};
}
export interface SnapshotInterpolationWeight {
 id:string;target:{layerId:string;curveId?:string};startSnapshotId:string;endSnapshotId:string;
 /** Monotone control points in normalized progress/weight coordinates. The
  * endpoints are fixed at [0,0] and [1,1]; absence of an asset means linear. */
 points:Point2[];
}
export interface RecordingSnapshotWorkspace {
 version:2;library:CanonicalElementStore;snapshots:RecordingSnapshot[];
 recordings:SnapshotRecording[];activeRecordingId?:string;
 /** Recovery evidence only; it is never another live geometry authority. */
 legacyArchive?:{projectJSON:string;format:'landmark-project-json';migrationVersion:2};
}
/** Derived sparse index. Values stay in recording tracks; rebuilding an
 * index never authors a key or fills in another layer's absent sample. */
export interface SnapshotPoseKeyRef {snapshotId?:string;channelId:string;keyId:string;angle:Angle;name?:string}
export interface SnapshotPoseTrackIndex {
 channel:SnapshotPoseChannel;targetId:string;elementId?:string;
 interpolation:'independent'|'legacy';keys:SnapshotPoseKeyRef[];
}
export type SnapshotDiagnosticCode='MISSING_SNAPSHOT'|'MISSING_LAYER'|'MISSING_ELEMENT'|'MISSING_RELATION'|'RELATION_CONFLICT'|'BRANCH_CONFLICT'|'SNAPSHOT_CYCLE'|'LEGACY_READ_ONLY'|'SOURCE_MATERIAL'|'LOCAL_ORIGINAL'|'POSE'|'ROUTE'|'INPUT_MIRROR';
export interface SnapshotDiagnostic {code:SnapshotDiagnosticCode;message:string;snapshotId?:string;layerId?:string;elementId?:string;channelId?:string}
/** Path records distinguish equal geometry from conflicting parent states. */
export interface SnapshotElementProvenance {
 elementId:string;sourceSnapshotId:string;path:string[];
 /** Runtime-only material address; never serialized with snapshot resources. */
 materialContext?:{elementId:string;idMap:Record<string,string>};
}
export const emptyCanonicalElementStore=():CanonicalElementStore=>({nodes:{},curves:{},fills:{},offsets:{}});
export const emptySnapshotDeformationState=():SnapshotDeformationState=>({warps:[],bindings:[],layers:{},relationPositions:{}});
export const emptyRecordingSnapshot=(id:string,name='View',kind:RecordingSnapshot['kind']='view',angle:Angle={x:0,y:0}):RecordingSnapshot=>({id,name,kind,angle:{...angle},layers:[],relations:{},deformation:emptySnapshotDeformationState(),authored:[]});
export const emptySnapshotRecording=(id:string,name='Recording'):SnapshotRecording=>({id,name,angle:{x:0,y:0},snapshotIds:[],tracks:[]});
export const emptyRecordingSnapshotWorkspace=():RecordingSnapshotWorkspace=>({version:2,library:emptyCanonicalElementStore(),snapshots:[],recordings:[]});
export const snapshotElementKey=(snapshotId:string,elementId:string):string=>JSON.stringify([snapshotId,elementId]);
export const snapshotChannelKey=(channel:SnapshotPoseChannel,targetId:string,elementId?:string):string=>JSON.stringify([channel,targetId,elementId??null]);
