import {expect,test} from 'vitest';
import type {Cubic,Point2} from '../domain/drawing/model';
import {snapViewGuides,type ViewGuide} from '../domain/drawing/viewGuides';

const x:ViewGuide={id:'x',axis:'x',value:0},y:ViewGuide={id:'y',axis:'y',value:0};
const line=(a:Point2,b:Point2):Cubic=>[a,[(2*a[0]+b[0])/3,(2*a[1]+b[1])/3],[(a[0]+2*b[0])/3,(a[1]+2*b[1])/3],b];
const polynomial=(a:number,b:number,c:number,d:number):Cubic=>[[d,0],[d+c/3,1/3],[d+2*c/3+b/3,2/3],[d+c+b+a,1]];
const evalCubic=(c:Cubic,t:number):Point2=>[0,1].map(axis=>(1-t)**3*c[0][axis]+3*(1-t)**2*t*c[1][axis]+3*(1-t)*t*t*c[2][axis]+t**3*c[3][axis]) as Point2;

test('x guides are vertical and y guides horizontal; no nearby guide returns null',()=>{
 expect(snapViewGuides([.02,.4],[x],[],.004)).toEqual({point:[0,.4],kind:'guide',guideIds:['x']});
 expect(snapViewGuides([.4,-.02],[y],[],.004)).toEqual({point:[.4,0],kind:'guide',guideIds:['y']});
 expect(snapViewGuides([.04,.4],[x],[],.004)).toBeNull();
 expect(snapViewGuides([0,0],[],[line([-1,-1],[1,1])],1)).toBeNull();
});

test.each([.001,.004,2])('capture radius is screen-based and inclusive at zoom %s',units=>{
 expect(snapViewGuides([8*units,1],[x],[],units)).not.toBeNull();
 expect(snapViewGuides([8.001*units,1],[x],[],units)).toBeNull();
 expect(snapViewGuides([4*units,1],[x],[],units,3)).toBeNull();
});

test('near discrete crossings have a bounded preference over guide-only projections',()=>{
 expect(snapViewGuides([1,2],[x,y],[],1)).toEqual({point:[0,0],kind:'guide-intersection',guideIds:['x','y']});
 expect(snapViewGuides([1,5],[x,y],[],1)?.kind).toBe('guide');
 // Each axis is close enough but the intersection lies outside the circular radius.
 expect(snapViewGuides([6,6],[x,y],[],1)?.kind).toBe('guide');
});

test('curve-guide crossing uses cubic t and the same bounded preference',()=>{
 const curves=[line([-10,0],[10,0])];
 expect(snapViewGuides([1,2],[x],curves,1)).toEqual({point:[0,0],kind:'curve-guide',guideIds:['x'],curveIndex:0,t:.5});
 expect(snapViewGuides([1,5],[x],curves,1)?.kind).toBe('guide');
});

test.each([.2,.5,.8])('all three S-curve intersections are found near t=%s',t=>{
 const curve=polynomial(1,-1.5,.66,-.08),snap=snapViewGuides([.0001,t],[x],[curve],.001)!;
 expect(snap.kind).toBe('curve-guide');expect(snap.t).toBeCloseTo(t,11);expect(snap.point[1]).toBeCloseTo(t,11);
 expect(evalCubic(curve,snap.t!)[0]).toBeCloseTo(0,13);
});

test('non-dyadic tangency is found without sign change or sampling',()=>{
 const t=.37123456789,curve=polynomial(0,1,-2*t,t*t),snap=snapViewGuides([.0001,t],[x],[curve],.001)!;
 expect(snap.kind).toBe('curve-guide');expect(snap.t).toBeCloseTo(t,10);expect(snap.point[1]).toBeCloseTo(t,10);
});

test('a nearby stationary point that misses a guide does not invent an intersection',()=>{
 const t=.37123456789,curve=polynomial(0,1,-2*t,t*t+1e-9);
 expect(snapViewGuides([.0001,t],[x],[curve],.001)?.kind).toBe('guide');
});

test('triple roots and endpoint intersections are retained',()=>{
 const triple=polynomial(1,-1.5,.75,-.125);
 expect(snapViewGuides([.0001,.5],[x],[triple],.001)?.t).toBeCloseTo(.5,11);
 expect(snapViewGuides([.0001,0],[x],[line([0,0],[1,1])],.001)?.t).toBe(0);
 expect(snapViewGuides([.0001,1],[x],[line([-1,0],[0,1])],.001)?.t).toBe(1);
});

test('quadratic, linear, and constant cubics handle degeneracies without arbitrary t',()=>{
 expect(snapViewGuides([0,.6],[x],[polynomial(0,0,1,-.6)],.001)?.t).toBeCloseTo(.6,12);
 expect(snapViewGuides([.001,.6],[x],[line([0,0],[0,1])],.001)?.kind).toBe('guide');
 expect(snapViewGuides([0,0],[x],[[[0,0],[0,0],[0,0],[0,0]]],.001)?.kind).toBe('guide');
 expect(snapViewGuides([.001,.6],[x],[polynomial(0,0,1,1)],.001)?.kind).toBe('guide');
});

test('horizontal-guide intersections work with transformed reference curves',()=>{
 const c=line([10,20],[12,24]),g:ViewGuide={id:'reference-height',axis:'y',value:22};
 const snap=snapViewGuides([11.002,22.001],[g],[c],.004)!;
 expect(snap.kind).toBe('curve-guide');expect(snap.point).toEqual([11,22]);expect(snap.t).toBe(.5);
});

test('nearest discrete candidate wins; guide-order ties use stable IDs',()=>{
 const a:ViewGuide={id:'a',axis:'x',value:-1},b:ViewGuide={id:'b',axis:'x',value:1};
 expect(snapViewGuides([0,20],[b,a],[],1)?.guideIds).toEqual(['a']);
 expect(snapViewGuides([0,20],[a,b],[],1)?.guideIds).toEqual(['a']);
 const curves=[line([-1,2],[1,2]),line([-1,1],[1,1])];
 expect(snapViewGuides([.1,.9],[x],curves,1)?.curveIndex).toBe(1);
 expect(snapViewGuides([.1,1],[x],[curves[1],curves[1]],1)?.curveIndex).toBe(0);
});

test('zero threshold means exact contact only',()=>{
 expect(snapViewGuides([0,1],[x],[],1,0)?.point).toEqual([0,1]);
 expect(snapViewGuides([1e-12,1],[x],[],1,0)).toBeNull();
 expect(snapViewGuides([0,0],[x,y],[],1,0)?.kind).toBe('guide-intersection');
});

test('inputs are read-only, including reference cubics and point arrays',()=>{
 const p:Point2=[.001,.501],guides=[x],curves=[line([-1,0],[1,1])],before=structuredClone({p,guides,curves});
 curves.forEach(c=>{c.forEach(Object.freeze);Object.freeze(c);});Object.freeze(curves);Object.freeze(x);Object.freeze(guides);Object.freeze(p);
 expect(()=>snapViewGuides(p,guides,curves,.004)).not.toThrow();expect({p,guides,curves}).toEqual(before);
});

test('very small and large coordinate scales remain finite and find real crossings',()=>{
 for(const scale of [1e-200,1e200]){
  const c=line([-1,-1],[1,1]).map(p=>[p[0]*scale,p[1]*scale] as Point2) as Cubic;
  const snap=snapViewGuides([.001*scale,.001*scale],[x],[c],.004*scale)!;
  expect(snap.kind).toBe('curve-guide');expect(snap.t).toBe(.5);expect(snap.point).toEqual([0,0]);
 }
});

test('invalid inputs fail explicitly rather than returning a misleading snap',()=>{
 expect(()=>snapViewGuides([NaN,0],[x],[],1)).toThrow(RangeError);
 for(const units of [0,-1,NaN,Infinity])expect(()=>snapViewGuides([0,0],[x],[],units)).toThrow(RangeError);
 for(const radius of [-1,NaN,Infinity])expect(()=>snapViewGuides([0,0],[x],[],1,radius)).toThrow(RangeError);
 expect(()=>snapViewGuides([0,0],[{...x,value:Infinity}],[],1)).toThrow(RangeError);
 expect(()=>snapViewGuides([0,0],[{...x,axis:'z'} as unknown as ViewGuide],[],1)).toThrow(RangeError);
 expect(()=>snapViewGuides([0,0],[x,x],[],1)).toThrow(RangeError);
 expect(()=>snapViewGuides([0,0],[],[[[0,0],[0,0],[0,Infinity],[0,0]]],1)).toThrow(RangeError);
});
