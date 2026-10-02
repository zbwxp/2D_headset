import type {LandmarkProject} from '../domain/landmarks/model';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {createArtworkCleanupBackup,readArtworkCleanupBackup} from './artworkCleanupBackups';

export interface ArtworkCleanupActionHost {
 getProject:()=>LandmarkProject;
 commit:(expected:LandmarkProject,next:LandmarkProject)=>void;
 restore:(project:LandmarkProject)=>void;
}
export interface ArtworkCleanupBackupActions {
 create:typeof createArtworkCleanupBackup;
 read:typeof readArtworkCleanupBackup;
}
const storage:ArtworkCleanupBackupActions={create:createArtworkCleanupBackup,read:readArtworkCleanupBackup};
function unchanged(host:ArtworkCleanupActionHost,expected:LandmarkProject){if(host.getProject()!==expected)throw Error('工程已变化，请重新检查整理清单。');}
/** Backup must commit and verify before mutation; a newer edit invalidates the plan. */
export async function applyArtworkCleanupPlan(host:ArtworkCleanupActionHost,expected:LandmarkProject,next:LandmarkProject,backups=storage){
 unchanged(host,expected);if(next===expected)return;
 await backups.create(expected,'cleanup');unchanged(host,expected);host.commit(expected,next);
}
/** Restores a whole, explicitly selected backup. Current work is preserved first. */
export async function restoreArtworkCleanupProject(host:ArtworkCleanupActionHost,id:string,backups=storage){
 const expected=host.getProject(),entry=await backups.read(id);if(!entry)throw Error('恢复备份不存在。');
 const restored=parseLandmarks(entry.serialized);unchanged(host,expected);
 await backups.create(expected,'before-restore');unchanged(host,expected);host.restore(restored);
}
