import {expect,test} from 'vitest';
import {
 combineSnapshotResponseExpressions,createSnapshotResponseConstant as constant,createSnapshotResponseBasisValue as basisValue,
 createSnapshotResponseFitParameter as fitValue,createSnapshotResponseMaterialParameter,createSnapshotResponseResidual,
 multiplySnapshotResponseExpressions as product,divideSnapshotResponseExpressions as quotient,weightSnapshotResponseExpression,
 substituteSnapshotResponseBasisValues,substituteSnapshotResponseBases,prepareSnapshotResponseExpression,validateSnapshotResponseExpression,
 snapshotResponseExpressionBasisReferences,snapshotResponseExpressionFitParameters,snapshotResponseExpressionMaterialDomains,
 snapshotResponseSourceBaseline,withSnapshotResponseSourceBaseline,createSnapshotSmoothProjectionExpression,rebaseSnapshotResponseExpression,
 type SnapshotResponseBasisReference,type SnapshotResponseFitParameterReference,type SnapshotResponseExpressionField,type SnapshotResponseExpression,
 type SnapshotResponseBasisScalarResolver,
} from '../../domain/recordingSnapshot/responseExpressions';
import {deriveSmoothComponents} from '../../domain/recordingSnapshot/smoothComponent';
import {createSnapshotSplitParameterField} from '../../domain/recordingSnapshot/splitParameterField';
import type {Cubic} from '../../domain/drawing/model';

const old:SnapshotResponseBasisReference={snapshotId:'A',target:{kind:'handle',curveId:'old',end:0},axis:0},child={...old,target:{kind:'handle' as const,curveId:'left',end:0 as const}};
const reference:SnapshotResponseFitParameterReference={snapshotId:'A',parts:[{curveId:'left',parameterRange:[0,.37]},{curveId:'right',parameterRange:[.37,1]}],t:.37};
const field:SnapshotResponseExpressionField={id:'support',vertexIds:['A','B'],edges:[{from:0,to:1,knots:[[.5,.8]]}],samples:[]};
const evaluate=(expression:SnapshotResponseExpression,basisScalar:SnapshotResponseBasisScalarResolver=()=>0)=>prepareSnapshotResponseExpression(expression)({basisScalar,geometricWeights:()=>[.5,.5]});
const recovered=()=>quotient(basisValue(child),fitValue(reference));

test('basis arithmetic reads live fitted parameters again after a real source change',()=>{
 let q=.25,handle=2;const resolver:SnapshotResponseBasisScalarResolver=()=>handle;resolver.fitParameter=()=>q;
 const expression=product(recovered(),constant(3)),sample=prepareSnapshotResponseExpression(expression);
 expect(sample({basisScalar:resolver,geometricWeights:()=>[]})).toBe(24);q=.5;handle=3;expect(sample({basisScalar:resolver,geometricWeights:()=>[]})).toBe(18);
 expect(sample({basisScalar:resolver,fitParameter:()=>.75,geometricWeights:()=>[]})).toBe(12);
 expect(snapshotResponseExpressionBasisReferences(expression)).toEqual([child]);expect(snapshotResponseExpressionFitParameters(expression)).toEqual([reference]);
});

test('quotients reject zero denominators and all arithmetic rejects nonfinite or missing live values',()=>{
 expect(()=>evaluate(quotient(constant(1),constant(0)))).toThrow(/zero live denominator/);
 expect(()=>evaluate(product(constant(Number.MAX_VALUE),constant(2)))).toThrow(/nonfinite/);
 expect(()=>evaluate(fitValue(reference))).toThrow(/live fitted parameter/);
 const resolver:SnapshotResponseBasisScalarResolver=()=>2;resolver.fitParameter=()=>0;expect(()=>evaluate(recovered(),resolver)).toThrow(/zero live denominator/);
 expect(()=>constant(Infinity)).toThrow(/finite/);expect(()=>evaluate(basisValue(old),()=>NaN)).toThrow(/live basis/);
});

test('weighted arithmetic uses the original residual field kernel and defaults to geometric weights',()=>{
 const source=createSnapshotResponseResidual(field,[[{coefficient:1,basis:old}],[{coefficient:1,basis:{...old,snapshotId:'B'}}]]),rewritten=substituteSnapshotResponseBasisValues(source,value=>value.snapshotId==='A'?recovered():undefined),resolver:SnapshotResponseBasisScalarResolver=value=>value.snapshotId==='A'?2:10;resolver.fitParameter=()=>.25;
 const originalResolver:SnapshotResponseBasisScalarResolver=value=>value.snapshotId==='A'?8:10;
 expect(evaluate(rewritten,resolver)).toBeCloseTo(evaluate(source,originalResolver),13);
 expect(evaluate(weightSnapshotResponseExpression(constant(10),field,0))).toBe(5);
 expect(evaluate(weightSnapshotResponseExpression(constant(10),field,0,'residual'))).toBeCloseTo(-3,13);
 const legacy:SnapshotResponseExpression={version:1,fields:[field],terms:[],operations:[{kind:'constant',value:10},{kind:'weighted',source:0,fieldId:field.id,coordinate:0}]};expect(evaluate(legacy)).toBe(5);
});

test('arbitrary substitution preserves saved source baselines and rewrites explicit basis operations once',()=>{
 const source=withSnapshotResponseSourceBaseline(basisValue(old),product(basisValue(old),constant(3))),rewritten=substituteSnapshotResponseBasisValues(source,value=>value.target.kind==='handle'&&value.target.curveId==='old'?recovered():undefined),loaded=JSON.parse(JSON.stringify(rewritten));validateSnapshotResponseExpression(loaded);
 const resolver:SnapshotResponseBasisScalarResolver=()=>2;resolver.fitParameter=()=>.25;
 expect(evaluate(loaded,resolver)).toBe(8);expect(evaluate(snapshotResponseSourceBaseline(loaded)!,resolver)).toBe(24);
 expect(snapshotResponseExpressionBasisReferences(loaded)).toEqual([child]);expect(snapshotResponseExpressionFitParameters(loaded)).toEqual([reference]);
 const doubled=substituteSnapshotResponseBases(loaded,value=>value.target.kind==='handle'&&value.target.curveId==='left'?[{coefficient:2,basis:{...value,target:{...value.target,curveId:'leaf'}}}]:undefined);expect(evaluate(doubled,resolver)).toBe(16);expect(snapshotResponseExpressionBasisReferences(doubled)[0].target).toMatchObject({curveId:'leaf'});
});

test('arithmetic preserves source baseline semantics through multiplication and weighted composition',()=>{
 const source=withSnapshotResponseSourceBaseline(basisValue(child),constant(5)),scaled=product(source,constant(3)),weighted=weightSnapshotResponseExpression(scaled,field,1);
 expect(evaluate(weighted,()=>2)).toBe(3);expect(evaluate(snapshotResponseSourceBaseline(weighted)!,()=>2)).toBe(7.5);
});

test('substitution preserves the existing nonlinear SMOOTH program and its contracts',()=>{
 const component=deriveSmoothComponents([{id:'join',a:{curveId:'driver',end:1},b:{curveId:'follower',end:0}}])[0],zero=constant(0),projection=createSnapshotSmoothProjectionExpression(component,[{node:[zero,zero],vector:[basisValue(old),zero]},{node:[zero,zero],vector:[zero,constant(4)]}],1,0),source=combineSnapshotResponseExpressions([{coefficient:1,expression:projection},{coefficient:2,expression:constant(1)}]),rewritten=substituteSnapshotResponseBasisValues(source,value=>value.target.kind==='handle'&&value.target.curveId==='old'?recovered():undefined),resolver:SnapshotResponseBasisScalarResolver=()=>2;resolver.fitParameter=()=>.5;
 expect(evaluate(rewritten,resolver)).toBeCloseTo(evaluate(source,()=>4),13);expect(rewritten.smoothOwned).toBe(true);expect(rewritten.operations?.some(operation=>operation.kind==='smooth')).toBe(true);
});

test('curve-material parameter uses the shared arc law and reports only the unanchored evaluation',()=>{
 const parent:Cubic=[[0,0],[.2,1],[.8,-.5],[1,0]],support={...field,edges:[]},other={...reference,snapshotId:'B'},domain={parts:reference.parts,t:reference.t},expression=createSnapshotResponseMaterialParameter(parent.map(p=>[constant(p[0]),constant(p[1])]),[fitValue(reference),fitValue(other)],support,domain),resolver:SnapshotResponseBasisScalarResolver=()=>0,reports:number[]=[];resolver.fitParameter=value=>value.snapshotId==='A'?.23:.68;resolver.recordFitParameter=(got,value)=>{expect(got).toEqual(domain);reports.push(value);};
 const expected=createSnapshotSplitParameterField(parent).parameterAt([.23,.68],[.5,.5]);expect(evaluate(expression,resolver)).toBe(expected);expect(reports).toEqual([expected]);expect(snapshotResponseExpressionMaterialDomains(expression)).toEqual([domain]);
 reports.length=0;const rebased=rebaseSnapshotResponseExpression(expression,{...support,id:'new-support'},(_field,index)=>index===0?[1,0]:[0,1]);evaluate(rebased,resolver);expect(reports).toEqual([expected]);
 const loaded=JSON.parse(JSON.stringify(rebased));validateSnapshotResponseExpression(loaded);expect(evaluate(loaded,resolver)).toBeCloseTo(expected-(.23+.68)/2,13);
});

test('new operation data remains bounded, strict and forward-reference free',()=>{
 const malformed=JSON.parse(JSON.stringify(recovered()));malformed.operations[0].geometry={nodes:[]};expect(()=>validateSnapshotResponseExpression(malformed)).toThrow(/unknown/);
 expect(()=>validateSnapshotResponseExpression({version:1,fields:[],terms:[],operations:[{kind:'product',left:0,right:0}]})).toThrow(/strictly backward/);
 expect(()=>fitValue({...reference,parts:[{curveId:'left',parameterRange:[0,.2]},{curveId:'right',parameterRange:[.3,1]}]})).toThrow(/contiguous/);
 const expression=JSON.parse(JSON.stringify(fitValue(reference)));expression.operations[0].reference.parts[1].curveId='left';expect(()=>validateSnapshotResponseExpression(expression)).toThrow(/distinct/);
});

test('extracts only reachable operations and does not read an unrelated earlier basis',async()=>{
 const {extractSnapshotResponseOperation,prepareSnapshotResponseExpression}=await import('../../domain/recordingSnapshot/responseExpressions');
 const expression={version:1 as const,fields:[],terms:[],operations:[{kind:'constant' as const,value:2},{kind:'constant' as const,value:3},{kind:'sum' as const,inputs:[{operation:0,coefficient:1},{operation:1,coefficient:1}]},{kind:'basis' as const,basis:{snapshotId:'self',target:{kind:'node' as const,nodeId:'self'},axis:0 as const}},{kind:'sum' as const,inputs:[{operation:2,coefficient:1}]}]},selected=extractSnapshotResponseOperation(expression,4);
 expect(selected.operations).toHaveLength(4);expect(prepareSnapshotResponseExpression(selected)({basisScalar:()=>{throw Error('unrelated basis was read');},geometricWeights:()=>[]})).toBe(5);
});
