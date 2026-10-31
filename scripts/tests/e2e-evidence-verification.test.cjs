const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');

// Failure inventory: declared native-backend exclusions reject otherwise green
// evidence; accepting arbitrary skips hides missing coverage; changed artifacts
// or failed outcomes become accepted along with the backend exclusions.
function verify(change=()=>{}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'party-evidence-'));
  try {
    fs.mkdirSync(path.join(root,'.build/e2e-results'),{recursive:true});
    fs.mkdirSync(path.join(root,'.build/e2e-report'),{recursive:true});
    const bytes=Buffer.from('native receipt'),file='.build/e2e-results/receipt.txt';
    fs.writeFileSync(path.join(root,file),bytes);
    const passed={title:'native gameplay',status:'passed',expectedStatus:'passed',location:'e2e/live-game.spec.ts'};
    const skipped={title:'ChronAL handshake',status:'skipped',expectedStatus:'skipped',location:'e2e/chronal-clock-reconnect.case.ts'};
    const manifest={schema:1,status:'passed',gameplayBackend:'native',selectedTests:[passed.title,skipped.title],tests:[passed,skipped],
      artifacts:[{path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]};
    change(manifest,root);
    fs.writeFileSync(path.join(root,'.build/e2e-report/manifest.json'),JSON.stringify(manifest));
    return spawnSync(process.execPath,[path.resolve('e2e/verify-artifacts.cjs'),root],{encoding:'utf8',windowsHide:true});
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
test('native evidence accepts explicitly expected ChronAL transport exclusions',()=>assert.equal(verify().status,0));
for(const [name,change] of [
  ['unexpected skip',m=>{m.tests[1].expectedStatus='passed';}],
  ['ordinary gameplay skip',m=>{m.tests[1].location='e2e/live-game.spec.ts';}],
  ['ChronAL backend skip',m=>{m.gameplayBackend='chronal';}],
  ['failed gameplay',m=>{m.tests[0].status='failed';}],
  ['modified receipt',(m,root)=>fs.writeFileSync(path.join(root,m.artifacts[0].path),'changed')],
])test('evidence still rejects '+name,()=>assert.notEqual(verify(change).status,0));
