/** Development-only workload counters. No geometry or persistence dependencies. */
export const diagnosticsEnabled = (import.meta.env ? import.meta.env.DEV : false);
const shared=globalThis as typeof globalThis & {__geometryCounters?:{counters:Record<string,number>;timings:Record<string,number>}};
const {counters,timings}=shared.__geometryCounters??={counters:{},timings:{}};
export function count(name:string,n=1){if(diagnosticsEnabled)counters[name]=(counters[name]??0)+n;}
export function timed(name:string){if(!diagnosticsEnabled)return ()=>{};const start=performance.now();return ()=>{timings[name]=(timings[name]??0)+performance.now()-start;};}
export const diagnostics={reset(){for(const k of Object.keys(counters))delete counters[k];for(const k of Object.keys(timings))delete timings[k];},snapshot(){return {counters:{...counters},timings:{...timings}};}};
if(diagnosticsEnabled)(globalThis as typeof globalThis & {__geometryPerformance?:typeof diagnostics}).__geometryPerformance=diagnostics;
