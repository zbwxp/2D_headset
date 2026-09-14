/** Bounded, runtime-only cache keyed by actual inputs; independent of project identity. */
export class InputCache<T>{
 private values=new Map<string,T>();
 constructor(private limit=2048){}
 get(key:string){return this.values.get(key);}
 set(key:string,value:T){if(this.values.size>=this.limit&&!this.values.has(key))this.values.delete(this.values.keys().next().value!);this.values.set(key,value);return value;}
}
