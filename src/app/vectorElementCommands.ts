/** Remaining source element commands; no raw document replacement or endpoint binding. */
import {curveById,objectById,type DrawingDocument,type Point2,type ContourMist,type Profile} from '../domain/drawing/model';
import {createOffset,changePaint,detachOffset,movePaint,setInk} from '../domain/drawing/paintCommands';
import {createGroup,changeGroup,ungroup,groupToLayer} from '../domain/drawing/groups';
import {reorderCurveMember} from '../domain/drawing/depth';
import {strokeFor} from '../domain/drawing/strokes';
import {setContourMist} from '../domain/drawing/mist';
import {setObjectState} from '../domain/drawing/objectState';
import {duplicateArtworkObjects,ObjectDuplicateError} from '../domain/drawing/duplicateArtworkObjects';

export type ElementCommand=
 | {op:'duplicateObjects';objectIds:string[];targetLayerId?:string;includeDependencies?:boolean;ref?:string}
 | {op:'reorderCurveMember';curveId:string;targetCurveId:string;after?:boolean}
 | {op:'movePaint';objectId:string;layerId:string}
 | {op:'createOffset';curveId:string;ref?:string}
 | {op:'setOffset';offsetId:string;name?:string;visible?:boolean;locked?:boolean;distance?:number;start?:number;end?:number;taper?:number;width?:number;translation?:Point2;profile?:Profile;profileReverse?:boolean}
 | {op:'detachOffset';offsetId:string;ref?:string}
 | {op:'createGroup';curveIds:string[];name?:string;ref?:string}
 | {op:'setGroup';groupId:string;name?:string;visible?:boolean;locked?:boolean}
 | {op:'ungroup';groupId:string}
 | {op:'groupToLayer';groupId:string;ref?:string}
 | {op:'setInkStyle';curveIds:string[];profile?:Profile;profileReverse?:boolean}
 | {op:'setContourMist';objectIds:string[];mist:Pick<ContourMist,'enabled'|'width'|'density'>};
export const elementCommandNames=['duplicateObjects','reorderCurveMember','movePaint','createOffset','setOffset','detachOffset','createGroup','setGroup','ungroup','groupToLayer','setInkStyle','setContourMist'];
export interface ElementCreation {kind:'objectCopy'|'offset'|'curve'|'group'|'layer';id:string;ref?:unknown;idMap?:Record<string,string>}
export class ElementCommandError extends Error {constructor(readonly code:string,message:string){super(message);}}
const fail=(code:string,message:string):never=>{throw new ElementCommandError(code,message);};
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))fail('INVALID_REQUEST','Expected an object.');return v as Record<string,unknown>;};
const keys=(c:Record<string,unknown>,allowed:string[])=>{const unknown=Object.keys(c).filter(k=>!allowed.includes(k));if(unknown.length)fail('INVALID_REQUEST',`Unknown field(s): ${unknown.join(', ')}.`);};
const text=(v:unknown,label:string)=>{if(typeof v!=='string'||!v.trim()||v.length>256)fail('INVALID_REQUEST',`${label} must be a nonempty string of at most 256 characters.`);return v as string;};
const number=(v:unknown,label:string,min=-10000,max=10000)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail('INVALID_REQUEST',`${label} must be finite and between ${min} and ${max}.`);return v as number;};
const bool=(v:unknown,label:string)=>{if(v!==undefined&&typeof v!=='boolean')fail('INVALID_REQUEST',`${label} must be a boolean.`);};
const ids=(v:unknown,label:string)=>{if(!Array.isArray(v)||!v.length||v.length>10000)fail('INVALID_REQUEST',`${label} must contain 1–10000 IDs.`);const out=(v as unknown[]).map(x=>text(x,label));if(new Set(out).size!==out.length)fail('INVALID_REQUEST',`${label} contains duplicates.`);return out;};
const patch=(c:Record<string,unknown>)=>{bool(c.visible,'visible');bool(c.locked,'locked');return {...(c.name===undefined?{}:{name:text(c.name,'name').trim()}),...(c.visible===undefined?{}:{visible:c.visible as boolean}),...(c.locked===undefined?{}:{locked:c.locked as boolean})};};
const nonempty=(value:object)=>{if(!Object.keys(value).length)fail('INVALID_REQUEST','Provide at least one property to change.');};
const curve=(d:DrawingDocument,v:unknown)=>{const id=text(v,'curveId');if(!curveById(d,id))fail('NOT_FOUND',`Unknown curve ID: ${id}.`);return id;};
const curves=(d:DrawingDocument,v:unknown)=>ids(v,'curveIds').map(id=>curve(d,id));
const object=(d:DrawingDocument,v:unknown)=>{const id=text(v,'objectId');if(!objectById(d,id))fail('NOT_FOUND',`Unknown object ID: ${id}.`);return id;};
const layer=(d:DrawingDocument,v:unknown)=>{const id=text(v,'layerId');if(!d.layers.some(l=>l.id===id))fail('NOT_FOUND',`Unknown layer ID: ${id}.`);return id;};
const offset=(d:DrawingDocument,v:unknown)=>{const id=text(v,'offsetId');if(!d.offsets.some(o=>o.id===id))fail('NOT_FOUND',`Unknown offset ID: ${id}.`);return id;};
const group=(d:DrawingDocument,v:unknown)=>{const id=text(v,'groupId'),g=d.groups?.find(g=>g.id===id);if(!g)fail('NOT_FOUND',`Unknown group ID: ${id}.`);return g!;};
const ink=(c:Record<string,unknown>)=>{if(c.profile!==undefined&&!['UNIFORM','TAPER_END','TAPER_BOTH','EYELID'].includes(c.profile as string))fail('INVALID_REQUEST','Invalid ink profile.');bool(c.profileReverse,'profileReverse');return {...(c.profile===undefined?{}:{profile:c.profile as Profile}),...(c.profileReverse===undefined?{}:{profileReverse:c.profileReverse as boolean})};};

export function applyElementCommand(d:DrawingDocument,raw:unknown):{document:DrawingDocument;created?:ElementCreation[]}|undefined{
 const c=record(raw);
 switch(c.op){
  case 'duplicateObjects':{
   keys(c,['op','objectIds','targetLayerId','includeDependencies','ref']);bool(c.includeDependencies,'includeDependencies');
   try{const r=duplicateArtworkObjects(d,ids(c.objectIds,'objectIds').map(id=>object(d,id)),{targetLayerId:c.targetLayerId===undefined?undefined:layer(d,c.targetLayerId),includeDependencies:c.includeDependencies===true});return {document:r.document,created:[{kind:'objectCopy',id:r.objectIds[0],idMap:r.idMap,ref:c.ref}]};}
   catch(e){if(e instanceof ObjectDuplicateError)fail(e.code,e.message);throw e;}
  }
  case 'reorderCurveMember':{
   keys(c,['op','curveId','targetCurveId','after']);bool(c.after,'after');const id=curve(d,c.curveId),target=curve(d,c.targetCurveId);if(strokeFor(d,id)!==strokeFor(d,target))fail('INVALID_REQUEST','Member ordering requires two curves from the same connected stroke.');return {document:reorderCurveMember(d,id,target,c.after===true)};
  }
  case 'movePaint':{
   keys(c,['op','objectId','layerId']);const id=object(d,c.objectId);if(curveById(d,id))fail('INVALID_REQUEST','Use moveToLayer for curves; movePaint accepts fills or offsets.');return {document:movePaint(d,id,layer(d,c.layerId))};
  }
  case 'createOffset':{
   keys(c,['op','curveId','ref']);const n=createOffset(d,curve(d,c.curveId));return {document:n,created:[{kind:'offset',id:n.offsets.at(-1)!.id,ref:c.ref}]};
  }
  case 'setOffset':{
   keys(c,['op','offsetId','name','visible','locked','distance','start','end','taper','width','translation','profile','profileReverse']);const id=offset(d,c.offsetId),change:Parameters<typeof changePaint>[2]={...patch(c),...ink(c)};
   for(const [key,min,max] of [['distance',-2,2],['start',0,1],['end',0,1],['taper',0,.5],['width',1e-8,1]] as const)if(c[key]!==undefined)change[key]=number(c[key],key,min,max);
   if(c.translation!==undefined){if(!Array.isArray(c.translation)||c.translation.length!==2)fail('INVALID_REQUEST','translation must be [x,y].');change.translation=(c.translation as unknown[]).map(v=>number(v,'translation')) as Point2;}
   nonempty(change);return {document:changePaint(d,id,change)};
  }
  case 'detachOffset':{
   keys(c,['op','offsetId','ref']);const id=offset(d,c.offsetId),visible=d.offsets.find(o=>o.id===id)!.visible,r=detachOffset(d,id);return {document:setObjectState(r.document,r.ids,{visible}),created:r.ids.map((id,i)=>({kind:'curve',id,...(i===0?{ref:c.ref}:{})}))};
  }
  case 'createGroup':{
   keys(c,['op','curveIds','name','ref']);const n=createGroup(d,curves(d,c.curveIds),c.name===undefined?undefined:text(c.name,'name').trim());return {document:n,created:[{kind:'group',id:n.groups!.at(-1)!.id,ref:c.ref}]};
  }
  case 'setGroup':{
   keys(c,['op','groupId','name','visible','locked']);const g=group(d,c.groupId),change=patch(c);nonempty(change);return {document:changeGroup(d,g.id,change)};
  }
  case 'ungroup':keys(c,['op','groupId']);return {document:ungroup(d,group(d,c.groupId).curveIds)};
  case 'groupToLayer':{
   keys(c,['op','groupId','ref']);const r=groupToLayer(d,group(d,c.groupId).id);return {document:r.document,created:[{kind:'layer',id:r.layerId,ref:c.ref}]};
  }
  case 'setInkStyle':{
   keys(c,['op','curveIds','profile','profileReverse']);const change=ink(c);nonempty(change);return {document:setInk(d,curves(d,c.curveIds),change)};
  }
  case 'setContourMist':{
   keys(c,['op','objectIds','mist']);const m=record(c.mist);keys(m,['enabled','width','density']);if(typeof m.enabled!=='boolean')fail('INVALID_REQUEST','mist.enabled must be a boolean.');const mist={enabled:m.enabled as boolean,width:number(m.width,'mist.width',.001,.012),density:number(m.density,'mist.density',0,1)};
   return {document:setContourMist(d,ids(c.objectIds,'objectIds').map(id=>object(d,id)),mist)};
  }
  default:return undefined;
 }
}
