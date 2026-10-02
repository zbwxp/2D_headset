import {expect,test,vi} from 'vitest';
import {withRecordingReferenceFallback} from '../ui/vectorRecording/recordingReferenceStorage';

test('missing v2 reference reads v33 fallback, but v2 records and removals remain authoritative',async()=>{
 const currentSave=vi.fn(async()=>{}),fallbackSave=vi.fn(async()=>{}),old={reference:undefined},fallbackLoad=vi.fn(async()=>old);
 const fallback={load:fallbackLoad,save:fallbackSave};
 expect(await withRecordingReferenceFallback({load:async()=>null,save:currentSave},fallback).load()).toBe(old);
 fallbackLoad.mockClear();const tombstone={reference:undefined};
 const storage=withRecordingReferenceFallback({load:async()=>tombstone,save:currentSave},fallback);
 expect(await storage.load()).toBe(tombstone);expect(fallbackLoad).not.toHaveBeenCalled();
 await storage.save(undefined);expect(currentSave).toHaveBeenCalledExactlyOnceWith(undefined);expect(fallbackSave).not.toHaveBeenCalled();
});
