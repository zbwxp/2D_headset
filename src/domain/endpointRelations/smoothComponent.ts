import type {Endpoint} from '../drawing/model';

export interface SmoothRelation {id:string;a:Endpoint;b:Endpoint}
export interface SmoothMember {endpoint:Endpoint;sign:number}
export interface SmoothComponent {relationId:string;members:SmoothMember[];conflict:boolean}

export const smoothEndpointKey=(endpoint:Endpoint):string=>JSON.stringify([endpoint.curveId,endpoint.end]);

/** Neutral relation graph shared by authoring and evaluation. Relation ID order
 * chooses the stable first member; breadth-first order retains alternating
 * signs and diagnoses odd cycles. Only explicit SMOOTH relations belong here:
 * shared node IDs, POSITION links and ARC brushes do not imply collinearity.
 * Driver choice, minimum lengths, locks, projection arithmetic and when to
 * project remain explicit policies of the caller. */
export function deriveSmoothComponents(relations:readonly SmoothRelation[]):SmoothComponent[] {
 const ordered=[...relations].sort((a,b)=>a.id.localeCompare(b.id)),graph=new Map<string,Endpoint[]>(),done=new Set<string>(),components:SmoothComponent[]=[];
 for(const relation of ordered)for(const [a,b] of [[relation.a,relation.b],[relation.b,relation.a]])graph.set(smoothEndpointKey(a),[...(graph.get(smoothEndpointKey(a))??[]),b]);
 for(const relation of ordered){if(done.has(smoothEndpointKey(relation.a)))continue;const queue:SmoothMember[]=[{endpoint:relation.a,sign:1}],members=new Map([[smoothEndpointKey(relation.a),queue[0]]]);let conflict=false;
  for(const member of queue){done.add(smoothEndpointKey(member.endpoint));for(const other of graph.get(smoothEndpointKey(member.endpoint))??[]){const known=members.get(smoothEndpointKey(other));if(known){if(known.sign!==-member.sign)conflict=true;}else{const next={endpoint:other,sign:-member.sign};members.set(smoothEndpointKey(other),next);queue.push(next);}}}
  components.push({relationId:relation.id,members:queue,conflict});
 }
 return components;
}
