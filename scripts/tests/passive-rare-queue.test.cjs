const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {evaluateGroup}=require('../../runtime/combat/grouped.ts');
const source=fs.readFileSync('characters/shared.js','utf8');
function fn(name,next){return source.slice(source.indexOf('  function '+name+'('),source.indexOf('  function '+next+'('));}
test('client reports enabled out-of-area rares from followers but excludes disabled, dead and claimed monsters',()=>{
 const entities={};for(const mtype of ['phoenix','tinyp','goldenbat','cutebee','hen','rooster','boar'])entities[mtype]={id:mtype,mtype,type:'monster',visible:true,x:20,y:0,hp:100};
 const c=vm.createContext({parent:{entities},character:{name:'M'},leader:'W',root:{},partyConvoyActive:false,navigationIntent:{},groupedFarming:()=>true,selectFarmCandidates:targets=>targets,
  isPassingEncounter:()=>false,passiveHunting:{rules:{}},passiveRareHunts:{phoenix:true,tinyp:true,goldenbat:false,cutebee:true,hen:true,rooster:true},monsterFocus:['boar'],monsterPriorities:{},rareActive:()=>false,
  groupedEntityReport:e=>({...e,map:'main',in:'main'}),inFarmArea:()=>false,isExternallyClaimedMonster:e=>e.claimed,farmApproach:{failed:{}}});
 vm.runInContext(require('./helpers/named-function.cjs').namedFunction(source, 'passiveLevelAllowed'), c);
 vm.runInContext(fn('queueCandidates','queueReport')+fn('monsterPriority','calculateFarmingMode'),c);
 assert.deepEqual(Array.from(c.queueCandidates(),t=>[t.id,t.priority]),[['phoenix',100],['tinyp',101],['cutebee',100],['hen',100],['rooster',100]]);
 entities.phoenix.claimed=true;entities.cutebee.dead=true;entities.hen.dead=true;entities.rooster.claimed=true;assert.deepEqual(Array.from(c.queueCandidates(),t=>t.id),['tinyp']);
 c.passiveRareHunts.tinyp=false;assert.equal(c.queueCandidates().length,0);
});
test('actual coordinator snapshot retains a rare-owned queue and all clients derive its targeting rings',()=>{
 const host=require('./helpers/coordinator-source.cjs').coordinatorSource();
 const rare={id:'R',mtype:'phoenix',map:'main',in:'main',x:20,y:0,priority:100,passiveRare:true};
 const party={leader:'W',partyFarmingMode:'default',headlessSlots:['W','P','M'],steamMembers:[],followers:{P:true,M:true},statuses:{},combatLogs:{}};
 for(const name of ['W','P','M'])party.statuses[name]={name,ctype:name==='P'?'priest':'warrior',seenAt:1000,map:'main',in:'main',server:'USII',x:0,y:0,hp:100,range:200,
  combatSelection:{runtimeId:name},groupedCombat:{protocol:4,anchorVisible:true,candidates:name==='M'?[rare]:[]}};
 const c=vm.createContext({coordinatorPolicies:require('../../runtime/coordinator/navigation/grouped-snapshot.ts'),party,Date:{now:()=>1000},farmingNavigation:{intent:()=>({revision:1})},ownedCharacter:()=>null,
  rareControl:{owns:()=>true,blocksPulls:()=>false},combatDisengagement:{tick(){},active:()=>false,prepare:m=>m,finalize:g=>g},evaluateGroup});
 vm.runInContext(require('./helpers/named-function.cjs').namedFunction(host, 'groupedCombatSnapshot'),c);
 const group=c.groupedCombatSnapshot();assert.equal(group.target.id,'R');assert.equal(group.queue.length,1);
 const client=vm.createContext({groupedFarming:()=>true,groupedCombat:group,navigationIntent:{},character:{map:'main',in:'main'},reunionRealm:()=> 'USII',get_entity:()=>({...rare,visible:true})});
 vm.runInContext(fn('queueMarkers','acceptQueue'),client);assert.equal(client.queueMarkers()[0].visible,true);
});

test('claim reports preserve cooperative bosses and are completely disabled during events',()=>{
 const entities={};for(const mtype of ['franky','icegolem','crabxx','phoenix','boar'])entities[mtype]={id:mtype,mtype,type:'monster',visible:true,x:0,y:0,hp:100,target:'Stranger'};
 const c=vm.createContext({parent:{entities},character:{map:'main',in:'main'},groupedFarming:()=>true,Date:{now:()=>1000},coordinatorClockOffset:0,
  groupedCombat:{queue:Object.keys(entities).map(id=>({id,map:'main',in:'main',server:'USII'}))},reunionRealm:()=> 'USII',get_entity:id=>entities[id],
  G:{monsters:Object.fromEntries(['franky','icegolem','crabxx','phoenix'].map(id=>[id,{cooperative:true}]))},eventTargetTypes:[],currentPartyList:()=>['W','M','P']});
 vm.runInContext(fn('queueClaims','groupedNomination')+fn('isExternallyClaimedMonster','groupedFarming'),c);
 assert.deepEqual(Array.from(c.queueClaims(),t=>[t.id,t.external]),[['franky',false],['icegolem',false],['crabxx',false],['phoenix',true],['boar',true]]);
 c.groupedFarming=()=>false;assert.equal(c.queueClaims().length,0);
});

test('rare retry expiry allows fresh nominations while rejecting delayed abandoned attack evidence',()=>{
 const {reconcileQueue}=require('../../runtime/combat/queue.ts');
 const rare={id:'R',mtype:'goldenbat',map:'main',in:'main',x:20,y:0,server:'USII',priority:100,passiveRare:true};
 const party={leader:'W',statuses:{W:{server:'USII'}},groupedCombat:{queue:[],fights:[],evidence:[]}};
 require('../rare-combat.cjs')(party,()=>['W'],()=> 'USII').release({...rare,realm:'USII'},4000,1000);
 const member={name:'W',ctype:'warrior',status:{seenAt:3999,server:'USII',map:'main',in:'main',x:0,y:0,hp:100,groupedCombat:{protocol:4,candidates:[rare],evidence:[]}}};
 let result=reconcileQueue(party.groupedCombat,[member],'W',3999,'test');
 assert.equal(result.target,null);
 member.status.seenAt=4001;
 member.status.groupedCombat.evidence=[{...rare,at:4001,startedAt:999,action:'old',state:'engaged'}];
 result=reconcileQueue({...party.groupedCombat,...result},[member],'W',4001,'test');
 assert.equal(result.target.id,'R');assert.equal(result.target.state,'planned');assert.equal(result.fights.length,0);
 member.status.groupedCombat.evidence.push({...rare,at:4002,startedAt:4002,action:'new',state:'engaged'});
 member.status.seenAt=4002;result=reconcileQueue({...party.groupedCombat,...result},[member],'W',4002,'test');
 assert.equal(result.target.state,'engaged');assert.equal(result.evidence.length,1);assert.equal(result.evidence[0].action,'new');
});
