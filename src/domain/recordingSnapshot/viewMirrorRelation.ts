import type {RecordingSnapshotWorkspace,SnapshotRecording,SnapshotViewMirrorRelation} from './model';

/** Recorder expression dependencies are not Snapshot inheritance parents. */
export function recordingViewMirrorRelation(workspace:RecordingSnapshotWorkspace,recording:SnapshotRecording):SnapshotViewMirrorRelation|undefined {
 const graph=recording.angleGraph;if(!graph)return;
 if(graph.viewMirror)return graph.viewMirror;
 const zero=graph.mesh.vertices.find(vertex=>vertex.angle.x===0&&vertex.angle.y===0),source=graph.mesh.vertices.find(vertex=>vertex.angle.x===-90&&vertex.angle.y===0),target=graph.mesh.vertices.find(vertex=>vertex.angle.x===90&&vertex.angle.y===0);
 if(!zero||!source||!target)return;
 const child=workspace.snapshots.find(snapshot=>snapshot.id===target.snapshotId);
 if(child?.parentSnapshotId!==source.snapshotId||!child.inputMirror)return;
 // Compatibility is derived in memory; reading an older document never saves
 // new geometry, a mirror relation, or a second zero mesh vertex.
 return {zeroSnapshotId:zero.snapshotId,sourceSnapshotId:source.snapshotId,targetSnapshotId:target.snapshotId};
}

export function validateSnapshotViewMirrorRelation(value:unknown,recording:Pick<SnapshotRecording,'angleGraph'>):asserts value is SnapshotViewMirrorRelation {
 const relation=value as SnapshotViewMirrorRelation,fail=(message:string):never=>{throw Error(`Invalid View mirror: ${message}`);};
 if(!relation||typeof relation!=='object'||Array.isArray(relation)||Object.keys(relation).some(key=>!['zeroSnapshotId','sourceSnapshotId','targetSnapshotId','unpairedReference'].includes(key)))fail('relation fields');
 const ids=[relation.zeroSnapshotId,relation.sourceSnapshotId,relation.targetSnapshotId];
 if(ids.some(id=>typeof id!=='string'||!id||id.length>16384)||new Set(ids).size!==3)fail('three distinct basis snapshot IDs are required');
 if(relation.unpairedReference!==undefined&&relation.unpairedReference!=='zero-stroke-frame')fail('unsupported local zero reference');
 const bindings=recording.angleGraph?.mesh.vertices??[];
 for(const [snapshotId,x] of [[relation.zeroSnapshotId,0],[relation.sourceSnapshotId,-90],[relation.targetSnapshotId,90]] as const){const vertex=bindings.find(vertex=>vertex.snapshotId===snapshotId);if(!vertex||vertex.angle.x!==x||vertex.angle.y!==0)fail(`missing ${x}°, 0° basis ${snapshotId}`);}
}
