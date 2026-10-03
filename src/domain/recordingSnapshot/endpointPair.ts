import {add,sub,length,finitePoint,type DrawingDocument,type Point2,type Endpoint} from '../drawing/model';
import {evaluatedAffine} from '../drawing/evaluatedAffine';
import {scaleEvaluatedDisplayRouteBrush} from '../drawing/displayRouteBrush';
import {intervalPinch,withIntervalPinch} from '../drawing/intervalPinch';
import {transportEndpointPairMaterial,replaceEndpointPairMaterial} from './endpointPairMaterial';
import type {SnapshotControlResponse,SnapshotEndpointPair,SnapshotEndpointResponses} from './model';

const own=<T>(record:Record<string,T>|undefined,id:string):T|undefined=>record&&Object.hasOwn(record,id)?record[id]:undefined;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const blend=(a:number,b:number,t:number)=>a+(b-a)*t;
const numericTolerance=(...values:number[])=>64*Number.EPSILON*Math.max(1,...values.map(Math.abs));

/** No epsilon denominator: an unavailable coordinate has no inverse. */
export function invertEndpointPairCoordinate(start:number,end:number,target:number):{available:true;value:number}|{available:false;reason:string} {
 if(![start,end,target].every(Number.isFinite))return {available:false,reason:'Endpoint-pair coordinates must be finite.'};
 const delta=end-start;if(Math.abs(delta)<=numericTolerance(start,end))return {available:false,reason:'The endpoint coordinate delta is zero or numerically indistinguishable from zero; edit an endpoint basis to enable this axis.'};
 const value=(target-start)/delta;return Number.isFinite(value)?{available:true,value}:{available:false,reason:'The inverse response is not finite.'};
}

export function validateSnapshotControlResponse(response:SnapshotControlResponse):void {
 if(!response||typeof response!=='object'||Array.isArray(response)||Object.keys(response).some(key=>key!=='x'&&key!=='y'))throw Error('Invalid endpoint control response.');
 for(const axis of ['x','y'] as const){const knots=response[axis];if(knots===undefined)continue;
  if(!Array.isArray(knots)||knots.length>256||knots.some((p,index)=>!finitePoint(p)||p[0]<=0||p[0]>=1||index>0&&p[0]<=knots[index-1][0]))throw Error('Endpoint response knots need finite values and strictly increasing interior progress.');
 }
}
export function validateEndpointResponse(points:Point2[]):void {validateSnapshotControlResponse({x:points});}
export function validateSnapshotEndpointResponses(responses:SnapshotEndpointResponses):void {
 if(!responses||typeof responses!=='object'||!responses.nodes||!responses.handles||Array.isArray(responses.nodes)||Array.isArray(responses.handles))throw Error('Invalid endpoint response collection.');
 for(const [id,response] of Object.entries(responses.nodes)){if(!id)throw Error('Endpoint response node ID is empty.');validateSnapshotControlResponse(response);}
 for(const [id,responsesForCurve] of Object.entries(responses.handles)){if(!id||!Array.isArray(responsesForCurve)||responsesForCurve.length!==2)throw Error('Endpoint response handles need a canonical curve and two controls.');responsesForCurve.forEach(validateSnapshotControlResponse);}
}
export function validateSnapshotEndpointPair(pair:SnapshotEndpointPair):void {
 if(!pair||pair.axis!=='x'||typeof pair.startSnapshotId!=='string'||!pair.startSnapshotId||typeof pair.endSnapshotId!=='string'||!pair.endSnapshotId||pair.startSnapshotId===pair.endSnapshotId)throw Error('An endpoint pair needs two distinct yaw endpoint snapshots.');
 if(pair.responses!==undefined)validateSnapshotEndpointResponses(pair.responses);
 if(pair.draft){if(![pair.draft.angle?.x,pair.draft.angle?.y].every(Number.isFinite))throw Error('Endpoint response draft angle must be finite.');validateSnapshotEndpointResponses(pair.draft.responses);}
}

/** Linear segments interpolate every signed constraint exactly, including
 * reversals and overshoot. Clamping progress never clamps the response. */
export function evaluateEndpointResponse(knots:readonly Point2[]|undefined,progress:number):number {
 if(!Number.isFinite(progress))throw Error('Endpoint-pair progress must be finite.');
 const t=Math.max(0,Math.min(1,progress));if(t===0||t===1)return t;
 let left:Point2=[0,0];for(const right of knots??[]){if(t<=right[0])return blend(left[1],right[1],(t-left[0])/(right[0]-left[0]));left=right;}
 return blend(left[1],1,(t-left[0])/(1-left[0]));
}

/** Canonical ID order, never layer/array order or proximity, chooses the one
 * position authority of every explicit EndpointLink component. */
export function endpointPairNodeAuthorities(drawing:DrawingDocument):Map<string,string> {
 const parents=new Map(drawing.nodes.map(n=>[n.id,n.id])),curves=new Map(drawing.curves.map(c=>[c.id,c]));
 const root=(id:string):string=>{const parent=parents.get(id);if(!parent||parent===id)return id;const next=root(parent);parents.set(id,next);return next;};
 for(const link of drawing.endpointLinks??[]){const a=curves.get(link.a.curveId)?.nodes[link.a.end],b=curves.get(link.b.curveId)?.nodes[link.b.end];if(!a||!b)continue;const x=root(a),y=root(b);if(x!==y)parents.set(x<y?y:x,x<y?x:y);}
 return new Map(drawing.nodes.map(n=>[n.id,root(n.id)]));
}

/** Structural compatibility is deliberate and lossless. No nearest matching,
 * missing-element omission, averaged link position, or hidden geometry bake. */
export function endpointPairCompatibility(start:DrawingDocument,end:DrawingDocument):string[] {
 const diagnostics:string[]=[],ids=(values:readonly {id:string}[])=>values.map(v=>v.id).sort();
 for(const key of ['nodes','curves','fills','offsets','layers','joins','endpointLinks','displayIntervals'] as const)if(!same(ids(start[key]??[]),ids(end[key]??[])))diagnostics.push(`Endpoint ${key} canonical IDs differ.`);
 const compare=<T extends {id:string}>(kind:string,left:readonly T[],right:readonly T[],value:(v:T)=>unknown)=>{const lookup=new Map(right.map(v=>[v.id,v]));for(const a of left){const b=lookup.get(a.id);if(b&&!same(value(a),value(b)))diagnostics.push(`${kind} ${a.id} has different endpoint topology.`);}};
 compare('Curve',start.curves,end.curves,c=>c.nodes);
 compare('Layer',start.layers,end.layers,l=>[...l.items].sort());
 compare('Fill',start.fills,end.fills,f=>f.boundary);
 compare('Offset',start.offsets,end.offsets,o=>o.source);
 compare('Join',start.joins,end.joins,j=>[j.a,j.b,j.mode]);
 compare('EndpointLink',start.endpointLinks??[],end.endpointLinks??[],l=>[l.a,l.b,l.throughDisplay,l.joinBrush?.kind]);
 compare('Material',start.displayIntervals??[],end.displayIntervals??[],t=>[t.anchor,t.scope,t.displayRoute,t.ranges.map(r=>r.id).sort()]);
 for(const [label,drawing] of [['Start',start],['End',end]] as const){
  const nodes=new Map(drawing.nodes.map(n=>[n.id,n.position]));for(const [id,authority] of endpointPairNodeAuthorities(drawing)){const p=nodes.get(id)!,q=nodes.get(authority)!;if(length(sub(p,q))>numericTolerance(...p,...q))diagnostics.push(`${label} EndpointLink component ${authority} has conflicting node ${id} positions.`);}
  const arcs=[...drawing.joins.filter(j=>j.mode==='ARC'),...(drawing.endpointLinks??[]).filter(l=>l.joinBrush?.kind==='ARC')];
  for(const arc of arcs)if([arc.a,arc.b].some(e=>evaluatedAffine(drawing,e.curveId)))diagnostics.push(`${label} ARC ${arc.id} has a deferred nonuniform placement; its endpoint ink is not representable by the final-control circular ARC basis.`);
 }
 return [...new Set(diagnostics)];
}

interface SmoothMember {endpoint:Endpoint;sign:number}
/** SMOOTH is an explicit existing relation, not an extra stored residual. The
 * stable driver supplies direction; each dependent retains its own length. */
export function applyEndpointPairSmoothConstraints(drawing:DrawingDocument):{drawing:DrawingDocument;diagnostics:string[]} {
 const relations=[...drawing.joins.filter(j=>j.mode==='SMOOTH'),...(drawing.endpointLinks??[]).filter(l=>l.joinBrush?.kind==='SMOOTH')].sort((a,b)=>a.id.localeCompare(b.id));
 if(!relations.length)return {drawing,diagnostics:[]};
 const key=(e:Endpoint)=>JSON.stringify([e.curveId,e.end]),graph=new Map<string,Endpoint[]>(),done=new Set<string>(),diagnostics:string[]=[];
 for(const relation of relations)for(const [a,b] of [[relation.a,relation.b],[relation.b,relation.a]])graph.set(key(a),[...(graph.get(key(a))??[]),b]);
 const curves=new Map(drawing.curves.map(c=>[c.id,{...c,handles:c.handles.map(p=>[...p]) as [Point2,Point2]}])),nodes=new Map(drawing.nodes.map(n=>[n.id,n.position]));
 for(const relation of relations){if(done.has(key(relation.a)))continue;const queue:SmoothMember[]=[{endpoint:relation.a,sign:1}],members=new Map([[key(relation.a),queue[0]]]);let conflict=false;
  for(const member of queue){done.add(key(member.endpoint));for(const other of graph.get(key(member.endpoint))??[]){const known=members.get(key(other));if(known){if(known.sign!==-member.sign)conflict=true;}else{const next={endpoint:other,sign:-member.sign};members.set(key(other),next);queue.push(next);}}}
  const driver=curves.get(relation.a.curveId)!,vector=sub(driver.handles[relation.a.end],nodes.get(driver.nodes[relation.a.end])!),size=length(vector);
  if(conflict||size<=numericTolerance(...vector)){diagnostics.push(`SMOOTH ${relation.id} has ${conflict?'conflicting tangent directions':'a zero-length driver'}; its constraint cannot be resolved.`);continue;}
  let projected=false;
  for(const {endpoint,sign} of queue){const curve=curves.get(endpoint.curveId)!,node=nodes.get(curve.nodes[endpoint.end])!,old=curve.handles[endpoint.end],extent=length(sub(old,node));if(extent<=numericTolerance(...old,...node)){diagnostics.push(`SMOOTH ${relation.id} handle ${endpoint.curveId}/${endpoint.end} has zero length.`);continue;}
   const next=add(node,[vector[0]*extent/size*sign,vector[1]*extent/size*sign]);if(length(sub(next,old))>numericTolerance(...next,...old))projected=true;curve.handles[endpoint.end]=next;
  }
  if(projected)diagnostics.push(`SMOOTH ${relation.id}: dependent handles follow the stable driver direction and their interpolated lengths.`);
 }
 return {drawing:{...drawing,curves:drawing.curves.map(c=>curves.get(c.id)!)},diagnostics};
}

function transportMaterial(start:DrawingDocument,end:DrawingDocument,drawing:DrawingDocument,t:number,startWins:boolean,diagnostics:string[]):DrawingDocument {
 if(!start.displayIntervals?.length)return drawing;
 const endTracks=new Map((end.displayIntervals??[]).map(track=>[track.id,track]));
 const displayIntervals=start.displayIntervals.map(first=>{
  const last=endTracks.get(first.id)!,selected=startWins?first:last;
  try{
   // Endpoint fields carry curve/source-t and ARC relation identity through
   // deformation. Percentages are blended only in the SAME final material domain.
   const a=transportEndpointPairMaterial(start,first,drawing,diagnostics),b=transportEndpointPairMaterial(end,last,drawing,diagnostics),right=new Map(b.ranges.map(r=>[r.id,r]));
   return {...selected,ranges:a.ranges.map(left=>{const r=right.get(left.id)!;return withIntervalPinch({...startWins?left:r,start:blend(left.start,r.start,t),end:blend(left.end,r.end,t)},blend(intervalPinch(left),intervalPinch(r),t));})};
  }catch(error){diagnostics.push(`Material ${first.id}: ${error instanceof Error?error.message:String(error)} The nearer endpoint material is retained and needs review.`);return structuredClone(selected);}
 });
 return replaceEndpointPairMaterial(drawing,displayIntervals);
}

/** A single common sampler for runtime, inverse correction and onion display.
 * Only endpoint final controls enter this path; Warp/placement are never run
 * for an intermediate. Derived ARC/ink is constructed by ordinary Drawing. */
export function interpolateEndpointPairDrawing(start:DrawingDocument,end:DrawingDocument,progress:number,responses?:SnapshotEndpointResponses,options:{startWins?:boolean}={}):{drawing:DrawingDocument;diagnostics:string[]} {
 if(!Number.isFinite(progress))throw Error('Endpoint-pair progress must be finite.');const t=Math.max(0,Math.min(1,progress));
 if(t===0)return {drawing:start,diagnostics:[]};if(t===1)return {drawing:end,diagnostics:[]};
 const diagnostics=endpointPairCompatibility(start,end);if(diagnostics.length)throw Error(diagnostics.join('\n'));
 const startWins=options.startWins??t<=.5,selected=startWins?start:end,firstNodes=new Map(start.nodes.map(n=>[n.id,n.position])),lastNodes=new Map(end.nodes.map(n=>[n.id,n.position])),lastCurves=new Map(end.curves.map(c=>[c.id,c])),authorities=endpointPairNodeAuthorities(start);
 const point=(a:Point2,b:Point2,response:SnapshotControlResponse|undefined,label='Control'):Point2=>{const result=([0,1] as const).map(axis=>{const key=axis?'y':'x',knots=response?.[key];if(knots?.length&&Math.abs(b[axis]-a[axis])<=numericTolerance(a[axis],b[axis]))diagnostics.push(`${label} ${key.toUpperCase()}: the endpoint delta is zero or numerically unavailable; its scalar response is retained but cannot move this coordinate.`);return blend(a[axis],b[axis],evaluateEndpointResponse(knots,t));}) as Point2;if(!finitePoint(result))throw Error('Endpoint response produces a non-finite coordinate.');return result;};
 const nodes=start.nodes.map(n=>{const id=authorities.get(n.id)!;return {...n,position:point(firstNodes.get(id)!,lastNodes.get(id)!,own(responses?.nodes,id),`Node ${id}`)};}),currentNodes=new Map(nodes.map(n=>[n.id,n.position]));
 for(const id of Object.keys(responses?.nodes??{}))if(!firstNodes.has(id))diagnostics.push(`Response node ${id} is missing; its scalar constraints are retained.`);else if(authorities.get(id)!==id)diagnostics.push(`Response node ${id} is not the authority of its EndpointLink component; only ${authorities.get(id)} controls its position.`);
 for(const id of Object.keys(responses?.handles??{}))if(!lastCurves.has(id))diagnostics.push(`Response curve ${id} is missing; its scalar constraints are retained.`);
 const curves=start.curves.map(c=>{const other=lastCurves.get(c.id)!,discrete=(startWins?c:other);return {...discrete,handles:([0,1] as const).map(endIndex=>add(currentNodes.get(c.nodes[endIndex])!,point(sub(c.handles[endIndex],firstNodes.get(c.nodes[endIndex])!),sub(other.handles[endIndex],lastNodes.get(other.nodes[endIndex])!),own(responses?.handles,c.id)?.[endIndex],`Handle ${c.id}/${endIndex}`))) as [Point2,Point2]};});
 const lastJoins=new Map(end.joins.map(j=>[j.id,j])),lastLinks=new Map((end.endpointLinks??[]).map(l=>[l.id,l])),lastOffsets=new Map(end.offsets.map(o=>[o.id,o]));
 let drawing:DrawingDocument={...selected,nodes,curves,joins:start.joins.map(j=>j.mode==='ARC'?{...j,radius:blend(j.radius!,lastJoins.get(j.id)!.radius!,t)}:j),endpointLinks:start.endpointLinks?.map(l=>{const other=lastLinks.get(l.id)!;return l.joinBrush?.kind==='ARC'&&other.joinBrush?.kind==='ARC'?{...l,joinBrush:scaleEvaluatedDisplayRouteBrush(l.joinBrush,blend(l.joinBrush.trimDistance,other.joinBrush.trimDistance,t)/l.joinBrush.trimDistance)}:l;}),offsets:selected.offsets.map(o=>{const a=start.offsets.find(v=>v.id===o.id)!,b=lastOffsets.get(o.id)!;return {...o,...(a.translation||b.translation?{translation:point(a.translation??[0,0],b.translation??[0,0],undefined)}:{})};})};
 const smooth=applyEndpointPairSmoothConstraints(drawing);drawing=smooth.drawing;diagnostics.push(...smooth.diagnostics);
 drawing=transportMaterial(start,end,drawing,t,startWins,diagnostics);
 // Material transport already checked the exact derived geometry. Changed
 // numeric masks do not require another traversal or ARC construction here.
 return {drawing,diagnostics:[...new Set(diagnostics)]};
}
