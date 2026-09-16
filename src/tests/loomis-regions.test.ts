import {it,expect} from 'vitest';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {createSection,sectionFromAngles} from '../domain/curves/section';
import {migrateHeadFrame,toRelative} from '../domain/head/frame';
import {regionCandidates,regionMesh,parseRegions,sectionPlane} from '../domain/head/regions';
import {dot} from '../domain/geometry/core';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {editRenderSnapshot} from '../app/renderSnapshot';
import {contourSource} from '../domain/contour/source';
function fixture(){let p=migrateHeadFrame(createLandmarkProject());p={...p,landmarks:[],curves:[],patches:[],centerlineOrder:[]};const ids:string[]=[];for(const [x,y] of [[0,0],[0,90],[90,0]]){const r=createSection(p);p=r.project;const c=p.curves.find(c=>c.id===r.selectedId)!;if(c.role==='canonical'&&'section' in c)c.section=sectionFromAngles(x,y,0);ids.push(r.selectedId);}return {p,ids};}
it('three orthogonal Sections partition the exact ellipsoid into eight selectable octants',()=>{
 const {p,ids}=fixture(),c=regionCandidates(p,ids);expect(c).toHaveLength(8);
 for(const r of c){expect(r.mesh.triangles.length).toBeGreaterThan(10);for(const v of r.mesh.vertices){const q=toRelative(p,v);expect(Math.hypot(...q)).toBeCloseTo(1,10);for(const cut of r.cuts){const plane=sectionPlane(p,cut.curveId);expect(cut.side*(dot(q,plane.n)-plane.d)).toBeGreaterThan(-1e-8);}}}
 expect(regionCandidates(p,ids)).toBe(c);
});
it('region source round-trips and all render consumers receive ellipsoid geometry',()=>{
 const {p,ids}=fixture(),c=regionCandidates(p,ids)[0];p.loomisRegions=[{id:'region',name:'八分球面',cuts:c.cuts,seed:c.seed}];
 const loaded=parseLandmarks(JSON.stringify(p));expect(loaded.loomisRegions).toEqual(p.loomisRegions);
 expect(editRenderSnapshot(loaded,{subdivisions:6,curveSegments:24,includeSurface:true}).surface).toHaveLength(1);
 expect(contourSource(loaded).mesh.triangles.length).toBeGreaterThan(0);
 const next={...loaded,headFrame:{...loaded.headFrame!,radiusX:2}};const m=regionMesh(next,next.loomisRegions![0]);for(const v of m.vertices)expect(Math.hypot(...toRelative(next,v))).toBeCloseTo(1,10);
 expect(()=>parseRegions([{...p.loomisRegions![0],cuts:[{curveId:'missing',side:1}]}],p)).toThrow();
});
it('offset section regions remain spherical and do not acquire fullness or ordinary Patch topology',()=>{
 const {p,ids}=fixture(),c=p.curves.find(c=>c.id===ids[0])!;if(c.role==='canonical'&&'section' in c)c.section=sectionFromAngles(10,35,.37);
 const candidates=regionCandidates(p,[ids[0]]);expect(candidates).toHaveLength(2);expect(p.patches).toEqual([]);
 for(const candidate of candidates)for(const v of candidate.mesh.vertices){const q=toRelative(p,v);expect(Math.hypot(...q)).toBeCloseTo(1,10);const plane=sectionPlane(p,ids[0]);expect(candidate.cuts[0].side*(dot(q,plane.n)-plane.d)).toBeGreaterThan(-1e-8);}
});
it('oblique offset cuts keep tessellated vertices inside their authored halfspaces',()=>{
 const {p,ids}=fixture();for(const [i,id] of ids.entries()){const c=p.curves.find(c=>c.id===id)!;if(c.role==='canonical'&&'section' in c)c.section=sectionFromAngles(15+i*22,20+i*37,.12+i*.13);}
 for(const r of regionCandidates(p,ids))for(const v of r.mesh.vertices){const q=toRelative(p,v);for(const cut of r.cuts){const plane=sectionPlane(p,cut.curveId);expect(cut.side*(dot(q,plane.n)-plane.d)).toBeGreaterThan(-1e-7);}}
});
