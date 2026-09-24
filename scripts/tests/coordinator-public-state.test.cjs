const test=require('node:test');
const assert=require('node:assert/strict');
const {publicStateRuntime}=require('./helpers/coordinator-public-state.cjs');
const contracts=require('./fixtures/public-state-contracts.json');
test('pending command projection preserves empty entries and excludes absent values from JSON',()=>{
 const {pendingCommands}=require('../../runtime/coordinator/telemetry/public-state-characters.ts');
 const command={id:7,type:'travel',privateValue:'keep private'},state={missing:undefined,empty:null,P:command};
 const output=pendingCommands(state);
 assert.equal(Object.hasOwn(output,'missing'),true);assert.equal(output.missing,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(output)),{empty:null,P:{id:7,type:'travel',phase:null,convoyId:null}});
 assert.equal(state.P,command);assert.equal(command.privateValue,'keep private');
});
function read(r,query){let result;r.route({query},{json:value=>{result=value;}});return JSON.parse(JSON.stringify(result));}

test('dashboard core exposes observed characters before a heartbeat',()=>{
 const r=publicStateRuntime();
 require('../../runtime/roster/connection-status.ts').recordConnections(r.party,[{name:'P',primary:true,state:'loading'}],r.ports.now());
 const result=read(r,{section:'core',dashboard:'1'});
 assert.equal(result.characterConnections[0].name,'P');
 assert.equal(result.characterConnections[0].state,'loading');
});

test('all dashboard state sections preserve their pre-extraction response contracts',()=>{
 for(const fixture of contracts){const actual=read(publicStateRuntime(),fixture.query);if (actual.characterConnections) { assert.deepEqual(actual.characterConnections, []); delete actual.characterConnections; } delete actual.upgradeOfferingRules;delete actual.upgradeOfferingStock;delete actual.bankSortMode;delete actual.bankSortRequest;delete actual.gameVersion;delete actual.clientUpdate;delete actual.bankboiPrefix;delete actual.anniversaryAutoChat;delete actual.gameLogs;delete actual.autoBlacklistMerchants;delete actual.nativeStand;delete actual.autoStandBuys;delete actual.combatRecovery;delete actual.huntSettings;delete actual.huntFailures;delete actual.deconstructionMarks;delete actual.autoDeconstruction;delete actual.deconstructionCatalog;delete actual.luckyUpgradeSlots;delete actual.luckySlotTracking;assert.deepEqual(actual,fixture.payload,JSON.stringify(fixture.query));}
});

test('dashboard receives the party death recovery explanation',()=>{
 const r=publicStateRuntime();r.party.combatRecovery={phase:'recovering',reason:'Waiting for respawn',names:['P']};
 assert.deepEqual(read(r,{}).combatRecovery,r.party.combatRecovery);
});

test('inventory presentation trims metadata without mutating the live inventory',()=>{
 const r=publicStateRuntime(),before=JSON.stringify(r.party.statuses.P.items);
 const value=read(r,{section:'inventory'});assert.equal(value.characters.P.items[0].meta.unneeded,undefined);
 assert.equal(value.characters.P.items[0].meta.sprite,'sprite');assert.equal(JSON.stringify(r.party.statuses.P.items),before);
 const full=read(r,{});assert.equal(full.characters.P.items[0].meta.unneeded,'omit-me');
});

test('overview does not expose unlisted private state and unknown sections retain full responses',()=>{
 const r=publicStateRuntime();r.party.sessionToken='never expose';r.party.worker={pid:123};
 const value=read(r,{section:'constructor'});assert.equal(value.sessionToken,undefined);assert.equal(value.worker,undefined);
 assert.deepEqual(value.giveawayPlayers.SR_USII,['Alice','Bob','Trader']);assert.equal(value.characters.P.name,'P');
});

test('dashboard core separates large bank and market fields and never contains live values',()=>{
 const r=publicStateRuntime();r.party.statuses.P.hp=123;
 const core=read(r,{section:'core',dashboard:'1'});
 assert.equal(core.bank,undefined);assert.equal(core.ponty,undefined);assert.equal(core.standPriceHistory,undefined);
 assert.equal(core.characters.P.hp,undefined);assert.equal(core.characterDetails.P.hp,undefined);
 assert.equal(core.characterDetails.P.items,undefined);assert.equal(core.bankbois[0].items,undefined);
 const revision=core.referenceRevision;
 assert.equal(read(r,{section:'catalog'}).referenceRevision,revision);
 r.party.monsterChoices=[{id:'crab'}];assert.notEqual(read(r,{section:'catalog'}).referenceRevision,revision);
});
test('small section reads bypass unrelated full overview ports',()=>{
 const r=publicStateRuntime();r.ports.roster=()=>{throw new Error('unrelated roster construction')};
 r.ports.bankbois=()=>{throw new Error('unrelated bank projection')};
 for(const section of ['fast','inventory','logs','catalog','bank']) assert.ok(read(r,{section}));
});

test('dashboard core keeps the latest bank balance without subscribing to bank contents',()=>{
 const r=publicStateRuntime(),query={section:'core',dashboard:'1'};
 assert.equal(read(r,query).bankGold,null);
 r.party.bankSnapshot={gold:63732670,packs:{items0:[{name:'coat'}]}};
 assert.equal(read(r,query).bankGold,63732670);
 assert.equal(read(r,query).bank,undefined);
 r.party.bankSnapshot={gold:0,packs:{}};
 assert.equal(read(r,query).bankGold,0);
 r.party.bankSnapshot=null;
 assert.equal(read(r,query).bankGold,null);
});

test('dashboard exposes deconstruction marks, rules and eligibility catalog in config',()=>{
 const r=publicStateRuntime();
 r.party.deconstructionMarks=[{id:'d',owner:'M',state:'ready'}];
 r.party.autoDeconstruction={P:{ring:{item:{name:'ring',level:1}}}};
 r.party.deconstructionCatalog={ring:{compound:true}};
 const result=read(r,{section:'config',dashboard:'1'});
 for(const key of ['deconstructionMarks','autoDeconstruction','deconstructionCatalog'])
  assert.deepEqual(result[key],r.party[key]);
});

 test('dashboard config publishes the active game version and update health',()=>{
 const r=publicStateRuntime();r.party.gameVersion=16846;r.party.clientUpdate={phase:'ready',version:16846};
 const result=read(r,{section:'config',catalog:'0'});assert.equal(result.gameVersion,16846);assert.deepEqual(result.clientUpdate,{phase:'ready',version:16846});
 });

test('dashboard core exposes durable bank sort mode and request status',()=>{
 const r=publicStateRuntime();r.party.bankSortMode='request';r.party.bankSortRequest={id:'sort',status:'retry',message:'offline'};
 const value=read(r,{section:'core',dashboard:'1'});assert.equal(value.bankSortMode,'request');assert.deepEqual(value.bankSortRequest,r.party.bankSortRequest);
});
