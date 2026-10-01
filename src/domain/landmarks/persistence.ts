import {parseAssembly} from '../assembly/model';
import {migrateChinNode} from '../chin/migration';
import type {Vec3} from '../project/types';
import {parseChin,ensureChin,chinRoles} from '../chin/model';
import {parseHeadPerspective} from '../head/perspective';
import {migrateFree3D} from '../curves/free3d';
import {followEndpoints} from '../curves/geometry';
import {migrateEyeCoord} from '../eyes/coord';
import {parseGaze} from '../eyes/gaze';
import {parseEyeScaffold,rebuildEyeScaffold} from '../eyes/scaffold';
import {assignModules} from '../modules/ownership';
import {parsePoseRecording,syncPoseSnapshots} from '../recording/poses';
import {upgradeAppliedInferenceInk} from '../recording/poseInference';
import {parseDrawing} from '../drawing/model';
import {parseDrawingSnapshots} from '../drawing/snapshots';
import {repairCurveNames} from '../curves/naming';
import {parseJoins} from '../curves/smoothJoin/model';
import {dependencyGraph} from '../geometry/dependencies';
import {validateOnPatch} from '../curves/onPatch';
import {ensureScaffold,roles} from '../head/scaffold';
import {parseInspectionBackground} from '../head/inspectionBackground';
import {loomisObjects,lockPair} from '../head/locks';
import {offsetFields} from '../head/offset';
import {parseCaps} from '../head/caps';
import {parseRegions} from '../head/regions';
import {migrateHeadFrame} from '../head/frame';
import {validatePlacements} from "./placement";
import {pointPosition} from "../geometry/evaluation";
import {migrateContinuity} from "../continuity/model";
import {parseSmooth} from "../smooth/model";
import {parsePatches,defaultDisplay,patchQualityLevels} from "../patches/model";
import { parseCurves } from "../curves/persistence";
import { repairCenterlineOrder } from "./order";
import { ensureObliqueViews } from "./views";
import type { LandmarkProject } from "./model";
import { activateDriver } from "./model";
import { dot, cross, sub } from "../geometry/core";
const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);
const vec = (a: unknown, n: number): a is number[] =>
  Array.isArray(a) && a.length === n && a.every(finite);
export function parseLandmarks(text: string): LandmarkProject {
  const raw=JSON.parse(text);
  if(Array.isArray(raw?.landmarks))raw.landmarks=raw.landmarks.map((l:any)=>l&&typeof l==='object'?{...l,placement:l.placement??{kind:'WORLD',position:l.position}}:l);
  const p = raw as LandmarkProject;
  const check = (ok: unknown) => {
    if (!ok)
      throw new Error("文件不是有效的语义点项目；旧曲面项目请保留备份。");
  };
  check(
    [
      "landmarks-0.9.7",
      "landmarks-0.9.5",
      "landmarks-0.9.3",
      "landmarks-0.9.2",
      "landmarks-0.5",
      "landmarks-0.5.1",
      "landmarks-0.5.2", "landmarks-0.6.3",
      "landmarks-0.5.5","landmarks-0.5.4","landmarks-0.5.3",
      "landmarks-0.4.9.1",
      "landmarks-0.4.9",
      "landmarks-0.4.5",
      "landmarks-0.1",
      "landmarks-0.2",
      "landmarks-0.3",
      "landmarks-0.3.5",
      "landmarks-0.3.6",
      "landmarks-0.3.8",
      "landmarks-0.3.9",
      "landmarks-0.4.0",
      "landmarks-0.4.1",
      "landmarks-0.4.2",
    ].includes(p?.version) &&
      p.meta &&
      typeof p.meta.name === "string" &&
      finite(p.meta.createdAt) &&
      finite(p.meta.updatedAt),
  );
  check(
    Array.isArray(p.views) &&
      p.views.length > 0 &&
      p.views.length <= 30 &&
      Array.isArray(p.landmarks),
  );
  const viewIds = new Set<string>();
  for (const v of p.views) {
    check(typeof v.id === "string" && !viewIds.has(v.id));
    viewIds.add(v.id);
    check(
      typeof v.label === "string" &&
        v.camera?.projection === "orthographic" &&
        vec(v.camera.position, 3) &&
        vec(v.camera.target, 3) &&
        vec(v.camera.up, 3) &&
        v.canvas &&
        vec(v.canvas.pan, 2) &&
        finite(v.canvas.zoom) &&
        v.canvas.zoom > 0,
    );
    check(
      Math.hypot(
        ...cross(sub(v.camera.position, v.camera.target), v.camera.up),
      ) > 1e-8,
    );
    if (v.reference) {
      const r = v.reference;
      check(
        typeof r.name === "string" &&
          typeof r.dataUrl === "string" &&
          /^data:image\/(png|jpeg|webp);base64,/.test(r.dataUrl) &&
          r.dataUrl.length < 1000000 &&
          finite(r.width) &&
          r.width > 0 &&
          finite(r.height) &&
          r.height > 0 &&
          finite(r.opacity) &&
          r.opacity >= 0 &&
          r.opacity <= 1 &&
          finite(r.scale) &&
          r.scale > 0 &&
          finite(r.rotation) &&
          vec(r.offset, 2) &&
          typeof r.locked === "boolean" &&
          typeof r.visible === "boolean",
      );
    }
  }
  if (p.lockedViews !== undefined)
    check(
      Array.isArray(p.lockedViews) &&
        new Set(p.lockedViews).size === p.lockedViews.length &&
        p.lockedViews.every((id) => viewIds.has(id)),
    );
  if(p.headFrame){const f=p.headFrame;check(vec(f.center,3)&&vec(f.orientation,4)&&Math.abs(Math.hypot(...f.orientation)-1)<1e-8&&[f.radiusX,f.radiusY,f.radiusZ].every(x=>finite(x)&&x>1e-6));}
  const ids = new Set<string>();
  for (const l of p.landmarks) {
    check(
      typeof l.id === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          l.id,
        ) &&
        !ids.has(l.id),
    );
    ids.add(l.id);
    check(
      typeof l.name === "string" &&
        l.placement && ["CHIN_SURFACE","EYE_LOCAL","LOOMIS_SCAFFOLD","WORLD","FRAME_RELATIVE","ON_CURVE","ON_LOOMIS_SURFACE","ON_SECTION_CAP","ON_PATCH"].includes(l.placement.kind) &&
        ["CENTERLINE", "LEFT", "RIGHT", "FREE"].includes(l.type) &&
        l.viewLocks &&
        typeof l.viewLocks === "object" &&
        !Array.isArray(l.viewLocks),
    );
    const q=l.placement;
    if(q.kind==='CHIN_SURFACE'){check(p.chinScaffold&&p.headFrame&&vec(q.direction,3)&&Math.abs(Math.hypot(...q.direction)-1)<1e-8&&q.direction[1]<=1e-8&&Object.keys(l.viewLocks).length===0);if(l.systemRole)check(chinRoles.includes(l.systemRole as any));}
    else if(q.kind==='EYE_LOCAL'){check(p.eyeScaffold?.coord&&['left','right'].includes(q.side)&&vec(q.local,3)&&l.type===(q.side==='left'?'LEFT':'RIGHT')&&Object.keys(l.viewLocks).length===0);}
    else if(q.kind==='LOOMIS_SCAFFOLD'){check(roles.includes(q.role)&&l.systemRole===q.role&&Object.keys(l.viewLocks).length===0);}
    else if(q.kind==='ON_PATCH'){check(typeof q.hostPatchId==='string'&&finite(q.u)&&finite(q.v)&&q.u>=0&&q.u<=1&&q.v>=0&&q.v<=1&&Object.keys(l.viewLocks).length===0);check(Object.keys(q).every(k=>['kind','hostPatchId','u','v'].includes(k)));}
    else if(q.kind==='ON_SECTION_CAP'){check(typeof q.hostSurfaceId==='string'&&finite(q.u)&&finite(q.v)&&q.u*q.u+q.v*q.v<=1+1e-8&&Object.keys(l.viewLocks).length===0);check(Object.keys(q).every(k=>['kind','hostSurfaceId','u','v','offsetX','offsetY','offsetZ'].includes(k)));}
    else if(q.kind==='ON_LOOMIS_SURFACE'){check(p.headFrame&&q.hostFrameId==='head'&&vec(q.direction,3)&&Math.abs(Math.hypot(...q.direction)-1)<1e-8&&Object.keys(l.viewLocks).length===0);check(Object.keys(q).every(k=>['kind','hostFrameId','direction','offsetX','offsetY','offsetZ'].includes(k)));}
    else if(q.kind!=='ON_CURVE'){check(vec(q.position,3));if(q.kind==='FRAME_RELATIVE')check(p.headFrame);}
    else {check(typeof q.hostCurveId==='string'&&['canonical','mirror'].includes(q.role)&&Object.keys(l.viewLocks).length===0);
     if(q.role==='canonical')check(finite(q.s)&&q.s>=0&&q.s<=1&&!('canonicalPointId' in q));else check(typeof q.canonicalPointId==='string'&&!('s' in q));
     check(!('position' in q)&&!('position' in l));
    }
    for (const [id, k] of Object.entries(l.viewLocks)) {
      check(
        viewIds.has(id) &&
          k &&
          vec(k.right, 3) &&
          vec(k.up, 3) &&
          vec(k.coordinates, 2),
      );
      check(
        Math.abs(dot(k.right, k.up)) < 1e-8 &&
          Math.abs(dot(k.right, k.right) - 1) < 1e-8 &&
          Math.abs(dot(k.up, k.up) - 1) < 1e-8,
      );
      check(
        Math.abs(dot(pointPosition(p,l.id), k.right) - k.coordinates[0]) < 1e-8 &&
          Math.abs(dot(pointPosition(p,l.id), k.up) - k.coordinates[1]) < 1e-8,
      );
    }
  }
  for (const l of p.landmarks) {
    if (l.type === "LEFT" || l.type === "RIGHT") check(l.mirrorPartnerId);
    if (l.mirrorPartnerId) {
      const r = p.landmarks.find((x) => x.id === l.mirrorPartnerId);
      check(
        r &&
          r.id !== l.id &&
          r.mirrorPartnerId === l.id &&
          ((l.type === "LEFT" && r.type === "RIGHT") ||
            (l.type === "RIGHT" && r.type === "LEFT")),
      );

    }
  }
  // Whitelist source data; never import legacy geometry or derived render objects.
  let result: LandmarkProject = {
    version: "landmarks-0.3.9",
    chinScaffold:parseChin(p.chinScaffold,p.headFrame),headFrame:p.headFrame,loomisScaffold:p.loomisScaffold,headPerspective:parseHeadPerspective(p.headPerspective),
    inspectionBackground:parseInspectionBackground(p.inspectionBackground),
    curves: [],
    centerlineOrder: repairCenterlineOrder(p.landmarks, p.centerlineOrder),
    lockedViews:
      p.lockedViews ??
      p.views
        .filter((v) => p.landmarks.some((l) => l.viewLocks[v.id]))
        .map((v) => v.id),
    meta: p.meta,
    viewsCustomized: p.viewsCustomized === true,
    views: (p.viewsCustomized === true ? (views: LandmarkProject["views"])=>views : ensureObliqueViews)(
      p.views.map((v) => ({
        id: v.id,
        label: v.label,
        shortLabel: v.shortLabel,
        camera: v.camera,
        canvas: v.canvas,
        reference: v.reference,
      })),
    ),
    landmarks: p.landmarks.map((l) => ({
      id: l.id,
      name: l.name,systemRole:l.systemRole,
      placement: {...offsetFields(l.placement),... (l.placement.kind==='CHIN_SURFACE'?{kind:'CHIN_SURFACE' as const,direction:[...l.placement.direction] as Vec3}:l.placement.kind==='EYE_LOCAL'?{kind:'EYE_LOCAL' as const,side:l.placement.side,local:l.placement.local}:l.placement.kind==='ON_PATCH'?{kind:'ON_PATCH' as const,hostPatchId:l.placement.hostPatchId,u:l.placement.u,v:l.placement.v}:l.placement.kind==='LOOMIS_SCAFFOLD'?{kind:'LOOMIS_SCAFFOLD' as const,role:l.placement.role}:l.placement.kind==='ON_SECTION_CAP'?{kind:'ON_SECTION_CAP' as const,hostSurfaceId:l.placement.hostSurfaceId,u:l.placement.u,v:l.placement.v}:l.placement.kind==='ON_LOOMIS_SURFACE'?{kind:'ON_LOOMIS_SURFACE' as const,hostFrameId:'head' as const,direction:l.placement.direction}:l.placement.kind!=='ON_CURVE'?(l.placement.kind==='WORLD'?{kind:'WORLD' as const,position:l.placement.position}:{kind:'FRAME_RELATIVE' as const,position:l.placement.position}):l.placement.role==='canonical'?{kind:'ON_CURVE' as const,role:'canonical' as const,hostCurveId:l.placement.hostCurveId,s:l.placement.s,...(l.placement.ringEndpoint?{ringEndpoint:true as const}:{})}:{kind:'ON_CURVE' as const,role:'mirror' as const,hostCurveId:l.placement.hostCurveId,canonicalPointId:l.placement.canonicalPointId})},
      type: l.type,
      mirrorPartnerId: l.mirrorPartnerId,
      viewLocks: l.viewLocks,
    })),
  };
  if(p.gazeEyeball!==undefined){result.gazeEyeball=parseGaze(p.gazeEyeball);check(!!p.eyeScaffold);}
  if(p.eyeScaffold!==undefined)result.eyeScaffold=parseEyeScaffold(p.eyeScaffold);
  if(result.eyeScaffold)for(const side of ['left','right'] as const){const e=result.eyeScaffold[side];check((result.eyeScaffold.coord?e.pointIds.slice(8):e.pointIds).every(id=>result.landmarks.some(l=>l.id===id&&l.type==='FREE')));check((result.eyeScaffold.coord?e.curveIds.slice(12):e.curveIds).every(id=>p.curves.some(c=>c.id===id)));}
  // Old files may contain both observations. Migrate each pair to one driver;
  // never retain the reflected partner as a second independent constraint.
  for (const l of result.landmarks)
    if (l.type === "RIGHT") {
      const partner = result.landmarks.find((x) => x.id === l.mirrorPartnerId);
      if (
        Object.keys(l.viewLocks).length &&
        partner &&
        Object.keys(partner.viewLocks).length
      )
        result = activateDriver(result, l.id);
    }
  result.curves = parseCurves(p.curves, result, false);
  if(result.chinScaffold)result=ensureChin(result);
  if(p.loomisRegions!==undefined)result.loomisRegions=parseRegions(p.loomisRegions,result);
  if(p.loomisCaps!==undefined)result.loomisCaps=parseCaps(p.loomisCaps,result);
  if(p.loomisLocks!==undefined){check(Array.isArray(p.loomisLocks)&&p.loomisLocks.every((id:unknown)=>typeof id==='string'));result.loomisLocks=[...new Set(p.loomisLocks.filter((id:string)=>loomisObjects(result).has(id)).flatMap((id:string)=>lockPair(result,id)))];}
  const beforeScaffold=result;
  if(result.loomisScaffold)result=ensureScaffold(result);
  if(p.patches!==undefined)result.patches=parsePatches(p.patches,result,false);
  if(p.surfaceContinuity!==undefined)result.surfaceContinuity=p.surfaceContinuity;
  if(p.curveSmoothJoins!==undefined)result.curveSmoothJoins=parseJoins(p.curveSmoothJoins,result);
  // Leveling an old sagged Rim moves hosted points. Transport legacy planar
  // curves before geometry validation, through the normal dependency path.
  if(beforeScaffold.loomisScaffold?.rimSag)result=followEndpoints({...result,curves:beforeScaffold.curves,landmarks:beforeScaffold.landmarks,loomisScaffold:beforeScaffold.loomisScaffold},result);
  dependencyGraph(result);
  validatePlacements(result);
  result.curves = parseCurves(result.curves, result);
  if(p.patches !== undefined || p.version === "landmarks-0.4.0" || p.version === "landmarks-0.4.1" || p.version === "landmarks-0.4.2") { result.patches = parsePatches(p.patches, result); result.version=p.version==="landmarks-0.4.2"?"landmarks-0.4.2":p.version==="landmarks-0.4.1"?"landmarks-0.4.1":"landmarks-0.4.0"; }
  if(p.patchDisplay !== undefined) {
    check(p.patchDisplay && [p.patchDisplay.opacity2d,p.patchDisplay.opacity3d].every(x=>finite(x)&&x>=0&&x<=1));
    check(p.patchDisplay.visible===undefined || typeof p.patchDisplay.visible==='boolean');
    check(p.patchDisplay.quality===undefined || p.patchDisplay.quality==='ultra' || Object.hasOwn(patchQualityLevels,p.patchDisplay.quality));
    result.patchDisplay={...defaultDisplay,...(p.patchDisplay.quality===undefined?{}:{quality:p.patchDisplay.quality==='ultra'?'high':p.patchDisplay.quality}),...(p.patchDisplay.visible===undefined?{}:{visible:p.patchDisplay.visible}),opacity2d:p.patchDisplay.opacity2d,opacity3d:p.patchDisplay.opacity3d};
  }
  if(p.surfaceSmooth!==undefined||p.version==="landmarks-0.4.2")result.surfaceSmooth=parseSmooth(p.surfaceSmooth,result);
  // Retire old point/curve recordings, including malformed legacy records.
  delete result.recording;
  if(p.poseRecording!==undefined)result.poseRecording=parsePoseRecording(p.poseRecording);
  delete result.hairstyle; // Retired workspace: never retain baked textures or duplicate hair documents.
  if(p.assembly!==undefined)result.assembly=parseAssembly(p.assembly);
  if(p.drawing!==undefined)result.drawing=parseDrawing(p.drawing);
  if(p.drawingSnapshots!==undefined)result.drawingSnapshots=parseDrawingSnapshots(p.drawingSnapshots);
  Object.assign(result,upgradeAppliedInferenceInk(result));
  if(result.poseRecording)result.poseRecording=syncPoseSnapshots(result.poseRecording,result.drawingSnapshots);
  if(p.geometryModules!==undefined){check(!!p.geometryModules&&typeof p.geometryModules==='object'&&!Array.isArray(p.geometryModules));check(Object.values(p.geometryModules).every(x=>x==='HEADSET'||x==='EYES'));result.geometryModules={...p.geometryModules};}
  const final=migrateHeadFrame(migrateContinuity(result,p.surfaceContinuity));dependencyGraph(final);validateOnPatch(final);return migrateChinNode(migrateFree3D(assignModules(repairCurveNames(rebuildEyeScaffold(migrateEyeCoord(final))))));
}
