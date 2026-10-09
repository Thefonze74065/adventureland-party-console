const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const createNavigation = require('../farming-navigation.cjs');
const coordinator = require('./helpers/coordinator-source.cjs').coordinatorSource();
const cave = { map: 'cave', x: -194, y: -461 };
const forest = { map: 'main', x: 900, y: 900 };

function fixture() {
  let time = 1000000, starts = 0;
  const names = ['L', 'F', 'P', 'Solo', 'M'];
  let online = names.slice();
  const party = { leader: 'L', merchantCharacter: 'M', followers: { F: true, P: true },
    location: { ...cave }, characterLocations: { Solo: { ...forest } }, navigationIntents: {},
    commands: {}, nextCommandId: 1, statuses: Object.fromEntries(names.map(name => [name,
      { map: 'main', x: 0, y: 0, seenAt: time }])),
    anniversary: { returnReady: {} }, eventSessions: {}, deferredEventReturns: {},
    monsterFocus: ['bat'], monsterFocusByCharacter: {}, monsterPrioritiesByCharacter: {},
    monsterSearchRadiusByCharacter: {}, scatterEpoch: 0,
  };
  const logs = [];
  const hooks = { now: () => time, names: () => names, activeNames: () => online,
    persist() {}, log: message => logs.push(message),
    cancelConvoy() {
      const id = party.activeConvoy?.id;
      for (const [name, command] of Object.entries(party.commands))
        if (command.convoyId === id) delete party.commands[name];
      party.activeConvoy = null;
    },
    startConvoy(location, label, participants, purpose) {
      starts++;
      const id = `convoy-${starts}`;
      party.activeConvoy = { id, location, label, participants: participants.slice(), purpose };
      for (const name of participants) party.commands[name] = {
        id: party.nextCommandId++, type: 'party-monster-travel', convoyId: id, location,
      };
      return true;
    },
  };
  const nav = createNavigation(party, hooks);
  const cycle = () => ({ id: 'round', startsAt: time, endsAt: time + 300000,
    participants: nav.members(), destination: { ...cave }, waypoints: nav.capture(), returnDispatchedAt: null });
  party.anniversary.eventCycle = cycle();
  const routes = {};
  const context = vm.createContext({ party, farmingNavigation: nav, escapeControl: { release() {} },
    huntTurnInOwnsTravel: require('../../runtime/hunt/policy.ts').priority,
    Date: { now: () => time }, ownedCharacter: name => names.includes(name),
    activeNames: hooks.activeNames, persistSettings: hooks.persist,
    anniversaryCombatParticipants: nav.members, anniversaryFallbackDestination: () => nav.waypoint('L'),
    anniversaryLog: hooks.log, cancelActiveConvoy: hooks.cancelConvoy,
    scheduleAnniversaryReturnConvoy() {},
    express_inst: { post: (url, handler) => { routes[url] = handler; } },
  });
  Object.assign(context,require('./helpers/coordinator-anniversary.cjs').anniversaryService(context));
  const anniversaryRoutes=require('./helpers/coordinator-anniversary-navigation.cjs').navigationRoutes(context);
  for (const [url,key] of [['return-ready','ready'],['navigation-preempt','preempt'],['staging','staging']])
    routes['/party-api/anniversary/'+url]=anniversaryRoutes[key];
  routes['/party-api/focus']=require('../../runtime/coordinator/http/focus.ts').createFocusRoute(party,{
    owned:context.ownedCharacter,members:()=>nav.members(),invalidate:(...args)=>nav.invalidate(...args),persist:hooks.persist,
  });
  routes['/party-api/event-resume-complete']=require('./helpers/coordinator-event-acknowledgements.cjs').acknowledgementRoutes(context).resumeComplete;
  for (const [url,handler] of Object.entries(require('./helpers/coordinator-convoy-routes.cjs').convoyRoutes(context))) routes['/party-api/'+url]=handler;
  routes['/party-api/town-party']=require('../../runtime/coordinator/http/party-actions.ts').createPartyActionRoutes(party,{
    now:()=>time,nextCommand:()=>party.nextCommandId++,release:()=>context.escapeControl.release(),members:()=>nav.members(),
    active:hooks.activeNames,invalidate:(...args)=>nav.invalidate(...args),persist:hooks.persist,
  }).town;
  function post(url, body = {}) {
    const response = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    routes['/party-api/' + url]({ body }, response);
    return response;
  }
  return { party, nav, hooks, cycle, post, logs, context, starts: () => starts,
    advance(ms) { time += ms; }, offline(name) { online = online.filter(value => value !== name); } };
}

test('Halloween point returns keep their owned convoy until actual shared arrival radius',()=>{
 for(const event of ['mrgreen','mrpumpkin','slenderman']) {
  const t=fixture(),owner={...t.cycle(),event};
  t.nav.dispatch(owner,'event-return',t.nav.members());
  const convoy=t.party.activeConvoy;
  for(const name of t.nav.members())Object.assign(t.party.statuses[name],{map:cave.map,x:cave.x+107.55,y:cave.y});
  assert.equal(t.nav.reconcile(owner,'event-return'),false,event);
  assert.equal(t.party.activeConvoy,convoy,event);
  for(const name of t.nav.members())t.party.statuses[name].x=cave.x+90;
  assert.equal(t.nav.reconcile(owner,'event-return'),true,event);
 }
});
test('unrelated return proximity keeps its established legacy policy',()=>{
 const t=fixture(),owner=t.cycle();t.nav.dispatch(owner,'anniversary-return',t.nav.members());
 for(const name of t.nav.members())Object.assign(t.party.statuses[name],{map:cave.map,x:cave.x+150,y:cave.y});
 assert.equal(t.nav.reconcile(owner,'anniversary-return'),true);
});

test('leader focus clear invalidates every party waypoint and preserves independent and merchant work', () => {
  const t = fixture();
  t.party.characterLocations.F = { ...forest };
  t.party.commands.M = { type: 'merchant-self-improve' };
  t.party.eventSessions.L = { checkpoint: cave, waypoints: t.nav.capture(), participants: t.nav.members() };
  t.party.deferredEventReturns.F = { checkpoint: forest };
  assert.equal(t.post('focus', { character: 'L', monsterFocus: [] }).code, 200);
  for (const name of ['L', 'F', 'P']) {
    assert.equal(t.nav.waypoint(name), null);
    assert.equal(t.nav.location(t.party.anniversary.eventCycle, name), null);
  }
  assert.equal(t.party.eventSessions.L.checkpoint, null);
  assert.equal(t.party.deferredEventReturns.F.checkpoint, null);
  assert.deepEqual(t.nav.waypoint('Solo'), forest);
  assert.equal(t.party.commands.M.type, 'merchant-self-improve');
});

function failRound(t, overrides = {}) {
  t.party.anniversary.eventCycle.target ||= 'DxMerchant';
  return t.context.abortAnniversaryRound({ character: 'M', round: 'round', target: 'DxMerchant',
    navigationRevision: 0, attempt: 2, failureReason: 'target-missing', ...overrides });
}

test('merchant missing-target report releases all fighters before expiry and preserves merchant work', () => {
  const t=fixture(); t.party.commands.M={ type:'merchant-self-improve' };
  assert.equal(failRound(t).aborted,true);
  assert.equal(t.starts(),1); assert.deepEqual(t.party.activeConvoy.participants,['L','F','P']);
  assert.equal(t.party.commands.M.type,'merchant-self-improve');
  assert.equal(t.party.anniversary.eventCycle.endsAt,1300000);
  assert.equal(t.party.anniversary.abortedRounds.round.reason,'target-missing');
  assert.equal(failRound(t).duplicate,true); assert.equal(t.starts(),1);
});

test('timeout without success and unreachable targets also release the round', () => {
  for(const failureReason of ['kiss-timeout','target-unreachable']) {
    const t=fixture(); assert.equal(failRound(t,{character:'F',failureReason}).aborted,true);
    assert.equal(t.starts(),1);
  }
});

test('stale round, target, member and revision cannot abort current navigation', () => {
  for(const changes of [{round:'old'}, {target:'other'}, {character:'Solo'}, {navigationRevision:4}, {failureReason:'network-error'}]) {
    const t=fixture(); assert.equal(failRound(t,changes).aborted,false); assert.equal(t.starts(),0);
  }
  const t=fixture(); t.nav.invalidate(['F'],'manual cancel');
  assert.equal(failRound(t,{character:'F',navigationRevision:1}).aborted,false);
});

test('abort preserves cancelled and offline farming waypoints', () => {
  const t=fixture(); t.nav.invalidate(['F'],'manual cancel'); t.offline('P');
  failRound(t); assert.deepEqual(t.party.activeConvoy.participants,['L']);
  assert.deepEqual(t.party.deferredEventReturns.P.checkpoint,cave);
  assert.equal(t.party.deferredEventReturns.F,undefined);
});

test('abort persists through serialization and prevents staging or preemption of the return', () => {
  const t=fixture(); failRound(t);
  t.party.anniversary=JSON.parse(JSON.stringify(t.party.anniversary));
  assert.equal(failRound(t).duplicate,true);
  const convoy=t.party.activeConvoy;
  assert.equal(t.post('anniversary/navigation-preempt',{character:'L',navigationRevision:0,startsAt:1000000}).body.skipped,true);
  assert.equal(t.post('anniversary/staging',{character:'L',navigationRevision:0,round:'round',
    startsAt:1000000,endsAt:1300000,map:'main',x:0,y:0}).body.skipped,true);
  assert.equal(t.party.activeConvoy,convoy);
});

test('abort releases a featured-member hold but preserves another combat event owner', () => {
  const t=fixture(); t.party.anniversary.eventCycle.target='L';
  assert.equal(failRound(t,{target:'L'}).aborted,true); assert.equal(t.starts(),1);
  const u=fixture(); u.party.anniversary.eventCycle.combatHandoffAt=1000000;
  assert.equal(failRound(u).aborted,true); assert.equal(u.starts(),0);
  assert.ok(u.party.anniversary.eventCycle.abortedAt);
});

test('a late merchant failure skips further kisses without replacing an already dispatched return', () => {
  const t=fixture();t.context.dispatchAnniversaryReturn(true);
  const convoy=t.party.activeConvoy;
  assert.equal(failRound(t).aborted,true);
  assert.equal(t.party.activeConvoy,convoy);assert.equal(t.starts(),1);
});

for (const name of ['F', 'Solo']) test(`clearing ${name} cancels only that person's waypoint`, () => {
  const t = fixture();
  t.party.characterLocations.F = { ...forest };
  t.post('focus', { character: name, monsterFocus: [] });
  assert.equal(t.nav.waypoint(name), null);
  assert.deepEqual(t.nav.waypoint('L'), cave);
  assert.deepEqual(t.nav.waypoint('P'), cave);
});

for (const order of [['clear', 'town'], ['town', 'clear']]) test(`${order.join(' then ')} cannot restore the cave`, () => {
  const t = fixture();
  for (const action of order) action === 'clear' ? t.post('focus', { character: 'L', monsterFocus: [] }) : t.post('town-party');
  t.nav.dispatch(t.party.anniversary.eventCycle, 'anniversary-return', t.nav.members());
  assert.equal(t.starts(), 0);
  assert.ok(t.party.anniversary.eventCycle.returnCompletedAt);
  assert.equal(t.party.location, null);
});

test('Town preserves monster selections and requires explicit new navigation', () => {
  const t = fixture();
  t.post('town-party');
  assert.deepEqual(t.party.monsterFocus, ['bat']);
  t.post('focus', { character: 'L', monsterFocus: ['bat'] });
  assert.equal(t.nav.waypoint('L'), null);
  t.nav.authorize(t.nav.members(), forest, true);
  assert.deepEqual(t.nav.waypoint('L'), forest);
  assert.equal(t.party.townCycle, null);
});

test('repeated empty focus is still a cancellation and survives persistence', () => {
  const t = fixture();
  t.post('focus', { monsterFocus: [] });
  const revision = t.nav.intent('L').revision;
  t.post('focus', { monsterFocus: [] });
  assert.equal(t.nav.intent('L').revision, revision + 1);
  const restored = JSON.parse(JSON.stringify(t.party));
  const nav = createNavigation(restored, t.hooks);
  assert.equal(nav.location(restored.anniversary.eventCycle, 'L'), null);
});

test('stale staging and return-ready reports are rejected after cancellation', () => {
  const t = fixture();
  t.post('town-party');
  const body = { character: 'L', round: 'round', map: 'cave', x: cave.x, y: cave.y,
    startsAt: 1000000, endsAt: 1300000, navigationRevision: 0 };
  assert.equal(t.post('anniversary/staging', body).code, 409);
  assert.equal(t.post('anniversary/return-ready', body).body.stale, true);
  assert.equal(t.party.anniversary.eventCycle.destination, null);
});

test('current staging can attend with no waypoint and cannot save its reported cave coordinates', () => {
  const t = fixture();
  t.post('town-party');
  const body = { character: 'L', round: 'next', map: 'cave', x: cave.x, y: cave.y,
    startsAt: 1400000, endsAt: 1700000, navigationRevision: t.nav.intent('L').revision };
  assert.equal(t.post('anniversary/staging', body).code, 200);
  assert.equal(t.party.anniversary.eventCycle.destination, null);
  assert.equal(t.nav.location(t.party.anniversary.eventCycle, 'L'), null);
});

test('a genuine cave return still dispatches even when everyone is sitting in Town', () => {
  const t = fixture();
  t.nav.dispatch(t.party.anniversary.eventCycle, 'anniversary-return', t.nav.members());
  assert.equal(t.starts(), 1);
  assert.deepEqual(t.party.activeConvoy.location, cave);
});

test('already-arrived participants need no convoy', () => {
  const t = fixture();
  for (const name of t.nav.members()) Object.assign(t.party.statuses[name], cave);
  t.nav.dispatch(t.party.anniversary.eventCycle, 'anniversary-return', t.nav.members());
  assert.equal(t.starts(), 0);
  assert.ok(t.party.anniversary.eventCycle.returnCompletedAt);
});

test('individual waypoints get individual returns and cancelled followers are excluded', () => {
  const t = fixture();
  t.party.characterLocations.F = { ...forest };
  const cycle = t.party.anniversary.eventCycle = t.cycle();
  t.post('focus', { character: 'P', monsterFocus: [] });
  t.nav.dispatch(cycle, 'anniversary-return', t.nav.members());
  assert.deepEqual(t.party.activeConvoy.participants, ['L']);
  assert.deepEqual(t.party.commands.F.location, forest);
  assert.equal(t.party.commands.F.type, 'event-resume-travel');
  assert.equal(t.party.commands.P, undefined);
});

test('cancelling one participant in flight preserves the other destinations without a rebuild loop', () => {
  const t = fixture(), cycle = t.party.anniversary.eventCycle;
  t.nav.dispatch(cycle, 'anniversary-return', t.nav.members());
  t.post('focus', { character: 'F', monsterFocus: [] });
  assert.deepEqual(t.party.activeConvoy.participants, ['L', 'P']);
  assert.equal(t.party.commands.F, undefined);
  for (const name of ['L', 'P']) Object.assign(t.party.statuses[name], cave);
  t.nav.reconcile(cycle, 'anniversary-return');
  assert.ok(cycle.returnCompletedAt);
  assert.equal(t.logs.length, 0);
});

test('cancelled and superseded returns cannot be rebuilt', () => {
  for (const cancel of ['town', 'next-round']) {
    const t = fixture(), cycle = t.party.anniversary.eventCycle;
    t.nav.dispatch(cycle, 'anniversary-return', t.nav.members());
    if (cancel === 'town') t.post('town-party');
    else t.post('anniversary/navigation-preempt', { character: 'L', navigationRevision: 0, startsAt: 1400000 });
    t.advance(3000);
    for (let i = 0; i < 5; i++) t.nav.reconcile(cycle, 'anniversary-return');
    assert.equal(t.starts(), 1);
    assert.equal(t.logs.filter(message => message.includes('Retrying')).length, 0);
  }
});

test('a genuinely lost return retries its dispatched destinations once, not a changed party location', () => {
  const t = fixture(), cycle = t.party.anniversary.eventCycle;
  t.nav.dispatch(cycle, 'anniversary-return', t.nav.members());
  t.hooks.cancelConvoy();
  t.party.location = forest;
  t.advance(3000);
  t.nav.reconcile(cycle, 'anniversary-return');
  assert.deepEqual(t.party.commands.L.location, cave);
  t.advance(3000);
  t.nav.reconcile(cycle, 'anniversary-return');
  assert.equal(t.logs.length, 1);
});

test('offline returns are deferred, then invalidated by Town', () => {
  const t = fixture(), cycle = t.party.anniversary.eventCycle;
  t.nav.dispatch(cycle, 'anniversary-return', t.nav.members());
  t.hooks.cancelConvoy();
  t.offline('F');
  t.advance(3000);
  t.nav.reconcile(cycle, 'anniversary-return');
  assert.deepEqual(t.party.deferredEventReturns.F.checkpoint, cave);
  t.post('town-party');
  assert.equal(t.party.deferredEventReturns.F.checkpoint, null);
});

test('failed event convoy releases its hold and retries the saved waypoint', () => {
  const t = fixture(), cycle = t.party.anniversary.eventCycle;
  t.nav.dispatch(cycle, 'anniversary-return', t.nav.members());
  t.party.activeConvoy.phase = 'failed';
  t.party.activeConvoy.failure = 'L: stale route owner';
  t.advance(3000);t.nav.reconcile(cycle, 'anniversary-return');
  assert.notEqual(t.party.activeConvoy.phase, 'failed');
  assert.equal(t.party.commands.L.type, 'party-monster-travel');
  assert.deepEqual(t.party.activeConvoy.participants,['L','F','P']);
  assert.deepEqual(t.party.commands.L.location, cave);
  const commandId=t.party.commands.L.id;
  t.advance(3000);t.nav.reconcile(cycle, 'anniversary-return');
  assert.equal(t.party.commands.L.id,commandId,'a running retry is not replaced every tick');
  for (const name of t.nav.members()) Object.assign(t.party.statuses[name],cave,{seenAt:1006000});
  t.nav.reconcile(cycle, 'anniversary-return');assert.ok(cycle.returnCompletedAt);
});

test('persisted individual reunions waiting for each other recover as a leader convoy', () => {
  const t=fixture(),cycle=t.party.anniversary.eventCycle;
  cycle.returnDispatchedAt=1000000;cycle.returnRoutes={};
  for(const name of t.nav.members()) {
    const id=t.party.nextCommandId++;
    cycle.returnRoutes[name]={location:cave,revision:0,commandId:id};
    t.party.commands[name]={id,type:'event-resume-travel',location:cave};
    t.party.statuses[name].farmReunion={phase:'waiting-for-party-near-farm'};
  }
  t.advance(11000);
  for(const name of t.nav.members())t.party.statuses[name].seenAt=1011000;
  t.nav.reconcile(cycle,'anniversary-return');
  assert.deepEqual(t.party.activeConvoy.participants,['L','F','P']);
  assert.equal(t.party.activeConvoy.purpose,'anniversary-return');
  assert.equal(t.party.commands.L.type,'party-monster-travel');
});

test('stale individual completion cannot delete a newer command or deferred return', () => {
  const t = fixture();
  t.party.commands.F = { type: 'event-resume-travel', id: 99, cycleId: 'new' };
  t.party.deferredEventReturns.F = { cycleId: 'new', checkpoint: forest };
  assert.equal(t.post('event-resume-complete', { character: 'F', commandId: 1, navigationRevision: 0 }).body.stale, true);
  assert.equal(t.party.commands.F.id, 99);
  assert.equal(t.party.deferredEventReturns.F.cycleId, 'new');
});

test('previous-round kiss buffs cannot end staging for the upcoming round', () => {
  const t = fixture(), cycle = t.party.anniversary.eventCycle;
  cycle.startsAt += 180000;
  for (const name of t.nav.members()) t.context.reconcileAnniversaryReturnFromStatus(name, {
    conditions: [{ id: 'anniversary_kiss' }], anniversaryState: { round: 'old-round' },
  });
  assert.equal(Object.keys(t.party.anniversary.returnReady).length, 0);
  assert.equal(t.context.dispatchAnniversaryReturn(true), false);
  assert.equal(t.starts(), 0);
});

test('featured party member holds for one minute even if everyone appears ready', () => {
  const t = fixture(), cycle = t.party.anniversary.eventCycle;
  cycle.target = 'L';
  t.party.anniversary.returnReady = { L: {}, F: {}, P: {} };
  assert.equal(t.context.dispatchAnniversaryReturn(false), false);
  t.advance(59999);
  assert.equal(t.context.dispatchAnniversaryReturn(true), false);
  t.advance(1);
  assert.equal(t.context.dispatchAnniversaryReturn(true), true);
  assert.ok(t.logs.includes('One-minute anniversary featured hold complete; returning to saved farming waypoints'));
});

test('completed anniversary visits retry after temporary movement clears, before the five-minute deadline',()=>{
 const t=fixture();t.party.anniversary.returnReady={L:{},F:{},P:{}};
 t.party.activeConvoy={id:'busy',purpose:'manual'};
 t.context.anniversaryReturns.tick();assert.equal(t.starts(),0);
 t.party.activeConvoy=null;t.advance(1000);t.context.anniversaryReturns.tick();
 assert.equal(t.starts(),1);assert.equal(t.party.anniversary.eventCycle.returnReason,'party completed anniversary visits');
});

test('first failed approach does not release the party',()=>{
 const t=fixture();assert.equal(failRound(t,{attempt:1}).aborted,false);
 assert.equal(t.party.anniversary.eventCycle.abortedAt,undefined);
});


test('dead or wrong-instance characters cannot satisfy return arrival',()=>{
 const r=fixture(),s=r.party.statuses.L;Object.assign(s,cave,{rip:true});assert.equal(r.nav.at('L',cave),false);
 s.rip=false;s.hp=0;assert.equal(r.nav.at('L',cave),false);
 s.hp=100;s.in='other';assert.equal(r.nav.at('L',{...cave,in:'cave'}),false);
 s.in='cave';assert.equal(r.nav.at('L',{...cave,in:'cave'}),true);
});
test('offline before initial dispatch preserves a durable return waypoint',()=>{
 const r=fixture();r.offline('F');const cycle=r.cycle();r.nav.dispatch(cycle,'event-return',cycle.participants);
 assert.deepEqual(r.party.deferredEventReturns.F.checkpoint,cave);
 assert.equal(r.party.deferredEventReturns.F.navigationRevision,r.nav.intent('F').revision);
 assert.equal(cycle.returnRoutes.F,undefined);
});

test('Hunt resumes after anniversary and Goobrawl despite legacy empty-backup cancellation; manual Town still blocks',()=>{
 const {createHuntRecovery}=require('../../runtime/coordinator/hunt/recovery.ts');
 const {createHuntTravel}=require('../../runtime/coordinator/hunt/travel.ts');
 const {party,nav}=fixture();party.farmingPolicy='hunt';
 const hunt=party.monsterHunt={stage:'farming',participants:['L','F','P'],owner:'L',target:'osnake'};
 for(const n of hunt.participants){party.navigationIntents[n]={revision:7,cancelled:true,reason:'monster focus cleared'};
  party.statuses[n].monsterHunt={id:'osnake',count:12,remainingMs:1200000};}
 const calls=[],ports={now:()=>1000000,intent:n=>nav.intent(n),cancelHuntConvoy(){},fresh:()=>true,ownsTravel:()=>false,
  destination:()=>cave,start:(h,d)=>{calls.push(d);h.stage='mission-travel';},returnToDaisy:()=>assert.fail('Unexpected early turn-in')};
 const recovery=createHuntRecovery(party,ports),travel=createHuntTravel(party,ports);
 assert.equal(recovery.pause(hunt),true);assert.equal(hunt.stage,'paused-event');
 party.anniversary.eventCycle.combatHandoffAt=1000000;
 for(const n of hunt.participants)party.statuses[n].joinedEvent='goobrawl';
 assert.equal(recovery.pause(hunt),false);travel.step(hunt);assert.equal(calls.length,0);
 for(const n of hunt.participants)delete party.statuses[n].joinedEvent;
 party.eventReturn={};assert.equal(recovery.pause(hunt),true);
 party.eventReturn=null;party.anniversary.eventCycle.returnCompletedAt=1000001;
 assert.equal(recovery.pause(hunt),false);travel.step(hunt);assert.deepEqual(calls,[cave]);
 party.navigationIntents.L={revision:8,cancelled:true,reason:'manual Town'};
 assert.equal(recovery.pause(hunt),true);assert.equal(nav.intent('L').cancelled,true);
 party.farmingPolicy='auto';assert.equal(nav.intent('F').cancelled,true,'legacy exemption applies only while Hunt owns travel');
});
