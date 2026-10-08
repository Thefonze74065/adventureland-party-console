const test=require('node:test'),assert=require('node:assert/strict');
const {createRosterProjection,coordinatorRealmLabel}=require('../../runtime/coordinator/characters/roster-projection.ts');
function fixture(){let account={characters:[{name:'M',type:'merchant',home:'USII',server:'SR_USIII'},{name:'F',type:'priest',server:'SR_USII'},{name:'B',type:'merchant'}],servers:[{key:'SR_USI',players:'42'},{key:'SR_EUPVP'}]};
 const state={bankbois:{B:{}},statuses:{},headlessSlots:['F','B',null,null],steamMembers:['M'],nativeOwner:'M',lifecycle:{F:'starting'},activeRealm:'SR_USII',realmSwitch:{phase:'arriving'}};
 return {state,service:createRosterProjection(state,()=>account,()=>100000),replace:value=>account=value};}
test('roster excludes BankBoi and reads account replacements without caching',()=>{
 const f=fixture();assert.deepEqual(f.service.roster().map(x=>x.name),['F','M']);assert.equal(f.service.homeRealm(),null);
 f.replace({characters:[{name:'New',home:'SR_EUI'}]});assert.equal(f.service.owned('M'),undefined);assert.equal(f.service.homeRealm(),'SR_EUI');assert.deepEqual(f.service.roster().map(x=>x.name),['New']);
});
test('ownership lookup compares raw names without coercing untrusted request values',()=>{
 const f=fixture(),character=f.service.owned('M');assert.equal(character.name,'M');
 for(const name of [null,undefined,42,{name:'M'},{toString:()=>{throw new Error('must not coerce');}}])
  assert.equal(f.service.owned(name),undefined);
 assert.equal(f.service.owned('M'),character);
});
test('slots preserve Steam ownership, lifecycle state, empty capacity, and heartbeat boundary',()=>{
 const f=fixture();f.state.statuses.M={name:'M',seenAt:90000};
 const slots=f.service.slots();assert.equal(slots.length,4);assert.equal(slots[0].index,0);assert.equal(slots[0].primary,true);assert.equal(slots[0].state,'offline');assert.equal(slots[1].state,'starting');
 f.state.statuses.M.seenAt++;assert.equal(f.service.slots()[0].state,'online');assert.deepEqual(f.service.participants(),['M','F']);
 f.state.steamMembers.push('F');assert.deepEqual(f.service.participants(),['M','F']);assert.equal(f.service.slots().length,4);
});
test('realm control ignores merchant travel when detecting split combat realms',()=>{
 const f=fixture();f.state.statuses.F={name:'F',seenAt:85000,server:'EUI',ctype:'priest'};
 const control=f.service.control();assert.equal(control.currentRealm,'SR_EUI');assert.equal(control.merchantRealm,'SR_USIII');assert.equal(control.split,false);assert.equal(control.characters[1].online,true);
 assert.deepEqual(control.realms[0],{key:'SR_USI',label:'US I',players:42,pvp:false});assert.equal(control.realms[1].pvp,true);assert.equal(control.operation,f.state.realmSwitch);
 f.state.statuses.F.seenAt--;assert.equal(f.service.control().currentRealm,'SR_USII');assert.equal(f.service.control().characters[1].online,false);
 f.state.headlessSlots[2]='Other';f.state.statuses.Other={name:'Other',ctype:'warrior',seenAt:100000,server:'EUI'};
 assert.equal(f.service.control().split,true);assert.equal(f.service.control().currentRealm,null);
 assert.equal(coordinatorRealmLabel('SR_ASIAIII'),'ASIA III');
 assert.equal(coordinatorRealmLabel('SR_ASIAIV'),'ASIA IV');
 assert.equal(coordinatorRealmLabel('SR_USV'),'US V');
});
