import {describe,expect,it} from 'vitest';
import {split as splitBezier} from '../../domain/geometry/bezier';
import {createSnapshotTriangulation,locateSnapshotSimplex} from '../../domain/recordingSnapshot/triangulation';
import {evaluateTriangularResponseWeights,type BarycentricWeights,type OrientedEdgeResponse} from '../../domain/recordingSnapshot/triangularResponses';
import {
 captureSnapshotResponseField,combineSnapshotResponseExpressions,createSnapshotExpressionValueSampler,createSnapshotResponseResidual,
 emptySnapshotResponseExpression,prepareSnapshotResponseExpression,restrictSnapshotResponseExpression,snapshotResponseBasisKey,
 snapshotResponseExpressionLimits,splitSnapshotCubicResponseExpressions,substituteSnapshotResponseBases,validateSnapshotResponseExpression,
 SnapshotResponseExpressionError,type SnapshotResponseBasisReference,type SnapshotResponseExpression,type SnapshotResponseExpressionField,
 type SnapshotResponseLinearBasis,type SnapshotCubicResponseExpressions,
} from '../../domain/recordingSnapshot/responseExpressions';

type ScalarCubic=readonly [number,number,number,number];
const vertices=['vA','vB','vC'],snapshots=['A','B','C'];
const node=(nodeId:string)=>({kind:'node' as const,nodeId});
const handle=(curveId:string,end:0|1)=>({kind:'handle' as const,curveId,end});
const basis=(snapshotId:string,control:number,axis:0|1=0,curveId='parent'):SnapshotResponseBasisReference=>({snapshotId,axis,target:control===0?node('start'):control===3?node('end'):handle(curveId,control===1?0:1)});
const recipes=(control:number,count=3,axis:0|1=0):SnapshotResponseLinearBasis[]=>snapshots.slice(0,count).map(snapshotId=>[{coefficient:1,basis:basis(snapshotId,control,axis)}]);
const edgeField=(id='edge'):SnapshotResponseExpressionField=>({id,vertexIds:vertices.slice(0,2),edges:[{from:0,to:1,knots:[[.25,-.2],[.6,1.4],[.8,.3]]}],samples:[]});
const triangleField=(control:number):SnapshotResponseExpressionField=>({id:`f${control}`,vertexIds:vertices,edges:[
 {from:0,to:1,knots:[[.3,.1+control*.2],[.8,1.1-control*.1]]},
 {from:2,to:1,knots:[[.4,.6+control*.1]]},
],samples:control%2===0?[
 {id:`a${control}`,at:[.2,.3,.5],weights:[.1+control*.2,.8-control*.3,.1+control*.1]},
]:[
 {id:`b${control}`,at:[.5,.3,.2],weights:[.7,-.2,.5]},
 {id:`c${control}`,at:[.2,.6,.2],weights:[-.1,.7,.4]},
]});
const dot=(values:readonly number[],weights:readonly number[])=>values.reduce((sum,value,index)=>sum+value*weights[index],0);
const close=(actual:readonly number[],expected:readonly number[],digits=11)=>actual.forEach((value,index)=>expect(value).toBeCloseTo(expected[index],digits));
const absolute=(q:ScalarCubic)=>[q[0],q[0]+q[1],q[3]+q[2],q[3]] as const;
function split(q:ScalarCubic,t:number):[ScalarCubic,ScalarCubic]{
 return splitBezier(absolute(q).map(value=>[value,0,0]),t).map(cp=>[cp[0][0],cp[1][0]-cp[0][0],cp[2][0]-cp[3][0],cp[3][0]]) as unknown as [ScalarCubic,ScalarCubic];
}
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
function errorCode(run:()=>unknown){try{run();throw Error('Expected failure');}catch(error){expect(error).toBeInstanceOf(SnapshotResponseExpressionError);return (error as SnapshotResponseExpressionError).code;}}
function controlStore(values:readonly ScalarCubic[],curveId='parent',axis:0|1=0){
 const store=new Map<string,number>();
 values.forEach((q,index)=>q.forEach((value,control)=>store.set(snapshotResponseBasisKey(basis(snapshots[index],control,axis,curveId)),value)));
 return store;
}
function splitStore(store:Map<string,number>,values:readonly ScalarCubic[],curveId:string,t:number,childCurveIds:readonly [string,string],axis:0|1=0){
 const children=values.map(q=>split(q,t));
 children.forEach(([left,right],index)=>{
  for(const end of [0,1] as const){store.delete(snapshotResponseBasisKey({snapshotId:snapshots[index],axis,target:handle(curveId,end)}));
   store.set(snapshotResponseBasisKey({snapshotId:snapshots[index],axis,target:handle(childCurveIds[0],end)}),left[end+1]);
   store.set(snapshotResponseBasisKey({snapshotId:snapshots[index],axis,target:handle(childCurveIds[1],end)}),right[end+1]);
  }
 });
 return children;
}
const fixture:readonly ScalarCubic[]=[[0,4,-5,10],[12,-3,7,2],[-8,9,2,15]];
const expressionFixture=(axis:0|1=0)=>[0,1,2,3].map(control=>createSnapshotResponseResidual(triangleField(control),recipes(control,3,axis))) as unknown as SnapshotCubicResponseExpressions;
function evaluateControls(expressions:SnapshotCubicResponseExpressions,values:readonly ScalarCubic[],store:Map<string,number>,at:readonly number[]):ScalarCubic {
 return expressions.map((expression,control)=>dot(values.map(q=>q[control]),at)+prepareSnapshotResponseExpression(expression)({basisScalar:ref=>store.get(snapshotResponseBasisKey(ref)),geometricWeights:()=>at})) as unknown as ScalarCubic;
}
const grid=()=>{const result:BarycentricWeights[]=[];for(let a=0;a<=6;a++)for(let b=0;b<=6-a;b++)result.push([a/6,b/6,(6-a-b)/6]);return [...result,[.2,.3,.5],[.5,.3,.2],[.2,.6,.2]] as BarycentricWeights[];};

describe('exact Recorder response expression transfer',()=>{
 it.each([.13,.5,.87])('equals splitting the final independently corrected parent at t=%s across an angle grid',t=>{
  for(const axis of [0,1] as const){
   const expressions=expressionFixture(axis),before=JSON.stringify(expressions),store=controlStore(fixture,'parent',axis);
   const children=splitStore(store,fixture,'parent',t,['left','right'],axis);
   const transferred=splitSnapshotCubicResponseExpressions(freeze(expressions),{curveId:'parent',t,childCurveIds:['left','right'],nonlinearDependencies:[]});
   for(const at of grid()){
    const parent=fixture[0].map((_,control)=>dot(fixture.map(q=>q[control]),evaluateTriangularResponseWeights(at,triangleField(control).edges,triangleField(control).samples))) as unknown as ScalarCubic;
    const expected=split(parent,t);
    close(evaluateControls(transferred.left,children.map(value=>value[0]),store,at),expected[0]);
    close(evaluateControls(transferred.right,children.map(value=>value[1]),store,at),expected[1]);
   }
   expect(JSON.stringify(expressions)).toBe(before);
   expect(transferred.left[3]).toBe(transferred.right[0]);
   for(const expression of [...transferred.left,...transferred.right]){
    validateSnapshotResponseExpression(expression);
    for(const term of expression.terms)for(const {basis} of term.basis)expect(basis.target.kind!=='handle'||basis.target.curveId!=='parent').toBe(true);
   }
  }
 });

 it('retains a moving seam when both child basis endpoints have the exact same seam position',()=>{
  const values:readonly ScalarCubic[]=[[0,0,0,8],[8,0,0,0]],field:SnapshotResponseExpressionField={...edgeField(),edges:[{from:0,to:1,knots:[[.5,0]]}]};
  const original=[createSnapshotResponseResidual(field,recipes(0,2)),emptySnapshotResponseExpression(),emptySnapshotResponseExpression(),emptySnapshotResponseExpression()] as const;
  const store=controlStore(values),children=splitStore(store,values,'parent',.5,['left','right']);
  const result=splitSnapshotCubicResponseExpressions(original,{curveId:'parent',t:.5,childCurveIds:['left','right'],nonlinearDependencies:[]});
  expect(children.map(value=>value[0][3])).toEqual([4,4]);
  const sample=createSnapshotExpressionValueSampler({vertexIds:vertices.slice(0,2)},{expression:()=>result.left[3],basisScalar:ref=>store.get(snapshotResponseBasisKey(ref))});
  expect(sample(node('seam'),0,[4,4],[.5,.5])).toBe(2);
  expect(sample(node('seam'),0,[4,4],[1,0])).toBe(4);
  expect(sample(node('seam'),0,[4,4],[0,1])).toBe(4);
 });

 it('flattens repeated splits and keeps every independent IDW support instead of unioning samples',()=>{
  const original=expressionFixture(),store=controlStore(fixture),firstBases=splitStore(store,fixture,'parent',.37,['left','right']);
  const first=splitSnapshotCubicResponseExpressions(original,{curveId:'parent',t:.37,childCurveIds:['left','right'],nonlinearDependencies:[]});
  const nextBases=splitStore(store,firstBases.map(value=>value[0]),'left',.41,['leftLeft','leftRight']);
  const next=splitSnapshotCubicResponseExpressions(first.left,{curveId:'left',t:.41,childCurveIds:['leftLeft','leftRight'],nonlinearDependencies:[]});
  for(const at of grid()){
   const parent=evaluateControls(original,fixture,controlStore(fixture),at),expected=split(split(parent,.37)[0],.41);
   close(evaluateControls(next.left,nextBases.map(value=>value[0]),store,at),expected[0]);
   close(evaluateControls(next.right,nextBases.map(value=>value[1]),store,at),expected[1]);
  }
  for(const expression of [...next.left,...next.right]){
   expect(expression.fields.length).toBeLessThanOrEqual(4);expect(expression.terms.length).toBeLessThanOrEqual(12);
   for(const field of expression.fields)expect(field.samples).toEqual(triangleField(Number(field.id.slice(1))).samples);
   for(const term of expression.terms)for(const {basis} of term.basis)expect(basis.target.kind!=='handle'||!['parent','left'].includes(basis.target.curveId)).toBe(true);
  }
 });

 it('follows changed live endpoint snapshot sources without recreating the expression or storing geometry',()=>{
  const expressions=expressionFixture(),store=controlStore(fixture),transferred=splitSnapshotCubicResponseExpressions(expressions,{curveId:'parent',t:.3,childCurveIds:['left','right'],nonlinearDependencies:[]});
  const sample=prepareSnapshotResponseExpression(transferred.left[3]),prior=JSON.stringify(transferred);
  splitStore(store,fixture,'parent',.3,['left','right']);
  const at:BarycentricWeights=[.25,.35,.4],initial=sample({basisScalar:ref=>store.get(snapshotResponseBasisKey(ref)),geometricWeights:()=>at});
  const changed=fixture.map((q,index)=>q.map((value,control)=>value+((index+1)*(control-1)*3)) as unknown as ScalarCubic),changedStore=controlStore(changed);
  store.clear();changedStore.forEach((value,key)=>store.set(key,value));const children=splitStore(store,changed,'parent',.3,['left','right']);
  const residual=sample({basisScalar:ref=>store.get(snapshotResponseBasisKey(ref)),geometricWeights:()=>at});
  expect(residual).not.toBe(initial);
  const expected=split(evaluateControls(expressions,changed,changedStore,at),.3)[0][3];
  expect(dot(children.map(value=>value[0][3]),at)+residual).toBeCloseTo(expected,11);
  expect(JSON.stringify(transferred)).toBe(prior);
  expect(prior).not.toMatch(/position|drawing|deformation|coordinates|geometry/);
 });

 it('keeps separate kernels observably different from an incorrectly merged sample list',()=>{
  const one=triangleField(0),two=triangleField(1),a=createSnapshotResponseResidual(one,recipes(0)),b=createSnapshotResponseResidual(two,recipes(0));
  const combined=combineSnapshotResponseExpressions([{coefficient:.3,expression:a},{coefficient:.7,expression:b}]);
  const at:BarycentricWeights=[.3,.3,.4],values=[2,-3,8],sample=(field:SnapshotResponseExpressionField)=>dot(values,evaluateTriangularResponseWeights(at,field.edges,field.samples))-dot(values,at);
  const result=prepareSnapshotResponseExpression(combined)({basisScalar:ref=>values[snapshots.indexOf(ref.snapshotId)],geometricWeights:()=>at});
  expect(result).toBeCloseTo(.3*sample(one)+.7*sample(two),12);
  const merged={...one,samples:[...one.samples,...two.samples]};
  expect(Math.abs(result-sample(merged))).toBeGreaterThan(.1);
 });

 it('leaves exactly equal source coordinates unchanged even at very large common offsets',()=>{
  for(const field of [{...edgeField(),edges:[{from:0 as const,to:1 as const,knots:[[.25,.8] as const]}]},triangleField(0)]){
   const expression=createSnapshotResponseResidual(field,recipes(0,field.vertexIds.length)),sample=prepareSnapshotResponseExpression(expression);
   const at=field.vertexIds.length===2?[.7,.3]:[.31,.27,.42];
   for(const value of [0,4,1e12,1e15])expect(sample({basisScalar:()=>value,geometricWeights:()=>at})).toBe(0);
  }
 });
});

describe('real-view restriction and sampler support',()=>{
 it('inserts a 60-degree real view without approximating the old trajectory and honors later edits there',()=>{
  const old=edgeField(),expression=createSnapshotResponseResidual(old,recipes(0,2)),store=controlStore([[0,0,0,0],[9,0,0,0]]),at=2/3;
  const oldValue=(t:number)=>9*evaluateTriangularResponseWeights([1-t,t,0],old.edges)[1];
  const value60=oldValue(at),newSupport:SnapshotResponseExpressionField={id:'new-left',vertexIds:['vA','v60'],edges:[],samples:[]};
  const restricted=restrictSnapshotResponseExpression(expression,newSupport,(_field,index)=>index===0?[1,0]:[1-at,at]);
  const before=JSON.stringify({old,expression,restricted});
  const sample=createSnapshotExpressionValueSampler({vertexIds:newSupport.vertexIds as string[]},{expression:()=>restricted,basisScalar:ref=>store.get(snapshotResponseBasisKey(ref)),geometricWeights:(field,weights)=>field.id===old.id?[1-weights[1]*at,weights[1]*at]:weights});
  for(let i=0;i<=100;i++){const s=i/100;expect(sample(node('start'),0,[0,value60],[1-s,s])).toBeCloseTo(oldValue(s*at),12);}
  expect(sample(node('start'),0,[0,value60+4],[0,1])).toBeCloseTo(value60+4,13);
  expect(sample(node('start'),0,[0,value60+4],[.5,.5])-sample(node('start'),0,[0,value60],[.5,.5])).toBeCloseTo(2,13);
  expect(JSON.stringify({old,expression,restricted})).toBe(before);
  expect(restricted.fields.find(field=>field.id===old.id)).toEqual(old);
 });

 it('restricts independent triangle kernels exactly into a child triangle',()=>{
  const original=combineSnapshotResponseExpressions([{coefficient:.4,expression:createSnapshotResponseResidual(triangleField(0),recipes(0))},{coefficient:.6,expression:createSnapshotResponseResidual(triangleField(1),recipes(0))}]);
  const child:SnapshotResponseExpressionField={id:'child',vertexIds:['vA','vB','center'],edges:[],samples:[]};
  const corners:BarycentricWeights[]=[[1,0,0],[0,1,0],[.2,.3,.5]],coordinates=[2,-3,8];
  const oldResidual=prepareSnapshotResponseExpression(original),read=(ref:SnapshotResponseBasisReference)=>coordinates[snapshots.indexOf(ref.snapshotId)];
  const oldValue=(at:BarycentricWeights)=>dot(coordinates,at)+oldResidual({basisScalar:read,geometricWeights:()=>at});
  const realBases=corners.map(oldValue),restricted=restrictSnapshotResponseExpression(original,child,(_field,index)=>corners[index]);
  const sample=createSnapshotExpressionValueSampler({vertexIds:child.vertexIds as string[]},{expression:()=>restricted,basisScalar:read,geometricWeights:(field,weights)=>field.id==='child'?weights:[0,1,2].map(axis=>dot(corners.map(corner=>corner[axis]),weights))});
  for(const at of grid()){
   const mapped=[0,1,2].map(axis=>dot(corners.map(corner=>corner[axis]),at)) as unknown as BarycentricWeights;
   expect(sample(node('start'),0,realBases,at)).toBeCloseTo(oldValue(mapped),11);
  }
 });

 it('does not reintroduce a large common coordinate offset through restriction compensation',()=>{
  const at:BarycentricWeights=[.2,.3,.5],field:SnapshotResponseExpressionField={id:'offset-field',vertexIds:vertices,edges:[],samples:[{id:'sample',at,weights:[1/73,49/97,1-1/73-49/97]}]};
  const expression=createSnapshotResponseResidual(field,recipes(0)),child:SnapshotResponseExpressionField={id:'child',vertexIds:['vA','new'],edges:[],samples:[]};
  const restricted=restrictSnapshotResponseExpression(expression,child,(_field,index)=>index===0?[1,0,0]:at);
  expect(prepareSnapshotResponseExpression(expression)({basisScalar:()=>1e15,geometricWeights:()=>at})).toBe(0);
  expect(prepareSnapshotResponseExpression(restricted)({basisScalar:()=>1e15,geometricWeights:field=>field.id==='child'?[0,1]:at})).toBe(0);
 });

 it('preserves the split seam response through two later real-view insertions without nested history',()=>{
  const values:readonly ScalarCubic[]=[[0,0,0,8],[8,0,0,0]],old:SnapshotResponseExpressionField={...edgeField(),edges:[{from:0,to:1,knots:[[.5,0],[.75,1.4]]}]};
  const original=[createSnapshotResponseResidual(old,recipes(0,2)),emptySnapshotResponseExpression(),emptySnapshotResponseExpression(),emptySnapshotResponseExpression()] as const;
  const store=controlStore(values);splitStore(store,values,'parent',.5,['left','right']);
  const expression=splitSnapshotCubicResponseExpressions(original,{curveId:'parent',t:.5,childCurveIds:['left','right'],nonlinearDependencies:[]}).left[3];
  const oldResidual=prepareSnapshotResponseExpression(expression),read=(ref:SnapshotResponseBasisReference)=>store.get(snapshotResponseBasisKey(ref));
  const value=(t:number)=>4+oldResidual({basisScalar:read,geometricWeights:()=>[1-t,t]});
  const sixty=2/3,thirty=1/3,firstSupport:SnapshotResponseExpressionField={id:'first',vertexIds:['vA','v60'],edges:[],samples:[]};
  const first=restrictSnapshotResponseExpression(expression,firstSupport,(_field,index)=>index===0?[1,0]:[1-sixty,sixty]);
  const secondSupport:SnapshotResponseExpressionField={id:'second',vertexIds:['v30','v60'],edges:[],samples:[]};
  const second=restrictSnapshotResponseExpression(first,secondSupport,(field,index)=>{const t=index===0?thirty:sixty;return field.id===old.id?[1-t,t]:[1-t/sixty,t/sixty];});
  const sample=createSnapshotExpressionValueSampler({vertexIds:secondSupport.vertexIds as string[]},{expression:()=>second,basisScalar:read,geometricWeights:(field,weights)=>{
   const t=dot([thirty,sixty],weights);return field.id===old.id?[1-t,t]:field.id==='first'?[1-t/sixty,t/sixty]:weights;
  }});
  for(let i=0;i<=60;i++){const s=i/60;expect(sample(node('seam'),0,[value(thirty),value(sixty)],[1-s,s])).toBeCloseTo(value(thirty+(sixty-thirty)*s),12);}
  expect(second.fields).toHaveLength(3);expect(second.terms.length).toBeLessThanOrEqual(6);
  expect(sample(node('seam'),0,[value(thirty)+5,value(sixty)],[1,0])).toBeCloseTo(value(thirty)+5,12);
 });

 it('captures the shared persisted orientation and samples reversed caller order consistently',()=>{
  const mesh=createSnapshotTriangulation([{snapshotId:'A',angle:{x:0,y:0}},{snapshotId:'B',angle:{x:90,y:0}}]),location=locateSnapshotSimplex(mesh,{x:30,y:0})!;
  const reversed={...location,vertexIds:[...location.vertexIds].reverse(),snapshotIds:[...location.snapshotIds].reverse(),geometricWeights:[...location.geometricWeights].reverse()};
  const field=captureSnapshotResponseField('captured',mesh,reversed,{edgeKnots:()=>[[1/3,.8]],triangleSamples:()=>undefined});
  expect(field.vertexIds).toEqual(mesh.edges[0].vertexIds);
  const expression=createSnapshotResponseResidual(field,recipes(0,2)),read=(ref:SnapshotResponseBasisReference)=>ref.snapshotId==='A'?2:12;
  const sample=createSnapshotExpressionValueSampler(reversed,{expression:()=>expression,basisScalar:read});
  expect(sample(node('start'),0,[12,2],reversed.geometricWeights)).toBeCloseTo(10,13);
 });

 it('retains exact reversed edge response interpretation',()=>{
  const field=edgeField(),edge=field.edges[0],reversed:OrientedEdgeResponse={from:edge.to,to:edge.from,knots:[...edge.knots!].reverse().map(([t,w])=>[1-t,1-w])};
  const a=prepareSnapshotResponseExpression(createSnapshotResponseResidual(field,recipes(0,2))),b=prepareSnapshotResponseExpression(createSnapshotResponseResidual({...field,edges:[reversed]},recipes(0,2)));
  for(const t of [0,.1,.25,.3,.5,.6,.8,.9,1]){
   const input={basisScalar:(ref:SnapshotResponseBasisReference)=>ref.snapshotId==='A'?3:17,geometricWeights:()=>[1-t,t]};
   expect(a(input)).toBeCloseTo(b(input),12);
  }
 });

 it('owns compiled inputs and requires explicit maps for new simplex support',()=>{
  const field=edgeField(),expression=createSnapshotResponseResidual(field,recipes(0,2)),sample=prepareSnapshotResponseExpression(expression);
  const evaluate={basisScalar:()=>3,geometricWeights:()=>[.3,.7]},before=sample(evaluate);
  (expression.fields[0].edges[0].knots as unknown as number[][])[0][1]=30;(expression.terms[0].basis[0].basis.target as {nodeId:string}).nodeId='changed';
  expect(sample(evaluate)).toBe(before);
  const newSample=createSnapshotExpressionValueSampler({vertexIds:['vA','new']},{expression:()=>expression,basisScalar:()=>3});
  expect(errorCode(()=>newSample(node('n'),0,[1,2],[.5,.5]))).toBe('EXPRESSION_MISSING_SUPPORT');
 });

 it('keeps original membership weights intact when an integration callback attempts mutation',()=>{
  const expression=createSnapshotResponseResidual(edgeField(),recipes(0,2)),weights=[.75,.25],target=node('start');
  const sample=createSnapshotExpressionValueSampler({vertexIds:vertices.slice(0,2)},{expression:given=>{if(given.kind==='node')given.nodeId='changed';return expression;},basisScalar:ref=>ref.snapshotId==='A'?0:12,geometricWeights:(_field,given)=>{(given as number[]).reverse();return given;}});
  expect(()=>sample(target,0,[0,12],weights)).toThrow();expect(weights).toEqual([.75,.25]);expect(target).toEqual(node('start'));
 });

 it('rejects sparse active basis coordinates and weights rather than treating missing values as zero',()=>{
  const sample=createSnapshotExpressionValueSampler({vertexIds:vertices.slice(0,2)},{expression:()=>undefined,basisScalar:()=>0});
  const sparse=new Array<number>(2);sparse[0]=4;
  expect(errorCode(()=>sample(node('start'),0,sparse,[.5,.5]))).toBe('EXPRESSION_INVALID');
  sparse[0]=1;expect(errorCode(()=>sample(node('start'),0,[4,6],sparse))).toBe('EXPRESSION_INVALID');
 });
});

describe('bounded strict response expression data',()=>{
 it('rejects missing fields, cycles, unknown geometry, nonfinite numbers and invalid support before mutation',()=>{
  const expression=createSnapshotResponseResidual(edgeField(),recipes(0,2)),before=JSON.stringify(expression);
  const variants:unknown[]=[{...expression,geometry:[1,2]}, {...expression,version:2}, {...expression,terms:[{...expression.terms[0],fieldId:'missing'}]},
   {...expression,terms:[{...expression.terms[0],coordinate:2}]},{...expression,terms:[{...expression.terms[0],weight:'multiply'}]},
   {...expression,terms:[{...expression.terms[0],basis:[{coefficient:Infinity,basis:basis('A',0)}]}]},
   {...expression,fields:[{...expression.fields[0],vertexIds:['same','same']}]},
   {...expression,fields:[{...expression.fields[0],edges:[null]}]},
   {...expression,fields:[{...expression.fields[0],edges:[{from:0,to:2}]}]},
   {...expression,fields:[{...expression.fields[0],samples:[{id:'bad',at:[.2,.3,.5],weights:[0,0,1]}]}]},
   {...expression,fields:[expression.fields[0],expression.fields[0]]},
  ];
  const cycle={...expression,terms:[] as unknown[]};cycle.terms.push(cycle);variants.push(cycle);
  for(const value of variants)expect(errorCode(()=>validateSnapshotResponseExpression(value))).toBe('EXPRESSION_INVALID');
  expect(JSON.stringify(expression)).toBe(before);
 });

 it('rejects accessors, sparse arrays and resource amplification without invoking getters',()=>{
  const expression=createSnapshotResponseResidual(edgeField(),recipes(0,2));let calls=0;
  const accessor=Object.defineProperty({...expression},'version',{get(){calls++;return 1;}});
  expect(errorCode(()=>validateSnapshotResponseExpression(accessor))).toBe('EXPRESSION_INVALID');expect(calls).toBe(0);
  expect(errorCode(()=>validateSnapshotResponseExpression({...expression,terms:new Array(2)}))).toBe('EXPRESSION_INVALID');
  expect(errorCode(()=>validateSnapshotResponseExpression({...expression,terms:Array(snapshotResponseExpressionLimits.terms+1).fill(expression.terms[0])}))).toBe('EXPRESSION_LIMIT');
  expect(errorCode(()=>validateSnapshotResponseExpression({...expression,fields:[{...expression.fields[0],edges:[{from:0,to:1,knots:Array(snapshotResponseExpressionLimits.knots+1).fill([.5,.6])}]}]}))).toBe('EXPRESSION_LIMIT');
 });

 it('enforces substitution expansion limits while building instead of allocating the full Cartesian product',()=>{
  const field=edgeField(),leaves=Array.from({length:129},(_,index)=>({coefficient:1,basis:basis(`source-${index}`,0)}));
  const expression:SnapshotResponseExpression=freeze({version:1,fields:[field],terms:[{fieldId:field.id,coordinate:0,weight:'residual',basis:leaves}]});
  const before=JSON.stringify(expression);let calls=0;
  expect(errorCode(()=>substituteSnapshotResponseBases(expression,()=>{calls++;return leaves;}))).toBe('EXPRESSION_LIMIT');
  expect(calls).toBeLessThan(leaves.length);expect(JSON.stringify(expression)).toBe(before);
 });

 it('diagnoses nonlinear SMOOTH dependencies and invalid split parameters atomically',()=>{
  const original=freeze(expressionFixture()),before=JSON.stringify(original),base={curveId:'parent',t:.5,childCurveIds:['left','right'] as const,nonlinearDependencies:[] as string[]};
  expect(errorCode(()=>splitSnapshotCubicResponseExpressions(original,{...base,nonlinearDependencies:['smooth-join']}))).toBe('EXPRESSION_NONLINEAR_DEPENDENCY');
  for(const t of [0,1,NaN,Infinity])expect(errorCode(()=>splitSnapshotCubicResponseExpressions(original,{...base,t}))).toBe('EXPRESSION_INVALID');
  expect(errorCode(()=>splitSnapshotCubicResponseExpressions(original,{...base,childCurveIds:['parent','right']}))).toBe('EXPRESSION_INVALID');
  expect(JSON.stringify(original)).toBe(before);
 });

 it('rejects field identity conflicts and absent live bases, and never adds geometry through substitution',()=>{
  const expression=createSnapshotResponseResidual(edgeField(),recipes(0,2)),conflict=createSnapshotResponseResidual({...edgeField(),edges:[]},recipes(0,2));
  expect(errorCode(()=>combineSnapshotResponseExpressions([{coefficient:1,expression},{coefficient:1,expression:conflict}]))).toBe('EXPRESSION_INVALID');
  const sample=prepareSnapshotResponseExpression(expression);
  expect(errorCode(()=>sample({basisScalar:()=>undefined,geometricWeights:()=>[.5,.5]}))).toBe('EXPRESSION_MISSING_BASIS');
  expect(errorCode(()=>sample({basisScalar:()=>3,geometricWeights:()=>[1]}))).toBe('EXPRESSION_MISSING_SUPPORT');
  expect(errorCode(()=>substituteSnapshotResponseBases(expression,()=>[{coefficient:1,basis:{...basis('A',0),position:[2,3]} as SnapshotResponseBasisReference}]))).toBe('EXPRESSION_INVALID');
  const cancelled=combineSnapshotResponseExpressions([{coefficient:1,expression},{coefficient:-1,expression}]);expect(cancelled).toEqual(emptySnapshotResponseExpression());
 });
});
