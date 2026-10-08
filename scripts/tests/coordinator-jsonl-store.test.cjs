const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {CoordinatorJsonlStore:Store}=require('../../runtime/coordinator/persistence/jsonl-store.ts');
const {syncBuiltinESMExports}=require('node:module');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
test('Linux stat token parsing uses field 22 after the full command name',()=>{
 const {linuxProcessStart}=require('../../runtime/coordinator/persistence/process-lock.ts');
 assert.equal(linuxProcessStart('82 (worker (name) here) S '+Array.from({length:18},(_,i)=>String(i+4)).join(' ')+' 999 23'),'999');
 assert.equal(linuxProcessStart('malformed'),undefined);
});

test('abruptly terminated process releases stale ownership on next journal open',async t=>{
 const [main,rotation]=fixture(t);
 const script=`const {CoordinatorJsonlStore}=require('./runtime/coordinator/persistence/jsonl-store.ts');const s=new CoordinatorJsonlStore(process.argv[1],process.argv[2]);s.set('saved',{value:7});process.send('ready');setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--experimental-strip-types','-e',script,main,rotation],{stdio:['ignore','pipe','pipe','ipc']});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 await once(child,'message');
 assert.throws(()=>new Store(main,rotation),/live writer/);
 const exited=once(child,'exit');child.kill('SIGKILL');await exited;
 const restored=new Store(main,rotation);try{assert.deepEqual(restored.get('saved'),{value:7});}finally{restored.close();}
});

test('legacy live PID and malformed ownership locks are preserved conservatively',t=>{
 const [main,rotation]=fixture(t),lock=main+'.writer.lock';
 for(const value of [String(process.pid),'', '{broken',JSON.stringify({version:1,pid:process.pid})]){
  fs.writeFileSync(lock,value);assert.throws(()=>new Store(main,rotation),/live writer|unverifiable/);
  assert.equal(fs.readFileSync(lock,'utf8'),value);fs.unlinkSync(lock);
 }
});

test('Linux process token distinguishes a reused live PID and previous boot', {skip:process.platform!=='linux'},t=>{
 const [main,rotation]=fixture(t),s=new Store(main,rotation),lock=main+'.writer.lock';
 const identity=JSON.parse(fs.readFileSync(lock,'utf8'));s.close();
 for(const patch of [{start:'0'},{boot:'previous-boot'}]){
  fs.writeFileSync(lock,JSON.stringify({...identity,...patch}));
  const recovered=new Store(main,rotation);recovered.close();
 }
 fs.writeFileSync(lock,JSON.stringify({...identity,namespace:'foreign-namespace'}));
 const recovered=new Store(main,rotation);recovered.close();
});

test('Linux advisory guard persists its inode and prevents a second file-description writer', {skip:process.platform!=='linux'},t=>{
 const [main,rotation]=fixture(t),first=new Store(main,rotation),guard=main+'.writer.guard';
 const inode=fs.statSync(guard).ino;assert.throws(()=>new Store(main,rotation),/live writer/);
 first.close();assert.equal(fs.statSync(guard).ino,inode);
 const next=new Store(main,rotation);next.close();assert.equal(fs.statSync(guard).ino,inode);
});
function fixture(t){fs.mkdirSync('.build/store-tests',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.build/store-tests/run-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return [path.join(dir,'state.jsonl'),path.join(dir,'state.new.jsonl')];}
test('loads a journal beyond the V8 string limit without reading it into one string',t=>{
 const [main,rotation]=fixture(t),fd=fs.openSync(main,'w');
 const record=JSON.stringify({history:'x'.repeat(256*1024)})+'\n';
 for(let i=0;i<2100;i++)fs.writeFileSync(fd,record);
 fs.writeFileSync(fd,JSON.stringify({history:'latest'})+'\n'+JSON.stringify({unicode:'dreams ✨ 🐈'})+'\n');fs.closeSync(fd);
 assert.ok(fs.statSync(main).size>0x1fffffe8);
 const s=new Store(main,rotation);try {assert.equal(s.get('history'),'latest');assert.equal(s.get('unicode'),'dreams ✨ 🐈');assert.ok(fs.statSync(main).size<1000);}finally{s.close();}
});
test('preserves legacy tombstones, objects, UTF-8 chunk boundaries, and final record without newline',t=>{
 const [main,rotation]=fixture(t);const value='猫'.repeat(50000);
 fs.writeFileSync(main,JSON.stringify({a:1})+'\n'+JSON.stringify({a:null})+'\n'+JSON.stringify({b:{value}}));
 const s=new Store(main,rotation);s.set('other',false);s.close();
 const r=new Store(main,rotation);try {assert.equal(r.get('a'),undefined);assert.deepEqual(r.get('b'),{value});assert.equal(r.get('other'),false);}finally{r.close();}
});
test('compacts by size even without yielding to the interval; latest updates and deletion survive restart',t=>{
 const [main,rotation]=fixture(t),s=new Store(main,rotation);const value='x'.repeat(1024*1024);
 for(let i=0;i<140;i++)s.set('state',value+i);
 assert.ok(fs.statSync(main).size<32*1024*1024);s.set('keep',3);s.delete('state');s.close();
 const r=new Store(main,rotation);try{assert.equal(r.get('state'),undefined);assert.equal(r.get('keep'),3);}finally{r.close();}
});
test('a live writer is protected and closing releases its lock',t=>{
 const [main,rotation]=fixture(t),s=new Store(main,rotation);
 assert.throws(()=>new Store(main,rotation),/live writer/);s.close();const r=new Store(main,rotation);r.close();
});
test('malformed input preserves the source and releases the startup lock',t=>{
 const [main,rotation]=fixture(t);fs.writeFileSync(main,'{"valid":1}\n{"broken"');const original=fs.readFileSync(main);
 assert.throws(()=>new Store(main,rotation));assert.deepEqual(fs.readFileSync(main),original);assert.equal(fs.existsSync(main+'.writer.lock'),false);
});
test('recovers a completed replacement only if the main file is absent',t=>{
 const [main,rotation]=fixture(t);fs.writeFileSync(rotation,'{"keep":7}\n');const s=new Store(main,rotation);assert.equal(s.get('keep'),7);s.close();
});

for(const code of ['EPERM','EACCES','EBUSY'])test('temporary '+code+' during rotation retains writes and defers compaction',async t=>{
 const [main,rotation]=fixture(t),s=new Store(main,rotation);t.after(()=>s.close());
 s.set('keep',1);s.set('remove',2);let now=1000,calls=0;
 const rename=fs.renameSync;t.mock.method(Date,'now',()=>now);
 t.mock.method(fs,'renameSync',(...args)=>{calls++;if(calls===1)throw Object.assign(Error('file in use'),{code});return rename(...args);});
 syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 assert.doesNotThrow(()=>s.refactor());
 s.set('keep',3);s.delete('remove');s.refactor();assert.equal(calls,1,'no tight compaction retry loop');
 const replay=()=>Object.assign({},...fs.readFileSync(main,'utf8').trim().split('\n').map(JSON.parse));
 assert.deepEqual(replay(),{keep:3,remove:null},'original journal contains writes after failed rename');
 now+=30000;s.refactor();assert.equal(calls,2);
 // Windows scanners can also deny the real rename after our injected failure.
 // Each additional retry still waits the full logical backoff and preserves data.
 for(let attempt=0;Object.hasOwn(replay(),'remove')&&attempt<20;attempt++) {
  assert.deepEqual(replay(),{keep:3,remove:null});
  const previousCalls=calls;s.refactor();assert.equal(calls,previousCalls);
  await new Promise(resolve=>setTimeout(resolve,25));
  now+=30000;s.refactor();assert.equal(calls,previousCalls+1);
 }
 assert.deepEqual(replay(),{keep:3});
 s.close();const restored=new Store(main,rotation);try{assert.equal(restored.get('keep'),3);assert.equal(restored.get('remove'),undefined);}finally{restored.close();}
});

test('non-sharing rotation failures remain visible and leave the append journal usable',t=>{
 const [main,rotation]=fixture(t),s=new Store(main,rotation);t.after(()=>s.close());s.set('keep',1);
 t.mock.method(fs,'renameSync',()=>{throw Object.assign(Error('I/O failure'),{code:'EIO'});});
 syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 assert.throws(()=>s.refactor(),/I\/O failure/);s.set('keep',2);assert.equal(s.get('keep'),2);s.close();
});
