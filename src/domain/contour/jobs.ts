/** One active computation, one replaceable pending input. No historical job queue. */
export class LatestJob<T> {
 private pending:T|undefined;
 private generation=0;
 private running=false;
 constructor(private run:(input:T,stale:()=>boolean)=>Promise<void>){}
 submit(input:T){this.pending=input;this.generation++;void this.drain();}
 invalidate(){this.pending=undefined;this.generation++;}
 private async drain(){
  if(this.running)return;
  this.running=true;
  try{while(this.pending!==undefined){
   const input=this.pending,generation=this.generation;this.pending=undefined;
   await this.run(input,()=>generation!==this.generation);
  }}finally{this.running=false;}
 }
}
