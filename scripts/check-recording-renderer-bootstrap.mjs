// Bounded module-initialization smoke test, not browser automation or rendering.
// Inert DOM stubs stop at the first benchmark element lookup, before createRoot.
// This catches the profiling-client/base-react-dom circular alias regression.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';

const directory=resolve(process.argv[2]??'/tmp/contour-recording-renderer-benchmark');
const html=readFileSync(resolve(directory,'recording-renderer-benchmark.html'),'utf8');
const entry=html.match(/<script\b[^>]*src="([^"]+\.js)"/u)?.[1];
if(!entry||!entry.startsWith('./assets/'))throw Error('Expected one relative benchmark module entry');
const boundary=Object.freeze({reason:'benchmark entry reached'});
const document={
 createElement:()=>({relList:{supports:()=>true},style:{},setAttribute(){}}),
 querySelectorAll:()=>[],
 getElementById(id){if(id==='scene')throw boundary;throw Error(`Unexpected early element lookup: ${id}`);},
};
const sandbox={document,window:{document,addEventListener(){},removeEventListener(){}},navigator:{userAgent:'inert module smoke test'},performance:{now:()=>0},setTimeout:()=>0,clearTimeout(){},queueMicrotask(){},console};
let reached=false;
try{vm.runInNewContext(readFileSync(resolve(directory,entry),'utf8'),sandbox,{timeout:3000,filename:entry});}
catch(error){if(error===boundary)reached=true;else throw Error(`Benchmark module bootstrap failed: ${error instanceof Error?error.message:String(error)}`);}
if(!reached)throw Error('Benchmark module did not reach its entry boundary');
console.log('PASS: production modules reach benchmark entry; browser rendering remains a separate check.');
