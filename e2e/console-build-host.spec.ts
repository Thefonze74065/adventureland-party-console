import {test, expect, type TestInfo} from '@playwright/test';
import {createHash, randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdir, readFile, writeFile, readdir, symlink} from 'node:fs/promises';
import filesystem from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {ConsoleBuildStore} from '../tools/console-build/store';
import {ConsoleBuildController} from '../tools/console-build/controller';
import {createDeploymentDriver, type ActivationPorts} from '../tools/console-build/driver';
import {ImmutableDashboard} from '../tools/console-build/dashboard';
import type {Candidate, CandidateManifest} from '../tools/console-build/contracts';
import {startupCandidate, deployStartupCandidate} from '../tools/console-build/startup';
import {loadManagedConsole} from '../tools/console-build/bootstrap';
import type {Services} from '../tools/hosting/services';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function port() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture port');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}
async function stopChild(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const stopped = new Promise<void>(resolve => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await stopped;
}
async function dependencyCache(store: ConsoleBuildStore, label: string) {
  const id = hash('dependencies-' + label), directory = path.join(store.directory, 'dependencies', id);
  const files: Record<string, string> = {};
  for (const component of ['root', 'dashboard', 'caracal']) {
    const name = component + '/node_modules/declared-module.txt';
    await mkdir(path.dirname(path.join(directory, name)), {recursive: true});
    await writeFile(path.join(directory, name), label);
    files[name] = hash(label);
  }
  const packageFile = 'caracal/node_modules/declared-pkg/index.js';
  const packageCode = `module.exports = ${JSON.stringify(label)};`;
  await mkdir(path.dirname(path.join(directory, packageFile)), {recursive: true});
  await writeFile(path.join(directory, packageFile), packageCode);
  files[packageFile] = hash(packageCode);
  await writeFile(path.join(directory, 'complete.json'), JSON.stringify({id, files, manifestHash: hash(JSON.stringify({id, files}))}));
  return {id, directory, label};
}
async function stage(store: ConsoleBuildStore, root: string, label: string, sequence: number, brokenDashboard = false, dependencyId?: string, extraContent:Record<string,string>={}): Promise<Candidate> {
  const directory = path.join(root, 'stage-' + label);
  const dashboard = brokenDashboard ? 'process.exit(23);' : `
    import {createServer} from 'node:http';
    createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/plain','X-Declared-Pid':String(process.pid)});res.end(${JSON.stringify(label)});if(req.url==='/crash')res.once('finish',()=>process.exit(0));}).listen(Number(process.argv[2]),'127.0.0.1');
  `;
  const coordinator = `
    import {createServer} from 'node:http';
    const identity=JSON.parse(process.argv[3]);
    createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({...identity,label:${JSON.stringify(label)},pid:process.pid}));}).listen(Number(process.argv[2]),'127.0.0.1');
  `;
  const content: Record<string, string> = {'tools/dashboard/node-server.mts': dashboard, 'coordinator.mts': coordinator, 'dashboard/.build/container/identity.txt': label,
    'tools/caracal/pinned-native.cjs': await readFile(fileURLToPath(new URL('../tools/caracal/pinned-native.cjs', import.meta.url)), 'utf8'), ...extraContent};
  for (const [name, value] of Object.entries(content)) {
    const file = path.join(directory, 'app', name);
    await mkdir(path.dirname(file), {recursive: true});
    await writeFile(file, value);
  }
  if (dependencyId) for (const [name, component] of Object.entries({'node_modules': 'root', 'dashboard/node_modules': 'dashboard', '.caracal/node_modules': 'caracal'})) {
    const target = path.join(directory, 'app', name);
    await mkdir(path.dirname(target), {recursive: true});
    await symlink(path.join(store.directory, 'dependencies', dependencyId, component, 'node_modules'), target, process.platform === 'win32' ? 'junction' : 'dir');
  }
  const id = hash(label);
  const manifest: CandidateManifest = {schema: 1, id, sourceHash: id, dependencyId,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(),
    components: {dashboard: hash('dashboard-' + label), coordinator: hash('coordinator-' + label), characters: hash('characters-' + label)},
    files: Object.fromEntries(Object.entries(content).map(([name, value]) => [name, hash(value)]))};
  return store.complete(directory, manifest);
}
async function processHost(store: ConsoleBuildStore, info: TestInfo) {
  const dashboard = new ImmutableDashboard(), dashboardPort = await port(), coordinatorPort = await port();
  await dashboard.listen(dashboardPort);
  let coordinator: ChildProcess | undefined;
  const ledger: Record<string, unknown>[] = [];
  const owned: ChildProcess[] = [];
  async function observation() {
    const response = await fetch(`http://127.0.0.1:${coordinatorPort}`, {signal: AbortSignal.timeout(1000)});
    return response.json() as Promise<{artifactId: string; hash: string; characters: Record<string, string>; label: string; pid: number}>;
  }
  const ports: ActivationPorts = {
    async stopCoordinator(signal) { signal.throwIfAborted(); await stopChild(coordinator); coordinator = undefined; },
    async startCoordinator(directory, signal) {
      signal.throwIfAborted();
      const candidate = await store.verify(path.basename(path.dirname(directory)));
      const identity = {artifactId: candidate.manifest.id, hash: candidate.manifest.components.coordinator,
        characters: {DeclaredNativeCharacter: candidate.manifest.components.characters}};
      coordinator = spawn(process.execPath, [path.join(directory, 'coordinator.mts'), String(coordinatorPort), JSON.stringify(identity)], {cwd: directory, stdio: 'pipe', windowsHide: true});
      owned.push(coordinator);
      coordinator.stdout?.on('data', chunk => ledger.push({stdout: String(chunk)}));
      coordinator.stderr?.on('data', chunk => ledger.push({stderr: String(chunk)}));
      ledger.push({action: 'start-coordinator', id: identity.artifactId, pid: coordinator.pid});
    },
    async activateDashboard(directory, signal) {
      const candidate = await store.verify(path.basename(path.dirname(directory)));
      await dashboard.activate(candidate, signal);
      await store.pin(dashboard.pinnedBuilds);
      ledger.push({action: 'dashboard-ready', id: candidate.manifest.id});
    },
    async reloadCharacters(directory, signal) {
      signal.throwIfAborted();
      const candidate = await store.verify(path.basename(path.dirname(directory)));
      return {DeclaredNativeCharacter: candidate.manifest.components.characters};
    },
    async observe(signal) {
      signal.throwIfAborted();
      const observed = await observation().catch(() => undefined);
      return {coordinator: observed, dashboardHash: dashboard.currentHash, characters: observed?.characters || {}};
    },
  };
  const driver = createDeploymentDriver(ports);
  const controller = new ConsoleBuildController(store, driver, 5000);
  return {controller, driver, ledger, dashboardPort, observation,
    async body() { const response = await fetch(`http://127.0.0.1:${dashboardPort}`, {signal: AbortSignal.timeout(2000)}); return response.text(); },
    async dashboardIdentity(route = '/') {
      const response = await fetch(`http://127.0.0.1:${dashboardPort}${route}`, {signal: AbortSignal.timeout(2000)});
      return {pid: response.headers.get('x-declared-pid'), body: await response.text(), status: response.status};
    },
    async stop() {
      await Promise.all(owned.map(stopChild));
      await dashboard.stop();
      await store.pin([]);
      await info.attach('owned-process-ledger', {body: JSON.stringify(ledger), contentType: 'application/json'});
    }};
}
async function terminal(controller: ConsoleBuildController) {
  await expect.poll(async () => (await controller.status()).operation?.phase, {timeout: 15_000}).toMatch(/^(complete|failed)$/);
}

test('immutable console process activation preserves exact selection, rollback and pinned restart', async ({}, info) => {
  // Short owned paths avoid Windows CreateProcess cwd limits for nested releases.
  const root = path.resolve('.build/p79', randomUUID().slice(0, 8)), store = new ConsoleBuildStore(root);
  const a = await stage(store, root, 'process-A', 1);
  const nativeRename=filesystem.rename,source=path.join(root,'stage-process-B'),destination=path.join(store.directory,'releases',hash('process-B'));
  const publicationAttempts:Array<{at:number;source:string;destination:string;forced:boolean;success?:boolean;error?:string}>=[];
  let b:Candidate;
  try{
    filesystem.rename=async(from,to)=>{
      if(String(from)!==source||String(to)!==destination)return nativeRename(from,to);
      const attempt:(typeof publicationAttempts)[number]={at:Date.now(),source:String(from),destination:String(to),forced:publicationAttempts.length===0};
      publicationAttempts.push(attempt);
      if(attempt.forced){attempt.error='EPERM';throw Object.assign(Error('Declared transient publication sharing violation'),{code:'EPERM'});}
      try{await nativeRename(from,to);attempt.success=true;}catch(error){attempt.error=(error as NodeJS.ErrnoException).code;throw error;}
    };
    syncBuiltinESMExports();
    b=await stage(store,root,'process-B',2);
  }finally{
    filesystem.rename=nativeRename;syncBuiltinESMExports();
    await info.attach('immutable-publication-rename-attempts',{body:JSON.stringify(publicationAttempts),contentType:'application/json'});
  }
  expect(publicationAttempts.filter(attempt=>attempt.forced)).toHaveLength(1);
  expect(publicationAttempts.filter(attempt=>attempt.success)).toHaveLength(1);
  await store.setReferences({active: a.manifest.id, latest: b.manifest.id});
  const state = path.join(root, 'current-account-state.json');
  await writeFile(state, JSON.stringify({currentJob: 'keep-this-job', gold: 1234}));
  const host = await processHost(store, info);
  try {
    await host.driver.activate(a, undefined, AbortSignal.timeout(5000));
    expect(await host.body()).toBe('process-A');
    const accepted = await host.controller.deploy(b.manifest.id);
    const c = await stage(store, root, 'process-C', 3);
    expect(accepted.target).toBe(b.manifest.id);
    await terminal(host.controller);
    expect((await store.references()).active).toBe(b.manifest.id);
    expect((await store.references()).latest).toBe(c.manifest.id);
    expect(await host.body()).toBe('process-B');
    expect((await host.observation()).label).toBe('process-B');
    const broken = await stage(store, root, 'process-broken-dashboard', 4, true);
    await host.controller.deploy(broken.manifest.id);
    await terminal(host.controller);
    expect((await store.journal())?.phase).toBe('failed');
    expect((await store.journal())?.error).toContain('exited before readiness');
    expect((await store.references()).active).toBe(b.manifest.id);
    expect(await host.body()).toBe('process-B');
    expect((await host.observation()).label).toBe('process-B');
    const beforeCrash = await host.dashboardIdentity();
    expect(beforeCrash.pid).toBeTruthy();
    expect((await host.dashboardIdentity('/crash')).body).toBe('process-B');
    await expect.poll(async () => {
      const current = await host.dashboardIdentity();
      return current.status === 200 && current.body === 'process-B' && !!current.pid && current.pid !== beforeCrash.pid;
    }, {timeout: 15_000}).toBe(true);
    const afterCrash = await host.dashboardIdentity();
    expect((await store.references()).active).toBe(b.manifest.id);
    expect((await store.references()).latest).toBe(broken.manifest.id);
    await info.attach('active-dashboard-process-crash-recovery', {body: JSON.stringify({beforeCrash, afterCrash, references: await store.references()}), contentType: 'application/json'});
    expect(JSON.parse(await readFile(state, 'utf8'))).toEqual({currentJob: 'keep-this-job', gold: 1234});
    await info.attach('exact-process-deployment-and-rollback', {body: JSON.stringify({accepted, references: await store.references(), journal: await store.journal(), identity: await host.observation(), state: JSON.parse(await readFile(state, 'utf8'))}), contentType: 'application/json'});
  } finally { await host.stop(); }
  const restarted = await processHost(store, info);
  try {
    const active = await store.verify((await store.references()).active!);
    await restarted.driver.activate(active, undefined, AbortSignal.timeout(5000));
    expect(await restarted.body()).toBe('process-B');
    expect((await restarted.observation()).artifactId).toBe(b.manifest.id);
    await info.attach('pinned-process-restart', {body: JSON.stringify({references: await store.references(), identity: await restarted.observation()}), contentType: 'application/json'});
  } finally { await restarted.stop(); }
});

test('interrupted console deployment recovers prior executable and retention protects live pins', async ({}, info) => {
  const root = path.resolve('.build/p79', randomUUID().slice(0, 8)), store = new ConsoleBuildStore(root);
  const dependencies = await Promise.all(['active', 'previous', 'live', 'new'].map(label => dependencyCache(store, label)));
  const a = await stage(store, root, 'crash-A', 1, false, dependencies[0].id), b = await stage(store, root, 'crash-B', 2, false, dependencies[1].id), c = await stage(store, root, 'crash-C', 3, false, dependencies[2].id);
  await store.setReferences({active: a.manifest.id, previous: b.manifest.id, latest: c.manifest.id});
  const state = path.join(root, 'current-state.json');
  await writeFile(state, JSON.stringify({checkpoint: 'current-after-old-build'}));
  const script = path.join(root, 'crash-controller.mts');
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  await writeFile(script, `
    import {ConsoleBuildStore} from ${JSON.stringify(pathToFileURL(path.join(sourceRoot, 'tools/console-build/store.ts')).href)};
    import {ConsoleBuildController} from ${JSON.stringify(pathToFileURL(path.join(sourceRoot, 'tools/console-build/controller.ts')).href)};
    const store=new ConsoleBuildStore(${JSON.stringify(root)});
    const controller=new ConsoleBuildController(store,{activate:async()=>{await new Promise(()=>{});},restore:async()=>{}},120000);
    await controller.deploy(${JSON.stringify(c.manifest.id)});
    setInterval(()=>{},1000);
  `);
  const crashed = spawn(process.execPath, [script], {cwd: root, stdio: 'pipe', windowsHide: true});
  let output = '';
  crashed.stderr?.on('data', chunk => { output += String(chunk); });
  try {
    await expect.poll(async () => {
      if (crashed.exitCode !== null) throw new Error('Controller process exited: ' + output);
      return (await store.journal())?.phase;
    }).toBe('activating');
  } finally {
    await stopChild(crashed);
    await info.attach('terminated-controller-output', {body: output, contentType: 'text/plain'});
  }
  // A real terminated process supplies the abandoned lock identity.
  await mkdir(path.join(store.directory, 'operation.lock'), {recursive: true});
  await writeFile(path.join(store.directory, 'operation.lock/owner.json'), JSON.stringify({pid: crashed.pid, token: 'terminated-process'}));
  const host = await processHost(store, info);
  try {
    await host.controller.recover();
    expect((await store.journal())?.phase).toBe('failed');
    expect((await store.references()).active).toBe(a.manifest.id);
    expect(await host.body()).toBe('crash-A');
    expect((await host.observation()).artifactId).toBe(a.manifest.id);
    expect(JSON.parse(await readFile(state, 'utf8'))).toEqual({checkpoint: 'current-after-old-build'});
    const candidates = [a, b, c];
    for (let index = 4; index <= 26; index++) candidates.push(await stage(store, root, 'retention-' + index, index, false, dependencies[3].id));
    await store.pin([c.manifest.id]);
    await store.cleanup();
    const retainedPinned = (await store.history()).map(value => value.id);
    expect(retainedPinned).toHaveLength(23);
    expect(retainedPinned).toEqual(expect.arrayContaining([a.manifest.id, b.manifest.id, c.manifest.id, ...candidates.slice(-20).map(value => value.manifest.id)]));
    const dependencyPins = await readdir(path.join(store.directory, 'dependencies'));
    expect(dependencyPins.sort()).toEqual(dependencies.map(value => value.id).sort());
    await store.pin([]);
    await store.cleanup();
    const retainedReleased = (await store.history()).map(value => value.id);
    expect(retainedReleased).toHaveLength(22);
    expect(retainedReleased).not.toContain(c.manifest.id);
    const dependencyReleased = await readdir(path.join(store.directory, 'dependencies'));
    expect(dependencyReleased.sort()).toEqual([dependencies[0].id, dependencies[1].id, dependencies[3].id].sort());
    const latest = candidates.at(-1)!;
    const changedDependency = path.join(dependencies[3].directory, 'root/node_modules/declared-module.txt');
    await writeFile(changedDependency, 'changed-dependency');
    await expect(store.verify(latest.manifest.id)).rejects.toThrow('Artifact file changed');
    await writeFile(changedDependency, dependencies[3].label);
    await writeFile(path.join(latest.directory, 'coordinator.mts'), '// changed executable');
    await expect(store.verify(latest.manifest.id)).rejects.toThrow('Artifact file changed');
    await info.attach('interrupted-controller-retention-evidence', {body: JSON.stringify({terminatedPid: crashed.pid, output, references: await store.references(), journal: await store.journal(), recoveredIdentity: await host.observation(), retainedPinned, retainedReleased, dependencyPins, dependencyReleased, manifests: candidates.map(value => value.manifest)}), contentType: 'application/json'});
  } finally { await host.stop(); }
});

test('managed launcher ignores legacy coordinator watchers after executable changes',async({},info)=>{
  const root=path.resolve('.build/p79',randomUUID().slice(0,8)),store=new ConsoleBuildStore(root);
  const dependency=await dependencyCache(store,'watcher-isolation'),candidate=await stage(store,root,'watcher-policy',1,false,dependency.id);
  const observations=[];
  for(const managed of [false,true]){
    const installed=path.join(root,managed?'managed':'unmanaged');await mkdir(path.join(installed,'src'),{recursive:true});
    await writeFile(path.join(installed,'main.js'),await readFile('.caracal/main.js','utf8'));
    await writeFile(path.join(installed,'config.js'),'module.exports={watch_CODE:true,enable_TYPECODE:false,log_sinks:[]};');
    await writeFile(path.join(installed,'src/ConfigUtil.js'),'exports.interactive=async()=>{};');
    await writeFile(path.join(installed,'src/CONSTANTS.js'),'exports.COORDINATOR_MODULE_PATH="./coordinator.cjs";');
    await writeFile(path.join(installed,'src/StreamMultiplexer.js'),'exports.setup_log_pipes=(_s,file)=>require("node:child_process").fork(file,[],{stdio:["ignore","ignore","ignore","ipc"]});');
    const executable=path.join(installed,'coordinator.cjs'),receipt=path.join(installed,'lifecycle.jsonl');
    await writeFile(executable,`require('node:fs').appendFileSync(${JSON.stringify(receipt)},JSON.stringify({pid:process.pid})+'\\n');process.on('message',m=>{if(m.type==='coordinator_shutdown')process.exit(0)});setInterval(()=>{},1000);`);
    const env={...Object.fromEntries(Object.entries(process.env).filter(([name])=>! /^(AL_|E2E_|NODE_OPTIONS$)/.test(name))),...(managed?{AL_CONSOLE_ARTIFACT:candidate.directory,AL_CONSOLE_NATIVE_DIR:installed,NODE_OPTIONS:`--require ${JSON.stringify(path.join(candidate.directory,'tools/caracal/pinned-native.cjs'))}`}:{})};
    const child=spawn(process.execPath,['main.js'],{cwd:installed,env,stdio:'pipe',windowsHide:true});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
    const pids=async()=>readFile(receipt,'utf8').then(s=>s.trim().split('\n').map(s=>JSON.parse(s).pid)).catch(()=>[]);
    try{
      await expect.poll(async()=>(await pids()).length).toBe(1);
      await writeFile(executable,(await readFile(executable,'utf8'))+'\n// rebuilt executable\n');
      if(!managed)await expect.poll(async()=>(await pids()).length).toBe(2);
      else {await new Promise(r=>setTimeout(r,1800));expect(await pids()).toHaveLength(1);}
      observations.push({managed,pids:await pids(),output});
    }finally{await stopChild(child);}
  }
  await info.attach('native-launcher-watcher-isolation',{body:JSON.stringify(observations),contentType:'application/json'});
});

test('managed native preload pins external packages while preserving installed state imports', async ({}, info) => {
  const root = path.resolve('.build/p79', randomUUID().slice(0, 8)), store = new ConsoleBuildStore(root);
  const dependency = await dependencyCache(store, 'selected-artifact-package');
  const candidate = await stage(store, root, 'native-preload-artifact', 1, false, dependency.id);
  const installed = path.join(root, 'native-installed');
  await mkdir(path.join(installed, 'node_modules/declared-pkg'), {recursive: true});
  await writeFile(path.join(installed, 'node_modules/declared-pkg/index.js'), 'module.exports = "unactivated-installed-package";');
  await writeFile(path.join(installed, 'config.cjs'), 'module.exports = { checkpoint: "current-account-checkpoint" };');
  await writeFile(path.join(installed, 'config.js'), 'module.exports = {watch_CODE:true,enable_TYPECODE:true,checkpoint:"saved-account"};');
  const executable = path.join(installed, 'main.cjs');
  await writeFile(executable, `
    const path = require('node:path');
    console.log(JSON.stringify({external: require('declared-pkg'), absoluteExternal: require(path.join(__dirname,'node_modules/declared-pkg')), state: require('./config.cjs'), policy:require('./config'), builtin: typeof require('node:fs').readFileSync}));
  `);
  const preload = path.join(candidate.directory, 'tools/caracal/pinned-native.cjs');
  const child = spawn(process.execPath, [executable], {cwd: installed, stdio: 'pipe', windowsHide: true,
    env: {...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(AL_|E2E_)/.test(name))),
      NODE_OPTIONS: `--require ${JSON.stringify(preload)}`, AL_CONSOLE_ARTIFACT: candidate.directory, AL_CONSOLE_NATIVE_DIR: installed}});
  let output = '', errors = '';
  child.stdout?.on('data', chunk => { output += String(chunk); });
  child.stderr?.on('data', chunk => { errors += String(chunk); });
  try {
    const exit = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    expect(exit, errors).toBe(0);
    const observed = JSON.parse(output.trim());
    expect(observed).toEqual({external: 'selected-artifact-package', absoluteExternal: 'selected-artifact-package', state: {checkpoint: 'current-account-checkpoint'}, policy:{watch_CODE:false,enable_TYPECODE:false,checkpoint:'saved-account'}, builtin: 'function'});
    expect(await readFile(path.join(installed,'config.js'),'utf8')).toBe('module.exports = {watch_CODE:true,enable_TYPECODE:true,checkpoint:"saved-account"};');
    await info.attach('pinned-native-package-resolution', {body: JSON.stringify({observed, errors, candidate: candidate.manifest, nativeDirectory: installed, preload}), contentType: 'application/json'});
  } finally { await stopChild(child); }
});

test('managed headless generations require explicit activation and retain the selected generation across busy retry',async({},info)=>{
  const {fork}=await import('node:child_process');
  const {watchGenerations,classScript}=await import('../runtime/lifecycle/generations');
  const {classes}=await import('../tools/game/manifest');
  const directory=path.resolve('.build/e2e','explicit-code-'+randomUUID()),code=path.join(directory,'code');
  await mkdir(code,{recursive:true});
  async function generation(label:string){
    const entries:any={};
    for(const name of classes){const source=`globalThis.executed=${JSON.stringify(label+':'+name)};`,sha256=hash(source),file=`generated/${sha256}/${name}.js`;await mkdir(path.dirname(path.join(code,file)),{recursive:true});await writeFile(path.join(code,file),source);entries[name]={file,sha256,inputs:[]};}
    return {schema:1 as const,generation:hash(classes.map(name=>name+':'+entries[name].sha256).join('\n')),classes:entries};
  }
  const a=await generation('A'),b=await generation('B'),c=await generation('C');
  const manifestFile=path.join(code,'manifest.json'),activationFile=path.join(code,'activation.json');
  await writeFile(manifestFile,JSON.stringify(a));
  const workerFile=path.join(directory,'worker.cjs');
  await writeFile(workerFile,`const fs=require('node:fs'),path=require('node:path');let busy=true;process.on('message',m=>{if(m.type!=='reload_code')return;if(busy){busy=false;process.send({type:'observed',status:'busy',generation:m.generation});process.send({type:'code_reload_result',id:m.id,generation:m.generation,status:'busy'});return;}const source=fs.readFileSync(path.join(${JSON.stringify(code)},m.script.replace('adventure_land/','')),'utf8');eval(source);process.send({type:'observed',status:'ready',generation:m.generation,executed:globalThis.executed});process.send({type:'code_reload_result',id:m.id,generation:m.generation,status:'ready'});});`);
  const worker=fork(workerFile,[],{stdio:['ignore','pipe','pipe','ipc']}),ledger:any[]=[],reports:any[]=[];
  worker.on('message',m=>{if((m as any)?.type==='observed')ledger.push(m);});
  const liveWorker={name:'W',className:'warrior',process:worker,script:'adventure_land/'+a.classes.warrior.file};
  const activator=watchGenerations({directory:code,activationFile,workers:()=>[liveWorker],current:()=>true,activated:(_w,script)=>{liveWorker.script=script;},restart:async()=>{throw Error('Unexpected native restart');},report:(message,detail)=>reports.push({message,detail})});
  try{
    await writeFile(manifestFile,JSON.stringify(b));
    await new Promise(resolve=>setTimeout(resolve,2500));
    expect(ledger).toHaveLength(0);
    const {atomicJson}=await import('../tools/build-store');
    await atomicJson(activationFile,{id:'explicit-B',manifest:b});
    await expect.poll(()=>ledger.some(e=>e.status==='busy'),{timeout:5000}).toBe(true);
    await writeFile(manifestFile,JSON.stringify(c));
    await expect.poll(()=>ledger.some(e=>e.executed==='B:warrior'),{timeout:8000}).toBe(true);
    expect(liveWorker.script).toBe('adventure_land/'+b.classes.warrior.file);
    expect(classScript(code,'warrior'),'Worker recovery must use the explicitly selected generation').toBe(liveWorker.script);
    expect(ledger.some(e=>e.generation===c.classes.warrior.sha256)).toBe(false);
    await atomicJson(activationFile,{id:'explicit-rollback',manifest:a});
    await expect.poll(()=>ledger.some(e=>e.executed==='A:warrior'),{timeout:5000}).toBe(true);
    await info.attach('explicit-headless-activation-and-busy-retry',{body:JSON.stringify({a,b,c,ledger,reports}),contentType:'application/json'});
  }finally{activator.dispose();await stopChild(worker);}
});

// Failure inventory: e2e/console-deployment-reload-failures.md.
test('a rollback written under the activation\'s own id returns the workers to the previous generation',async({},info)=>{
  const {fork}=await import('node:child_process');
  const {watchGenerations}=await import('../runtime/lifecycle/generations');
  const {classes}=await import('../tools/game/manifest');
  const {atomicJson}=await import('../tools/build-store');
  const directory=path.resolve('.build/e2e','rollback-code-'+randomUUID()),code=path.join(directory,'code');
  await mkdir(code,{recursive:true});
  async function generation(label:string){
    const entries:any={};
    for(const name of classes){const source=`globalThis.executed=${JSON.stringify(label+':'+name)};`,sha256=hash(source),file=`generated/${sha256}/${name}.js`;await mkdir(path.dirname(path.join(code,file)),{recursive:true});await writeFile(path.join(code,file),source);entries[name]={file,sha256,inputs:[]};}
    return {schema:1 as const,generation:hash(classes.map(name=>name+':'+entries[name].sha256).join('\n')),classes:entries};
  }
  const a=await generation('A'),b=await generation('B');
  await writeFile(path.join(code,'manifest.json'),JSON.stringify(a));
  const activationFile=path.join(code,'activation.json'),workerFile=path.join(directory,'worker.cjs');
  await writeFile(workerFile,`const fs=require('node:fs'),path=require('node:path');process.on('message',m=>{if(m.type!=='reload_code')return;const source=fs.readFileSync(path.join(${JSON.stringify(code)},m.script.replace('adventure_land/','')),'utf8');eval(source);process.send({type:'observed',generation:m.generation,executed:globalThis.executed});process.send({type:'code_reload_result',id:m.id,generation:m.generation,status:'ready'});});`);
  const worker=fork(workerFile,[],{stdio:['ignore','pipe','pipe','ipc']}),ledger:any[]=[],reports:any[]=[];
  worker.on('message',m=>{if((m as any)?.type==='observed')ledger.push(m);});
  const liveWorker={name:'M',className:'merchant',process:worker,script:'adventure_land/'+a.classes.merchant.file};
  const activator=watchGenerations({directory:code,activationFile,workers:()=>[liveWorker],current:()=>true,activated:(_w,script)=>{liveWorker.script=script;},restart:async()=>{throw Error('Unexpected native restart');},report:(message,detail)=>reports.push({message,detail})});
  try{
    // The host's activation, then its rollback: the same deployment id, the previous manifest.
    await atomicJson(activationFile,{id:'deployment-1',manifest:b});
    await expect.poll(()=>ledger.at(-1)?.executed,{timeout:8000}).toBe('B:merchant');
    await atomicJson(activationFile,{id:'deployment-1',manifest:a});
    await expect.poll(()=>ledger.at(-1)?.executed,{timeout:8000,message:'The rollback must return the worker to generation A'}).toBe('A:merchant');
    // 3: rewriting the same record changes nothing.
    const reloads=ledger.length;
    await atomicJson(activationFile,{id:'deployment-1',manifest:a});
    await new Promise(resolve=>setTimeout(resolve,2500));
    expect(ledger.length,'An unchanged activation record is not reapplied').toBe(reloads);
    await info.attach('same-id-rollback',{body:JSON.stringify({ledger,reports}),contentType:'application/json'});
  }finally{activator.dispose();await stopChild(worker);}
});

test('during a deployment hold a paused merchant job does not block the reload the CODE allows',async({},info)=>{
  const vm=await import('node:vm');
  const {JSDOM}=await import('../.caracal/node_modules/jsdom/lib/api.js' as string) as any;
  const {createRunnerHost}=await import('../runtime/lifecycle/runner-host.ts' as string) as any;
  const directory=path.resolve('.build/e2e','merchant-hold-'+randomUUID());await mkdir(directory,{recursive:true});
  const codeFile=path.join(directory,'entry.js'),upper:any={caracAL:{},loaded:[] as string[],canReload:true,record(value:string){this.loaded.push(value);}};
  // What shared.js does while the lease holds: its job stays active (paused), and canReload()
  // reports whether a bank or upgrade transaction is in flight.
  const code=(label:string)=>`parent.record(${JSON.stringify(label)});globalThis.__merchantActiveJob={reason:'auto compound'};globalThis.sharedRoutine={canReload:()=>parent.canReload,isOccupied:()=>true,stop(){}};`;
  await writeFile(codeFile,code('old'));
  const messages:any[]=[];
  const host=createRunnerHost({upper,codeFile,runnerFiles:[],
    createContext(parent:any){const window=new JSDOM('',{url:'https://adventure.land/'}).window;window.globalThis=window;Object.defineProperty(window,'parent',{value:parent});vm.createContext(window);return window;},
    async evaluateFiles(_files:any,context:any){vm.runInContext('var character={rip:false};function set_message(){}',context);},
    async connected(){},send:(message:any)=>messages.push(message)} as any);
  try{
    await host.start();
    // A transaction in flight keeps the reload waiting.
    upper.canReload=false;await writeFile(codeFile,code('during transaction'));
    await host.reload({id:'transaction',generation:'2'} as any);
    expect(messages.at(-1)?.status,'A bank or upgrade transaction in flight still answers busy').toBe('busy');
    // 1: the job is paused for the hold and canReload() allows it.
    upper.canReload=true;await writeFile(codeFile,code('new'));
    await host.reload({id:'hold',generation:'3'} as any);
    expect(messages.at(-1)?.status,'The paused merchant job must not block the reload').toBe('ready');
    expect(upper.loaded.at(-1)).toBe('new');
    await info.attach('merchant-hold-reload',{body:JSON.stringify({messages,loaded:upper.loaded}),contentType:'application/json'});
  }finally{await host.dispose();await filesystem.rm(directory,{recursive:true,force:true});}
});

// Failure inventory: startup keeps an older active build; it chases builds made
// after launch; no-op restarts create deployments; readiness failures select
// broken code; recovery is skipped; source files replace verified executables.
// Coordinator and dashboard processes are real; game CODE receipts use the
// declared native boundary in processHost, separately from process readiness.
test('console startup deploys its newest completed snapshot and rolls back failed readiness', async ({}, info) => {
  const parent=path.resolve('.build/p79'),root=path.join(parent,randomUUID().slice(0,8)),store=new ConsoleBuildStore(root);
  let host:Awaited<ReturnType<typeof processHost>>|undefined;
  try {
    const a=await stage(store,root,'startup-A',1), b=await stage(store,root,'startup-B',2);
    await store.setReferences({active:a.manifest.id,latest:b.manifest.id});
    const selected=await startupCandidate(store);
    expect(selected?.manifest.id).toBe(b.manifest.id);
    const c=await stage(store,root,'startup-C',3);
    const saved=path.join(root,'account-state.json');await writeFile(saved,JSON.stringify({job:'preserve',gold:1234}));
    host=await processHost(store,info);
    await host.driver.activate(a,undefined,AbortSignal.timeout(5000));
    // Interrupted preparation is recovered before the automatic startup load.
    await store.setJournal({id:'interrupted',target:c.manifest.id,previous:a.manifest.id,startedAt:new Date().toISOString(),phase:'preparing'});
    await host.controller.recover();
    expect((await store.journal())?.phase).toBe('failed');
    await deployStartupCandidate(host.controller,selected?.manifest.id);
    let snapshot={refs:await store.references(),identity:await host.observation(),dashboard:await host.body(),operation:await store.journal()};
    expect(snapshot.refs.active).toBe(b.manifest.id);expect(snapshot.refs.latest).toBe(c.manifest.id);
    expect(snapshot.identity.artifactId).toBe(b.manifest.id);expect(snapshot.dashboard).toBe('startup-B');
    expect(snapshot.operation?.phase).toBe('complete');
    const unchangedId=snapshot.operation?.id;
    await deployStartupCandidate(host.controller,b.manifest.id);
    expect((await store.journal())?.id).toBe(unchangedId);
    await info.attach('startup-frozen-selection',{body:JSON.stringify(snapshot),contentType:'application/json'});
    await host.stop();host=undefined;
    // The next launch picks up C, which was deliberately left staged above.
    const next=await startupCandidate(store);expect(next?.manifest.id).toBe(c.manifest.id);
    host=await processHost(store,info);await host.driver.activate(b,undefined,AbortSignal.timeout(5000));
    await deployStartupCandidate(host.controller,next?.manifest.id);
    expect((await host.observation()).artifactId).toBe(c.manifest.id);expect(await host.body()).toBe('startup-C');
    const bad=await stage(store,root,'startup-broken',4,true);
    await expect(deployStartupCandidate(host.controller,(await startupCandidate(store))?.manifest.id)).rejects.toThrow('Startup console deployment failed');
    snapshot={refs:await store.references(),identity:await host.observation(),dashboard:await host.body(),operation:await store.journal()};
    expect(snapshot.refs.active).toBe(c.manifest.id);expect(snapshot.identity.artifactId).toBe(c.manifest.id);
    expect(snapshot.dashboard).toBe('startup-C');expect(snapshot.operation?.phase).toBe('failed');
    expect(JSON.parse(await readFile(saved,'utf8'))).toEqual({job:'preserve',gold:1234});
    await info.attach('startup-readiness-rollback',{body:JSON.stringify(snapshot),contentType:'application/json'});
    await writeFile(path.join(bad.directory,'coordinator.mts'),'corrupted');
    await expect(startupCandidate(store)).rejects.toThrow();
    expect((await store.references()).active).toBe(c.manifest.id);
  } finally {
    await host?.stop();
    if(path.dirname(root)!==parent)throw Error('Startup E2E cleanup escaped owned workspace');
    await filesystem.rm(root,{recursive:true,force:true});
    await info.attach('startup-workspace-cleanup',{body:JSON.stringify({root,removed:true}),contentType:'application/json'});
  }
});

// Host module selection is also part of startup: importing the previous host
// would miss fixes even if its coordinator later deployed the right candidate.
test('console startup imports the newest completed host implementation', async ({},info)=>{
  const parent=path.resolve('.build/p79'),root=path.join(parent,randomUUID().slice(0,8)),store=new ConsoleBuildStore(root);
  try {
    const host=(label:string)=>({'tools/console-build/hosting.ts':`export function createManagedConsole(root,services,options){return {implementation:${JSON.stringify(label)},options};}`});
    const a=await stage(store,root,'startup-host-A',1,false,undefined,host('A'));
    const b=await stage(store,root,'startup-host-B',2,false,undefined,host('B'));
    await store.setReferences({active:a.manifest.id,latest:b.manifest.id});
    const selected=await loadManagedConsole(root,{} as Services,{dashboardPort:1,apiPort:2}) as unknown as {implementation:string;options:{startupCandidateId:string}};
    expect(selected.implementation).toBe('B');expect(selected.options.startupCandidateId).toBe(b.manifest.id);
    // Selection alone must not mark an unacknowledged candidate active.
    expect((await store.references()).active).toBe(a.manifest.id);
    await info.attach('startup-host-selection',{body:JSON.stringify(selected),contentType:'application/json'});
  }finally{
    if(path.dirname(root)!==parent)throw Error('Startup E2E cleanup escaped owned workspace');
    await filesystem.rm(root,{recursive:true,force:true});
    await info.attach('startup-host-workspace-cleanup',{body:JSON.stringify({root,removed:true}),contentType:'application/json'});
  }
});
