import {expect,test} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {prepareSceneBatch} from '../app/recordingSceneApi';
import {emptyRecordingScene,identityScenePlacement,type ScenePlacementTrack,type ScenePlacementValue} from '../domain/recordingScene/model';
import {parseRecordingScenes} from '../domain/recordingScene/persistence';
import {applyScenePlacement,applyScenePlacementMatrix,composePlacementSimilarity,evaluatePlacementTrack,inverseScenePlacement,placementMatrix,scenePlacementScales,setScenePlacementAxisScale,tryInverseScenePlacement} from '../domain/recordingScene/tracks';
import type {Point2} from '../domain/drawing/model';

const pose=(change:Partial<ScenePlacementValue>={}):ScenePlacementValue=>({...identityScenePlacement(),...change});
const near=(actual:Point2,expected:Point2)=>actual.forEach((n,i)=>expect(n).toBeCloseTo(expected[i],10));
const angle=(x:number,y=0)=>({x,y});

test('rotated local axes invert safely and world similarity gestures preserve anisotropy',()=>{
 const base=pose({translation:[2,-3],rotation:400,scale:1.5,scaleX:.2,scaleY:2}),delta=pose({translation:[-.4,.7],rotation:35,scale:.6}),p:Point2=[.9,-.2];
 const inverse=tryInverseScenePlacement(base);expect(inverse).not.toBeNull();near(applyScenePlacementMatrix(inverse!,applyScenePlacement(base,p)),p);
 const next=composePlacementSimilarity(base,delta);near(applyScenePlacement(next,p),applyScenePlacement(delta,applyScenePlacement(base,p)));expect(scenePlacementScales(next)).toEqual([.12,1.2]);expect(next.rotation).toBe(435);
 expect(()=>composePlacementSimilarity(base,pose({scaleX:2}))).toThrow(/similarity/);
 const legacy=pose({translation:[2,-3],rotation:400,scale:1.5});near(applyScenePlacement(inverseScenePlacement(legacy),applyScenePlacement(legacy,p)),p);
 expect(composePlacementSimilarity(legacy,delta)).toEqual({translation:applyScenePlacement(delta,legacy.translation),rotation:435,scale:legacy.scale*delta.scale});
});

test('exact zero preserves the other rotated axis and recovers around an anchor without inversion',()=>{
 const original=pose({translation:[2,3],rotation:37,scaleX:2,scaleY:.7}),anchor:Point2=[-1,.5],collapsed=setScenePlacementAxisScale(original,'x',0,anchor);
 const m=placementMatrix(collapsed);expect(m[0]).toBe(0);expect(m[1]).toBe(0);expect(scenePlacementScales(collapsed)).toEqual([0,.7]);expect(tryInverseScenePlacement(collapsed)).toBeNull();expect(()=>inverseScenePlacement(collapsed)).toThrow(/inverse/);
 near(applyScenePlacement(collapsed,anchor),applyScenePlacement(original,anchor));near(applyScenePlacement(collapsed,[2,1]),applyScenePlacement(collapsed,[-8,1]));
 const recovered=setScenePlacementAxisScale(collapsed,'x',2,anchor);near(recovered.translation,original.translation);near(applyScenePlacement(recovered,[.4,1.2]),applyScenePlacement(original,[.4,1.2]));
 expect(tryInverseScenePlacement(pose({scaleX:1e-10}))).not.toBeNull();expect(()=>setScenePlacementAxisScale(original,'y',-1)).toThrow();
});

test('saved axis values interpolate from a collapsed front to full width and round-trip through scene API',()=>{
 const scene={...emptyRecordingScene('scene'),instances:[{id:'one',artworkId:'missing-source',name:'One'},{id:'two',artworkId:'missing-source',name:'Two'}],shapeTracks:[{id:'shape',instanceId:'one',keys:[{id:'shape-key',angle:angle(0),value:{nodes:{node:[.1,.2] as Point2},handles:{}}}]}]};
 const project={...createEmptyProject(),recordingScenes:{version:1 as const,activeSceneId:'scene',scenes:[scene]}},before=JSON.stringify(project);
 const result=prepareSceneBatch(project,{commands:[{op:'setInstancePlacement',instanceId:'one',value:pose({scaleX:0})},{op:'saveSelected',instanceIds:['one']},{op:'setAngle',angle:angle(90)},{op:'setInstancePlacement',instanceId:'one',value:pose({scaleX:1})},{op:'saveSelected',instanceIds:['one']}]});
 const saved=parseRecordingScenes(JSON.parse(JSON.stringify(result.recordingScenes))),track=saved.scenes[0].placementTracks![0];
 expect(track.draft).toBeUndefined();expect(scenePlacementScales(evaluatePlacementTrack(track,angle(0)))).toEqual([0,1]);expect(scenePlacementScales(evaluatePlacementTrack(track,angle(45)))).toEqual([.5,1]);expect(scenePlacementScales(evaluatePlacementTrack(track,angle(90)))).toEqual([1,1]);
 expect(saved.scenes[0].shapeTracks![0].keys[0]).toEqual(scene.shapeTracks[0].keys[0]);expect(saved.scenes[0].shapeTracks![0].keys.every(k=>JSON.stringify(k.value)===JSON.stringify(scene.shapeTracks[0].keys[0].value))).toBe(true);expect(saved.scenes[0].placementTracks).toHaveLength(1);expect(saved.scenes[0].warps).toEqual([]);expect(JSON.stringify(project)).toBe(before);
 const corner:ScenePlacementTrack={...track,keys:[...track.keys,{id:'up',angle:angle(0,90),value:pose({scaleX:.5})}]};expect(scenePlacementScales(evaluatePlacementTrack(corner,angle(90,90)))).toEqual([1.5,1]);
 for(const scaleX of [-1,NaN,Infinity,1e7,null])expect(()=>prepareSceneBatch(project,{commands:[{op:'setInstancePlacement',instanceId:'one',value:{...pose(),scaleX}}]})).toThrow();
 const bad=structuredClone(saved);bad.scenes[0].placementTracks![0].keys[0].value.scaleY=-1;expect(()=>parseRecordingScenes(bad)).toThrow(/axis scale/);
});
