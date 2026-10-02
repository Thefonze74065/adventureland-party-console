const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {sharedUpgradeRules,runnableBankUpgrades,planUpgradeStorage,sharedCompoundRules}=require('../../runtime/coordinator/merchant/banked-improvements.ts');
const {createImprovementScheduler}=require('../../runtime/coordinator/merchant/improvement-scheduler.ts');
const {reconcileCollectionMarks}=require('../../runtime/coordinator/inventory/collection-marks.ts');
const {coordinatorMerchantPriority}=require('../../runtime/coordinator/merchant/job-policy.ts');
const source=fs.readFileSync('characters/shared.js','utf8');
const item=(name,level=0,extra={})=>({name,level,...extra});
const entry=(name,level=0,extra={})=>({slot:0,item:item(name,level,extra)});
test('bank visits wait for the bank snapshot before checkpointing or running errands',async()=>{
 const calls=[];let loaded=false;
 const r=vm.createContext({closeMerchantStandForTravel:async()=>{},smart_move:async()=>calls.push('arrive'),
 waitForBankPack:async(pack)=>{assert.equal(pack,'items0');loaded=true;calls.push('loaded')},
 bankboiCheckpoint:async()=>{assert.ok(loaded);calls.push('checkpoint')},merchantBankErrands:async()=>calls.push('errands'),sortCurrentBankFloor:async()=>{}});
 vm.runInContext(source.slice(source.indexOf('  async function merchantOperationStage('),source.indexOf('  function findUpgradeMarkSlot(')),r);
 await r.merchantVisitBank({},[]);assert.deepEqual(calls,['arrive','loaded','checkpoint','errands','checkpoint']);
});
function state(){return {merchantCharacter:'M',statuses:{M:{items:[]},F:{items:[]}},autoUpgradeMarks:{F:{'sword@+0':{tiers:3,quantity:1}}},autoCompounds:{F:[{name:'ring',targetTier:3,quantity:-1}]},autoItemMarks:{M:{'sword@+0':'bank','ring@+0':'bank'}},bankSnapshot:{packs:{items0:[entry('sword'),entry('ring'),entry('ring'),entry('ring')]}},bankbois:{},merchantAutomations:{},merchantQueue:[],withdrawals:{}}}
test('staged improvement stock prioritizes its consuming job ahead of an unrelated bank visit',()=>{
 const s={merchantCharacter:'M',merchantRoutinePriorities:{'manual bank exchange':80,'upgrades and compounds':70},withdrawals:{M:[{pack:'items1',slot:35,improvement:'upgrades and compounds'}]},bankSnapshot:{packs:{items1:{35:entry('sword')}}}};
 assert.ok(coordinatorMerchantPriority(s,{target:'M',reason:'upgrades and compounds'})>coordinatorMerchantPriority(s,{target:'M',reason:'manual bank exchange'}));
 delete s.bankSnapshot.packs.items1[35];assert.equal(coordinatorMerchantPriority(s,{target:'M',reason:'upgrades and compounds'}),70);
});
test('shared bank stock schedules upgrades and compounds while preserving permanent bank preferences',()=>{
 const s=state(),before=JSON.stringify(s.autoItemMarks),queued=[];
 const scheduler=createImprovementScheduler(Object.assign(s,{production:s.production||{attempts:{}}}),{now:()=>1,nextCommand:()=>1,stamp:x=>x,persist(){},log(){},queue:(names,reason)=>queued.push({names,reason})});
 scheduler.compound('M',s.statuses.M);
 assert.ok(queued.some(x=>x.reason==='auto upgrade'));assert.ok(queued.some(x=>x.reason==='auto compound'));
 assert.equal(JSON.stringify(s.autoItemMarks),before);
 s.statuses.F.items=[entry('sword',3)];assert.equal(runnableBankUpgrades(s).length,1);
 s.statuses.F.items=[];s.bankSnapshot.packs.items0[0].item.l='l';assert.equal(runnableBankUpgrades(s).length,0);
});

test('disabling auto upgrade suppresses bank upgrade jobs without deleting rules',()=>{
 const s=state(),queued=[];s.merchantAutomations['auto upgrade']=false;
 const scheduler=createImprovementScheduler(Object.assign(s,{production:s.production||{attempts:{}}}),{now:()=>1,nextCommand:()=>1,stamp:x=>x,persist(){},log(){},queue:(_names,reason)=>queued.push(reason)});
 scheduler.compound('M',s.statuses.M);
 assert.equal(queued.includes('auto upgrade'),false);assert.ok(s.autoUpgradeMarks.F['sword@+0']);
});
test('duplicate rules authorize one pass; BankBoi requests reserve only missing improvement stock',()=>{
 const s=state();s.autoUpgradeMarks.M={'sword@+0':{tiers:3,quantity:1}};
 assert.equal(sharedUpgradeRules(s).length,1);assert.equal(sharedUpgradeRules(s)[0].tiers,3);
 s.autoCompounds.M=[{name:'ring',targetTier:3,quantity:1}];assert.deepEqual(sharedCompoundRules(s),[{name:'ring',targetTier:3,quantity:-1}]);
 s.bankbois.B={name:'B',items:[{slot:4,item:item('sword')}]};
 assert.deepEqual(planUpgradeStorage(s,runnableBankUpgrades(s)),[]);
 s.bankSnapshot.packs.items0=[];
 assert.deepEqual(planUpgradeStorage(s,runnableBankUpgrades(s)),[{pack:'bankboi:B',slot:4,item:item('sword'),improvement:"auto upgrade"}]);
});
test('bank errands skip active upgrade and compound ingredients, then normal banking resumes',async()=>{
 const deposited=[];const r=vm.createContext({character:{gold:0,esize:10},findMarkedItem:m=>m.slot,bankStoreFully:async slot=>deposited.push(slot),sameItem:(a,b)=>a.name===b.name&&a.level===b.level});
 vm.runInContext(source.slice(source.indexOf('  async function merchantBankErrands('),source.indexOf('  async function merchantVisitBank(')),r);
 const marks=[{slot:0,item:item('sword')},{slot:1,item:item('ring')},{slot:2,item:item('junk')}];
 const command={type:'merchant-self-improve',upgrades:[{slot:0,item:item('sword'),tiers:3}],autoCompounds:[{name:'ring',targetTier:3}],merchantBankMarked:marks};
 await r.merchantBankErrands(command,[]);assert.deepEqual(deposited,[2]);assert.equal(command.merchantBankMarked.length,3);
 await r.merchantBankErrands({...command,type:'merchant-self-bank',_merchantBankErrandsChecked:false},[]);assert.deepEqual(deposited,[2,0,1,2]);
 const result=reconcileCollectionMarks([],[],{'sword@+0':'bank'},[entry('sword')]);assert.equal(result.bank.length,1);
});
test('bank upgrade preparation withdraws bounded unlocked matching stock and respects finite targets',async()=>{
 const character={items:Array(8).fill(null),bank:{items0:[item('sword',0,{l:'l'}),item('sword'),item('sword'),item('sword'),item('sword')]}};
 Object.defineProperty(character,'esize',{get:()=>character.items.filter(x=>!x).length});
 const withdrawals=[];
 const r=vm.createContext({character,G:{items:{sword:{upgrade:true}}},merchantVisitBank:async()=>{},fingerprint:x=>({...x}),bank_retrieve:async(pack,slot)=>{withdrawals.push(slot);character.items[character.items.indexOf(null)]=character.bank[pack][slot];character.bank[pack][slot]=null}});
 vm.runInContext(source.slice(source.indexOf('  async function prepareBankUpgrades('),source.indexOf('  async function merchantSelfImprove(')),r);
 const command={bankUpgradeRules:[{name:'sword',level:0,tiers:3,quantity:1}]};await r.prepareBankUpgrades(command,[]);
 assert.deepEqual(withdrawals,[1]);assert.equal(command.upgrades.length,1);assert.equal(command.upgrades[0].tiers,3);
 character.items[0].level=3;await r.prepareBankUpgrades({bankUpgradeRules:command.bankUpgradeRules},[]);assert.deepEqual(withdrawals,[1,2]);
 const unlimited={bankUpgradeRules:[{name:'sword',level:0,tiers:3,quantity:-1}]};await r.prepareBankUpgrades(unlimited,[]);assert.equal(unlimited.upgrades.length,3);assert.equal(character.bank.items0[0].l,'l');
});
