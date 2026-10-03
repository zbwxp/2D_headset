/** A persisted mesh of genuine saved views. Correction frames are deliberately
 * not an input type: callers must take these references from their real snapshot
 * registry, never from evaluated cursor frames or response/pose keys. Angles
 * belong to these recorder vertices, not to the referenced snapshot resource.
 *
 * Creation is deterministic Delaunay (including cocircular grids). Insertion
 * preserves the existing triangulation, splitting only the containing simplex
 * or extending its convex hull; it does not perform subsequent Delaunay flips.
 * Coordinates are ordinary IEEE numbers. Predicates use their exact binary
 * values, not a tolerance, decimal rounding, angle snapping, or a presence halo.
 */
export interface SnapshotTriangulationAngle {x:number;y:number}
export interface SnapshotTriangulationInput {
 snapshotId:string;
 angle:SnapshotTriangulationAngle;
}
export interface SnapshotTriangulationVertex extends SnapshotTriangulationInput {id:string}
export interface SnapshotTriangulationEdge {
 id:string;
 /** Shared orientation, ordered by vertex ID, independent of adjacent faces. */
 vertexIds:[string,string];
}
export interface SnapshotTriangulationTriangle {
 id:string;
 /** Counterclockwise, starting at the lexicographically first vertex ID. */
 vertexIds:[string,string,string];
 /** Edges (v0,v1), (v1,v2), (v2,v0); each edge owns its own orientation. */
 edgeIds:[string,string,string];
}
export interface SnapshotTriangulation {
 version:1;
 /** Missing means the initial full convex hull. Deletion or coordinate rebinding
  * makes coverage explicit: holes and disconnected regions must stay uncovered. */
 coverage?:'explicit';
 vertices:SnapshotTriangulationVertex[];
 edges:SnapshotTriangulationEdge[];
 triangles:SnapshotTriangulationTriangle[];
}
export interface SnapshotSimplexLocation {
 kind:'vertex'|'edge'|'triangle';
 simplexId:string;
 /** Only the geometrically active vertices: 1 at a vertex, 2 on an edge, 3
  * strictly inside a triangle. Presence must use these original weights/IDs,
  * never response-corrected or visibility/opacity-filtered weights. */
 vertexIds:string[];
 snapshotIds:string[];
 geometricWeights:number[];
}
export interface SnapshotCoverageProjection {
 requestedAngle:SnapshotTriangulationAngle;
 evaluatedAngle:SnapshotTriangulationAngle;
 outside:boolean;
 /** Use this returned support directly. Rounded projected coordinates need not
  * lie exactly on an oblique edge under the strict IEEE orientation predicate. */
 simplex:SnapshotSimplexLocation;
}

type Face=[string,string,string];
type VertexMap=Map<string,SnapshotTriangulationVertex>;
type Dyadic={n:bigint;e:number};
const bits=new DataView(new ArrayBuffer(8));
const compareId=(a:string,b:string)=>a<b?-1:a>b?1:0;
const pair=(a:string,b:string):[string,string]=>compareId(a,b)<0?[a,b]:[b,a];
const edgeKey=(a:string,b:string)=>JSON.stringify(pair(a,b));
const faceKey=(ids:readonly string[])=>JSON.stringify([...ids].sort(compareId));
const sign=(n:bigint)=>n<0n?-1:n>0n?1:0;

function requireId(id:string,label:string):void {
 if(typeof id!=='string'||!id.length)throw Error(`${label} must be a nonempty ID.`);
}
function requireAngle(angle:SnapshotTriangulationAngle):void {
 if(!angle||!Number.isFinite(angle.x)||!Number.isFinite(angle.y))throw Error('Snapshot triangulation angle must be finite.');
}
function compareVertex(a:SnapshotTriangulationVertex,b:SnapshotTriangulationVertex):number {
 return (a.angle.x<b.angle.x?-1:a.angle.x>b.angle.x?1:0)||
  (a.angle.y<b.angle.y?-1:a.angle.y>b.angle.y?1:0)||compareId(a.id,b.id);
}
function dyadic(value:number):Dyadic {
 if(value===0)return {n:0n,e:0};
 bits.setFloat64(0,value,false);
 const high=bits.getUint32(0,false),low=bits.getUint32(4,false),exponent=(high>>>20)&0x7ff;
 const fraction=(BigInt(high&0xfffff)<<32n)|BigInt(low);
 return {n:(high>>>31?-1n:1n)*(exponent?fraction|(1n<<52n):fraction),e:exponent?exponent-1075:-1074};
}
function commonIntegers(values:readonly number[]):{values:bigint[];e:number} {
 const ds=values.map(dyadic),e=Math.min(...ds.filter(d=>d.n!==0n).map(d=>d.e),0);
 return {values:ds.map(d=>d.n===0n?0n:d.n<<BigInt(d.e-e)),e};
}
function determinant(a:SnapshotTriangulationAngle,b:SnapshotTriangulationAngle,c:SnapshotTriangulationAngle):Dyadic {
 const {values:[ax,ay,bx,by,cx,cy],e}=commonIntegers([a.x,a.y,b.x,b.y,c.x,c.y]);
 return {n:(bx-ax)*(cy-ay)-(by-ay)*(cx-ax),e:2*e};
}
/** Exact orientation of finite represented coordinates; +1 is counterclockwise. */
export function snapshotOrientation(a:SnapshotTriangulationAngle,b:SnapshotTriangulationAngle,c:SnapshotTriangulationAngle):-1|0|1 {
 requireAngle(a);requireAngle(b);requireAngle(c);
 return sign(determinant(a,b,c).n);
}
function insideCircle(a:SnapshotTriangulationAngle,b:SnapshotTriangulationAngle,c:SnapshotTriangulationAngle,d:SnapshotTriangulationAngle):number {
 const {values:[ax,ay,bx,by,cx,cy,dx,dy]}=commonIntegers([a.x,a.y,b.x,b.y,c.x,c.y,d.x,d.y]);
 const x=ax-dx,y=ay-dy,u=bx-dx,v=by-dy,p=cx-dx,q=cy-dy;
 return sign((x*x+y*y)*(u*q-v*p)-(u*u+v*v)*(x*q-y*p)+(p*p+q*q)*(x*v-y*u));
}
function positiveRatio(numerator:Dyadic,denominator:Dyadic):number {
 const n=numerator.n<0n?-numerator.n:numerator.n,d=denominator.n<0n?-denominator.n:denominator.n;
 if(n===0n)return 0;
 const ns=Math.max(0,n.toString(2).length-53),ds=Math.max(0,d.toString(2).length-53);
 const exponent=numerator.e-denominator.e+ns-ds;
 const ratio=Number(n>>BigInt(ns))/Number(d>>BigInt(ds));
 // A positive represented area can have a barycentric smaller than the smallest
 // double. Preserve its active membership; numeric geometry saturates at MIN_VALUE.
 return Math.max(Number.MIN_VALUE,Math.min(1,ratio*2**Math.max(-1074,exponent)*2**Math.min(0,exponent+1074)));
}
function difference(a:number,b:number):Dyadic {
 const {values:[ai,bi],e}=commonIntegers([a,b]);return {n:ai-bi,e};
}
function onSegment(p:SnapshotTriangulationAngle,a:SnapshotTriangulationAngle,b:SnapshotTriangulationAngle):boolean {
 return p.x>=Math.min(a.x,b.x)&&p.x<=Math.max(a.x,b.x)&&p.y>=Math.min(a.y,b.y)&&p.y<=Math.max(a.y,b.y)&&determinant(a,b,p).n===0n;
}
function makeFace(a:string,b:string,c:string,vertices:VertexMap):Face {
 const orientation=sign(determinant(vertices.get(a)!.angle,vertices.get(b)!.angle,vertices.get(c)!.angle).n);
 if(!orientation)throw Error('Snapshot triangulation cannot contain a degenerate triangle.');
 const ids:Face=orientation>0?[a,b,c]:[a,c,b],first=ids.reduce((best,id,i)=>compareId(id,ids[best])<0?i:best,0);
 return [ids[first],ids[(first+1)%3],ids[(first+2)%3]];
}
function faceEdges(face:Face):[string,string][] {return [[face[0],face[1]],[face[1],face[2]],[face[2],face[0]]];}
function adjacency(faces:readonly Face[]):Map<string,{a:string;b:string;faces:number[]}> {
 const result=new Map<string,{a:string;b:string;faces:number[]}>();
 faces.forEach((face,index)=>{for(const [a,b] of faceEdges(face)){
  const key=edgeKey(a,b),known=result.get(key);if(known)known.faces.push(index);else result.set(key,{a,b,faces:[index]});
 }});return result;
}
function withFaces(vertices:SnapshotTriangulationVertex[],faces:readonly Face[],previous?:SnapshotTriangulation):SnapshotTriangulation {
 const oldEdges=new Map(previous?.edges.map(edge=>[edgeKey(...edge.vertexIds),edge])),oldFaces=new Map(previous?.triangles.map(face=>[faceKey(face.vertexIds),face]));
 const edgeMap=new Map<string,SnapshotTriangulationEdge>();
 const addEdge=(a:string,b:string)=>{
  const key=edgeKey(a,b);if(!edgeMap.has(key))edgeMap.set(key,oldEdges.get(key)??{id:`snapshot-edge:${key}`,vertexIds:pair(a,b)});
  return edgeMap.get(key)!;
 };
 const triangles=faces.map(face=>{
  const edgeIds=faceEdges(face).map(([a,b])=>addEdge(a,b).id) as [string,string,string];
  return oldFaces.get(faceKey(face))??{id:`snapshot-triangle:${faceKey(face)}`,vertexIds:face,edgeIds};
 });
 if(previous?.coverage==='explicit'){
  const faceEdges=new Set(previous.triangles.flatMap(face=>face.edgeIds));
  for(const edge of previous.edges)if(!faceEdges.has(edge.id))addEdge(...edge.vertexIds);
 }else if(!triangles.length){const sorted=[...vertices].sort(compareVertex);for(let i=1;i<sorted.length;i++)addEdge(sorted[i-1].id,sorted[i].id);}
 return {version:1,...(previous?.coverage?{coverage:previous.coverage}:{}),vertices,edges:[...edgeMap.values()].sort((a,b)=>compareId(a.id,b.id)),triangles:triangles.sort((a,b)=>compareId(a.id,b.id))};
}
function splitIndependentEdge(mesh:SnapshotTriangulation,vertex:SnapshotTriangulationVertex,edge:SnapshotTriangulationEdge):SnapshotTriangulation {
 const edges=mesh.edges.filter(candidate=>candidate.id!==edge.id);
 for(const endpoint of edge.vertexIds){const vertexIds=pair(endpoint,vertex.id);edges.push({id:`snapshot-edge:${edgeKey(...vertexIds)}`,vertexIds});}
 return {...mesh,vertices:[...mesh.vertices,vertex],edges:edges.sort((a,b)=>compareId(a.id,b.id))};
}
function addVertex(mesh:SnapshotTriangulation,vertex:SnapshotTriangulationVertex):SnapshotTriangulation {
 const vertices=[...mesh.vertices,vertex],byId=new Map(vertices.map(v=>[v.id,v])),faces:Face[]=mesh.triangles.map(face=>[...face.vertexIds]);
 const covered=mesh.coverage==='explicit'?locateSnapshotSimplex(mesh,vertex.angle):undefined;
 if(covered===null)throw Error('Cannot insert outside explicit snapshot coverage or inside a deleted hole; adding a region requires an explicit topology operation.');
 if(!faces.length){
  if(covered)return splitIndependentEdge(mesh,vertex,mesh.edges.find(edge=>edge.id===covered.simplexId)!);
  const offLine=mesh.edges.some(edge=>determinant(byId.get(edge.vertexIds[0])!.angle,byId.get(edge.vertexIds[1])!.angle,vertex.angle).n!==0n);
  if(offLine)for(const edge of mesh.edges)faces.push(makeFace(...edge.vertexIds,vertex.id,byId));
  return withFaces(vertices,faces,mesh);
 }
 const split=mesh.edges.find(edge=>onSegment(vertex.angle,byId.get(edge.vertexIds[0])!.angle,byId.get(edge.vertexIds[1])!.angle));
 if(split){
  const [a,b]=split.vertexIds,remaining:Face[]=[];
  if(!faces.some(face=>face.includes(a)&&face.includes(b)))return splitIndependentEdge(mesh,vertex,split);
  for(const face of faces){
   if(face.includes(a)&&face.includes(b)){const c=face.find(id=>id!==a&&id!==b)!;remaining.push(makeFace(a,vertex.id,c,byId),makeFace(vertex.id,b,c,byId));}
   else remaining.push(face);
  }
  return withFaces(vertices,remaining,mesh);
 }
 const containing=faces.findIndex(face=>faceEdges(face).every(([a,b])=>determinant(byId.get(a)!.angle,byId.get(b)!.angle,vertex.angle).n>0n));
 if(containing>=0){
  const [face]=faces.splice(containing,1);for(const [a,b] of faceEdges(face))faces.push(makeFace(a,b,vertex.id,byId));
 }else{
  for(const {a,b,faces:incident} of adjacency(faces).values())if(incident.length===1&&determinant(byId.get(a)!.angle,byId.get(b)!.angle,vertex.angle).n<0n)faces.push(makeFace(b,a,vertex.id,byId));
 }
 return withFaces(vertices,faces,mesh);
}
function compareDiagonal(a:string,b:string,c:string,d:string,vertices:VertexMap):number {
 const first=[vertices.get(a)!,vertices.get(b)!].sort(compareVertex),second=[vertices.get(c)!,vertices.get(d)!].sort(compareVertex);
 return compareVertex(first[0],second[0])||compareVertex(first[1],second[1]);
}
function initialDelaunay(mesh:SnapshotTriangulation):SnapshotTriangulation {
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v])),faces:Face[]=mesh.triangles.map(face=>[...face.vertexIds]);
 // Lawson flips terminate: positive incircle violations improve the Delaunay
 // mesh; exact cocircular ties strictly decrease the chosen diagonal ordering.
 let changed=true;
 while(changed){
  changed=false;
  for(const {a,b,faces:incident} of adjacency(faces).values()){
   if(incident.length!==2)continue;
   const [i,j]=incident,c=faces[i].find(id=>id!==a&&id!==b)!,d=faces[j].find(id=>id!==a&&id!==b)!;
   const pa=vertices.get(a)!.angle,pb=vertices.get(b)!.angle,pc=vertices.get(c)!.angle,pd=vertices.get(d)!.angle;
   if(sign(determinant(pc,pd,pa).n)*sign(determinant(pc,pd,pb).n)>=0)continue;
   const circle=insideCircle(pa,pb,pc,pd)*sign(determinant(pa,pb,pc).n);
   if(circle>0||(circle===0&&compareDiagonal(c,d,a,b,vertices)<0)){
    faces[i]=makeFace(c,d,a,vertices);faces[j]=makeFace(d,c,b,vertices);changed=true;break;
   }
  }
 }
 return withFaces(mesh.vertices,faces,mesh);
}
function newVertex(input:SnapshotTriangulationInput):SnapshotTriangulationVertex {
 requireId(input.snapshotId,'Snapshot');requireAngle(input.angle);
 return {id:`snapshot-vertex:${JSON.stringify(input.snapshotId)}`,snapshotId:input.snapshotId,angle:{x:input.angle.x===0?0:input.angle.x,y:input.angle.y===0?0:input.angle.y}};
}
function validateVertices(vertices:readonly SnapshotTriangulationVertex[]):void {
 const ids=new Set<string>(),snapshots=new Set<string>(),coordinates=new Set<string>();
 for(const vertex of vertices){
  requireId(vertex.id,'Vertex');requireId(vertex.snapshotId,'Snapshot');requireAngle(vertex.angle);
  if(ids.has(vertex.id)||snapshots.has(vertex.snapshotId))throw Error('Snapshot triangulation requires distinct vertex and snapshot IDs.');
  const coordinate=JSON.stringify([vertex.angle.x,vertex.angle.y]);
  if(coordinates.has(coordinate))throw Error('Snapshot triangulation rejects duplicate angle coordinates.');
  ids.add(vertex.id);snapshots.add(vertex.snapshotId);coordinates.add(coordinate);
 }
}

/** Build once when starting a topology. Input ordering does not affect diagonals
 * or IDs. Do not call this to insert into a saved mesh: use insertSnapshotVertex. */
export function createSnapshotTriangulation(inputs:readonly SnapshotTriangulationInput[]):SnapshotTriangulation {
 const vertices=inputs.map(newVertex).sort(compareVertex);validateVertices(vertices);
 let mesh:SnapshotTriangulation={version:1,vertices:[],edges:[],triangles:[]};
 for(const vertex of vertices)mesh=addVertex(mesh,vertex);
 mesh=initialDelaunay(mesh);validateSnapshotTriangulation(mesh);return mesh;
}

/** Pure insertion. Existing vertices/edges/faces keep persisted IDs; replaced
 * edges/faces retire their IDs. This intentionally preserves existing diagonals
 * even when a fresh Delaunay triangulation would now prefer different ones. */
export function insertSnapshotVertex(mesh:SnapshotTriangulation,input:SnapshotTriangulationInput):SnapshotTriangulation {
 validateSnapshotTriangulation(mesh);
 const vertex=newVertex(input);validateVertices([...mesh.vertices,vertex]);
 const result=addVertex(mesh,vertex);validateSnapshotTriangulation(result);return result;
}

/** Remove one real vertex and its incident faces. Never bridge the resulting
 * hole. Unaffected faces/edges retain their IDs; surviving isolated vertices and
 * independently supported 1D edges remain valid exact support. Wrappers can
 * compare edge/face IDs before and after to diagnose orphaned response assets. */
export function removeSnapshotVertex(mesh:SnapshotTriangulation,snapshotId:string):SnapshotTriangulation {
 validateSnapshotTriangulation(mesh);requireId(snapshotId,'Snapshot');
 const vertex=mesh.vertices.find(candidate=>candidate.snapshotId===snapshotId);
 if(!vertex)throw Error(`Snapshot triangulation does not contain snapshot ${snapshotId}.`);
 const triangles=mesh.triangles.filter(face=>!face.vertexIds.includes(vertex.id));
 const oldFaceEdges=new Set(mesh.triangles.flatMap(face=>face.edgeIds)),liveFaceEdges=new Set(triangles.flatMap(face=>face.edgeIds));
 const result:SnapshotTriangulation={...mesh,coverage:'explicit',vertices:mesh.vertices.filter(candidate=>candidate.id!==vertex.id),triangles,
  edges:mesh.edges.filter(edge=>!edge.vertexIds.includes(vertex.id)&&(liveFaceEdges.has(edge.id)||!oldFaceEdges.has(edge.id)))};
 validateSnapshotTriangulation(result);return result;
}

/** Move a recorder's existing angle binding without changing any identity or
 * connectivity. This bounded operation rejects folds, degeneracy, crossings,
 * coordinate collisions, and unsplit edges. It does not retessellate a region,
 * recreate the old extreme, or rebind any absolute-angle correction frames. */
export function rebindSnapshotVertex(mesh:SnapshotTriangulation,snapshotId:string,angle:SnapshotTriangulationAngle):SnapshotTriangulation {
 validateSnapshotTriangulation(mesh);requireId(snapshotId,'Snapshot');requireAngle(angle);
 const vertex=mesh.vertices.find(candidate=>candidate.snapshotId===snapshotId);
 if(!vertex)throw Error(`Snapshot triangulation does not contain snapshot ${snapshotId}.`);
 if(vertex.angle.x===angle.x&&vertex.angle.y===angle.y)return mesh;
 const result:SnapshotTriangulation={...mesh,coverage:'explicit',vertices:mesh.vertices.map(candidate=>candidate.id===vertex.id?{...candidate,angle:{...angle}}:candidate)};
 validateSnapshotTriangulation(result);return result;
}

/** Restrict a curve's support without creating topology. Preserve each existing
 * edge whose two endpoints are allowed even when adjacent faces disappear, and
 * retain allowed isolated vertices. This is not a deletion/retriangulation. */
export function restrictSnapshotCoverage(mesh:SnapshotTriangulation,allowedSnapshotIds:ReadonlySet<string>|readonly string[]):SnapshotTriangulation {
 const allowed=new Set(allowedSnapshotIds),vertices=mesh.vertices.filter(vertex=>allowed.has(vertex.snapshotId)),ids=new Set(vertices.map(vertex=>vertex.id));
 return {...mesh,coverage:'explicit',vertices,edges:mesh.edges.filter(edge=>edge.vertexIds.every(id=>ids.has(id))),triangles:mesh.triangles.filter(face=>face.vertexIds.every(id=>ids.has(id)))};
}

/** Validate persisted data at the load/edit boundary. Lookups deliberately avoid
 * repeating this O(edges * vertices + edges²) structural/planarity validation. */
export function validateSnapshotTriangulation(mesh:SnapshotTriangulation):void {
 if(mesh.version!==1)throw Error('Unsupported snapshot triangulation version.');
 if(mesh.coverage!==undefined&&mesh.coverage!=='explicit')throw Error('Unsupported snapshot triangulation coverage policy.');
 validateVertices(mesh.vertices);
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v])),edges=new Map<string,SnapshotTriangulationEdge>(),pairs=new Set<string>(),faceIds=new Set<string>(),faceSets=new Set<string>(),used=new Set<string>();
 for(const edge of mesh.edges){
  requireId(edge.id,'Edge');const [a,b]=edge.vertexIds;
  if(edge.vertexIds.length!==2||!vertices.has(a)||!vertices.has(b)||compareId(a,b)>=0)throw Error('Snapshot edge needs distinct known vertices in canonical orientation.');
  if(edges.has(edge.id)||pairs.has(edgeKey(a,b)))throw Error('Snapshot triangulation contains a duplicate shared edge.');
  edges.set(edge.id,edge);pairs.add(edgeKey(a,b));
 }
 for(const face of mesh.triangles){
  requireId(face.id,'Triangle');const ids=face.vertexIds;
  if(ids.length!==3||new Set(ids).size!==3||ids.some(id=>!vertices.has(id)))throw Error('Snapshot triangle needs three distinct known vertices.');
  if(faceIds.has(face.id)||faceSets.has(faceKey(ids)))throw Error('Snapshot triangulation contains a duplicate triangle.');
  if(determinant(vertices.get(ids[0])!.angle,vertices.get(ids[1])!.angle,vertices.get(ids[2])!.angle).n<=0n)throw Error('Snapshot triangle must be nondegenerate and counterclockwise.');
  if(face.edgeIds.length!==3||faceEdges(ids).some(([a,b],i)=>{const edge=edges.get(face.edgeIds[i]);return !edge||edgeKey(...edge.vertexIds)!==edgeKey(a,b);}))throw Error('Snapshot triangle must reference its shared edges in face order.');
  faceIds.add(face.id);faceSets.add(faceKey(ids));for(const id of ids)used.add(id);
 }
 if(!mesh.triangles.length&&mesh.coverage!=='explicit'){
  const sorted=[...mesh.vertices].sort(compareVertex);
  if(mesh.edges.length!==Math.max(0,sorted.length-1)||sorted.slice(1).some((v,i)=>!pairs.has(edgeKey(sorted[i].id,v.id))))throw Error('Collinear snapshot mesh must contain its consecutive segment chain.');
  if(sorted.length>2&&sorted.slice(2).some(v=>determinant(sorted[0].angle,sorted[1].angle,v.angle).n!==0n))throw Error('Noncollinear snapshots require triangles.');
  return;
 }
 const incidence=adjacency(mesh.triangles.map(face=>face.vertexIds));
 if(mesh.coverage!=='explicit'&&(used.size!==vertices.size||incidence.size!==edges.size||vertices.size-edges.size+mesh.triangles.length!==1))throw Error('Snapshot triangulation must cover one complete convex hull.');
 for(const {a,b,faces} of incidence.values()){
  if(faces.length>2)throw Error('Snapshot edge has more than two adjacent triangles.');
  const pa=vertices.get(a)!.angle,pb=vertices.get(b)!.angle;
  if(mesh.coverage!=='explicit'&&faces.length===1&&mesh.vertices.some(v=>determinant(pa,pb,v.angle).n<0n))throw Error('Snapshot boundary must be the convex hull.');
  if(faces.length===2){
   const opposite=faces.map(i=>vertices.get(mesh.triangles[i].vertexIds.find(id=>id!==a&&id!==b)!)!.angle);
   if(sign(determinant(pa,pb,opposite[0]).n)*sign(determinant(pa,pb,opposite[1]).n)>=0)throw Error('Adjacent snapshot triangles must be on opposite sides of their shared edge.');
  }
 }
 for(const edge of mesh.edges){
  const [a,b]=edge.vertexIds,pa=vertices.get(a)!.angle,pb=vertices.get(b)!.angle;
  if(mesh.vertices.some(v=>v.id!==a&&v.id!==b&&onSegment(v.angle,pa,pb)))throw Error('Snapshot edge must split at every vertex on it.');
 }
 for(const face of mesh.triangles)for(const vertex of mesh.vertices){
  if(!face.vertexIds.includes(vertex.id)&&faceEdges(face.vertexIds).every(([a,b])=>determinant(vertices.get(a)!.angle,vertices.get(b)!.angle,vertex.angle).n>0n))throw Error('Snapshot vertex must not overlap an unrelated triangle interior.');
 }
 for(let i=0;i<mesh.edges.length;i++)for(let j=i+1;j<mesh.edges.length;j++){
  const first=mesh.edges[i].vertexIds,second=mesh.edges[j].vertexIds;if(first.some(id=>second.includes(id)))continue;
  const [a,b,c,d]=[...first,...second].map(id=>vertices.get(id)!.angle);
  if(sign(determinant(a,b,c).n)*sign(determinant(a,b,d).n)<0&&sign(determinant(c,d,a).n)*sign(determinant(c,d,b).n)<0)throw Error('Snapshot edges must not cross.');
 }
}

/** Geometric barycentrics only, with strict support. Returns null outside the
 * exact stored coverage, including deleted holes (also off the line of a
 * collinear mesh). No nearest view,
 * extrapolation, topology compatibility, or nonlinear response is implied.
 * Pass only meshes produced here or validated after restoring persisted JSON. */
export function locateSnapshotSimplex(mesh:SnapshotTriangulation,angle:SnapshotTriangulationAngle):SnapshotSimplexLocation|null {
 requireAngle(angle);
 const vertices=new Map(mesh.vertices.map(v=>[v.id,v]));
 const location=(kind:SnapshotSimplexLocation['kind'],simplexId:string,vertexIds:string[],geometricWeights:number[]):SnapshotSimplexLocation=>({kind,simplexId,vertexIds,snapshotIds:vertexIds.map(id=>vertices.get(id)!.snapshotId),geometricWeights});
 const exact=mesh.vertices.find(v=>v.angle.x===angle.x&&v.angle.y===angle.y);
 if(exact)return location('vertex',exact.id,[exact.id],[1]);
 for(const edge of mesh.edges){
  const [a,b]=edge.vertexIds.map(id=>vertices.get(id)!.angle);
  if(onSegment(angle,a,b)){
   const axis=a.x!==b.x?'x':'y',whole=difference(b[axis],a[axis]);
   // Evaluate both weights separately: 1-t would round a near-endpoint positive
   // barycentric to zero and incorrectly remove that endpoint from presence.
   return location('edge',edge.id,[...edge.vertexIds],[positiveRatio(difference(b[axis],angle[axis]),whole),positiveRatio(difference(angle[axis],a[axis]),whole)]);
  }
 }
 for(const triangle of mesh.triangles){
  const [a,b,c]=triangle.vertexIds.map(id=>vertices.get(id)!.angle),areas=[determinant(b,c,angle),determinant(c,a,angle),determinant(a,b,angle)];
  if(areas.every(area=>area.n>0n)){
   const whole=determinant(a,b,c),weights=areas.map(area=>positiveRatio(area,whole));
   return location('triangle',triangle.id,[...triangle.vertexIds],weights);
  }
 }
 return null;
}

type ProjectionCandidate={n:bigint;d:bigint;e:number;angle:SnapshotTriangulationAngle;simplex:SnapshotSimplexLocation};
function compareDistance(a:ProjectionCandidate,b:ProjectionCandidate):number {
 const exponent=Math.min(a.e,b.e),left=(a.n*b.d)<<BigInt(a.e-exponent),right=(b.n*a.d)<<BigInt(b.e-exponent);
 return sign(left-right)||compareId(a.simplex.simplexId,b.simplex.simplexId);
}
function rationalCoordinate(n:bigint,d:bigint,e:number,first:number,last:number):number {
 if(n===0n)return 0;
 const negative=n<0n,absolute=negative?-n:n,ns=Math.max(0,absolute.toString(2).length-53),ds=Math.max(0,d.toString(2).length-53);
 const exponent=e+ns-ds,bounded=Math.max(-1074,Math.min(1023,exponent));
 const value=(negative?-1:1)*(Number(absolute>>BigInt(ns))/Number(d>>BigInt(ds)))*2**bounded*2**(exponent-bounded);
 return Math.max(Math.min(first,last),Math.min(Math.max(first,last),value));
}

/** Closest-point preview on the union of actual stored triangles, edges, and
 * isolated vertices. Inside coverage the requested coordinate is unchanged.
 * Outside/hole preview projects onto an edge interior when that is nearest;
 * it never substitutes a nearest snapshot or adds any coverage. Empty returns
 * null. Squared-distance comparisons and ties use exact represented inputs. */
export function projectToSnapshotCoverage(mesh:SnapshotTriangulation,requestedAngle:SnapshotTriangulationAngle):SnapshotCoverageProjection|null {
 const inside=locateSnapshotSimplex(mesh,requestedAngle);
 if(inside)return {requestedAngle:{...requestedAngle},evaluatedAngle:{...requestedAngle},outside:false,simplex:inside};
 const vertices=new Map(mesh.vertices.map(vertex=>[vertex.id,vertex]));
 let closest:ProjectionCandidate|undefined;
 const consider=(candidate:ProjectionCandidate)=>{if(!closest||compareDistance(candidate,closest)<0)closest=candidate;};
 for(const vertex of mesh.vertices){
  const {values:[px,py,x,y],e}=commonIntegers([requestedAngle.x,requestedAngle.y,vertex.angle.x,vertex.angle.y]);
  consider({n:(px-x)**2n+(py-y)**2n,d:1n,e:2*e,angle:{...vertex.angle},simplex:{kind:'vertex',simplexId:vertex.id,vertexIds:[vertex.id],snapshotIds:[vertex.snapshotId],geometricWeights:[1]}});
 }
 for(const edge of mesh.edges){
  const [a,b]=edge.vertexIds.map(id=>vertices.get(id)!);
  const {values:[px,py,ax,ay,bx,by],e}=commonIntegers([requestedAngle.x,requestedAngle.y,a.angle.x,a.angle.y,b.angle.x,b.angle.y]);
  const dx=bx-ax,dy=by-ay,wx=px-ax,wy=py-ay,denominator=dx*dx+dy*dy,dot=wx*dx+wy*dy;
  if(dot<=0n||dot>=denominator)continue; // Endpoints already considered.
  consider({n:(wx*wx+wy*wy)*denominator-dot*dot,d:denominator,e:2*e,
   angle:{x:rationalCoordinate(ax*denominator+dx*dot,denominator,e,a.angle.x,b.angle.x),y:rationalCoordinate(ay*denominator+dy*dot,denominator,e,a.angle.y,b.angle.y)},
   simplex:{kind:'edge',simplexId:edge.id,vertexIds:[...edge.vertexIds],snapshotIds:[a.snapshotId,b.snapshotId],geometricWeights:[positiveRatio({n:denominator-dot,e:0},{n:denominator,e:0}),positiveRatio({n:dot,e:0},{n:denominator,e:0})]}});
 }
 return closest?{requestedAngle:{...requestedAngle},evaluatedAngle:closest.angle,outside:true,simplex:closest.simplex}:null;
}
