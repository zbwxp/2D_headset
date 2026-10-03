import {afterEach,expect,test,vi} from 'vitest';
import {inverse3,map3} from '../domain/deformation/homography';
import {neutralBend} from '../domain/deformation/coons';
import {quadProjection,type Quad} from '../domain/drawing/deform';
import type {Point2} from '../domain/drawing/model';
import {moveDeformBoundary} from '../ui/drawing/DeformCageOverlay';
import {readPhoto} from '../ui/shared/readPhoto';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
const near=(a:Point2,b:Point2)=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],10));
test('Drawing curved-cage drags use the inverse homography in the normalized Coons frame',()=>{
 const rect={min:[-2,-1] as Point2,max:[2,3] as Point2},quad:Quad=[[-2,-1],[1.5,-.6],[.8,3],[-1.7,2.2]],h=quadProjection(rect,quad),bend=neutralBend(),before=structuredClone(bend),a:Point2=[-.5,.5],b:Point2=[-.1,1.3];
 near(map3(inverse3(h.matrix),h.map(a)),a);near(map3(h.matrix,b),h.map(b));
 const next=moveDeformBoundary(rect,quad,bend,1,0,h.map(a),h.map(b));
 near(next.handles[1][0],[bend.handles[1][0][0]+.1,bend.handles[1][0][1]+.2]);expect(next.handles[1][1]).toEqual(bend.handles[1][1]);expect(bend).toEqual(before);
 const midpoint=moveDeformBoundary(rect,quad,bend,1,2,h.map(a),h.map(b));
 for(const handle of [0,1] as const)near(midpoint.handles[1][handle],[bend.handles[1][handle][0]+.1*4/3,bend.handles[1][handle][1]+.2*4/3]);
});

function imageBrowser(options:{fails?:boolean;dataUrl?:(type:string,quality:number)=>string}={}){
 const createObjectURL=vi.fn(()=> 'blob:reference'),revokeObjectURL=vi.fn();
 vi.stubGlobal('URL',{createObjectURL,revokeObjectURL});
 vi.stubGlobal('Image',class {
  naturalWidth=2800;naturalHeight=1400;onload=()=>{};onerror=()=>{};
  set src(_value:string){queueMicrotask(()=>options.fails?this.onerror():this.onload());}
 });
 const context={fillStyle:'',fillRect:vi.fn(),drawImage:vi.fn()},canvas={width:0,height:0,getContext:()=>context,toDataURL:vi.fn(options.dataUrl??(()=> 'data:image/jpeg;base64,AAAA'))};
 vi.stubGlobal('document',{createElement:vi.fn(()=>canvas)});
 return {createObjectURL,revokeObjectURL,context,canvas};
}
const photo=()=>new File(['photo'],'reference.png',{type:'image/png'});
test('shared photo loading keeps Drawing defaults, white backing, dimensions and transform defaults',async()=>{
 const env=imageBrowser(),result=await readPhoto(photo());
 expect(result).toEqual({name:'reference.png',dataUrl:'data:image/jpeg;base64,AAAA',width:1400,height:700,opacity:.45,visible:true,locked:false,offset:[0,0],scale:1,rotation:0});
 expect(env.context.fillStyle).toBe('#fff');expect(env.context.fillRect).toHaveBeenCalledWith(0,0,1400,700);expect(env.context.drawImage).toHaveBeenCalledOnce();expect(env.revokeObjectURL).toHaveBeenCalledWith('blob:reference');
});
test('shared photo loading respects Recording size and compression limits',async()=>{
 const env=imageBrowser({dataUrl:(_type,quality)=>quality>.6?'x'.repeat(120):'data:image/jpeg;base64,AAAA'}),result=await readPhoto(photo(),{maxDimension:700,maxDataUrlLength:100});
 expect([result.width,result.height]).toEqual([700,350]);expect(result.dataUrl.length).toBeLessThanOrEqual(100);expect(env.canvas.toDataURL.mock.calls.length).toBeGreaterThan(1);expect(env.revokeObjectURL).toHaveBeenCalledOnce();
});
test('shared photo loader rejects unsupported files and releases failed image URLs',async()=>{
 const env=imageBrowser({fails:true});await expect(readPhoto(new File(['text'],'bad.txt',{type:'text/plain'}))).rejects.toThrow(/JPG/);expect(env.createObjectURL).not.toHaveBeenCalled();
 await expect(readPhoto(photo())).rejects.toThrow(/无法读取/);expect(env.revokeObjectURL).toHaveBeenCalledWith('blob:reference');
});
