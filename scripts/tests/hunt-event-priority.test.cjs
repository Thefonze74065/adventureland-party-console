const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('characters/shared.js', 'utf8');
const permissionCode = source.slice(source.indexOf('  async function eventTravelAllowed('), source.indexOf('  async function preemptConvoyForAnniversary('));
const pollCode = source.slice(source.indexOf('  async function joinCombatEvent('), source.indexOf('  function reunionRealm('));
function fixture() {
  const actions = [];
  const r = vm.createContext({ character: { name: 'Mage', ctype: 'mage', map: 'main' },
    eventSelected: () => true, eventSelectionRevision: 0, travellingEventName: null,
    huntTurnInPriority: false, convoyTraveling: null, runtimeCurrent: () => true, navigationIntent:{revision:0},
    request: async () => ({ allowed: true }), escapeOwns: () => false,
    eventPollBusy: false, eventsEnabled: true, anniversaryBusy: false, anniversaryStaging: false,
    joinedEvent: null, eventTraveling: false, eventReturnPending: false, banking: false, stocking: false, upgrading: false,
    departurePending: false, bankQueued: false, eventMissingSince: 0, eventTargetTypes: [], root: {},
    G: { maps: { main: {}, goobrawl: { event: 'goobrawl' } }, events: { goobrawl: { join: true } } },
    activeCombatEvent: () => ({ name: 'goobrawl', types: ['goo'], state: {}, kind: 'pve' }),
    nearestEventTarget: () => null, eventDestination: () => ({ map: 'goobrawl', x: 0, y: 0 }),
    eventRequiresJoin: () => true, join: async name => { actions.push(['join', name]); r.character.map = r.eventDestination().map; },
    smart_move: async point => { actions.push(['move', point.map]); }, game_log() {},
    sharedPartyWalk: async point => { actions.push(['move', point.map]); },
  });
  const exitOwnerCode=source.slice(source.indexOf('  function eventExitOwnsMovement('),source.indexOf('  function reunionBlocked('));
  vm.runInContext(permissionCode + pollCode + exitOwnerCode, r);
  return { r, actions };
}

function delayedCrab() {
 const f=fixture(),r=f.r;let visible=false,live=true;
 Object.assign(r,{leader:'Mage',followLeader:true,runtimeGeneration:1,convoyRuntimeId:'runtime',
  activeCombatEvent:()=>live?{name:'crabxx',types:['crabxx'],state:{},kind:'monster'}:null,
  eventDestination:()=>({map:'main',x:-1000,y:1700}),
  parent:{entities:{}},isLiveAbtesting:()=>false,
  setTimeout:done=>{visible=true;r.parent.entities.boss={id:'boss',mtype:'crabxx',type:'monster',visible:true,hp:100,x:-1000,y:1700};done();},
  request:async(path,options)=>{if(path==='/shared-travel'){f.actions.push(['walk',!!options.body.cancel]);return {phase:'waiting'};}return {allowed:true};}
 });
 vm.runInContext(source.slice(source.indexOf('  function nearestEventTarget('),source.indexOf('  function isAggressiveEventCombat(')),r);
 vm.runInContext(source.slice(source.indexOf('  async function sharedPartyWalk('),source.indexOf('  function sharedConvoyPoint(')),r);
 return {...f,visible:()=>visible,end:()=>{live=false;}};
}

test('Gigacrab teleport releases travel before boss visibility without any convoy request',async()=>{
 const {r,actions}=delayedCrab();
 r.sharedPartyWalk=async()=>assert.fail('joinable event must not walk');
 await r.pollEvents();
 assert.equal(r.joinedEvent,'crabxx'); assert.equal(r.nearestEventTarget(),null);
 assert.equal(r.eventTraveling,false);assert.equal(r.eventPollBusy,false);
 assert.deepEqual(actions,[['join','crabxx']]);
 await r.pollEvents(); assert.deepEqual(actions,[['join','crabxx']]);
});

test('event ending during join releases travel and preserves unconfirmed reentry',async()=>{
 const f=delayedCrab();f.r.join=async()=>{f.end();};
 await f.r.pollEvents();assert.equal(f.r.eventTraveling,false);assert.equal(f.r.eventPollBusy,false);
 assert.equal(f.r.joinedEvent,null); assert.deepEqual(f.actions,[]);
});

test('dead or other-instance event entities cannot trigger the combat handoff',()=>{
 const {r}=delayedCrab();r.eventTargetTypes=['crabxx'];r.character.in='main';
 const boss={id:'boss',mtype:'crabxx',type:'monster',visible:true,hp:100,x:0,y:0,map:'main',in:'main'};
 for(const change of [{hp:0},{dead:true},{visible:false},{map:'cave'},{in:'other'}]){
  r.parent.entities={boss:{...boss,...change}};assert.equal(r.nearestEventTarget(),null);
 }
 r.parent.entities={boss};assert.equal(r.nearestEventTarget().id,'boss');
});

test('joinable entry does not depend on coordinator walking availability',async()=>{
 const f=delayedCrab();f.r.request=async path=>path==='/shared-travel'?{error:'unauthorized walking leg'}:{allowed:true};
 f.r.setTimeout=()=>assert.fail('rejected route must not keep polling');
 await f.r.pollEvents();assert.equal(f.r.eventTraveling,false);assert.equal(f.r.eventPollBusy,false);
});
test('Goobrawl cannot join or move when coordinator protects the Daisy claim gap', async () => {
  const { r, actions } = fixture(); r.request = async () => ({ allowed: false });
  await r.pollEvents(); assert.deepEqual(actions, []); assert.equal(r.eventTraveling, false);
});
test('a permission response cannot revive an event poll after local turn-in begins', async () => {
  const { r, actions } = fixture(); let resolve;
  r.request = () => new Promise(done => { resolve = done; });
  const pending = r.pollEvents(); r.huntTurnInPriority = true; resolve({ allowed: true });
  await pending; assert.deepEqual(actions, []);
});
test('event travel rechecks priority after joining and resumes normally once released', async () => {
  const { r, actions } = fixture();
  r.join = async () => { actions.push(['join']); r.character.map = 'goobrawl'; r.huntTurnInPriority = true; };
  await r.pollEvents(); assert.deepEqual(actions, [['join']]);
  r.huntTurnInPriority = false;
  await r.pollEvents(); assert.deepEqual(actions, [['join']]);
});
test('coordinator outage denies event movement without interfering with merchant work', async () => {
  const { r } = fixture(); r.request = async () => { throw new Error('offline'); };
  assert.equal(await r.eventTravelAllowed(), false);
  r.character.ctype = 'merchant'; assert.equal(await r.eventTravelAllowed(), true);
});
test('anniversary preemption denial cannot stop the active hunt route', async () => {
  const { r, actions } = fixture();
  r.anniversaryRoundAborted = () => false; r.partyConvoyActive = true;
  r.convoyTraveling = { id: 'turn-in', cancelled: false };
  r.navigationIntent = { revision: 1 };r.anniversaryEpoch = value => value;
  r.releaseConvoyCruise = () => actions.push(['release']);r.stop = async () => actions.push(['stop']);
  r.request = async path => path === '/hunt-event-permission' ? { allowed: true } : { huntTurnIn: true };
  vm.runInContext(source.slice(source.indexOf('  async function preemptConvoyForAnniversary('), source.indexOf('  function anniversaryRoundAborted(')), r);
  await r.preemptConvoyForAnniversary({ live: true, expires: 500000 });
  assert.deepEqual(actions, []);assert.equal(r.convoyTraveling.cancelled, false);
});

test('coordinator refuses anniversary preemption after the return convoy has completed', () => {
  const coordinator = require('./helpers/coordinator-source.cjs').coordinatorSource();
  let route, response, mutations = 0;
  const huntPolicy = require('../../runtime/hunt/policy.ts');
  const hunt = JSON.parse(JSON.stringify({ owner: 'Warrior', stage: 'at-daisy', participants: ['Warrior'],
    turnIn: { owner: 'Warrior', phase: 'claiming' } }));
  const context = { party: { monsterHunt: hunt, merchantCharacter: 'Merchant', activeConvoy: null,
      anniversary: { eventCycle: { startsAt: 1 } } }, ownedCharacter: () => true,
    huntTurnInOwnsTravel: huntPolicy.priority,
    farmingNavigation: { intent: () => ({ revision: 1 }), supersede: () => mutations++ },
    cancelActiveConvoy: () => mutations++, persistSettings: () => mutations++,
    express_inst: { post: (_, handler) => { route = handler; } },
  };
  route=require('./helpers/coordinator-anniversary-navigation.cjs').navigationRoutes(context).preempt;
  route({ body: { character: 'Warrior', navigationRevision: 1, startsAt: 9999999 } },
    { json: value => { response = value; }, status() { return this; } });
  assert.equal(response.huntTurnIn, true);assert.equal(mutations, 0);
});


test('anniversary staging yields to an enabled combat event',async()=>{
 const {r,actions}=fixture();r.anniversaryStaging=true;
 await r.pollEvents();assert.equal(r.anniversaryStaging,false);
 assert.deepEqual(actions,[['join','goobrawl']]);
});
test('denied handoff leaves anniversary movement intact',async()=>{
 const {r,actions}=fixture();r.anniversaryStaging=true;r.request=async()=>({allowed:false});
 await r.pollEvents();assert.equal(r.anniversaryStaging,true);assert.deepEqual(actions,[]);
});
test('preempting an owned staging route invalidates its continuation',async()=>{
 const {r,actions}=fixture();const operation={revision:3,cancelled:false};
 r.anniversaryBusy=true;r.root.__partyAnniversaryStagingOperation=operation;
 r.navigationIntent={revision:3};r.townTraveling=false;r.forceTraveling=false;
 r.stop=async()=>{};await r.pollEvents();
 assert.equal(operation.cancelled,true);assert.equal(r.root.__partyAnniversaryStagingOperation,null);
 assert.deepEqual(actions,[['join','goobrawl']]);
});
test('an active kiss stays protected until its operation ends',async()=>{
 const {r,actions}=fixture();r.root.__partyAnniversaryKissOperation={startedAt:1};
 await r.pollEvents();assert.deepEqual(actions,[]);
 r.root.__partyAnniversaryKissOperation=null;await r.pollEvents();assert.equal(actions[0][0],'join');
});

test('a late departure permission cannot cancel a newer navigation intent',async()=>{
 const {r,actions}=fixture();r.anniversaryStaging=true;
 const operation=r.root.__partyAnniversaryStagingOperation={revision:0,cancelled:false};
 r.request=async()=>{r.navigationIntent.revision++;return {allowed:true};};
 await r.pollEvents();assert.equal(operation.cancelled,false);assert.deepEqual(actions,[]);
});
