/** Development-only camera regression measurements; never part of project state. */
export interface JobTiming {projection:number;raster:number;trace:number;total:number;cancelled:boolean}
const profile={camera:0,requests:0,started:0,completed:0,installed:0,stale:0,cancelled:0,uploads:0,bytes:0,surfaceBytes:0,prepMs:0,payloadMeasurementMs:0,postMs:0,stages:[] as JobTiming[],latencies:[] as number[]};
export const contourProfile=import.meta.env.DEV?profile:undefined;
if(import.meta.env.DEV)(window as unknown as {__contourProfile:typeof profile}).__contourProfile=profile;
