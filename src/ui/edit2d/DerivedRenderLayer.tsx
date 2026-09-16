import {createPortal} from 'react-dom';
import GpuDerivedRenderer from '../../rendering/edit2d/GpuDerivedRenderer';
import {useMemo,useSyncExternalStore} from 'react';
import {useShallow} from 'zustand/react/shallow';
import {useEditor} from '../../app/store';
import {useFrameProject} from '../../app/frameProject';
import {editRenderSnapshot} from '../../app/renderSnapshot';
import {surfaceInputKey,curveInputKey} from '../../domain/geometry/revisions';
import {subscribeSmooth,smoothVersion,evaluationToken} from '../../domain/continuity/evaluation';
import {patchSampling} from '../../domain/patches/model';
import {editSurfaceOpacity,HIDDEN_CURVE_OPACITY} from '../../rendering/edit2d/types';
import CpuSvgRenderer from '../../rendering/edit2d/CpuSvgRenderer';
import type {OrthographicViewState} from '../../rendering/orthographic';
/** Application integration; no renderer selector exposed to users. */
export default function DerivedRenderLayer({view,gpuHost}:{view:OrthographicViewState;gpuHost:HTMLDivElement|null}){
 useSyncExternalStore(subscribeSmooth,smoothVersion);
 const p=useFrameProject(),selection=useEditor(useShallow(s=>({id:s.selectedCurveId,edges:s.patchCreation})));
 const sampling=patchSampling(p.patchDisplay),visible=p.patchDisplay?.visible!==false;
 const key=surfaceInputKey(p)+curveInputKey(p)+evaluationToken(p);
 const snapshot=useMemo(()=>editRenderSnapshot(p,{...sampling,includeSurface:visible}),[key,sampling,visible]);
 const props={snapshot,view,style:{surfaceOpacity:editSurfaceOpacity(p.patchDisplay?.opacity2d),hiddenCurveOpacity:HIDDEN_CURVE_OPACITY,selectedCurveIds:new Set([...(selection.edges?.host?[selection.edges.host]:[]),...(selection.id?[selection.id]:[])])}};
 // CPU reference is opt-in in development only; production never runs CPU occlusion.
 if(import.meta.env.DEV&&new URLSearchParams(location.search).get("renderer")==="cpu")return <CpuSvgRenderer {...props}/>;
 return gpuHost?createPortal(<GpuDerivedRenderer {...props}/>,gpuHost):null;
}
