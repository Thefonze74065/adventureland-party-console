const test=require('node:test'),assert=require('node:assert/strict');
const {migrateCharacterSelections}=require('../../runtime/coordinator/characters/migrate-selections.ts');
// Migration cannot be seeded through the live formation endpoint, which writes
// explicit selections. Failures: legacy true silently enables newly supported
// bosses; explicit opt-in is overwritten; merchant inherits legacy all-events.
test('new Halloween support leaves legacy all-events migration opt-in',()=>{
 const halloween=['slenderman','mrgreen','mrpumpkin'];
 const state={merchantCharacter:'M',eventSelectionsByCharacter:{Explicit:[...halloween],Empty:[]},eventsByCharacter:{F:true,M:true,Explicit:true,Empty:true},headlessSlots:[],bankbois:{},activeRealm:'SR_USII'};
 migrateCharacterSelections(state,{F:{},Explicit:{},Empty:{}},['anniversary','franky',...halloween]);
 assert.deepEqual(state.eventSelectionsByCharacter.F,['anniversary','franky']);
 assert.deepEqual(state.eventSelectionsByCharacter.Explicit,halloween);
 assert.deepEqual(state.eventSelectionsByCharacter.Empty,[]);
 assert.deepEqual(state.eventSelectionsByCharacter.M,['anniversary']);
});
test('legacy event flags migrate while explicit empty and undefined selections stay authoritative',()=>{
 const state={merchantCharacter:'M',eventSelectionsByCharacter:{Empty:[],Undefined:undefined},eventsByCharacter:{F:true,M:true,Empty:true,Undefined:true},headlessSlots:[],bankbois:{},activeRealm:'SR_USII'};
 migrateCharacterSelections(state,{F:{},Off:{},Empty:{},Undefined:{}},['franky','anniversary','abtesting']);
 assert.deepEqual(state.eventSelectionsByCharacter.F,['anniversary','franky','abtesting']);assert.deepEqual(state.eventSelectionsByCharacter.Off,['anniversary']);assert.deepEqual(state.eventSelectionsByCharacter.M,['anniversary']);assert.deepEqual(state.eventSelectionsByCharacter.Empty,[]);assert.equal(state.eventSelectionsByCharacter.Undefined,undefined);
});
test('only known occupied headless slots inherit the active realm, excluding BankBoi',()=>{
 const workers={F:{realm:'old'},B:{realm:'bank'},Steam:{realm:'steam'}};
 const state={merchantCharacter:'M',eventSelectionsByCharacter:{},eventsByCharacter:{},headlessSlots:['F','B','Unknown',null],bankbois:{B:{}},activeRealm:'SR_USII'};
 migrateCharacterSelections(state,workers,[]);assert.equal(workers.F.realm,'SR_USII');assert.equal(workers.B.realm,'bank');assert.equal(workers.Steam.realm,'steam');assert.equal(workers.Unknown,undefined);
});
