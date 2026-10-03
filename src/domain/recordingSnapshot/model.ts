import type {SnapshotObjectLocks} from './objectLocks';
import type {SnapshotVisibilityRecipeRegistry} from './visibilityRestriction';
import type {SnapshotMaterialPathLineage} from './materialPathLineages';
import type {SnapshotMaterialRecipeRegistry} from './materialRestriction';
import type {SnapshotMaterialPartition} from './materialSplit';
import type {SnapshotLayerDomain} from './layerDomains';
import type {SnapshotResponseExpression} from './responseExpressions';
import type {DrawingDocument,DrawingNode,DrawingCurve,FillRegion,OffsetRelation,DrawingLayer,TangentJoin,EndpointLink,DrawingGroup,StrokeDisplayIntervals,Point2} from '../drawing/model';
import type {RecordingScene,ScenePlacementValue,SceneShapeValue,SceneIntervalValue,SceneTrack,WarpGrid,Angle} from '../recordingScene/model';
import type {SnapshotTriangulation} from './triangulation';
import type {InteriorResponseSample,ScalarResponseKnot} from './triangularResponses';
import type {SnapshotMirrorOptions} from './snapshotMirror';
import type {SnapshotNodeAliases} from './nodeAliases';
import type {SnapshotNodeForks} from './nodeForks';
import type {SnapshotCurveAppearanceMap} from './curveAppearance';

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
 /** Sparse local ink/style fields; absent properties keep following the source. */
 curveAppearance?:SnapshotCurveAppearanceMap;
 intervals?:Record<string,SceneIntervalValue>;depth?:number;
}
export interface SnapshotMaterialIssue {sourceSnapshotId:string;sourceSignature:string;message:string}
export interface SnapshotRelationPositionState {sourceLinkIds:string[];offset:Point2}
/** Only this node's residual deformation, applied after its saved parent state. */
export interface SnapshotDeformationState {
 warps:SnapshotWarpState[];bindings:SnapshotWarpBinding[];
 /** Authored order after curve/layer placement; scope follows current members. */
 layerDomains?:SnapshotLayerDomain[];
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
 /** Discrete per-object editor locks; absent IDs follow their live parent. */
 objectLocks?:SnapshotObjectLocks;
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
 /** Snapshot-only shared-node authorities; original source topology stays live. */
 nodeAliases?:SnapshotNodeAliases;
 /** Explicit unbind identities, following their source endpoint before local shape. */
 nodeForks?:SnapshotNodeForks;
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
/** A typed address into saved material, not a node, pose key or mesh vertex.
 * Endpoint values come from the actual active snapshot bases in one material
 * coordinate frame. Equal start/end values are a valid zero-length range. */
export interface SnapshotIntervalEndpointTarget {
 kind:'interval-endpoint';layerId:string;sourceTrackId:string;rangeId:string;end:'start'|'end';
}
/** Extend this union only when a channel has a real basis resolver and runtime
 * adapter. Continuous placement components may use the same scalar field;
 * discrete display channels need their own semantics and are not implemented. */
export type SnapshotScalarPropertyTarget=SnapshotIntervalEndpointTarget;
export interface SnapshotEdgePropertyResponse {
 target:SnapshotScalarPropertyTarget;knots:ScalarResponseKnot[];
}
export interface SnapshotTrianglePropertyResponse {
 target:SnapshotScalarPropertyTarget;samples:InteriorResponseSample[];
}
/** Each edge uses mesh.edges' sole orientation; each triangle uses its saved
 * vertex order. Attribute responses never replace geometric barycentrics. */
export interface SnapshotPropertyResponses {
 edges:Record<string,SnapshotEdgePropertyResponse[]>;
 triangles:Record<string,SnapshotTrianglePropertyResponse[]>;
}
/** Recorder-owned editing frame, never a snapshot or a geometric mesh vertex.
 * Draft collections replace the corresponding saved simplex response. */
export interface SnapshotCorrectionFrame {
 responseExpressions?:SnapshotResponseExpressionRegistry;
 id:string;angle:Angle;status:'saved'|'draft';
 edgeResponses?:Record<string,SnapshotEndpointResponses>;
 triangleResponses?:Record<string,SnapshotTriangleResponses>;
 propertyResponses?:SnapshotPropertyResponses;
}
/** Keep the exact old coordinate frame with retired constraints. Recovery does
 * not silently attach them to an unrelated live edge or triangle. */
export interface SnapshotOrphanedResponses {
 materialPathLineages?:SnapshotMaterialPathLineage[];
 materialPartitions?:SnapshotMaterialPartition[];
 materialRecipes?:SnapshotMaterialRecipeRegistry;
 materialBasisRecipes?:SnapshotMaterialRecipeRegistry;
 visibilityRecipes?:SnapshotVisibilityRecipeRegistry;
 visibilityBasisRecipes?:SnapshotVisibilityRecipeRegistry;
 responseExpressions?:SnapshotResponseExpressionRegistry;
 id:string;reason:'deleted-view'|'mesh-change'|'unhandled-rebind';message:string;
 mesh:SnapshotTriangulation;
 edgeResponses:Record<string,SnapshotEndpointResponses>;
 triangleResponses:Record<string,SnapshotTriangleResponses>;
 propertyResponses?:SnapshotPropertyResponses;
 correctionFrames?:SnapshotCorrectionFrame[];
}
/** Inherited scalar residuals are flat live-basis expressions. Native saved or
 * draft responses add to these residuals; they never replace their provenance. */
export interface SnapshotExpressionControlResponse {x?:SnapshotResponseExpression;y?:SnapshotResponseExpression}
export interface SnapshotExpressionResponses {
 nodes:Record<string,SnapshotExpressionControlResponse>;
 handles:Record<string,readonly [SnapshotExpressionControlResponse,SnapshotExpressionControlResponse]>;
}
export type SnapshotResponseExpressionRegistry=Record<string,SnapshotExpressionResponses>;
export interface SnapshotAngleGraph {
 /** Live curve/t measurement lineage for unscoped stroke and explicit-route fields. */
 materialPathLineages?:SnapshotMaterialPathLineage[];
 /** Recorder-owned material partitions retain split IDs and source fractions. */
 materialPartitions?:SnapshotMaterialPartition[];
 /** Recorder-owned live material supports, independent of newly inserted geometry keys. */
 materialRecipes?:SnapshotMaterialRecipeRegistry;
 materialBasisRecipes?:SnapshotMaterialRecipeRegistry;
 visibilityRecipes?:SnapshotVisibilityRecipeRegistry;
 visibilityBasisRecipes?:SnapshotVisibilityRecipeRegistry;
 responseExpressions?:SnapshotResponseExpressionRegistry;
 version:1;mesh:SnapshotTriangulation;
 /** Every shared edge has the sole orientation saved in mesh.edges. */
 edgeResponses:Record<string,SnapshotEndpointResponses>;
 triangleResponses:Record<string,SnapshotTriangleResponses>;
 propertyResponses?:SnapshotPropertyResponses;
 correctionFrames?:SnapshotCorrectionFrame[];
 orphanedResponses?:SnapshotOrphanedResponses[];
 /** Recovery evidence. The original recording and real snapshots also remain
  * in the workspace, byte-for-byte unchanged by copy migration. */
 migration?:{sourceRecordingId:string;sourceMode:'endpoint-pair';sourceRecordingJSON:string;sourceSnapshotsJSON:string};
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
export type SnapshotDiagnosticCode='MISSING_SNAPSHOT'|'MISSING_LAYER'|'MISSING_ELEMENT'|'MISSING_RELATION'|'RELATION_CONFLICT'|'BRANCH_CONFLICT'|'SNAPSHOT_CYCLE'|'LEGACY_READ_ONLY'|'SOURCE_MATERIAL'|'LOCAL_ORIGINAL'|'POSE'|'ROUTE'|'INPUT_MIRROR'|'LAYER_DOMAIN';
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
