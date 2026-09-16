import {test,expect} from 'vitest';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame,mirrorPoint,rotateFrame} from '../domain/head/frame';
import {addSurfacePoint,setSurfaceDirection} from '../domain/head/surfacePoint';
import {addCap,addCapPoint,setCapPoint} from '../domain/head/caps';
import {createSection} from '../domain/curves/section';
import {addOnCurvePoint,setOnCurveS} from '../domain/landmarks/placement';
import {setLoomisOffset,offsetVector} from '../domain/head/offset';
import {pointPosition} from '../domain/geometry/evaluation';
import {dirtyDescendants} from '../domain/geometry/dependencies';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {duplicateLandmark} from '../domain/landmarks/management';
import {createCurve} from '../domain/curves/management';
function empty(){return {...migrateHeadFrame(createLandmarkProject()),landmarks:[],curves:[],patches:[],centerlineOrder:[]};}
function offsets(p:ReturnType<typeof empty>,id:string){for(const [i,v]of [.2,-.1,.3].entries())p=setLoomisOffset(p,id,i as 0|1|2,v) as typeof p;return p;}
for(const kind of ['surface','section','cap'] as const)test(kind+' offsets preserve anchor, mirror, resize, copy and save/load',()=>{
 let p:any=empty(),id:string;
 if(kind==='surface'){const r=addSurfacePoint(p,[.5,.3,.8],false);p=r.project;id=r.selectedId;}
 else{const r=createSection(p,false);p=r.project;if(kind==='section'){const a=addOnCurvePoint(p,r.selectedId);p=a.project;id=a.selectedId;}else{p=addCap(p,r.selectedId);const a=addCapPoint(p,p.loomisCaps[0].id,.2,.3);p=a.project;id=a.selectedId;}}
 const before=p,base=pointPosition(p,id!);p=offsets(p,id!);const q=p.landmarks.find((l:any)=>l.id===id).placement;expect(offsetVector(q)).toEqual([.2,-.1,.3]);
 const delta=rotateFrame([.2*p.headFrame.radiusX,-.1*p.headFrame.radiusY,.3*p.headFrame.radiusZ],p.headFrame);
 pointPosition(p,id!).forEach((v,i)=>expect(v-base[i]).toBeCloseTo(delta[i],12));
 const partner=p.landmarks.find((l:any)=>l.id===id).mirrorPartnerId;expect(pointPosition(p,partner)).toEqual(mirrorPoint(p,pointPosition(p,id!)));
 const dirty=dirtyDescendants(before,p);expect(dirty.curves.size).toBe(0);expect(dirty.order).not.toContain('frame:head');
 const moved=kind==='surface'?setSurfaceDirection(p,id!,[.2,.4,.8]):kind==='section'?setOnCurveS(p,id!,.23):setCapPoint(p,id!,.4,.1);expect(offsetVector(moved.landmarks.find(l=>l.id===id)!.placement)).toEqual([.2,-.1,.3]);
 const resized={...p,headFrame:{...p.headFrame,radiusX:2,radiusY:3,radiusZ:4}};const zero={...resized,landmarks:resized.landmarks.map((l:any)=>({...l,placement:{...l.placement,offsetX:0,offsetY:0,offsetZ:0}}))};pointPosition(resized,id!).forEach((v,i)=>expect(v-pointPosition(zero,id!)[i]).toBeCloseTo([.4,-.3,1.2][i],12));
 expect(pointPosition(parseLandmarks(JSON.stringify(p)),id!)).toEqual(pointPosition(p,id!));const copy=duplicateLandmark(p,id!,'copy');expect(offsetVector(copy.project.landmarks.find(l=>l.id===copy.selectedId)!.placement)).toEqual([.2,-.1,.3]);
 expect(pointPosition(parseLandmarks(JSON.stringify(before)),id!)).toEqual(base);
});
test('center X fixed; downstream curve follows without changing shape parameters',()=>{
 let r=addSurfacePoint(empty(),[0,.3,.8],true),p=r.project,id=r.selectedId;
 expect(offsetVector(setLoomisOffset(p,id,0,1).landmarks.find(l=>l.id===id)!.placement)[0]).toBe(0);
 const b=addSurfacePoint(p,[0,-.5,.8],true);p=createCurve(b.project,id,b.selectedId,p.views[0],'edge').project;
 const changed=setLoomisOffset(p,id,2,.3),dirty=dirtyDescendants(p,changed);expect(dirty.curves.size).toBe(1);expect(changed.curves).toEqual(p.curves);expect(pointPosition(changed,id)).not.toEqual(pointPosition(p,id));
});

test('downstream Patch/Fullness reevaluates while source shape parameters stay unchanged',async()=>{
 const {addPatch}=await import('../domain/patches/model'),{evaluator}=await import('../domain/patches/geometry');
 let p:any=empty();const ids:string[]=[];
 for(const d of [[.5,.7,.5],[.5,-.6,.7],[.5,-.3,-.8]]){const r=addSurfacePoint(p,d as [number,number,number],false);p=r.project;ids.push(r.selectedId);}
 const edges:string[]=[];for(let i=0;i<3;i++){const r=createCurve(p,ids[i],ids[(i+1)%3],p.views[0],'edge '+i);p=r.project;edges.push(r.selectedId);}
 p=addPatch(p,edges);p={...p,patches:p.patches.map((x:any)=>({...x,fullness:.2}))};const before=evaluator(p,p.patches[0])(.3,.3),next=setLoomisOffset(p,ids[0],2,.25);
 expect(next.curves).toEqual(p.curves);expect(next.patches).toEqual(p.patches);expect(dirtyDescendants(p,next).patches.size).toBe(2);expect(evaluator(next,next.patches![0])(.3,.3)).not.toEqual(before);
});
