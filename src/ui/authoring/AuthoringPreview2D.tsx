import {assignModules} from '../../domain/modules/ownership';
import {displayPoint} from '../../rendering/moduleDisplay';
import {evaluationContext} from '../../domain/geometry/evaluation';
import {useMemo} from 'react';
import {useEditor} from '../../app/store';
import {regionCandidates} from '../../domain/head/regions';
import {pointPosition} from '../../domain/geometry/evaluation';
import {materializeToolDraft} from './draft';
import {worldToSvg,type OrthographicViewState} from '../../rendering/orthographic';
export default function AuthoringPreview2D({view}:{view:OrthographicViewState}){
 const s=useEditor(),t=s.tool;
 const regions=useMemo(()=>{try{return t.kind==='region'&&t.preview?regionCandidates(s.project,t.ids):[];}catch{return [];}},[s.project,t.kind,t.kind==='region'?t.ids:null,t.kind==='region'&&t.preview]);
 const triangles=regions.flatMap((c,i)=>c.mesh.triangles.map(f=>{const q=f.map(j=>worldToSvg(displayPoint(s.project,"head",c.mesh.vertices[j],view.forward),view));return {i,q,depth:q.reduce((a,b)=>a+b[2],0)};})).sort((a,b)=>a.depth-b.depth);
 let points:ReturnType<typeof worldToSvg>[]=[];if(t.draft)try{const p=assignModules(materializeToolDraft(s.project,t.draft),s.project,s.activeModule);points=t.draft.points.map(l=>worldToSvg(displayPoint(p,l.id,pointPosition(p,l.id),view.forward),view));}catch{}
 let paths:string[]=[];if(t.draft)try{const p=assignModules(materializeToolDraft(s.project,t.draft),s.project,s.activeModule);paths=t.draft.curves.map(c=>'M'+evaluationContext(p).curve(c.id).sample(96).map(q=>worldToSvg(displayPoint(p,c.id,q,view.forward),view).slice(0,2).join(',')).join('L'));}catch{}
 return <g pointerEvents="none" data-testid="authoring-preview-2d">{paths.map((d,i)=><path key={`curve-${i}`} data-testid="on-patch-preview" d={d} fill="none" stroke="#ffc879" strokeWidth={3} vectorEffect="non-scaling-stroke"/>)}{triangles.map((x,i)=><polygon key={i} points={x.q.map(q=>q.slice(0,2).join(',')).join(' ')} fill={`hsl(${x.i*137.5%360} 40% 64%)`} stroke="none"/>)}{points.map((q,i)=><circle key={i} cx={q[0]} cy={q[1]} r={7/view.zoom} fill="#ffc879" stroke="#ffffff" strokeWidth={2/view.zoom}/>)}</g>;
}
