// Local developer fixture only. Does not build or alter the published app.
import {build,preview} from 'vite';
import react from '@vitejs/plugin-react';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';

const root=process.cwd(),outputFlag=process.argv.indexOf('--out-dir');
if(outputFlag>=0&&!process.argv[outputFlag+1])throw Error('--out-dir requires a directory');
const outDir=outputFlag>=0?resolve(root,process.argv[outputFlag+1]):'/tmp/contour-recording-renderer-benchmark';
const revision=execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,encoding:'utf8'}).trim();
// A custom output folder is never emptied: embedding this isolated bundle
// under a normal app's dist/diagnostics cannot erase that app's build.
const common={configFile:false,root:resolve(root,'tests/fixtures'),base:'./',build:{outDir,emptyOutDir:outputFlag<0}};
if(process.argv.includes('--serve')){
 const server=await preview({...common,preview:{host:'127.0.0.1',port:5184,strictPort:true}});
 server.printUrls();
 console.log('Open /recording-renderer-benchmark.html in a separate visible browser tab.');
}else{
 // A revision label must describe the production code actually measured.
 // Harness-only uncommitted files are fine; build dirty production elsewhere.
 execFileSync('git',['diff','--quiet','HEAD','--','src'],{cwd:root});
 await build({...common,plugins:[react()],resolve:{alias:[{find:/^react-dom\/client$/,replacement:'react-dom/profiling'},{find:/^react-dom$/,replacement:'react-dom/profiling'}]},define:{__RENDERER_BENCHMARK_REVISION__:JSON.stringify(revision)},build:{...common.build,minify:'esbuild',rollupOptions:{input:resolve(root,'tests/fixtures/recording-renderer-benchmark.html')}}});
 console.log(`Built ${revision} in ${outDir}. Serve with node scripts/build-recording-renderer-benchmark.mjs --serve`);
}
