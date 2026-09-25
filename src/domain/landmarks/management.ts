import {spatialPlacement} from '../head/frame';
import {pointPosition} from '../geometry/evaluation';
import {deleteClosure} from "../geometry/dependencies";
import type { LandmarkProject, SemanticLandmark } from "./model";
import { captureLock, viewIsLocked } from "./model";

function nameInput(value: string) {
  const name = value.trim();
  if (!name) throw new Error("请输入名称。");
  if (name.length > 80) throw new Error("名称请不超过 80 个字符。");
  return name;
}
export function landmarkBaseName(l: SemanticLandmark) {
  return l.type === "LEFT" || l.type === "RIGHT"
    ? l.name.replace(/^[左右]/, "")
    : l.name;
}
export function duplicateLandmark(
  p: LandmarkProject,
  id: string,
  value: string,
): { project: LandmarkProject; selectedId: string } {
  const source = p.landmarks.find((l) => l.id === id);
  if (!source) throw new Error("请先选择要复制的点。");
  const name = nameInput(value),
    partner = p.landmarks.find((l) => l.id === source.mirrorPartnerId);
  const copy = (l: SemanticLandmark): SemanticLandmark => ({
    id: crypto.randomUUID(),
    name: partner ? (l.type === "LEFT" ? "左" : "右") + name : name,
    placement: (l.placement.kind==='CHIN_SURFACE'||l.placement.kind==='LOOMIS_SCAFFOLD'||(l.placement.kind==='ON_CURVE'&&l.placement.role==='canonical'&&l.placement.ringEndpoint))?spatialPlacement(p,pointPosition(p,l.id)):structuredClone(l.placement),
    type: l.type,
    viewLocks: {},
  });
  const driver = copy(source),
    follower = partner ? copy(partner) : undefined;
  if (follower) {
    driver.mirrorPartnerId = follower.id;
    follower.mirrorPartnerId = driver.id;
  }
  if(follower&&driver.placement.kind==="ON_CURVE"&&follower.placement.kind==="ON_CURVE"){
    if(driver.placement.role==="mirror")driver.placement.canonicalPointId=follower.id;
    if(follower.placement.role==="mirror")follower.placement.canonicalPointId=driver.id;
  }
  for (const v of p.views)
    if (driver.placement.kind!=="ON_CURVE" && driver.placement.kind!=="ON_LOOMIS_SURFACE"&&driver.placement.kind!=="ON_SECTION_CAP"&&driver.placement.kind!=="LOOMIS_SCAFFOLD" && viewIsLocked(p, v.id))
      driver.viewLocks[v.id] = captureLock(pointPosition(p,source.id), v);
  const added = follower
    ? [driver, follower].sort((a, b) =>
        a.type === "LEFT" ? -1 : b.type === "LEFT" ? 1 : 0,
      )
    : [driver];
  return {
    project: {
      ...p,
      landmarks: [...p.landmarks, ...added],
      centerlineOrder:
        source.type === "CENTERLINE" && source.placement.kind!=="ON_CURVE"
          ? p.centerlineOrder.flatMap((id) =>
              id === source.id ? [id, driver.id] : [id],
            )
          : p.centerlineOrder,
    },
    selectedId: driver.id,
  };
}
export function renameLandmark(
  p: LandmarkProject,
  id: string,
  value: string,
): LandmarkProject {
  const source = p.landmarks.find((l) => l.id === id);
  if (!source) throw new Error("请先选择要重命名的点。");
  const name = nameInput(value);
  return {
    ...p,
    landmarks: p.landmarks.map((l) =>
      l.id === id || l.id === source.mirrorPartnerId
        ? {
            ...l,
            name: source.mirrorPartnerId
              ? (l.type === "LEFT" ? "左" : "右") + name
              : name,
          }
        : l,
    ),
  };
}
export function deleteLandmark(
  p: LandmarkProject,
  id: string,
): LandmarkProject {
  return deleteClosure(p,[`point:${id}`]);
}

/** Create ordinary editable points without requiring a duplicate source. */
export function addDefaultLandmark(p:LandmarkProject,centerline:boolean):{project:LandmarkProject;selectedId:string}{
 const base=centerline?'默认中线点':'默认对称点';let n=1;
 while(p.landmarks.some(l=>landmarkBaseName(l)===base+' '+n))n++;
 const id=crypto.randomUUID(),partnerId=crypto.randomUUID();
 const make=(id:string,x:number,type:SemanticLandmark['type']):SemanticLandmark=>({
  id,name:(centerline?'':type==='RIGHT'?'右':'左')+base+' '+n,type,
  placement:{kind:p.headFrame?'FRAME_RELATIVE':'WORLD',position:[x,0,centerline?.85:.75]},viewLocks:{},
 });
 const driver=make(id,centerline?0:.45,centerline?'CENTERLINE':'RIGHT');
 const added=[driver];if(!centerline){const partner=make(partnerId,-.45,'LEFT');driver.mirrorPartnerId=partnerId;partner.mirrorPartnerId=id;added.push(partner);}
 const project={...p,landmarks:[...p.landmarks,...added],centerlineOrder:centerline?[...p.centerlineOrder,id]:p.centerlineOrder};
 for(const v of p.views)if(viewIsLocked(p,v.id))driver.viewLocks[v.id]=captureLock(pointPosition(project,id),v);
 return {project,selectedId:id};
}
