const test=require('node:test'),assert=require('node:assert/strict');
const {createHuntMode}=require('../../runtime/coordinator/hunt/mode.ts');
const {clearCoordinatorHunt}=require('../../runtime/coordinator/hunt/controls.ts');
function fixture(completed=false,event=false){
 const quest={id:'booboo',count:completed?0:23,remainingMs:234567};
 const state={leader:'L',statuses:{L:{monsterHunt:quest}},farmingPolicy:'hunt',monsterFocus:['bee'],monsterFocusByCharacter:{},
   huntSettings:{preferredSpawns:{booboo:'saved'}},huntFailures:{booboo:{deaths:3}},huntBlacklist:{booboo:{deaths:3}},
   monsterHunt:{cycleId:'old',participants:['L'],returnPolicy:'auto',routeRecovery:{bank:{}},loot:{complete:false}},
   farmAreaState:{pending:{},failures:{bad:1},paused:true},combatRecovery:{phase:'held'},combatHuntBoundary:{old:true},
   activeConvoy:{id:'bank',purpose:'monster-hunt',participants:['L']},commands:{L:{convoyId:'bank',purpose:'monster-hunt'},M:{purpose:'merchant'}},
   eventReturn:event?{cycleId:'event',pending:['L']}:null};
 let beginCount=0;const settings=state.huntSettings;
 const mode=createHuntMode(state,{participants:()=>['L'],cancelled:()=>false,release(){},authorize(){},monsterDestination:()=>null,
   clear:()=>clearCoordinatorHunt(state),selectedDestination:()=>null,convoy(){},
   returnToDaisy(){assert.fail('off must not continue turn-in')},
   begin(policy,location,preserve){assert.equal(preserve,false);assert.equal(state.monsterHunt,null);state.monsterHunt={cycleId:'new'+(++beginCount),participants:['L'],stage:'checking-quests'};}});
 return {state,quest,settings,mode};
}
for(const completed of [false,true])for(const event of [false,true])test(`off/on resets runtime while retaining live quests: completed=${completed}, event=${event}`,()=>{
 const f=fixture(completed,event);f.mode.select('auto',null,undefined,false);
 assert.equal(f.state.monsterHunt,null);assert.equal(f.state.activeConvoy,null);assert.equal(f.state.commands.L,undefined);
 assert.equal(f.state.commands.M.purpose,'merchant');assert.deepEqual(f.state.huntBlacklist,{booboo:{deaths:3}});assert.deepEqual(f.state.huntFailures,{booboo:{deaths:3}});
 assert.equal(f.state.farmAreaState.pending,null);assert.equal(f.state.combatRecovery,null);
 assert.equal(f.state.statuses.L.monsterHunt,f.quest);assert.equal(f.state.huntSettings,f.settings);
 f.mode.select('hunt',null,undefined,false);assert.equal(f.state.monsterHunt.cycleId,'new1');assert.equal(f.state.monsterHunt.routeRecovery,undefined);
 assert.equal(f.state.statuses.L.monsterHunt,f.quest);assert.equal(!!f.state.eventReturn,event);
});
test('Hunt child recovery convoy clears without deleting another owners command',()=>{
 const f=fixture();f.state.activeConvoy={id:'child',purpose:'shared-walk',walkingActivity:'farm-recovery',participants:['L','M']};
 f.state.commands.L={convoyId:'child'};f.state.commands.M={convoyId:'other',purpose:'merchant'};
 f.mode.select('auto',null,undefined,false);assert.equal(f.state.activeConvoy,null);assert.equal(f.state.commands.L,undefined);assert.equal(f.state.commands.M.convoyId,'other');
});
