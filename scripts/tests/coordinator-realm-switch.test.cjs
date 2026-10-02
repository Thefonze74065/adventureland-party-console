const test = require('node:test');
const assert = require('node:assert/strict');
const {createRealmSwitch} = require('../../runtime/coordinator/characters/realm-switch.ts');
const {createShutdown} = require('../../runtime/coordinator/lifecycle/shutdown.ts');

function fixture() {
  let now=1000, id=0;
  const effects=[], statuses={}, blocks={M:{enabled:true},P:{enabled:true},S:{enabled:true}};
  const operation={id:'switch',realm:'SR_EUI',participants:['M','P','S'],startedAt:1000,phase:'switching',characters:[]};
  const ports={now:()=>now,sleep:async ms=>{now+=ms;},pauseMerchant:()=>effects.push('pause'),
    clearCommand:name=>effects.push(['clear',name]),native:()=> 'S',steamMembers:()=>['S'],block:name=>blocks[name],
    stop:async block=>effects.push(['stop',block]),nextCommand:()=>++id,command:(...args)=>effects.push(['command',...args]),
    persist:()=>effects.push('persist'),status:name=>statuses[name],setActiveRealm:realm=>effects.push(['realm',realm]),
    label:realm=>realm,leader:()=> 'P',dispatchMerchant:()=>effects.push('dispatch')};
  return {operation,ports,effects,statuses,blocks,service:createRealmSwitch(ports)};
}

test('realm switch restarts headless workers and commands only the primary Steam character',async()=>{
  const {operation,service,statuses,effects,blocks}=fixture();
  for(const name of operation.participants) statuses[name]={seenAt:1000,server:'EUI',ctype:name==='M'?'merchant':'priest'};
  await service.run(operation);
  assert.equal(operation.phase,'complete');
  assert.equal(blocks.M.realm,'SR_EUI');assert.equal(blocks.P.realm,'SR_EUI');assert.equal(blocks.S.realm,undefined);
  assert.deepEqual(effects.filter(e=>Array.isArray(e)&&e[0]==='command').map(e=>[e[1],e[2].type]),[['S','native-realm-switch']]);
  assert.equal(effects.at(-1),'dispatch');
});

test('stale destination reports do not satisfy the sixty-second arrival deadline',async()=>{
  const {operation,service,statuses,effects}=fixture();
  for(const name of operation.participants) statuses[name]={seenAt:999,server:'EUI'};
  await service.run(operation);
  assert.equal(operation.phase,'failed');assert.equal(operation.completedAt,61000);
  assert.match(operation.error,/within 60 seconds/);assert.equal(effects.includes('dispatch'),false);
});

test('all-headless participants reconnect to the destination without a native command',async()=>{
 for(const setHome of [false,true]) {
  const {operation,service,ports,statuses,effects,blocks}=fixture();
  operation.setHome=setHome;ports.native=()=>null;ports.steamMembers=()=>[];
  for(const name of operation.participants) statuses[name]={seenAt:999,server:'USII',ctype:name==='M'?'merchant':'priest'};
  ports.sleep=async()=>{
   for(const name of operation.participants) statuses[name]={...statuses[name],seenAt:1001,server:'EUI'};
  };
  await service.run(operation);
  assert.equal(operation.phase,setHome?'setting-home':'complete');
  for(const name of operation.participants) assert.equal(blocks[name].realm,'SR_EUI');
  assert.equal(effects.filter(e=>Array.isArray(e)&&e[0]==='stop').length,3);
  assert.ok(operation.characters.every(entry=>entry.arrived));
  const commands=effects.filter(e=>Array.isArray(e)&&e[0]==='command');
  assert.deepEqual(commands.map(e=>[e[1],e[2].type]),setHome?[['M','realm-set-home'],['P','realm-set-home'],['S','realm-set-home']]:[]);
  assert.equal(effects.includes('dispatch'),!setHome);
 }
});

test('home realm is per character: every connected participant, merchant included, visits Bean after arrival',async()=>{
  const {operation,service,statuses,effects}=fixture();operation.setHome=true;
  for(const name of operation.participants) statuses[name]={seenAt:1000,server:'EUI',ctype:name==='M'?'merchant':'priest'};
  await service.run(operation);
  assert.equal(operation.phase,'setting-home');assert.deepEqual(operation.homeTargets,['M','P','S']);
  assert.deepEqual(operation.homePending,['M','P','S']);assert.equal(operation.completedAt,null);
  assert.deepEqual(effects.filter(e=>Array.isArray(e)&&e[0]==='command'&&e[2].type==='realm-set-home').map(e=>e[1]),['M','P','S']);
});

test('shutdown waits for workers before closing storage and ignores duplicate requests',async()=>{
  const effects=[];let finish;
  const shutdown=createShutdown({log:()=>{},stopCharacters:()=>new Promise(resolve=>{effects.push('stop');finish=resolve;}),
    closeStorage:()=>effects.push('close'),exit:()=>effects.push('exit')});
  const pending=shutdown('SIGTERM');await shutdown('reload');assert.deepEqual(effects,['stop']);
  finish();await pending;assert.deepEqual(effects,['stop','close','exit']);
});
