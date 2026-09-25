import {test,expect} from 'vitest';
import {recordingSnapTargets,snapRecordingEndpoint,type SnapTarget} from '../domain/recording/snapping';
import {createRecorded,editEndpoint} from '../domain/recording/commands';
import {bindEndpoints,evaluateRecording} from '../domain/recording/junctions';
import {setSmoothMode,smoothGeometry} from '../domain/recording/smooth';
import {emptyRecording,displayShape,type Cubic} from '../domain/recording/model';

const front={yaw:0,pitch:0};
const line:Cubic=[[0,-1],[0,-1/3],[0,1/3],[0,1]];
const target:SnapTarget={id:'b',name:'B',shape:line,auxiliary:true};
test('capture uses CSS distance at each zoom and prioritizes exact endpoints',()=>{
 for(const zoom of [1,3]){
  const scale:[number,number]=[100*zoom,200*zoom];
  const hit=snapRecordingEndpoint([8/scale[0],.21],[target],scale)!;
  expect(hit.endpoint).toBe(false);expect(hit.point[0]).toBe(0);
  expect(Math.abs(hit.point[1]-.21)*scale[1]).toBeLessThan(.02);
  expect(snapRecordingEndpoint([11/scale[0],.21],[target],scale)).toBeNull();
  const end=snapRecordingEndpoint([3/scale[0],1-4/scale[1]],[target],scale)!;
  expect(end.endpoint).toBe(true);expect(end.point).toEqual([0,1]);
 }
});

test('a tight loop snaps to the cubic rather than its control polygon',()=>{
 const shape:Cubic=[[0,0],[1,2],[-1,2],[0,0]];
 const hit=snapRecordingEndpoint([.004,1.51],[{...target,shape}],[400,400])!;
 expect(hit.endpoint).toBe(false);expect(hit.t).toBeCloseTo(.5,2);
 const a=1-hit.t,b=[a**3,3*a*a*hit.t,3*a*hit.t**2,hit.t**3];
 expect(hit.point).toEqual([0,1].map(k=>shape.reduce((sum,p,i)=>sum+p[k]*b[i],0)));
 expect(Math.hypot(hit.point[0]-.004,hit.point[1]-1.51)*400).toBeLessThan(5);
});

test('targets follow visible evaluated geometry and mirroring, including locked guides and frozen references',()=>{
 let r=createRecorded(emptyRecording(),front,'a','Moving');
 r=createRecorded(r,front,'b','Guide',line,true);
 r=createRecorded(r,front,'c','Hidden',line);
 r=createRecorded(r,front,'d','View hidden',line);
 r.curves[1].locked=true;r.curves[2].visible=false;
 r.curves[3].visibilityKeys=[{...front,visible:false}];
 const view={yaw:-30,pitch:0},targets=recordingSnapTargets(r,view,{id:'a',end:0});
 expect(targets.map(t=>t.id)).toEqual(['b']);
 expect(targets[0].shape).toEqual(displayShape(evaluateRecording(r,view).get('b')!.shape,view));
 expect(targets[0].auxiliary).toBe(true);
});

test('bound moving geometry is excluded; snapping keeps one-shot position semantics and adjacent handle vector',()=>{
 let r=createRecorded(emptyRecording(),front,'a','A');
 r=createRecorded(r,front,'b','B');r=createRecorded(r,front,'target','Target',line);
 r=bindEndpoints(r,{id:'a',end:3},{id:'b',end:0},front,'bind');
 const targets=recordingSnapTargets(r,front,{id:'b',end:0});
 expect(targets.map(t=>t.id)).toEqual(['target']);
 const point=snapRecordingEndpoint([.02,.13],targets,[200,200])!.point;
 const next=editEndpoint(r,'b',0,front,point),e=evaluateRecording(next,front);
 expect(next.junctions).toEqual(r.junctions);
 expect(next.curves[2]).toBe(r.curves[2]);
 expect(e.get('a')!.shape[3]).toEqual(point);expect(e.get('b')!.shape[0]).toEqual(point);
 const before=r.curves[0].keys[0].shape,after=next.curves[0].keys[0].shape;
 after[2].forEach((x,k)=>expect(x-after[3][k]).toBeCloseTo(before[2][k]-before[3][k],12));
});

test('Smooth targets use trimmed sources and transition; moving that junction excludes both',()=>{
 let r=createRecorded(emptyRecording(),front,'a','A',[[-1,0],[-.7,0],[-.3,0],[0,0]]);
 r=createRecorded(r,front,'b','B',[[0,0],[0,.3],[0,.7],[0,1]]);
 r=createRecorded(r,front,'moving','Moving');
 r=setSmoothMode(bindEndpoints(r,{id:'a',end:3},{id:'b',end:0},front,'j'),'j',front,true);
 const targets=recordingSnapTargets(r,front,{id:'moving',end:0}),rendered=smoothGeometry(r,front);
 expect(targets.find(t=>t.id==='a')!.shape).toEqual(rendered.sources.get('a'));
 expect(targets.find(t=>t.id==='j')!.shape).toEqual(rendered.transitions[0].shape);
 expect(targets.find(t=>t.id==='a')!.shape[3]).not.toEqual([0,0]);
 expect(recordingSnapTargets(r,front,{id:'a',end:3}).map(t=>t.id)).toEqual(['moving']);
});
