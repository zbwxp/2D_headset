/** Sparse properties share one fieldwise patch contract. Missing follows source;
 * null explicitly clears an optional field, including previously authored state. */
export const sameAppearance=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function appearanceDifference<T extends object>(before:T|undefined,after:T|undefined,fields:readonly string[]):Record<string,unknown>|null|undefined{
 if(sameAppearance(before,after))return undefined;
 if(after===undefined)return null;
 const patch:Record<string,unknown>={};
 for(const key of fields)if(!sameAppearance((before as Record<string,unknown>|undefined)?.[key],(after as Record<string,unknown>)[key]))patch[key]=(after as Record<string,unknown>)[key]??null;
 return Object.keys(patch).length?patch:undefined;
}
export function mergeAppearanceObject<T extends object>(before:T|null|undefined,after:T|null|undefined,cleared:T):T|null|undefined{
 if(after===undefined)return before===undefined?undefined:structuredClone(before);
 if(after===null)return null;
 return {...structuredClone(before===null?cleared:before??{}),...structuredClone(after)} as T;
}
export function applyAppearanceObject<T extends object>(source:T|undefined,patch:Partial<T>|null|undefined,fallback:T):T|undefined{
 if(patch===null)return undefined;if(patch===undefined)return source;
 const result={...(source??fallback)} as T;
 for(const [key,value] of Object.entries(patch)){if(value===null)delete (result as Record<string,unknown>)[key];else (result as Record<string,unknown>)[key]=structuredClone(value);}
 return result;
}
export const appearanceRecord=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function validateAppearanceMap(value:unknown,validate:(patch:Record<string,unknown>)=>void):void{
 if(!appearanceRecord(value)||Object.keys(value).length>65536)throw Error('Invalid snapshot appearance override.');
 for(const [id,patch] of Object.entries(value)){if(!id||id.length>16384||!appearanceRecord(patch))throw Error('Invalid snapshot appearance override.');validate(patch);}
}
