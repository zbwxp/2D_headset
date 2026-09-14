import{it,expect}from'vitest';import{SLIDER,holdMultiplier,trackValue,modifierScale,formatNumeric,snapTowardZero}from'../ui/shared/numericSliderMath';
it('neutral detent snaps inward within one percent, without trapping outward fine edits',()=>{
 expect(snapTowardZero(.025,.019123,-1,1)).toBe(0);
 expect(snapTowardZero(-.025,-.019123,-1,1)).toBe(0);
 expect(snapTowardZero(.001,-.001,-1,1)).toBe(0);
 expect(snapTowardZero(0,.0005,-1,1)).toBe(.0005);
 expect(snapTowardZero(.001,.0015,-1,1)).toBe(.0015);
 expect(snapTowardZero(.03,.021,-1,1)).toBe(.021);
 expect(snapTowardZero(.02,.001,0,1)).toBe(.001);
 expect(snapTowardZero(2,.1,-10,20)).toBe(.1);
});
it('normalized keyboard increments and fine wins',()=>{expect(100*SLIDER.normalizedStep).toBe(.25);expect(360*SLIDER.normalizedStep).toBe(.9);expect(modifierScale(true,true)).toBe(.2);expect(modifierScale(false,true)).toBe(5);});
it('acceleration is continuous, monotonic and bounded',()=>{let prev=1;for(let t=0;t<20000;t+=16){const x=holdMultiplier(t);expect(x).toBeGreaterThanOrEqual(prev);expect(x).toBeLessThanOrEqual(16);expect(x-prev).toBeLessThan(.15);prev=x;}expect(holdMultiplier(0)).toBe(1);});
it('pointer normalizes range and dimensions without snapping',()=>{expect(trackValue(42.35,0,100,0,1)).toBe(.4235);expect(trackValue(423.5,0,1000,0,1)).toBe(.4235);expect(trackValue(-10,0,100,0,1)).toBe(0);expect(trackValue(200,0,100,0,1)).toBe(1);});
it('display trims zeros without changing stored precision',()=>{expect(formatNumeric(42)).toBe('42');expect(formatNumeric(42.5)).toBe('42.5');expect(formatNumeric(42.354)).toBe('42.35');});
