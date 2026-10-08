// Real OS/container boundary; run: node scripts/validate-journal-container-restart.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),name='journal-lock-'+randomUUID();
const directory=fs.mkdtempSync(path.join(root,'.build','journal-container-'));
const relative=path.relative(root,directory).replaceAll('\\','/');
const main='/workspace/'+relative+'/state.jsonl',replacement=main+'.new';
const args=['--mount',`type=bind,source=${root},target=/workspace`,'--workdir','/workspace','node:24.14.0-bookworm','node','--experimental-strip-types','-e'];
const prelude=`const fs=require('fs');const {CoordinatorJsonlStore:S}=require('./runtime/coordinator/persistence/jsonl-store.ts');`;
function docker(parameters){const result=spawnSync('docker',parameters,{encoding:'utf8',timeout:30000});if(result.error)throw result.error;return result;}
(async()=>{
 try{
  let result=docker(['run','--detach','--name',name,...args,prelude+`const s=new S(${JSON.stringify(main)},${JSON.stringify(replacement)});s.set('saved',{value:7});fs.writeFileSync(${JSON.stringify(main+'.ready')},'ready');setInterval(()=>{},1000);`]);
  assert.equal(result.status,0,result.stderr);
  const deadline=Date.now()+15000;while(!fs.existsSync(path.join(directory,'state.jsonl.ready'))&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
  assert.ok(fs.existsSync(path.join(directory,'state.jsonl.ready')),'writer ready');
  const before=JSON.parse(fs.readFileSync(path.join(directory,'state.jsonl.writer.lock'),'utf8'));
  result=docker(['run','--rm',...args,prelude+`try{new S(${JSON.stringify(main)},${JSON.stringify(replacement)});process.exit(2);}catch(e){if(!String(e).includes('live writer'))throw e;console.log('competing container blocked');}`]);
  assert.equal(result.status,0,result.stderr);
  result=docker(['run','--detach','--name',name+'-recovery',...args,prelude+`const timer=setInterval(()=>{if(!fs.existsSync(${JSON.stringify(main+'.release')}))return;clearInterval(timer);const s=new S(${JSON.stringify(main)},${JSON.stringify(replacement)});fs.writeFileSync(${JSON.stringify(main+'.recovered')},JSON.stringify({saved:s.get('saved'),identity:JSON.parse(fs.readFileSync(${JSON.stringify(main+'.writer.lock')},'utf8'))}));s.close();},50);`]);
  assert.equal(result.status,0,result.stderr);
  assert.equal(docker(['kill','--signal','KILL',name]).status,0);
  fs.writeFileSync(path.join(directory,'state.jsonl.release'),'go');
  result=docker(['wait',name+'-recovery']);assert.equal(result.stdout.trim(),'0',result.stderr);
  const after=JSON.parse(fs.readFileSync(path.join(directory,'state.jsonl.recovered'),'utf8'));
  assert.deepEqual(after.saved,{value:7});assert.equal(before.pid,after.identity.pid);
  assert.notEqual(before.namespace,after.identity.namespace);
  const evidence={command:'node scripts/validate-journal-container-restart.cjs',image:'node:24.14.0-bookworm',before,after,competingContainer:'blocked',shutdown:'SIGKILL',result:'passed'};
  fs.writeFileSync(path.join(directory,'evidence.json'),JSON.stringify(evidence,null,2));console.log('Passed; evidence: '+path.join(directory,'evidence.json'));
 }finally{docker(['rm','--force',name,name+'-recovery']);}
})().catch(error=>{console.error(error);process.exitCode=1;});
