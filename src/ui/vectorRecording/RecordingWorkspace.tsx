import SnapshotRecordingWorkspace from './SnapshotRecordingWorkspace';
import LegacyRecordingReview from './LegacyRecordingReview';
import {useEditor} from '../../app/store';
import {recordingRetirementStatus} from '../../domain/recordingSnapshot/retirement';

/** One authoring workspace; old recordings have an explicit read-only gate. */
export default function RecordingWorkspace(_props:{aiGuides?:boolean}={}){
 const project=useEditor(s=>s.project);
 if(recordingRetirementStatus(project))return <LegacyRecordingReview/>;
 return <SnapshotRecordingWorkspace/>;
}
