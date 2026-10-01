import {test,expect} from 'vitest';
import fixture from '../fixtures/jaw-60-90-intervals.json';
import allAngles from '../fixtures/jaw-all-angle-intervals.json';
import {parseDrawing} from '../../domain/drawing/model';
import {createAssembly,assemblyDrawing,parseAssembly} from '../../domain/assembly/model';
import {ensureTimeline,intervalEvaluation,savePose,writeIntervalChanges} from '../../domain/assembly/timeline';
import {displayField,displayPath,changeDisplayInterval} from '../../domain/drawing/displayIntervals';

test('saved jaw at 60/90 degrees keeps the same two authored interval identities through 69 degrees',()=>{
 const drawing=parseDrawing(fixture.drawing),initial=ensureTimeline(createAssembly(drawing));
 const a=parseAssembly({...initial,timeline:{...initial.timeline!,loop:true,intervals:[fixture.track]}}),layer=drawing.layers[0].id,before=JSON.stringify(a);
 const key60=fixture.track.keys.find(k=>k.yaw===-60)!.tracks[0],key90=fixture.track.keys.find(k=>k.yaw===-90)!.tracks[0];
 for(const yaw of [-60,-60.001,-61,-65,-69,-69.61941133115225,-74.999,-75,-75.001,-85,-89.999,-90]){
  const current={...a,pose:{...a.pose,yaw}},tracks=intervalEvaluation(current,layer).tracks;
  expect(tracks).toHaveLength(1);expect(tracks[0].ranges,`${yaw} degrees`).toHaveLength(2);
  expect(tracks[0].ranges.map(r=>r.id)).toEqual(key60.ranges.map(r=>r.id));
  const t=(-yaw-60)/30,w=t*t*(3-2*t);
  for(const [i,r] of tracks[0].ranges.entries()){
   expect(r.start).toBeCloseTo(key60.ranges[i].start*(1-w)+key90.ranges[i].start*w,5);
   expect(r.end).toBeCloseTo(key60.ranges[i].end*(1-w)+key90.ranges[i].end*w,5);
  }
  const doc=assemblyDrawing(current),field=displayField(doc,displayPath(doc,key60.anchor.id));
  expect(field.mask).toHaveLength(3); // One visible run is split across the arbitrary 0/100% seam.
 }
 expect(JSON.stringify(a)).toEqual(before);
 const at69={...a,pose:{...a.pose,yaw:-69}},d=assemblyDrawing(at69),range=d.displayIntervals![0].ranges[1];
 const edited=changeDisplayInterval(d,key60.id,range.id,{start:range.start+.001}),saved=savePose(writeIntervalChanges(at69,edited));
 expect(saved.timeline!.intervals[0].keys.find(k=>k.yaw===-69)!.tracks[0].ranges).toHaveLength(2);
 expect(parseAssembly(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
});

test('legacy jaw IDs at 30/45 match the same two moving ranges; sweep every recorded neighbor pair',()=>{
 const initial=ensureTimeline(createAssembly(parseDrawing(fixture.drawing)));
 const a=parseAssembly({...initial,timeline:{...initial.timeline!,loop:true,intervals:[allAngles]}}),layer=allAngles.layerId,before=JSON.stringify(a);
 const keys=a.timeline!.intervals[0].keys.slice().sort((a,b)=>b.yaw-a.yaw);
 for(let i=1;i<keys.length;i++){
  const from=keys[i-1],to=keys[i],r0=from.tracks[0].ranges,r1=to.tracks[0].ranges;
  for(let step=0;step<=100;step++){
   const yaw=from.yaw+(to.yaw-from.yaw)*step/100,current={...a,pose:{...a.pose,yaw}},ranges=intervalEvaluation(current,layer).tracks[0].ranges;
   expect(ranges.length,`${yaw} between ${from.yaw} and ${to.yaw}`).toBeLessThanOrEqual(Math.max(r0.length,r1.length));
   if(from.yaw===-30){
    expect(ranges).toHaveLength(2);const t=step/100,w=t*t*(3-2*t);
    for(const [j,r] of ranges.entries()){
     expect(r.start).toBeCloseTo(r0[j].start*(1-w)+r1[j].start*w,5);
     expect(r.end).toBeCloseTo(r0[j].end*(1-w)+r1[j].end*w,5);
    }
   }
  }
 }
 const current={...a,pose:{...a.pose,yaw:-37.20741589209845}};
 expect(intervalEvaluation(current,layer).tracks[0].ranges).toHaveLength(2);
 expect(JSON.stringify(a)).toBe(before);
 const d=assemblyDrawing(current),track=d.displayIntervals![0],gap=track.ranges[1];
 const saved=parseAssembly(savePose(writeIntervalChanges(current,changeDisplayInterval(d,track.id,gap.id,{start:gap.start+.001}))));
 for(const yaw of [-30,-33,-37,-37.207,-38,-42,-45])expect(intervalEvaluation({...saved,pose:{...saved.pose,yaw}},layer).tracks[0].ranges).toHaveLength(2);
 expect(saved.timeline!.intervals[0].keys.filter(k=>[-30,-45].includes(k.yaw))).toEqual(a.timeline!.intervals[0].keys.filter(k=>[-30,-45].includes(k.yaw)));
});
