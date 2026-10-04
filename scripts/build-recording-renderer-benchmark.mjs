// Local developer fixture only. Does not build or alter the published app.
import {build,preview} from 'vite';
import react from '@vitejs/plugin-react';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';

const root=process.cwd(),outputFlag=process.argv.indexOf('--out-dir'),baselineFlag=process.argv.indexOf('--baseline-ref');
if(outputFlag>=0&&!process.argv[outputFlag+1])throw Error('--out-dir requires a directory');
if(baselineFlag>=0&&!process.argv[baselineFlag+1])throw Error('--baseline-ref requires an exact Git revision');
const outDir=outputFlag>=0?resolve(root,process.argv[outputFlag+1]):'/tmp/contour-recording-renderer-benchmark';
const requestedRef=baselineFlag>=0?process.argv[baselineFlag+1]:'HEAD';
const git=(args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const productionHead=git(['rev-parse','--verify',`${requestedRef}^{commit}`]),revision=productionHead.slice(0,7),productionSrcTree=git(['rev-parse',`${productionHead}:src`]);
const harnessFiles=[...readdirSync(resolve(root,'tests/fixtures')).filter(name=>name.startsWith('recording-renderer-benchmark')).map(name=>'tests/fixtures/'+name),'scripts/build-recording-renderer-benchmark.mjs','scripts/check-recording-renderer-bootstrap.mjs'].sort();
const harnessEntries=harnessFiles.map(path=>({path,sha256:createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex')}));
const harnessSha256=createHash('sha256').update(JSON.stringify(harnessEntries)).digest('hex');
let sourceRoot=root;
if(baselineFlag>=0){
 if(process.argv.includes('--serve'))throw Error('--baseline-ref builds only; serve an already-built directory separately');
 // Materialize only the exact baseline production source and compiler inputs.
 // The current harness is then copied verbatim; no baseline algorithms are
 // replaced, and no prior worktree/private artifact is needed to reproduce it.
 sourceRoot=mkdtempSync(resolve(tmpdir(),'contour-renderer-baseline-'));
 const archive=execFileSync('git',['archive',productionHead,'--','src','package.json','package-lock.json','tsconfig.json'],{cwd:root,maxBuffer:64*1024*1024});
 execFileSync('tar',['-x','-C',sourceRoot],{input:archive});
 for(const path of harnessFiles){mkdirSync(resolve(sourceRoot,path,'..'),{recursive:true});copyFileSync(resolve(root,path),resolve(sourceRoot,path));}
 symlinkSync(resolve(root,'node_modules'),resolve(sourceRoot,'node_modules'),'dir');
 // Git blob IDs verify every archived production byte against the real ref.
 for(const line of git(['ls-tree','-r',productionHead,'--','src']).split('\n')){
  const [,type,oid,path]=line.match(/^\d+ (\S+) ([0-9a-f]+)\t(.+)$/)??[];
  if(type!=='blob')throw Error(`Unsupported baseline source entry: ${line}`);
  const bytes=readFileSync(resolve(sourceRoot,path)),actual=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if(actual!==oid)throw Error(`Baseline production bytes differ from ${productionHead}: ${path}`);
 }
 console.log(`Frozen baseline ${productionHead} (src tree ${productionSrcTree}) at ${sourceRoot}`);
}
// A custom output folder is never emptied: embedding this isolated bundle
// under a normal app's dist/diagnostics cannot erase that app's build.
const common={configFile:false,root:resolve(sourceRoot,'tests/fixtures'),base:'./',build:{outDir,emptyOutDir:outputFlag<0}};
if(process.argv.includes('--serve')){
 const server=await preview({...common,preview:{host:'127.0.0.1',port:5184,strictPort:true}});
 server.printUrls();
 console.log('Open /recording-renderer-benchmark.html in a separate visible browser tab.');
}else{
 // A revision label must describe the production code actually measured.
 // Harness-only uncommitted files are fine; build dirty production elsewhere.
 if(baselineFlag<0){
  execFileSync('git',['diff','--quiet','HEAD','--','src'],{cwd:root});
  if(git(['ls-files','--others','--exclude-standard','src']))throw Error('Untracked production source would invalidate the HEAD label');
 }
 // The profiling client itself imports base react-dom for shared internals.
 // Aliasing that base package back to profiling creates a circular bootstrap.
 await build({...common,plugins:[react()],resolve:{alias:[{find:/^react-dom\/client$/,replacement:'react-dom/profiling'}]},define:{__RENDERER_BENCHMARK_REVISION__:JSON.stringify(revision),__RENDERER_BENCHMARK_PRODUCTION_HEAD__:JSON.stringify(productionHead),__RENDERER_BENCHMARK_HARNESS_SHA256__:JSON.stringify(harnessSha256)},build:{...common.build,minify:'esbuild',rollupOptions:{input:resolve(sourceRoot,'tests/fixtures/recording-renderer-benchmark.html')}}});
 execFileSync(process.execPath,[resolve(root,'scripts/check-recording-renderer-bootstrap.mjs'),outDir],{stdio:'inherit'});
 writeFileSync(resolve(outDir,'benchmark-build.json'),JSON.stringify({productionHead,requestedRef,productionSrcTree,harnessSha256,harnessEntries,baselineSourceArchive:baselineFlag>=0,sourceRoot,bootstrapGuard:'passed',productionSourceGuard:'passed'},null,2)+'\n');
 console.log(`Built ${revision} in ${outDir}. Serve with node scripts/build-recording-renderer-benchmark.mjs --serve`);
}
