import {test,expect} from 'vitest';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {addDefaultLandmark} from '../domain/landmarks/management';
import {assignModules,ownerOf,canPickModule,moduleEditAllowed} from '../domain/modules/ownership';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {normalizeEditorUpdate} from '../ui/authoring/state';
test('legacy objects default to HeadSet and new objects use active module',()=>{
 const base=assignModules(createLandmarkProject()),added=addDefaultLandmark(base,false),next=assignModules(added.project,base,'EYES');
 expect(base.landmarks.every(l=>ownerOf(base,l.id)==='HEADSET')).toBe(true);
 expect(ownerOf(next,added.selectedId)).toBe('EYES');expect(moduleEditAllowed(base,next,'EYES')).toBe(true);
 const parsed=parseLandmarks(JSON.stringify(next));expect(ownerOf(parsed,added.selectedId)).toBe('EYES');
 expect(()=>parseLandmarks(JSON.stringify({...next,geometryModules:{bad:'OTHER'}}))).toThrow();
});
test('inactive mutations/deletion are rejected, active edit allowed, selection filtered',()=>{
 const base=assignModules(createLandmarkProject()),id=base.landmarks[0].id;
 expect(canPickModule(base,id,'EYES')).toBe(false);
 expect(moduleEditAllowed(base,{...base,landmarks:base.landmarks.filter(x=>x.id!==id)},'EYES')).toBe(false);
 const renamed={...base,landmarks:base.landmarks.map(x=>x.id===id?{...x,name:'No'}:x)};
 expect(moduleEditAllowed(base,renamed,'EYES')).toBe(false);expect(moduleEditAllowed(base,renamed,'HEADSET')).toBe(true);
 const s=normalizeEditorUpdate(undefined,{project:base,activeModule:'EYES',selection:{kind:'point',id},tool:{kind:'select'}});expect(s.selection).toBeNull();
});
