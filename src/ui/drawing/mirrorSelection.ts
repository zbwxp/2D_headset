import type {DrawingDocument} from '../../domain/drawing/model';
import {addMirrorCurvePair,proposeExactMirrorPairs} from '../../domain/drawing/mirrorCommands';

/** Explicit pairing only. Copying and one-shot placement never call this. */
export function pairSelectedMirrorCurves(d:DrawingDocument,ids:readonly string[],reverse=false):DrawingDocument{
 const selected=[...new Set(ids)];if(selected.length<2)throw Error('请选中源曲线和对应曲线。');
 let pairs:Array<{a:string;b:string;reverse:boolean}>;
 if(selected.length===2)pairs=[{a:selected[0],b:selected[1],reverse}];
 else{
  const proposal=proposeExactMirrorPairs({...d,mirrorEditing:{enabled:false,curvePairs:[]}},selected);
  if(proposal.unmatched.length||proposal.ambiguous.length)throw Error(`所选笔画无法唯一配对：${proposal.unmatched.length} 条未匹配，${proposal.ambiguous.length} 条有多个对应。请先按镜像轴摆放，或只选两条对应曲线。`);
  pairs=proposal.pairs;
 }
 const members=new Set(pairs.flatMap(pair=>[pair.a,pair.b]));
 let next={...d,mirrorEditing:{...(d.mirrorEditing??{enabled:false,curvePairs:[]}),curvePairs:(d.mirrorEditing?.curvePairs??[]).filter(pair=>!members.has(pair.a)&&!members.has(pair.b))}};
 for(const pair of pairs)next=addMirrorCurvePair(next,pair.a,pair.b,pair.reverse) as typeof next;
 return next;
}
