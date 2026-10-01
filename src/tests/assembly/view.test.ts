import {test,expect} from 'vitest';
import {zoomAssemblyView,rigPointInDrawing,type AssemblyView} from '../../ui/assemblyDrawing/view';
import {createDrawingSession} from '../../ui/assemblyDrawing/session';

test('artwork navigation leaves the independent reference origin alone',()=>{
 const session=createDrawingSession();
 session.getState().set({pan:[120,-80]});
 expect(session.getState().rigPan).toEqual([0,0]);
});
test('locking preserves current alignment through pan, zoom and unlock without snapping',()=>{
 const session=createDrawingSession(),set=session.getState().set;
 set({pan:[120,-80],rigPan:[10,20]});
 const alignment=()=>rigPointInDrawing([.3,.7],{...session.getState(),unit:250*session.getState().zoom});
 const anchor=alignment();set({rigViewLocked:true});expect(alignment()).toEqual(anchor);
 for(const pan of [[190,-40],[85,55]] as [number,number][]){set({pan});alignment().forEach((n,i)=>expect(n).toBeCloseTo(anchor[i],12));}
 const zoomed=zoomAssemblyView(session.getState(),2.5,[-170,75]);set(zoomed);
 expect(session.getState().rigPan).toEqual(zoomed.rigPan);
 alignment().forEach((n,i)=>expect(n).toBeCloseTo(anchor[i],12));
 const fixed=session.getState().rigPan;set({rigViewLocked:false});expect(session.getState().rigPan).toEqual(fixed);
 set({pan:[0,0]});expect(session.getState().rigPan).toEqual(fixed);
 // Explicit viewport restore/import must not apply a second linked translation.
 set({rigViewLocked:true});set({zoom:1,pan:[0,0],rigPan:[0,0]});
 expect(session.getState().rigPan).toEqual([0,0]);
});
test('cursor zoom, repeated Z zoom and fit retain the same reference point in artwork coordinates',()=>{
 const start:AssemblyView={zoom:1,pan:[120,-80],rigPan:[10,20]};
 const point:[number,number]=[.3,.7];
 const anchor=rigPointInDrawing(point,{...start,unit:250});
 const next=zoomAssemblyView(start,2.5,[-170,75]);
 expect(rigPointInDrawing(point,{...next,unit:625})).toEqual(anchor);
 const incremental=zoomAssemblyView(next,1.7,[100,30]);
 const fromGestureStart=zoomAssemblyView(start,1.7,[100,30]);
 incremental.rigPan.forEach((n,i)=>expect(n).toBeCloseTo(fromGestureStart.rigPan[i],12));
 const fit=zoomAssemblyView(incremental,.8,[0,0]);
 rigPointInDrawing(point,{...fit,unit:200}).forEach((n,i)=>expect(n).toBeCloseTo(anchor[i],12));
});
