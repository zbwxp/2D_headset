import {test,expect} from 'vitest';
import hair from './fixtures/drawing-cusp-hair.json';
import {parseDrawing,type Point2} from '../domain/drawing/model';
import {strokes} from '../domain/drawing/strokes';
import {strokeInk} from '../domain/drawing/appearance';
import {addDisplayInterval,changeDisplayInterval,setDisplayIntervalEnd} from '../domain/drawing/displayIntervals';
import {transform} from '../domain/drawing/commands';

/** Nonzero winding coverage, matching the SVG ink fill. */
function contains(polygon:Point2[],p:Point2){
 let winding=0;
 for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],cross=(b[0]-a[0])*(p[1]-a[1])-(p[0]-a[0])*(b[1]-a[1]);if(a[1]<=p[1]&&b[1]>p[1]&&cross>0)winding++;if(a[1]>p[1]&&b[1]<=p[1]&&cross<0)winding--;}
 return winding!==0;
}
test.each(['normal','mirror','reverse','wrap'] as const)('hair cusp roots meet both sides of the variable-width body without holes: %s',mode=>{
 let d=parseDrawing(hair);
 if(mode==='mirror')d=transform(d,d.curves.map(c=>c.id),([x,y])=>[-x,y]);
 for(const s of strokes(d,d.layers[0].id)){
  d=addDisplayInterval(d,s.id);const t=d.displayIntervals!.at(-1)!,r=t.ranges[0];d=changeDisplayInterval(d,t.id,r.id,mode==='wrap'&&s.closed?{start:.95,end:.9}:{start:.001,end:.999});d=setDisplayIntervalEnd(d,t.id,r.id,0,{taper:.002});d=setDisplayIntervalEnd(d,t.id,r.id,1,{taper:.002});
 }
 const before=JSON.stringify(d),runs=strokes(d,d.layers[0].id).flatMap(s=>strokeInk(d,mode==='reverse'?{...s,segments:[...s.segments].reverse().map(e=>({...e,reverse:!e.reverse}))}:s));let tested=0;
 for(const run of runs){if(run.uniform)continue;for(const tip of run.tips){
  const p=tip[0],apex=tip[2];
  // Sample through both root cross sections, just behind the shared point.
  const v=[apex[0]-p[0],apex[1]-p[1]],len=Math.hypot(...v);
  for(const base of [tip[1],tip[3]])for(const f of [.25,.5,.75]){
   const q:Point2=[p[0]+f*(base[0]-p[0])-.0001*v[0]/len,p[1]+f*(base[1]-p[1])-.0001*v[1]/len];
   expect(contains(run.outline,q),`root gap at ${q}`).toBe(true);tested++;
  }
 }}
 expect(tested).toBeGreaterThan(0);expect(JSON.stringify(d)).toBe(before);
});
