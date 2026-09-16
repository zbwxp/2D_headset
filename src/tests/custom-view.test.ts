import {test,expect} from 'vitest';
import {customView,ensureObliqueViews} from '../domain/landmarks/views';
import {basis} from '../domain/geometry/core';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {parseLandmarks} from '../domain/landmarks/persistence';
test('orthographic cameras are orthonormal even at poles and survive save/load',()=>{const p=createLandmarkProject();for(const pitch of [-90,-15,0,30,90]){const v=customView('自定',23,pitch),b=basis(v);expect(Math.hypot(...b.right)).toBeCloseTo(1,12);expect(Math.hypot(...b.up)).toBeCloseTo(1,12);expect(v.camera.position[1]).toBeCloseTo(4*Math.sin(pitch*Math.PI/180),12);expect(parseLandmarks(JSON.stringify({...p,views:[...p.views,v]})).views.at(-1)).toEqual(JSON.parse(JSON.stringify(v)));}expect(()=>customView('',0,91)).toThrow();});
test('preset replacement retains ID, reference and pan, is idempotent',()=>{const old=customView('俯 45°',0,45,'high45');old.canvas.pan=[12,34];const next=ensureObliqueViews([old]);expect(next[0].id).toBe(old.id);expect(next[0].label).toBe('俯 30°');expect(next[0].canvas).toBe(old.canvas);expect(next[0].camera.position[1]).toBeCloseTo(2,12);expect(ensureObliqueViews(next)).toEqual(next);});
