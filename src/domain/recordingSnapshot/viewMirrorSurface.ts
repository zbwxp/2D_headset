import {prepareSnapshotViewMirrorMaterial} from './viewMirrorMaterial';
import type {DrawingDocument,Endpoint,Point2} from '../drawing/model';
import {InputCache} from '../geometry/cache';
import type {Angle,SnapshotAngleGraph} from './model';
import {snapshotProjectionScalarKey,snapshotResponseProjectionContracts} from './responseExpressionProjection';
import type {SnapshotSmoothProjectionContract} from './responseExpressions';
import {interpolateSnapshotSimplexGeometry,type SnapshotScalarTarget,type SnapshotSimplexBasis} from './simplexGeometry';
import {deriveSmoothComponents,smoothEndpointKey} from './smoothComponent';
import type {SnapshotSurfaceMirrorContext,SnapshotSurfaceMirrorSample} from './surfaceMirrorContext';
import {prepareSnapshotSurfaceValueProgram,effectiveSnapshotSurfaceResponses} from './surfaceTargets';
import {locateSnapshotSimplex,type SnapshotSimplexLocation} from './triangulation';
import type {ViewMirrorOptions} from './viewMirrorMath';
import {mirrorViewDrawingPresence} from './viewMirrorInput';

/** Strip material adapters before reflecting sampled controls. The ordinary
 * positive material pipeline retains its own canonical ownership and routes. */
const geometryOnly=(drawing:DrawingDocument):DrawingDocument=>{const ids=new Set(drawing.curves.map(curve=>curve.id));return {...drawing,nodes:[...drawing.nodes],curves:[...drawing.curves],layers:drawing.layers.map(layer=>({...layer,items:layer.items.filter(id=>ids.has(id))})),fills:[],offsets:[],displayIntervals:[]};};

/** Resolve the true reflected source simplex, including a different triangle
 * diagonal. Native source programs and complete sampled controls are shared by
 * every scalar and onion frame; no recursive workspace evaluation occurs. */
export function prepareSnapshotViewMirrorSurface(graph:SnapshotAngleGraph,bases:readonly SnapshotSimplexBasis[],zero:DrawingDocument,options:(current:DrawingDocument)=>ViewMirrorOptions):SnapshotSurfaceMirrorContext {
 const vertices=new Map(graph.mesh.vertices.map(vertex=>[vertex.id,vertex.angle])),byId=new Map(bases.map(basis=>[basis.snapshotId,basis])),effective=effectiveSnapshotSurfaceResponses(graph);
 type Frame={drawing:DrawingDocument;location:SnapshotSimplexLocation;scalar:SnapshotSurfaceMirrorSample['scalar'];contracts:SnapshotSmoothProjectionContract[];diagnostics:string[]};
 const programs=new Map<string,ReturnType<typeof prepareSnapshotSurfaceValueProgram>>(),frames=new InputCache<Frame>(96),supports=new Map<string,Angle[]>();
 type NodeMap={sourceId:string;targetId:string;sourceZero:Point2;targetZero:Point2};
 type HandleMap={source:Endpoint;target:Endpoint;sourceZero:Point2;targetZero:Point2;targetNode:string};
 const projections=new Map<string,{nodes:NodeMap[];handles:HandleMap[];contracts:SnapshotSmoothProjectionContract[];diagnostics:string[]}>(),zeroNodes=new Map(zero.nodes.map(node=>[node.id,node])),zeroCurves=new Map(zero.curves.map(curve=>[curve.id,curve]));
 const at=(angle:Angle)=>{
  const sourceAngle={x:-angle.x,y:angle.y},key=JSON.stringify([sourceAngle.x,sourceAngle.y]),known=frames.get(key);if(known)return known;
  const location=locateSnapshotSimplex(graph.mesh,sourceAngle);if(!location)throw Error(`View mirror source angle (${sourceAngle.x}, ${sourceAngle.y}) is outside authored coverage.`);
  const supportKey=JSON.stringify([location.simplexId,location.vertexIds]);let program=programs.get(supportKey);
  if(!program){program=prepareSnapshotSurfaceValueProgram(graph,location,bases);programs.set(supportKey,program);}
  const sampler=program.createSampler();
  const source=interpolateSnapshotSimplexGeometry(location.snapshotIds.map(id=>byId.get(id)!),location.geometricWeights,sampler).drawing;
  let projection=projections.get(supportKey);
  if(!projection){
  const reference={...geometryOnly(source),nodes:source.nodes.map(node=>zeroNodes.get(node.id)??node),curves:source.curves.map(curve=>({...curve,handles:zeroCurves.get(curve.id)?.handles??curve.handles}))};
  const mirrored=mirrorViewDrawingPresence(reference,geometryOnly(zero),options(source)),targetNodes=new Map(mirrored.drawing.nodes.map(node=>[node.id,node.position])),targetCurves=new Map(mirrored.drawing.curves.map(curve=>[curve.id,curve]));
  const endpoint=(value:Endpoint):Endpoint=>{const mapped=mirrored.correspondence.curves[value.curveId];if(!mapped)throw Error(`View mirror source is missing SMOOTH endpoint ${value.curveId}/${value.end}.`);return {curveId:mapped.id,end:mapped.reverse?(value.end===0?1:0):value.end};};
  const retained=snapshotResponseProjectionContracts(effective.responseExpressions[location.simplexId]),owned=new Set(retained.flatMap(contract=>contract.targets.map(target=>smoothEndpointKey(target.endpoint))));
  const native=deriveSmoothComponents([...source.joins.filter(join=>join.mode==='SMOOTH'),...(source.endpointLinks??[]).filter(link=>link.joinBrush?.kind==='SMOOTH')]).filter(component=>component.members.every(member=>!owned.has(smoothEndpointKey(member.endpoint)))).map(component=>({id:JSON.stringify(['native-smooth',location.simplexId,component.relationId]),component,targets:component.members.map(member=>({endpoint:member.endpoint,scale:1}))}));
  const present=new Set(Object.keys(mirrored.correspondence.curves)),contracts=[...retained,...native].filter(contract=>contract.targets.every(target=>present.has(target.endpoint.curveId))).map(contract=>({...contract,id:JSON.stringify(['view-mirror',contract.id]),targets:contract.targets.map(target=>({...target,endpoint:endpoint(target.endpoint)}))}));
  const nodes:NodeMap[]=reference.nodes.filter(node=>mirrored.correspondence.nodes[node.id]!==undefined).map(node=>({sourceId:node.id,targetId:mirrored.correspondence.nodes[node.id],sourceZero:node.position,targetZero:targetNodes.get(mirrored.correspondence.nodes[node.id])!}));
  const handles:HandleMap[]=reference.curves.filter(curve=>present.has(curve.id)).flatMap(curve=>([0,1] as const).map(end=>{const target=endpoint({curveId:curve.id,end}),mapped=targetCurves.get(target.curveId)!;return {source:{curveId:curve.id,end},target,sourceZero:curve.handles[end],targetZero:mapped.handles[target.end],targetNode:mapped.nodes[target.end]};}));
  projection={nodes,handles,contracts,diagnostics:mirrored.diagnostics.map(issue=>issue.message)};projections.set(supportKey,projection);
  }
  const sourceNodes=new Map(source.nodes.map(node=>[node.id,node.position])),sourceCurves=new Map(source.curves.map(curve=>[curve.id,curve])),values=new Map<string,number>();
  for(const node of projection.nodes)for(const axis of [0,1] as const)values.set(snapshotProjectionScalarKey({kind:'node',nodeId:node.targetId},axis),node.targetZero[axis]+(axis===0?-1:1)*(sourceNodes.get(node.sourceId)![axis]-node.sourceZero[axis]));
  for(const handle of projection.handles)for(const axis of [0,1] as const){const absolute=handle.targetZero[axis]+(axis===0?-1:1)*(sourceCurves.get(handle.source.curveId)!.handles[handle.source.end][axis]-handle.sourceZero[axis]);values.set(snapshotProjectionScalarKey({kind:'handle',...handle.target},axis),absolute-values.get(snapshotProjectionScalarKey({kind:'node',nodeId:handle.targetNode},axis))!);}
  const scalar:SnapshotSurfaceMirrorSample['scalar']=(target,axis)=>values.get(snapshotProjectionScalarKey(target,axis));
  return frames.set(key,{drawing:source,location,scalar,contracts:projection.contracts,diagnostics:projection.diagnostics});
 };
 return {material:prepareSnapshotViewMirrorMaterial(graph,bases,zero,options,at),sample:(location:SnapshotSimplexLocation,weights:readonly number[]):SnapshotSurfaceMirrorSample|undefined=>{
  const key=JSON.stringify(location.vertexIds);let corners=supports.get(key);if(!corners){corners=location.vertexIds.map(id=>vertices.get(id)!);supports.set(key,corners);}
  const angle=corners.reduce((sum,corner,index)=>({x:sum.x+corner.x*weights[index],y:sum.y+corner.y*weights[index]}),{x:0,y:0});if(angle.x<=0)return;
  const current=at(angle),anchors=corners.map(at);
  return {scalar:current.scalar,corners:(target,axis)=>anchors.map(anchor=>anchor.scalar(target,axis)),contracts:current.contracts,diagnostics:[...new Set([current,...anchors].flatMap(frame=>frame.diagnostics))]};
 }};
}
