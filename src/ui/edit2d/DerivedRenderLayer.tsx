import {displayTransform,displayCurveSamples} from '../../rendering/moduleDisplay';
import {evaluationContext} from '../../domain/geometry/evaluation';
import {useVisibility} from '../authoring/visibility';
import {createPortal} from 'react-dom';
import GpuDerivedRenderer from '../../rendering/edit2d/GpuDerivedRenderer';
import {useMemo,useSyncExternalStore} from 'react';
import {useShallow} from 'zustand/react/shallow';
import {useEditor} from '../../app/store';
import {useFrameProject} from '../../app/frameProject';
import {editRenderSnapshot,surfaceNormals} from '../../app/renderSnapshot';
import {surfaceInputKey,curveInputKey} from '../../domain/geometry/revisions';
import {subscribeSmooth,smoothVersion,evaluationToken} from '../../domain/continuity/evaluation';
import {patchSampling} from '../../domain/patches/model';
import {editSurfaceOpacity,HIDDEN_CURVE_OPACITY} from '../../rendering/edit2d/types';
import CpuSvgRenderer from '../../rendering/edit2d/CpuSvgRenderer';
import type {OrthographicViewState} from '../../rendering/orthographic';
/** Application integration; no renderer selector exposed to users. */
export default function DerivedRenderLayer({view,gpuHost}:{view:OrthographicViewState;gpuHost:HTMLDivElement|null}){
 const hidden=useVisibility();
 useSyncExternalStore(subscribeSmooth,smoothVersion);
 const p=useFrameProject(),selection=useEditor(useShallow(s=>({id:s.selectedCurveId,edges:s.patchCreation})));
 const sampling=patchSampling(p.patchDisplay),visible=p.patchDisplay?.visible!==false;
 const key=surfaceInputKey(p)+curveInputKey(p)+evaluationToken(p);
 const snapshot=useMemo(()=>editRenderSnapshot(p,{...sampling,includeSurface:visible}),[key,sampling,visible]);
 const displaySnapshot={...snapshot,surface:snapshot.surface.filter(x=>!hidden(x.id)).map(c=>{const m=displayTransform(p,c.id,view.forward);if(!m.active)return c;const positions=new Float32Array(c.positions.length);for(let i=0;i<positions.length;i+=3)positions.set(m.display([c.positions[i],c.positions[i+1],c.positions[i+2]]),i);return {...c,positions,normals:surfaceNormals(positions,c.indices),geometryToken:c.geometryToken+m.key};}),curves:snapshot.curves.filter(x=>!hidden(x.id)).map(c=>{const m=displayTransform(p,c.id,view.forward);if(!m.active)return c;const samples=new Float32Array(displayCurveSamples(p,c.id,evaluationContext(p).curve(c.id),view.forward).flat());return {...c,samples,geometryToken:c.geometryToken+m.key};})};
 const props={snapshot:displaySnapshot,view,style:{surfaceOpacity:editSurfaceOpacity(p.patchDisplay?.opacity2d),hiddenCurveOpacity:HIDDEN_CURVE_OPACITY,selectedCurveIds:new Set([...(selection.edges?.host?[selection.edges.host]:[]),...(selection.id?[selection.id]:[])])}};
 // CPU reference is opt-in in development only; production never runs CPU occlusion.
 if(import.meta.env.DEV&&new URLSearchParams(location.search).get("renderer")==="cpu")return <CpuSvgRenderer {...props}/>;
 return gpuHost?createPortal(<GpuDerivedRenderer {...props}/>,gpuHost):null;
}
