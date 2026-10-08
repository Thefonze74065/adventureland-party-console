const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorPersistence}=require('../../runtime/coordinator/persistence/writer.ts');
test('settings persist selections before settings and exclude transient state and auth keys',()=>{
 const writes=[],state={monsterFocus:[],merchantCharacter:'M',commands:{secret:'runtime'},aldata:{key:'auth-secret',trades:[1]}};
 const writer=createCoordinatorPersistence(state,{set:(key,value)=>writes.push([key,JSON.parse(JSON.stringify(value))])});writer.settings();
 assert.equal(writes[0][0],'party_dashboard_selections_state_v1');assert.deepEqual(writes[0][1].monsterFocus,[]);assert.equal(writes[1][0],'party_dashboard_settings_state_v1');assert.deepEqual(writes[1][1].aldataTrades,[1]);assert.equal(writes[1][1].commands,undefined);assert.equal(JSON.stringify(writes).includes('auth-secret'),false);
 state.monsterFocus=['bat'];writer.settings();assert.deepEqual(writes[2][1].monsterFocus,['bat']);
});
test('persistence writes separate roster, bank, capped history and authentication documents',()=>{
 const writes=[],state={headlessSlots:['F'],bankbois:{B:{}},merchantActivity:Array.from({length:501},(_,i)=>i),combatLogs:{F:Array.from({length:501},(_,i)=>i)},aldata:{key:'key',auth:'YES',requestTimes:[1]}};
 const writer=createCoordinatorPersistence(state,{set:(key,value)=>writes.push([key,JSON.parse(JSON.stringify(value))])});writer.roster();writer.bank();writer.history();writer.aldata();
 assert.deepEqual(writes.map(x=>x[0]),['party_dashboard_roster_state_v1','party_dashboard_bank_state_v1','party_dashboard_history_state_v1','party_dashboard_aldata_state_v1']);assert.deepEqual(writes[0][1],{headlessSlots:['F']});assert.deepEqual(writes[1][1],{bankbois:{B:{}}});assert.equal(writes[2][1].merchantActivity[0],1);assert.equal(writes[2][1].combatLogs.F.length,500);assert.deepEqual(writes[3][1],{key:'key',auth:'YES'});
});
test('failed first settings write prevents the second write',()=>{
 let calls=0;const writer=createCoordinatorPersistence({aldata:{}},{set(){calls++;throw Error('disk');}});
 assert.throws(()=>writer.settings(),/disk/);assert.equal(calls,1);
});

 test('scheduled saves coalesce and immediate settings cancel the pending save',async()=>{
 const writes=[],state={monsterFocus:[],aldata:{}};
 const writer=createCoordinatorPersistence(state,{set:(key,value)=>writes.push([key,JSON.parse(JSON.stringify(value))])});
 writer.scheduleSettings();state.monsterFocus=['bat'];writer.scheduleSettings();
 assert.equal(writes.length,0);writer.flush();assert.equal(writes.length,2);
 assert.deepEqual(writes[0][1].monsterFocus,['bat']);state.monsterFocus.push('goo');
 assert.deepEqual(writes[0][1].monsterFocus,['bat']);
 writer.scheduleSettings();writer.settings();await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(writes.length,4);
 });
