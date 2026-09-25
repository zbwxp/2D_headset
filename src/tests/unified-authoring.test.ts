import {test,expect} from 'vitest';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {addDefaultLandmark} from '../domain/landmarks/management';
import {normalizeEditorUpdate,undoToolStep} from '../ui/authoring/state';
import {createToolDraft,stageToolDraft,materializeToolDraft} from '../ui/authoring/draft';
import {objectRows,resolveObject,objectRelations} from '../ui/authoring/objects';
test('selection/tool compatibility values are getters derived from one authority',()=>{
 const project=createLandmarkProject(),id=project.landmarks[0].id;
 let s=normalizeEditorUpdate(undefined,{project,selection:{kind:'point',id},tool:{kind:'select'}});
 expect(Object.getOwnPropertyDescriptor(s,'selectedId')?.get).toBeTypeOf('function');
 expect(s.selectedId).toBe(id);expect(s.selectedCurveId).toBeNull();
 s=normalizeEditorUpdate(s,{curveCreation:{startId:id}});
 expect(s.tool).toEqual({kind:'curve',pending:{startId:id}});
 s=normalizeEditorUpdate(s,{patchCreation:{mode:'whole',uses:[]},curveCreation:null});
 expect(s.curveCreation).toBeNull();expect(s.tool.kind).toBe('patch');
 s=normalizeEditorUpdate(s,{project:{...project,landmarks:[]}});expect(s.selection).toBeNull();
});
test('draft cancellation leaves source unchanged; all source additions materialize together',()=>{
 const base=createLandmarkProject(),created=addDefaultLandmark(base,false),points=created.project.landmarks.filter(l=>!base.landmarks.some(x=>x.id===l.id));
 const json=JSON.stringify(base),draft=stageToolDraft(createToolDraft(base),{points});
 expect(JSON.stringify(base)).toBe(json);expect(draft.points).toHaveLength(2);
 const next=materializeToolDraft(base,draft);expect(next.landmarks.length).toBe(base.landmarks.length+2);
 expect(()=>materializeToolDraft({...base},draft)).toThrow('Source changed');
 expect(()=>materializeToolDraft(base,{...draft,points:[base.landmarks[0]]})).toThrow('duplicate');
});
test('Undo Step operates on pending topology, not project; relations reference real objects',()=>{
 expect(undoToolStep({kind:'curve',pending:{startId:'a'}})).toEqual({kind:'curve',pending:{startId:null}});
 const p=createLandmarkProject();for(const kind of ['point','curve','surface'] as const)for(const row of objectRows(p,kind)){
 expect(resolveObject(p,row.primary.ref)).toBeDefined();for(const r of objectRelations(p,row.primary))expect(resolveObject(p,r.ref)).toBeDefined();
 }
});
