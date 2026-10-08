const test=require('node:test'),assert=require('node:assert/strict');
const {createWorkerSetup}=require('../../runtime/coordinator/characters/worker-setup.ts');
function fixture(){const workers={},state={activeRealm:'SR_USII',location:{realm:'SR_EUI'},headlessSlots:[null,null],lifecycle:{}},calls=[];
 const service=createWorkerSetup(workers,state,{configuredRealm:'SR_USI',homeRealm:()=> 'SR_USII',script:name=>name+'.js',watch:(name,block)=>calls.push(['watch',name,block]),persist:()=>calls.push(['persist',state.headlessSlots.slice()]),start:name=>calls.push(['start',name])});
 return {workers,state,calls,service};}
test('dormant worker setup selects native home and preserves version while replacing legacy watchers',()=>{
 const f=fixture();let closed=0;const block={realm:'SR_USIII',version:4,connected:1,code_watcher:{close:()=>closed++}};f.workers.M=block;
 assert.equal(f.service.ensure('M'),block);assert.equal(closed,1);assert.equal(block.code_watcher,null);assert.equal(block.realm,'SR_USII');assert.equal(block.version,4);assert.equal(block.connected,true);assert.equal(block.script,'M.js');
 f.service.ensure('M');assert.equal(closed,1);assert.equal(f.calls.length,2);
});
