const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {createRequire}=require('node:module');
const assert=require('node:assert/strict');
const {after}=require('node:test');
const {inspect}=require('node:util');
const os=require('node:os');
const {coordinatorSource}=require('./coordinator-source.cjs');
const resolve=createRequire(path.resolve('.caracal/standalones/CharacterCoordinator.js'));

async function run(now, overrides = {}, bundled = false, launcherDirectory) {
  let applicationExports;
  const errors=[],routes=[],timers=[],listeners=[],handlers=new Map(),signals=new Map();
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'coordinator-host-'));
  let exited;
  const exit=new Promise(resolve=>{exited=resolve;});
  after(async()=>{
    if(signals.has('SIGTERM')) {signals.get('SIGTERM')();await exit;}
    fs.rmSync(directory,{recursive:true,force:true});
  });
  let finished=false;
  const logger={log(){},warn(){},error(...args){errors.push(args);},info(){}};
  const router={use(){},listen(){},get(route,...handlers){routes.push(['get',route,handlers.length]);},post(route,...callbacks){routes.push(['post',route,callbacks.length]);handlers.set(route,callbacks.at(-1));},delete(route,...handlers){routes.push(['delete',route,handlers.length]);}};
  const express=()=>router;
  express.json=express.text=express.static=()=>()=>{};
  const account={response:{characters:[{name:"P",ctype:"priest"}],servers:[]},resolve_char(){},resolve_realm(){},updateInfo:async()=>{},add_listener(){finished=true;}};
  const config={characters:{},merchant:'GoldMajesty',web_app:{party_dashboard:true,port:0}};
  function stubRequire(name) {
    if(Object.hasOwn(overrides,name))return overrides[name];
    if(name==='../../.build/runtime/coordinator-application.cjs')return applicationExports;
    if(name==='./infrastructure/dependencies.ts')return require('../../../runtime/coordinator/infrastructure/dependencies.ts');
    if((name.startsWith('./') || name.startsWith('../')) && name.endsWith('.ts'))return require(path.resolve(__dirname,'../../../runtime/coordinator',name));
    if(name==='../../.build/runtime/coordinator-policies.cjs')return require('../../../runtime/coordinator/index.ts');
    if(name==='../config')return config;
    if(name==='../account_info')return async()=>account;
    if(name==='../game_files')return {ensure_latest:async()=>123,cull_versions:async()=>{}};
    if(name==='../api')return async()=>[];
    if(name==='../src/CONSTANTS')return {LOCALSTORAGE_PATH:path.join(directory,'state.jsonl'),LOCALSTORAGE_ROTA_PATH:path.join(directory,'rotation.jsonl'),STAT_BEAT_INTERVAL:1000};
    if(name==='../src/LogUtils')return {log:logger,console:logger,ctype_to_clid:{}};
    if(name==='node:child_process')return {fork(){throw Error('Unexpected worker launch in empty-roster smoke test');}};
    if(name==='node:fs')return fs;
    if(name==='express')return express;
    if(name==='bot-web-interface'||name==='../monitoring_util')return {};
    return resolve(name);
  }
  const clock=now===undefined?Date:class extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  const hostModule={exports:{}};
  const context=vm.createContext({module:hostModule,exports:hostModule.exports,require:stubRequire,Date:clock,__dirname:launcherDirectory || path.resolve('.caracal/standalones'),Buffer,URL,URLSearchParams,structuredClone,console:logger,
    performance,fetch:async()=>({ok:true,json:async()=>[],text:async()=>'',headers:{get(){return null;}}}),
    process:{env:{AL_SESSION:'fixture'},pid:process.pid,kill:process.kill,on(name,handler){listeners.push(name);signals.set(name,handler);},exit(){exited();},stdout:{},stderr:{}},
    setTimeout(callback,ms){timers.push(['timeout',ms]);return {unref(){}};},clearTimeout(){},
    setInterval(callback,ms){timers.push(['interval',ms]);return {unref(){}};},clearInterval(){},AbortController,AbortSignal});
  const filename = bundled ? '.build/runtime/coordinator-application.cjs' : 'runtime/coordinator/application.ts';
  const source = bundled ? fs.readFileSync(path.resolve(__dirname, '../../../', filename), 'utf8') : coordinatorSource();
  if (launcherDirectory) {
    vm.runInContext('(function(require,module,exports,__dirname){\n'+source+'\n})(require,module,exports,__dirname);',context,{filename});
    applicationExports=hostModule.exports;
    hostModule.exports={};
    context.exports=hostModule.exports;
    const launcher=fs.readFileSync(path.resolve(__dirname,'../../../tools/caracal/CharacterCoordinator.cjs'),'utf8');
    vm.runInContext(launcher,context,{filename:'CharacterCoordinator.js'});
    await hostModule.exports;
  } else {
    await vm.runInContext(source + '\nmodule.exports.startCoordinatorApplication({require,directory:__dirname,loadFetch:async()=>{throw Error("Unexpected fetch in fixture");}});',
      context,{filename});
  }
  assert.equal(finished,true,inspect(errors,{depth:5}));
  assert.equal(errors.filter(args=>args[0]==='failed to start caracAL').length,0);
  return {routes,timers,listeners,handlers};
}

module.exports={run,runBundled:(now,overrides)=>run(now,overrides,true),
  runLauncher:(directory,now,overrides)=>run(now,overrides,true,directory)};

