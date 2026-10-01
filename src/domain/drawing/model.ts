import {resolveDisplayRoute,type DisplayRoute} from './displayRoutes';
import {tagCurve} from './curveProvenance';
import type {Point2,Cubic} from '../recording/model';
import type {ReferenceImage} from '../project/types';
import {validateRecordingReference} from '../recording/reference';
import {drawingItemById} from './lookup';
export type {Point2,Cubic};
export type End=0|1;
/** A real, movable Bézier end attached to a canonical node and handle. */
export interface GeometryEndpoint {curveId:string;end:End}
/** Compatibility name. This NEVER refers to a display cut or rendered ink terminus. */
export type Endpoint=GeometryEndpoint;
/** Position coupling only. Nodes, strokes, ink styles and layer ownership stay separate. */
export interface GeometryEndpointLink {id:string;a:GeometryEndpoint;b:GeometryEndpoint;/** Explicit display-only routing opt-in. Legacy links remain position-only. */throughDisplay?:boolean;joinBrush?:TerminusJoinBrush}
/** Serialized a/b shape is retained; no dataset migration is needed. */
export type EndpointLink=GeometryEndpointLink;
export interface DrawingNode {id:string;position:Point2}
export type Profile='UNIFORM'|'TAPER_END'|'TAPER_BOTH'|'EYELID';
export interface InkStyle {profile?:Profile;profileReverse?:boolean}
/** Ink-edge appearance only. Untagged values are legacy additive mist settings. */
export interface ContourMist {enabled:boolean;width:number;density:number;mode?:'INK_EDGE'}
export const MAX_CONTOUR_MIST_DENSITY=1;
export interface MistAppearance {mist?:ContourMist}
export const DEFAULT_CONTOUR_MIST:ContourMist={mode:'INK_EDGE',enabled:false,width:1.25/250,density:.75};
export const validContourMist=(v:unknown):boolean=>{
 if(v===undefined)return true;if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const m=v as ContourMist;
 return (m.mode===undefined||m.mode==='INK_EDGE')&&typeof m.enabled==='boolean'&&Number.isFinite(m.width)&&m.width>=.25/250&&m.width<=(m.mode?3:60)/250&&Number.isFinite(m.density)&&m.density>=0&&m.density<=(m.mode?1:5);
};
/** Ink only. Distances use the same logical units as curve width; absent taper uses the preset. */
export interface TerminusBrushStyle {taper?:number;taperWidthScale?:number;extension?:number;/** Explicit opt-in at an interior join; legacy outer-end defaults never activate it. */interior?:boolean}
/** Compatibility type for the existing inkEnds JSON field. Appearance only. */
export type InkEndStyle=TerminusBrushStyle;
export const inkTaperDistance=(end:InkEndStyle,width:number,fallback=0)=>end.taper??(end.taperWidthScale!==undefined?end.taperWidthScale*width:fallback);
export type TerminusBrushPair=[TerminusBrushStyle,TerminusBrushStyle];
export type InkEnds=TerminusBrushPair;
/** A coverage boundary is an arc-location reference, never a movable geometry node. */
export interface DisplayIntervalBoundary {trackId:string;rangeId:string;side:0|1}
/** Read-only render output. No node, curve-end edit command or binding behavior. */
export interface ResolvedVisibleTerminus {kind:'VISIBLE_TERMINUS';support:Point2;point:Point2;direction:Point2;brush:TerminusBrushStyle}
/** ARC trimDistance is per-side trim influence, not a fixed circular radius. */
export type TerminusJoinBrush={kind:'SHARP'}|{kind:'SMOOTH'}|{kind:'ARC';trimDistance:number};
export const DEFAULT_PEN_TAPER_SCALE=20;
export const MAX_PEN_TAPER_SCALE=200;
export interface CurveUse {id:string;reverse:boolean}
export type DisplayIntervalMode='SHOW'|'HIDE';
/** Missing mode is the legacy SHOW interval. HIDE subtracts ink, never fill. */
export interface DisplayInterval {id:string;/** Original authored range when routing splits its coverage. */originId?:string;/** Optional author-facing range label. */name?:string;start:number;end:number;inkEnds?:InkEnds;mode?:DisplayIntervalMode;/** Omitted in legacy files means enabled. Explicit values can be held by angle keys. */enabled?:boolean}
/** Appearance attached to a derived continuous path; the anchor stabilizes direction/origin. */
export interface StrokeDisplayIntervals {id:string;anchor:CurveUse;ranges:DisplayInterval[];/** Explicit captured display traversal; never changes local strokes or fills. */displayRoute?:DisplayRoute;/** Local arc length on just the anchor curve, independent of the surrounding stroke. */scope?:'CURVE';/** Physical end from which missing-view ink is revealed; chosen once. */revealFrom?:End;/** Inferred cuts copied source endpoint ink; prevents reapplying the legacy fix. */inferenceInkVersion?:1}
/** A boundary-following Gaussian band, not a blur of the solid interior. */
export interface FillMist {enabled:boolean;side:'INSIDE'|'OUTSIDE'|'BOTH';width:number;opacity:number}
export const DEFAULT_FILL_MIST:FillMist={enabled:true,side:'INSIDE',width:12/250,opacity:.65};
export const validFillMist=(v:unknown):boolean=>v===undefined||!!v&&typeof v==='object'&&!Array.isArray(v)&&typeof (v as FillMist).enabled==='boolean'&&['INSIDE','OUTSIDE','BOTH'].includes((v as FillMist).side)&&Number.isFinite((v as FillMist).width)&&(v as FillMist).width>=.25/250&&(v as FillMist).width<=200/250&&Number.isFinite((v as FillMist).opacity)&&(v as FillMist).opacity>=0&&(v as FillMist).opacity<=1;
export interface FillRegion {id:string;name:string;visible:boolean;locked:boolean;/** transparent cuts all solid/mist fills in its own layer, preserving strokes. */color:'white'|'black'|'transparent';mist?:FillMist;boundary:CurveUse[];/** Legacy V2 field, flattened into visible on load. */hiddenWithStroke?:boolean}
export interface OffsetRelation extends InkStyle,MistAppearance {id:string;name:string;visible:boolean;locked:boolean;source:CurveUse[];distance:number;start:number;end:number;taper:number;width:number;inkEnds?:InkEnds;/** Optional placement after deriving the offset; source remains editable. */translation?:Point2}
export interface DrawingCurve extends InkStyle,MistAppearance {/** Relative paint position only; ownership/topology never changes. */depthOffset?:number;depthScope?:'PARENT'|'LAYER';localPaintOrder?:boolean;id:string;name:string;/** Optional connected-group label, copied to members; geometry membership remains derived. */strokeName?:string;nodes:[string,string];handles:[Point2,Point2];visible:boolean;locked:boolean;width:number;inkVisible?:boolean;inkEnds?:InkEnds}
/** visible/locked are legacy neutral fields, not inherited gates. Top first. Ownership and ordering have one source: the layer's ordered object IDs. */
export interface DrawingLayer {id:string;name:string;visible:boolean;locked:boolean;items:string[]}
/** Organizational group only; visible/locked are legacy neutral fields. Member flags are authoritative. */
export interface DrawingGroup {id:string;name:string;visible:boolean;locked:boolean;curveIds:string[]}
/** ARC radius is the requested trim distance on each source, not a fixed circle radius. */
export interface TangentJoin {id:string;a:Endpoint;b:Endpoint;mode:'SMOOTH'|'CUSP'|'ARC';radius?:number}
/** V3: only member flags affect rendering/editing. Container flags are retired (neutral on save). */
export interface DrawingDocument {version:3;fills:FillRegion[];offsets:OffsetRelation[];layers:DrawingLayer[];curves:DrawingCurve[];nodes:DrawingNode[];joins:TangentJoin[];reference?:ReferenceImage;mirrorAxisX?:number;displayIntervals?:StrokeDisplayIntervals[];endpointLinks?:EndpointLink[];groups?:DrawingGroup[]}
export const emptyDrawing=():DrawingDocument=>({version:3,fills:[],offsets:[],layers:[],curves:[],nodes:[],joins:[]});
export const endKey=(e:Endpoint)=>`${e.curveId}:${e.end}`;
export const sameEnd=(a:Endpoint,b:Endpoint)=>a.curveId===b.curveId&&a.end===b.end;
export const curveById=(d:DrawingDocument,id:string)=>drawingItemById(d.curves,id)!;
export const layerFor=(d:DrawingDocument,id:string)=>d.layers.find(l=>l.items.includes(id));
export const nodeAt=(d:DrawingDocument,e:Endpoint)=>drawingItemById(d.nodes,curveById(d,e.curveId).nodes[e.end])!;
export const shapeOf=(d:DrawingDocument,id:string):Cubic=>{const c=curveById(d,id);return tagCurve([nodeAt(d,{curveId:id,end:0}).position,c.handles[0],c.handles[1],nodeAt(d,{curveId:id,end:1}).position],id);};
export const members=(d:DrawingDocument,nodeId:string):Endpoint[]=>d.curves.flatMap(c=>([0,1] as const).filter(e=>c.nodes[e]===nodeId).map(end=>({curveId:c.id,end})));
/** A branch can be an evaluator path end without being an exposed physical end. */
export const boundEndpoint=(d:DrawingDocument,e:Endpoint)=>{const id=nodeAt(d,e).id;return members(d,id).length>1||(d.endpointLinks??[]).some(l=>nodeAt(d,l.a).id===id||nodeAt(d,l.b).id===id);};
export const joinAt=(d:DrawingDocument,e:Endpoint)=>d.joins.find(j=>sameEnd(j.a,e)||sameEnd(j.b,e));
export const objectById=(d:DrawingDocument,id:string)=>curveById(d,id)??d.fills.find(x=>x.id===id)??d.offsets.find(x=>x.id===id);
export const groupFor=(d:DrawingDocument,id:string)=>{const direct=d.groups?.find(g=>g.curveIds.includes(id));if(direct)return direct;const f=d.fills.find(f=>f.id===id);return f&&d.groups?.find(g=>f.boundary.length&&f.boundary.every(e=>g.curveIds.includes(e.id))&&layerFor(d,g.curveIds[0])?.id===layerFor(d,id)?.id);};
export const objectVisible=(d:DrawingDocument,id:string)=>!!objectById(d,id)?.visible;
export const visible=(d:DrawingDocument,id:string)=>!!curveById(d,id)?.visible;
export const editable=(d:DrawingDocument,id:string)=>visible(d,id)&&!curveById(d,id).locked;
export const uid=()=>crypto.randomUUID();
export const add=(a:Point2,b:Point2):Point2=>[a[0]+b[0],a[1]+b[1]];
export const sub=(a:Point2,b:Point2):Point2=>[a[0]-b[0],a[1]-b[1]];
export const mul=(a:Point2,s:number):Point2=>[a[0]*s,a[1]*s];
export const length=(a:Point2)=>Math.hypot(...a);
export const rotate=(p:Point2,degrees:number):Point2=>{const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [p[0]*c-p[1]*s,p[0]*s+p[1]*c];};
export const finitePoint=(p:unknown):p is Point2=>Array.isArray(p)&&p.length===2&&p.every(x=>typeof x==='number'&&Number.isFinite(x));
export const validInkEnds=(v:unknown):boolean=>v===undefined||Array.isArray(v)&&v.length===2&&v.every(e=>e&&typeof e==='object'&&!Array.isArray(e)&&(e.interior===undefined||typeof e.interior==='boolean')&&[[e.taper,20],[e.extension,2],[e.taperWidthScale,200]].every(([x,max])=>x===undefined||typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=max));
export function parseDrawing(value:unknown):DrawingDocument{
 const raw=value as any;
 // V1 layers held only curves. V2 has one ordered object list, not parallel z-order fields.
 if(raw?.version===1&&Array.isArray(raw.layers))value={...raw,version:2,fills:[],offsets:[],layers:raw.layers.map((l:any)=>{const {curves,...rest}=l??{};return {...rest,items:curves};})};
 const d=value as DrawingDocument,fail=()=>{throw Error('绘制间数据无效');};
 if(!d||![2,3].includes(d.version)||![d.layers,d.curves,d.nodes,d.joins,d.fills,d.offsets].every(Array.isArray))return fail();
 const ids=new Set<string>(),owners=new Map<string,string>();
 const id=(x:string)=>{if(typeof x!=='string'||!x||ids.has(x))fail();ids.add(x);};
 const named=(x:{id:string;name:string;visible:boolean;locked:boolean})=>{if(!x)fail();id(x.id);if(typeof x.name!=='string'||!x.name.trim()||typeof x.visible!=='boolean'||typeof x.locked!=='boolean')fail();};
 for(const n of d.nodes){if(!n)fail();id(n.id);if(!finitePoint(n.position))fail();}
 for(const c of d.curves){named(c);if(!Array.isArray(c.nodes)||c.nodes.length!==2||!c.nodes.every(n=>d.nodes.some(x=>x.id===n))||!Array.isArray(c.handles)||c.handles.length!==2||!c.handles.every(finitePoint)||!Number.isFinite(c.width)||c.width<=0||c.width>1)fail();}
 const style=(x:InkStyle)=>{if(x.profile!==undefined&&!['UNIFORM','TAPER_END','TAPER_BOTH','EYELID'].includes(x.profile)||x.profileReverse!==undefined&&typeof x.profileReverse!=='boolean')fail();};
 const uses=(xs:CurveUse[])=>{if(!Array.isArray(xs)||!xs.length||xs.some(x=>!x||typeof x.id!=='string'||!x.id||typeof x.reverse!=='boolean')||new Set(xs.map(x=>x.id)).size!==xs.length)fail();};
 for(const c of d.curves){style(c);if(c.depthOffset!==undefined&&(!Number.isSafeInteger(c.depthOffset)||Math.abs(c.depthOffset)>10000)||c.depthScope!==undefined&&!['PARENT','LAYER'].includes(c.depthScope)||c.localPaintOrder!==undefined&&typeof c.localPaintOrder!=='boolean')fail();if(c.strokeName!==undefined&&(typeof c.strokeName!=='string'||!c.strokeName.trim()))fail();if(!validContourMist(c.mist)||!validInkEnds(c.inkEnds)||c.inkVisible!==undefined&&typeof c.inkVisible!=='boolean')fail();}
 for(const f of d.fills){named(f);uses(f.boundary);if(!['white','black','transparent'].includes(f.color)||!validFillMist(f.mist)||f.color==='transparent'&&f.mist?.enabled||f.hiddenWithStroke!==undefined&&typeof f.hiddenWithStroke!=='boolean')fail();}
 for(const o of d.offsets){named(o);uses(o.source);style(o);if(!validContourMist(o.mist)||o.translation!==undefined&&!finitePoint(o.translation)||!validInkEnds(o.inkEnds)||![o.distance,o.start,o.end,o.taper,o.width].every(Number.isFinite)||Math.abs(o.distance)>2||o.start<0||o.end>1||o.end<=o.start||o.taper<0||o.taper>.5||o.width<=0||o.width>1)fail();}
 for(const l of d.layers){named(l);if(!Array.isArray(l.items))fail();for(const c of l.items){if(owners.has(c)||!objectById(d,c))fail();owners.set(c,l.id);}}
 if(owners.size!==d.curves.length+d.fills.length+d.offsets.length)fail();
 if(d.groups!==undefined){
  if(!Array.isArray(d.groups))return fail();const grouped=new Map<string,string>();
  for(const g of d.groups){named(g);if(!Array.isArray(g.curveIds)||!g.curveIds.length)return fail();const layer=owners.get(g.curveIds[0]);
   for(const cid of g.curveIds){if(!curveById(d,cid)||grouped.has(cid)||owners.get(cid)!==layer)return fail();grouped.set(cid,g.id);}
  }
  // A continuous stroke cannot straddle organizational groups.
  for(const n of d.nodes){const gs=new Set(members(d,n.id).map(e=>grouped.get(e.curveId)));if(gs.size>1)return fail();}
 }
 for(const n of d.nodes){const group=members(d,n.id);if(!group.length||new Set(group.map(e=>owners.get(e.curveId))).size!==1)fail();}
 const paired=new Set<string>();
 for(const j of d.joins){if(!j)fail();id(j.id);if(!['SMOOTH','CUSP','ARC'].includes(j.mode))fail();if(j.mode==='ARC'&&(!Number.isFinite(j.radius)||j.radius!<=0||j.radius!>2))fail();
  const legacyAngle=(j as TangentJoin&{angle?:number}).angle;if(legacyAngle!==undefined&&(j.mode!=='CUSP'||!Number.isFinite(legacyAngle)||Math.abs(legacyAngle)>90))fail();
  for(const e of [j.a,j.b]){if(!e||!d.curves.some(c=>c.id===e.curveId)||![0,1].includes(e.end)||paired.has(endKey(e)))fail();paired.add(endKey(e));}
  if(nodeAt(d,j.a).id!==nodeAt(d,j.b).id)fail();
  const a=sub(curveById(d,j.a.curveId).handles[j.a.end],nodeAt(d,j.a).position),b=sub(curveById(d,j.b.curveId).handles[j.b.end],nodeAt(d,j.b).position),den=length(a)*length(b);
  const expected=mul(a,-1);
  if(j.mode!=='CUSP'&&den<1e-14||j.mode==='SMOOTH'&&length(sub(mul(expected,1/length(a)),mul(b,1/length(b))))>1e-6||curveById(d,j.a.curveId).width!==curveById(d,j.b.curveId).width||(curveById(d,j.a.curveId).profile??'UNIFORM')!==(curveById(d,j.b.curveId).profile??'UNIFORM')||!!curveById(d,j.a.curveId).profileReverse!==!!curveById(d,j.b.curveId).profileReverse)fail();
 }
 if(d.mirrorAxisX!==undefined&&!Number.isFinite(d.mirrorAxisX))fail();
 if(d.endpointLinks!==undefined){
  if(!Array.isArray(d.endpointLinks))return fail();const pairs=new Set<string>();
  for(const link of d.endpointLinks){if(!link)return fail();id(link.id);
   if(link.throughDisplay!==undefined&&typeof link.throughDisplay!=='boolean')return fail();
   if(link.joinBrush!==undefined){const b=link.joinBrush;if(!b||!['SHARP','SMOOTH','ARC'].includes(b.kind)||b.kind==='ARC'&&(!Number.isFinite(b.trimDistance)||b.trimDistance<=0||b.trimDistance>2))return fail();}
   for(const e of [link.a,link.b])if(!e||!curveById(d,e.curveId)||![0,1].includes(e.end))return fail();
   const a=nodeAt(d,link.a),b=nodeAt(d,link.b),key=[a.id,b.id].sort().join(':');
   if(a.id===b.id||pairs.has(key)||length(sub(a.position,b.position))>1e-7)return fail();pairs.add(key);
  }
 }
 if(d.displayIntervals!==undefined){
  if(!Array.isArray(d.displayIntervals))return fail();
  for(const track of d.displayIntervals){if(!track)return fail();id(track.id);if(!track.anchor||!curveById(d,track.anchor.id)||typeof track.anchor.reverse!=='boolean'||!Array.isArray(track.ranges)||!track.ranges.length)return fail();
   if(track.scope!==undefined&&track.scope!=='CURVE'||track.revealFrom!==undefined&&(track.scope!=='CURVE'||![0,1].includes(track.revealFrom)))return fail();
   if(track.displayRoute!==undefined){const r=track.displayRoute;if(track.scope==='CURVE'||!r||!r.seed||typeof r.seed.closed!=='boolean'||!Array.isArray(r.seed.segments)||!r.seed.segments.length||r.seed.segments.some(u=>!u||!curveById(d,u.id)||typeof u.reverse!=='boolean')||new Set(r.seed.segments.map(u=>u.id)).size!==r.seed.segments.length||!Array.isArray(r.throughLinkIds)||!r.throughLinkIds.length||r.throughLinkIds.some(id=>!d.endpointLinks?.some(l=>l.id===id&&l.throughDisplay===true))||new Set(r.throughLinkIds).size!==r.throughLinkIds.length)return fail();}
   if(track.displayRoute){const resolved=resolveDisplayRoute(d,track.displayRoute);if(resolved.diagnostics.length)return fail();const curves=resolved.path.segments.map(u=>curveById(d,u.id));if(curves.some(c=>Math.abs(c.width-curves[0].width)>1e-10||(c.profile??'UNIFORM')!=='UNIFORM'||c.inkEnds?.some(e=>e.interior)))return fail();}
   if(track.inferenceInkVersion!==undefined&&(track.inferenceInkVersion!==1||track.scope!=='CURVE'))return fail();
   for(const r of track.ranges){if(!r)return fail();id(r.id);if(r.originId!==undefined&&(typeof r.originId!=='string'||!r.originId)||r.name!==undefined&&(typeof r.name!=='string'||r.name.length>256))return fail();if(r.mode!==undefined&&!['SHOW','HIDE'].includes(r.mode)||r.enabled!==undefined&&typeof r.enabled!=='boolean')return fail();if(![r.start,r.end].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1)||!validInkEnds(r.inkEnds))return fail();}
  }
 }
 validateRecordingReference(d.reference);
 const result=structuredClone(d);
 // Flatten V1/V2 inherited states once, preserving the old visible/locked result.
 // V3 reload must never reapply a past container action over a member override.
 if(d.version!==3)for(const object of [...result.curves,...result.fills,...result.offsets]){
  const layer=layerFor(d,object.id),group=groupFor(d,object.id);
  object.visible=object.visible&&layer?.visible!==false&&group?.visible!==false;
  object.locked=object.locked||!!layer?.locked||!!group?.locked;
 }
 for(const fill of result.fills){if(fill.hiddenWithStroke)fill.visible=false;delete fill.hiddenWithStroke;}
 for(const container of [...result.layers,...(result.groups??[])]){container.visible=true;container.locked=false;}
 result.version=3;
 // Legacy CUSP angles affected authoring geometry. Preserve that geometry, retire the constraint.
 for(const j of result.joins)delete (j as TangentJoin&{angle?:number}).angle;
 return result;
}
