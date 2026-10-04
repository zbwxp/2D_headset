/** Exact value interning for the immutable fragments repeated in Recording
 * surface keys. Identity skips serialization, but never defines value equality:
 * detached replay/commit objects with the same JSON receive the same token.
 * Only the bounded text table holds strong references. Eviction can lose reuse,
 * never equality correctness: tokens are monotonic and are never recycled. */
export class RecordingSemanticFragments {
 private identities=new WeakMap<object,number>();
 private values=new Map<string,number>();
 private nextToken=1;private characters=0;
 private serializations=0;private serializedCharacters=0;private identityHits=0;private valueHits=0;
 constructor(private maxEntries=4096,private maxCharacters=4*1024*1024){}
 key(value:object):number {
  const known=this.identities.get(value);if(known!==undefined){this.identityHits++;return known;}
  const text=JSON.stringify(value);this.serializations++;this.serializedCharacters+=text.length;
  let token=this.values.get(text);
  if(token!==undefined)this.valueHits++;
  else{
   token=this.nextToken++;
   // Oversized inputs still get weak identity reuse, without exceeding the
   // strong text budget or evicting every ordinary fragment.
   if(text.length<=this.maxCharacters&&this.maxEntries>0){
    while(this.values.size>=this.maxEntries||this.characters+text.length>this.maxCharacters){const oldest=this.values.keys().next().value!;this.characters-=oldest.length;this.values.delete(oldest);}
    this.values.set(text,token);this.characters+=text.length;
   }
  }
  this.identities.set(value,token);return token;
 }
 stats(){return {serializations:this.serializations,serializedCharacters:this.serializedCharacters,identityHits:this.identityHits,valueHits:this.valueHits,entries:this.values.size,characters:this.characters};}
}
const fragments=new RecordingSemanticFragments();
/** Untrusted/external callers retain the complete value in the enclosing key. */
export const recordingSemanticFragment=(value:object|undefined,immutable:boolean):object|number|undefined=>immutable&&value?fragments.key(value):value;
export const getRecordingSemanticFragmentStats=()=>fragments.stats();
