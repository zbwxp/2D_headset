import {displayField,unionInkSpans,type InkSpan} from '../drawing/displayIntervals';
import {strokeEnds} from '../drawing/appearance';
import type {StrokePath} from '../drawing/strokes';
import type {DrawingDocument as Doc,StrokeDisplayIntervals as Track,DisplayInterval as Range,InkEnds} from '../drawing/model';

/** Canonicalize mixed SHOW/HIDE authoring into the same visible state, in the
 * common anchor frame. A full SHOW supplies outer tips; HIDE ranges describe
 * the actual gaps. These derived IDs never replace authored ranges in a save. */
export function poseCoverageRanges(d:Doc,path:StrokePath,track:Track,sample:number):Range[]{
 const f=displayField({...d,displayIntervals:track.ranges.length?[track]:[]},path);
 const forward=path.segments.find(s=>s.id===track.anchor.id)!.reverse===track.anchor.reverse;
 const pieces:InkSpan[]=[];
 for(const s of f.inkSpans??[{start:0,end:1,ends:[{},{}] as InkEnds}]){
  const size=s.end-s.start,ends:InkEnds=forward?s.ends:[s.ends[1],s.ends[0]];
  if(path.closed&&size>=1-1e-10){pieces.push({start:0,end:1,ends:[{},{}]});continue;}
  const start=f.relative(track,forward?s.start:s.end),end=path.closed?start+size:f.relative(track,forward?s.end:s.start);
  if(end<=1)pieces.push({start,end,ends});
  else pieces.push({start,end:1,ends:[ends[0],{}]},{start:0,end:end-1,ends:[{},ends[1]]});
 }
 const visible=unionInkSpans(pieces),gaps:InkSpan[]=[];
 let cursor=0,previous={};
 for(const s of visible){
  if(s.start>cursor+1e-10)gaps.push({start:cursor,end:s.start,ends:[previous,s.ends[0]]});
  cursor=s.end;previous=s.ends[1];
 }
 if(cursor<1-1e-10)gaps.push({start:cursor,end:1,ends:[previous,{}]});
 // 0/100% is an arbitrary seam, not two independent disappearing gaps.
 if(path.closed&&gaps.length>1&&gaps[0].start<1e-10&&gaps.at(-1)!.end>1-1e-10){
  const first=gaps.shift()!,last=gaps.pop()!;
  gaps.push({start:last.start,end:first.end,ends:[last.ends[0],first.ends[1]]});
 }
 const outer=strokeEnds(d,path).map(e=>e.style),ends:InkEnds=path.closed?[{},{}]:forward?[outer[0],outer[1]]:[outer[1],outer[0]];
 if(!path.closed){
  if(visible[0]?.start<1e-10)ends[0]={...ends[0],...visible[0].ends[0]};
  const last=visible.at(-1);if(last&&last.end>1-1e-10)ends[1]={...ends[1],...last.ends[1]};
 }
 return [{id:`${track.id}:coverage:full`,mode:'SHOW',start:0,end:1,inkEnds:ends},
  ...gaps.map((g,i):Range=>({id:`${track.id}:coverage:${sample}:${i}`,mode:'HIDE',start:g.start,end:g.end,inkEnds:g.ends}))];
}
