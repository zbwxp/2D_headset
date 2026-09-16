import type { LandmarkView } from "./model";

/** Add missing presets without replacing authored cameras, photos, or canvas settings. */
export function ensureObliqueViews(views: LandmarkView[]): LandmarkView[] {
  const result = views.map(v=>{
    const pitch=v.id==='high45'&&v.label==='俯 45°'?30:v.id==='low45'&&v.label==='仰 45°'?-15:null;
    if(pitch===null)return v;
    const next=customView(pitch>0?'俯 30°':'仰 15°',0,pitch,v.id);
    return {...v,label:next.label,shortLabel:next.shortLabel,camera:next.camera};
  });
  for (const degrees of [-30, 15, 30]) {
    const side = degrees < 0 ? "left" : "right",
      label = degrees < 0 ? "左" : "右";
    const id = `${side}${Math.abs(degrees)}`;
    if (result.some((v) => v.id === id)) continue;
    const angle = (degrees * Math.PI) / 180;
    const view: LandmarkView = {
      id,
      label: `${label} ${Math.abs(degrees)}°`,
      shortLabel: `${label} ${Math.abs(degrees)}°`,
      camera: {
        projection: "orthographic",
        position: [4 * Math.sin(angle), 0, 4 * Math.cos(angle)],
        target: [0, 0, 0],
        up: [0, 1, 0],
        zoom: 1,
      },
      canvas: { zoom: 1, pan: [0, 0] },
    };
    const index = result.findIndex((v) => v.id === `${side}45`);
    result.splice(index < 0 ? result.length : index, 0, view);
  }
  if (!result.some((v) => v.id === "top")) {
    const view: LandmarkView = {
      id: "top",
      label: "纯俯视",
      shortLabel: "俯视",
      camera: {
        projection: "orthographic",
        position: [0, 4, 0],
        target: [0, 0, 0],
        // Keep world X screen-right; the face (+Z) points down the screen.
        up: [0, 0, -1],
        zoom: 1,
      },
      canvas: { zoom: 1, pan: [0, 0] },
    };
    const index = result.findIndex((v) => v.id === "high45");
    result.splice(index < 0 ? result.length : index + 1, 0, view);
  }
  return result;
}

/** Yaw positive: right; pitch positive: above. Stable up even at the poles. */
export function customView(name:string,yaw:number,pitch:number,id:string=crypto.randomUUID()):LandmarkView{
 if(!Number.isFinite(yaw)||!Number.isFinite(pitch)||Math.abs(yaw)>180||Math.abs(pitch)>90)throw Error('水平角范围 -180～180°，俯仰角范围 -90～90°');
 const y=yaw*Math.PI/180,p=pitch*Math.PI/180,label=name.trim()||`自定义 ${yaw}° / ${pitch}°`;
 if(label.length>40)throw Error('视角名称最多 40 个字符');
 return {id,label,shortLabel:label,camera:{projection:'orthographic',position:[4*Math.sin(y)*Math.cos(p),4*Math.sin(p),4*Math.cos(y)*Math.cos(p)],target:[0,0,0],up:[-Math.sin(y)*Math.sin(p),Math.cos(p),-Math.cos(y)*Math.sin(p)],zoom:1},canvas:{zoom:1,pan:[0,0]}};
}
