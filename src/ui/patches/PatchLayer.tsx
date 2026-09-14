import {useFrameProject} from '../../app/frameProject';
import {screenIndex,frontLayers} from '../../domain/geometry/screenIndex';
import {surfaceInputKey,curveInputKey} from '../../domain/geometry/revisions';
import {useShallow} from 'zustand/react/shallow';
import {count,timed} from '../../domain/geometry/diagnostics';
import {subscribeSmooth,smoothVersion,evaluationToken} from "../../domain/smooth/evaluation";
import { useMemo, useSyncExternalStore } from 'react';
import { useEditor } from '../../app/store';
import { tessellate } from '../../domain/patches/geometry';
import { defaultDisplay, patchSampling } from '../../domain/patches/model';
import { project, basis, dot, sub, cross } from '../../domain/geometry/core';
import { controls, bezier } from '../../domain/curves/geometry';
import type { LandmarkView } from '../../domain/landmarks/model';
import type { Vec3 } from '../../domain/project/types';
export default function PatchLayer({view}:{view:LandmarkView}){
    const visible=useEditor(s=>s.project.patchDisplay?.visible!==false);
    return visible ? <VisiblePatchLayer view={view}/> : null;
}
function VisiblePatchLayer({ view }: {
    view: LandmarkView;
}) {
    useSyncExternalStore(subscribeSmooth,smoothVersion);
    const s = useEditor(useShallow(s=>({selectedCurveId:s.selectedCurveId,patchCreation:s.patchCreation}))), p = useFrameProject(), opacity = p.patchDisplay?.opacity2d ?? defaultDisplay.opacity2d;
    const sampling=patchSampling(p.patchDisplay);
    const geometryKey=surfaceInputKey(p)+curveInputKey(p);
    const data = useMemo(() => {
        const endTiming=timed('projectionOcclusion');
        const { forward } = basis(view), screen = (v: Vec3) => { const q = project(v, view); return [q[0] * 160, -q[1] * 160, dot(v, forward)]; };
        const triangles = (p.patches ?? []).flatMap(patch => { const mesh = tessellate(p, patch, sampling.subdivisions); return mesh.triangles.map(ids => { const pts = ids.map(i => screen(mesh.vertices[i])); const n = cross(sub(mesh.vertices[ids[1]], mesh.vertices[ids[0]]), sub(mesh.vertices[ids[2]], mesh.vertices[ids[0]])); const shade = .72 + .28 * Math.abs(dot(n, forward)) / (Math.hypot(...n) || 1); return { patch: patch.id, pts, shade, depth: pts.reduce((a, x) => a + x[2], 0) / 3, minX: Math.min(...pts.map(x => x[0])), maxX: Math.max(...pts.map(x => x[0])), minY: Math.min(...pts.map(x => x[1])), maxY: Math.max(...pts.map(x => x[1])) }; }); });
        const index=screenIndex(triangles);
        const lines = p.curves.map(c => { const cp = controls(p, c); const samples = Array.from({ length: sampling.curveSegments+1 }, (_, i) => screen(bezier(cp, i / sampling.curveSegments))); const segments = samples.slice(1).map((b, i) => { const a = samples[i], x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2, z = (a[2] + b[2]) / 2, candidates=index.query(x,y);count('occlusionCandidateTests',candidates.length);return {d:`M${a[0]},${a[1]}L${b[0]},${b[1]}`,layers:frontLayers(candidates,x,y,z)}; }); const groups = new Map<number, string>(); for (const seg of segments)
            groups.set(seg.layers, (groups.get(seg.layers) ?? '') + seg.d); return { id: c.id, segments: [...groups].map(([layers, d]) => ({ layers, d })) }; });
        // Camera basis forward points toward the camera: far to near alpha compositing.
        triangles.sort((a, b) => a.depth - b.depth);
        count('projectedTriangles',triangles.length);endTiming();return { triangles, lines };
    }, [geometryKey, view.camera, sampling, evaluationToken(p)]);
    if (!p.patches?.length)
        return null;
    return <g pointerEvents="none" data-testid="patch-layer">
 {opacity > 0 && data.triangles.map((t, i) => <path key={i} d={`M${t.pts.map(x => `${x[0]},${x[1]}`).join('L')}Z`} fill={`rgb(${Math.round(190 * t.shade)},${Math.round(205 * t.shade)},${Math.round(207 * t.shade)})`} fillOpacity={opacity} stroke="none"/>)}
 {data.lines.map(c => <g key={c.id} data-testid={`patch-visible-curve-${c.id}`}>{c.segments.map((seg, i) => <path key={i} d={seg.d} fill="none" stroke={s.selectedCurveId === c.id || s.patchCreation?.includes(c.id) ? '#f0d8ff' : '#ab9fdd'} strokeWidth={s.selectedCurveId === c.id || s.patchCreation?.includes(c.id) ? 2.5 : 1.5} strokeOpacity={Math.pow(1 - opacity, seg.layers)} vectorEffect="non-scaling-stroke"/>)}</g>)}
 </g>;
}
