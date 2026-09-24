const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {passingControl,createPassingAdmission}=require('../../runtime/combat/passing-admission.ts');
const {updateHuntTravel}=require('../../runtime/combat/hunt-travel.ts');
const {classifyTravelDefense,retireTravelTargets}=require('../../runtime/coordinator/navigation/travel-defense.ts');
const {step}=require('../../runtime/coordinator/navigation/convoy-defense.ts');
const {reconcileQueue}=require('../../runtime/combat/queue.ts');
const {namedFunction}=require('./helpers/named-function.cjs');
const source=fs.readFileSync('characters/shared.js','utf8');
const now=10000;
function monster(id,target=null){return {id,mtype:'mole',type:'monster',visible:true,hp:100,x:20,y:0,map:'tunnel',in:'tunnel',server:'USII',target};}
function fixture(){
 const members=['W','P'].map(name=>({name,ctype:'warrior',revision:1,status:{seenAt:now,hp:100,map:'tunnel',in:'tunnel',server:'USII',x:0,y:0,combatSelection:{runtimeId:name},
 groupedCombat:{currentAttackersAt:now,currentAttackers:[],passingEncounters:[],sightings:[],observationAt:now}}}));
 const c={id:'C',epoch:1,purpose:'monster-hunt',huntTarget:'mole',phase:'travel',participants:['W','P'],leader:'W',completed:[],location:{map:'tunnel',x:14,y:-1072}};
 const party={activeConvoy:c,statuses:Object.fromEntries(members.map(m=>[m.name,m.status])),commands:{W:{type:'party-monster-travel',convoyId:'C'},P:{type:'party-monster-travel',convoyId:'C'}}};
 function control(){return passingControl(members,['C',c.epoch],now,c,party.passiveHunting);}
 const scope=control().scope;
 for(const m of members)m.status.groupedCombat.passingAcknowledgement={scope,tokens:['a','b'],at:now};
 function reserve(i,t,token){members[i].status.groupedCombat.passingEncounters.push({...t,at:now,startedAt:now,reserved:true,admission:{scope,token}});}
 return {members,c,party,control,reserve,scope};
}
test('outbound party admits only one simultaneous proposal and retains it out of range',()=>{
 const f=fixture();f.reserve(0,monster('a'),'a');f.reserve(1,monster('b'),'b');
 let control=f.control();assert.equal(control.hunt.primary.id,'a');assert.deepEqual(control.admitted,['a']);
 f.members[0].status.x=500;f.members[1].status.x=500;
 assert.equal(f.control().hunt.primary.id,'a');assert.deepEqual(f.control().admitted,['a']);
 f.members[0].status.groupedCombat.deaths=[{...monster('a'),at:now}];
 assert.equal(f.control().hunt.primary.id,'b');assert.deepEqual(f.control().admitted,['b']);
});
test('natural attacker wins before a voluntary proposal; one travels, extra aggro defends',()=>{
 const f=fixture();f.reserve(0,monster('neutral'),'a');
 f.members[1].status.groupedCombat.currentAttackers=[monster('first','P')];
 assert.equal(f.control().hunt.primary.id,'first');
 assert.equal(classifyTravelDefense(f.party,['W','P'],now).state,'clear');
 f.members[0].status.groupedCombat.currentAttackers=[monster('first','P'),{...monster('second','W'),mtype:'goo'}];
 assert.equal(classifyTravelDefense(f.party,['W','P'],now).state,'defending');
});
test('a second attacker interrupts even before the reserved primary retaliates',()=>{
 const f=fixture();f.reserve(0,monster('first'),'a');f.control();
 f.members[1].status.groupedCombat.currentAttackers=[monster('second','P')];
 assert.equal(classifyTravelDefense(f.party,['W','P'],now).state,'defending');
});
test('defense stays latched for one survivor and resumes the same destination after loot',()=>{
 const f=fixture();const dest=f.c.location;
 f.members[0].status.groupedCombat.currentAttackers=[monster('a','W'),monster('b','P')];
 const issue=(_p,c,phase,name)=>({type:'party-monster-travel',convoyId:c.id,phase,name});
 step(f.party,now,issue);assert.equal(f.c.phase,'defending');assert.equal(f.control().hunt.defending,true);assert.deepEqual(f.control().admitted,[]);
 f.members[0].status.groupedCombat.currentAttackers=[monster('b','P')];f.members[0].status.groupedCombat.deaths=[{...monster('a'),at:now}];
 step(f.party,now,issue);assert.equal(f.c.phase,'defending');
 f.members[0].status.groupedCombat.currentAttackers=[];
 step(f.party,now,issue);assert.equal(f.c.phase,'defending');assert.ok(f.c.loot);
 f.members[0].status.convoyLoot={...f.c.loot,complete:true,observedAt:now+1};
 step(f.party,now+1,issue);assert.equal(f.c.phase,'assemble');assert.equal(f.c.location,dest);assert.equal(f.c.epoch,2);
});
test('stale observations hold travel; outsiders and duplicate identities do not add attackers',()=>{
 const f=fixture();f.members.forEach(m=>m.status.groupedCombat.currentAttackers=[monster('a','W'),monster('outside','outsider')]);
 assert.equal(classifyTravelDefense(f.party,['W','P'],now).state,'clear');
 f.members[1].status.seenAt=0;
 assert.equal(classifyTravelDefense(f.party,['W','P'],now).state,'waiting-for-observations');
});
test('admission rejects an old target grant immediately after shared primary changes',()=>{
 let at=now;const f=fixture();f.reserve(0,monster('a'),'a');const control=f.control();
 const client=createPassingAdmission({now:()=>at,reserve:()=>{}});
 client.apply(control,[],at);assert.equal(client.prepare(monster('b')),false);
 client.apply({...control,hunt:{...control.hunt,defending:true}},[],++at);
 assert.equal(client.prepare(monster('a')),false);
});
test('fresh bounded absence retires the primary without reviving its reservation',()=>{
 const f=fixture();f.reserve(0,monster('a'),'a');f.control();
 for(const at of [now+1,now+1001,now+9001]){
  f.members.forEach(m=>{m.status.seenAt=at;m.status.groupedCombat.observationAt=at;m.status.groupedCombat.currentAttackersAt=at;});
  updateHuntTravel(f.c,f.members,at,f.scope);
 }
 assert.equal(f.c.huntTravel.primary,null);
});
test('defensive combat promotes cached passing encounters and retains the original primary',()=>{
 const f=fixture(), a=monster('a','W');f.reserve(0,a,'a');
 f.members[0].status.groupedCombat.huntDefense=true;f.members[0].status.groupedCombat.threats=[a];
 let queue=reconcileQueue(null,f.members,'W',now,'key',0,true);
 assert.equal(queue.target.id,'a');assert.equal(queue.passingEncounters.length,0);
 assert.equal(retireTravelTargets(queue,f.members,now),queue);
});
test('client counts raw passing aggro, pauses locally, and releases passing suppression',()=>{
 const a=monster('a','W'),b=monster('b','P');let stops=0;
 const c=vm.createContext({Date:{now:()=>now},Math,Object,String,Number,Promise,character:{name:'W',map:'tunnel',in:'tunnel'},
 parent:{entities:{a,b}},root:{__partyHuntTravel:{id:'C',epoch:1,primary:a}},convoyTraveling:{id:'C',epoch:1,purpose:'monster-hunt',huntTarget:'mole',phase:'travelling',routeProtocol:4},
 fightDeaths:[],groupedCombat:null,passingEncounters:{},peerPassingEncounters:[],coordinatorClockOffset:0,
 reunionRealm:()=> 'USII',get_entity:id=>({a,b}[id]),currentPartyList:()=>['W','P'],stop:()=>{stops++;},committedHuntEncounter:()=>false});
 const names=['passiveStopRequired','passiveTravelInterruptible','travelStopCandidates','outboundHuntTravel','huntTravelDefense','huntTravelControl','huntTravelExtraAggro','currentTravelAttackers','passingKey','isPassingEncounter','interruptConvoyForDefense','groupedEntityReport'];
 vm.runInContext(names.map(n=>namedFunction(source,n)).join('\n'),c);
 c.passingEncounters[c.passingKey(a)]={...a,at:now};assert.equal(c.isPassingEncounter(a),true);
 assert.equal(c.currentTravelAttackers().length,2);assert.equal(c.huntTravelExtraAggro(),true);
 c.interruptConvoyForDefense();assert.equal(stops,1);assert.equal(c.convoyTraveling.defensePaused,true);assert.equal(c.isPassingEncounter(a),false);
 delete c.parent.entities.a;assert.equal(c.huntTravelDefense(),true);
});

function phoenixFixture(purpose='monster-hunt') {
 const f=fixture();f.c.purpose=purpose;
 f.party.passiveHunting={rules:{phoenix:{enabled:true,keepMoving:false,priority:100}}};
 f.phoenix={...monster('phoenix'),mtype:'phoenix'};
 return f;
}
for(const purpose of ['monster-hunt','party-travel'])test(purpose+': neutral stop-required Phoenix selects committed combat before passing admission',()=>{
 const f=phoenixFixture(purpose);f.members[1].status.groupedCombat.travelCandidates=[f.phoenix];
 const control=f.control();assert.equal(control.hunt.primary.id,'phoenix');assert.equal(control.hunt.reason,'passive-setting');assert.deepEqual(control.admitted,[]);
 step(f.party,now,()=>({type:'party-monster-travel',convoyId:'C'}));assert.equal(f.c.phase,'defending');assert.equal(f.c.huntTravel.committed[0].id,'phoenix');
});
test('single naturally aggroed Phoenix stops despite a cached passing grant',()=>{
 const f=phoenixFixture();f.reserve(0,f.phoenix,'a');f.members[0].status.groupedCombat.currentAttackers=[{...f.phoenix,target:'W'}];
 assert.equal(classifyTravelDefense(f.party,['W','P'],now).state,'defending');assert.equal(f.control().admitted.length,0);
});
test('explicit stop overrides matching Hunt species; disabled rule leaves the Hunt exception intact',()=>{
 const f=phoenixFixture();f.c.huntTarget='phoenix';f.reserve(0,f.phoenix,'a');
 f.control();assert.equal(f.control().hunt.reason,'passive-setting');
 const disabled=phoenixFixture();disabled.c.huntTarget='phoenix';disabled.party.passiveHunting.rules.phoenix.enabled=false;disabled.reserve(0,disabled.phoenix,'a');
 assert.equal(disabled.control().hunt.reason,undefined);assert.deepEqual(disabled.control().admitted,['a']);
});
test('turning keepMoving off revokes a primary grant; turning it on does not abandon commitment',()=>{
 const f=phoenixFixture();f.party.passiveHunting.rules.phoenix.keepMoving=true;f.reserve(0,f.phoenix,'a');
 assert.deepEqual(f.control().admitted,['a']);f.party.passiveHunting.rules.phoenix.keepMoving=false;
 assert.deepEqual(f.control().admitted,[]);assert.equal(f.c.huntTravel.reason,'passive-setting');
 f.party.passiveHunting.rules.phoenix.keepMoving=true;assert.deepEqual(f.control().admitted,[]);
});
test('a Phoenix stop preserves the original mole primary and queues the Phoenix',()=>{
 const f=phoenixFixture();f.reserve(0,monster('mole'),'a');f.control();
 f.members[1].status.groupedCombat.travelCandidates=[f.phoenix];
 const control=f.control();assert.equal(control.hunt.primary.id,'mole');assert.equal(control.hunt.committed[0].id,'phoenix');assert.deepEqual(control.admitted,[]);
});
test('protected movement and stale, dead, or externally targeted sightings cannot acquire a passive stop',()=>{
 for(const change of [{purpose:'escape-recovery'},{continuousReturn:1},{nonPreemptible:true},{force:true},{navigationExempt:true}]){
  const f=phoenixFixture();Object.assign(f.c,change);f.members[0].status.groupedCombat.travelCandidates=[f.phoenix];assert.equal(f.control().hunt,undefined);
 }
 for(const kind of ['stale','dead','outside','instance']){
  const f=phoenixFixture();const t={...f.phoenix};f.members[0].status.groupedCombat.travelCandidates=[t];
  if(kind==='stale')f.members[0].status.seenAt=0;if(kind==='dead')t.hp=0;if(kind==='outside')t.target='outsider';if(kind==='instance')t.in='other';
  assert.equal(f.control().hunt.primary,null,kind);
 }
});
test('defending does not nominate another neutral Phoenix after the first was committed',()=>{
 const f=phoenixFixture();f.members[0].status.groupedCombat.travelCandidates=[f.phoenix];f.control();f.c.phase='defending';
 f.members[0].status.groupedCombat.travelCandidates=[{...f.phoenix,id:'new-neutral'}];f.control();
 assert.deepEqual(f.c.huntTravel.committed.map(t=>t.id),['phoenix']);
});
