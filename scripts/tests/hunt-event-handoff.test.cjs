const test = require('node:test'), assert = require('node:assert/strict');
const safety = require('../hunt-safety.cjs');
const navigation = require('../farming-navigation.cjs');
const {beginHuntEventTrip, endHuntEventTrip} = require('../../runtime/coordinator/events/hunt-trip.ts');
const {coordinatorGroupedSnapshot} = require('../../runtime/coordinator/navigation/grouped-snapshot.ts');
const {evaluateGroup} = require('../../runtime/combat/grouped.ts');
const {huntBlacklistLabel} = require('../../dashboard/features/party/hunt-blacklist-label.ts');

function deathFixture() {
  const state = {};
  const trip = beginHuntEventTrip(state, 'W', 'icegolem', 20000);
  const hunt = {startedAt: 10000, participants: ['W'], eventTrips: state.huntEventTrips};
  const status = {seenAt: 30000, hp: 0, rip: true, map: 'winterland', lastDeath: {at: 30000, eventTrip: {...trip}}};
  return {state, trip, hunt, status};
}

for (const [phase, at] of [['departure',21000],['combat',30000],['return',49000]]) {
  test(`Ice Golem ${phase} death is consumed without blacklisting or recounting`, () => {
    const f = deathFixture();
    f.status.lastDeath.at = at; f.status.seenAt = at;
    assert.deepEqual(safety.recordDeaths(f.hunt, {W:f.status}, at), []);
    assert.equal(f.hunt.deathCount, 0);
    endHuntEventTrip(f.state, 'W', 'icegolem', 50000);
    const restored = JSON.parse(JSON.stringify(f.hunt));
    f.status.seenAt = 55000; f.status.rip = false; f.status.hp = 100;
    assert.deepEqual(safety.recordDeaths(restored, {W:f.status}, 55000), []);
    assert.equal(restored.deathCount, 0);
  });
}

test('late event death stays exempt after return; a new outside death counts even with a stale client trip', () => {
  const f = deathFixture();
  endHuntEventTrip(f.state, 'W', 'icegolem', 50000);
  f.status.seenAt = 55000; f.status.rip = false; f.status.hp = 100;
  assert.deepEqual(safety.recordDeaths(f.hunt, {W:f.status}, 55000), []);
  f.status.seenAt = 60000; f.status.rip = true; f.status.hp = 0; f.status.lastDeath.at = 60000;
  assert.deepEqual(safety.recordDeaths(f.hunt, {W:f.status}, 60000), ['W']);
});

test('globally live Ice Golem does not exempt a normal hunt death', () => {
  const hunt = {startedAt:10000, participants:['W']};
  const status = {seenAt:30000, hp:0, rip:true, activeEvent:'icegolem', lastDeath:{at:30000,eventTrip:null}};
  assert.deepEqual(safety.recordDeaths(hunt,{W:status},30000),['W']);
});

test('rip edge before the event death packet and repeated permission requests are idempotent', () => {
  const f = deathFixture(); delete f.status.lastDeath;
  assert.equal(beginHuntEventTrip(f.state,'W','icegolem',25000),f.trip);
  assert.equal(f.state.huntEventTrips.W.length,1);
  assert.deepEqual(safety.recordDeaths(f.hunt,{W:f.status},30000),[]);
  f.status.rip=false; f.status.hp=100; f.status.seenAt=40000;
  f.status.lastDeath={at:30050,eventTrip:{...f.trip}};
  assert.deepEqual(safety.recordDeaths(f.hunt,{W:f.status},40000),[]);
  assert.equal(f.hunt.deathCount,0);
});

function returnFixture() {
  let time=50000, starts=0;
  const party={leader:'W',merchantCharacter:'B',followers:{P:true},characterLocations:{},
    location:{map:'winter_cave',x:0,y:0},statuses:{W:{map:'winterland',x:0,y:0,seenAt:time,hp:100},P:{map:'winterland',x:0,y:0,seenAt:time,hp:100}},
    commands:{},nextCommandId:1,anniversary:{},eventSessions:{},deferredEventReturns:{}};
  for(const name of ['W','P']) beginHuntEventTrip(party,name,'icegolem',20000);
  const nav=navigation(party,{now:()=>time,names:()=>['W','P'],activeNames:()=>['W','P'],persist(){},log(){},
    startConvoy(location,label,participants,purpose){party.activeConvoy={id:'return-'+(++starts),phase:'travel',participants,location,purpose};return true;},
    cancelConvoy(){party.activeConvoy=null;}});
  const owner={cycleId:'ice-return',event:'icegolem',participants:['W','P'],waypoints:nav.capture()};
  return {party,nav,owner,starts:()=>starts,advance(ms){time+=ms;for(const s of Object.values(party.statuses))s.seenAt=time;}};
}

test('replayed return dispatch and slow healthy routes keep one convoy until arrival', () => {
  const f=returnFixture();
  f.nav.dispatch(f.owner,'event-return',['W','P']);
  const routes=f.owner.returnRoutes;
  for(let i=0;i<50;i++){f.advance(2000);f.nav.dispatch(f.owner,'event-return',['W','P']);}
  assert.equal(f.starts(),1);assert.equal(f.owner.returnRoutes,routes);
  assert.equal(f.party.huntEventTrips.W[0].endedAt,undefined);
  for(const s of Object.values(f.party.statuses))Object.assign(s,{map:'winter_cave',x:0,y:0});
  assert.equal(f.nav.reconcile(f.owner,'event-return'),true);
  assert.ok(f.party.huntEventTrips.W[0].endedAt);assert.ok(f.party.combatEventHandoff.endedAt);
});

test('failed return retries once and manual cancellation closes protection without reviving movement', () => {
  const f=returnFixture();f.nav.dispatch(f.owner,'event-return',['W','P']);
  f.party.activeConvoy.phase='failed';f.advance(3000);
  f.nav.reconcile(f.owner,'event-return');assert.equal(f.starts(),2);
  f.nav.reconcile(f.owner,'event-return');assert.equal(f.starts(),2);
  f.nav.invalidate(['W','P'],'manual Town',true);
  f.nav.reconcile(f.owner,'event-return');assert.equal(f.starts(),2);
  assert.ok(f.party.huntEventTrips.W[0].endedAt);
});

function groupFixture() {
  let time=10000;
  const target={id:'old',mtype:'bbpompom',map:'winter_cave',x:20,y:0,hp:100};
  const alternative={...target,id:'yellow',x:40};
  const members=['W','P'].map(name=>({name,ctype:name==='P'?'priest':'warrior',revision:1,
    status:{seenAt:time,hp:100,map:'winter_cave',server:'USII',x:0,y:0,range:200,
      groupedCombat:{protocol:4,epoch:0,anchorVisible:true,sightings:[target,alternative],candidates:[target,alternative],
        evidence:[{...target,server:'USII',at:9000,startedAt:9000,action:'attack-old',state:'engaged'}]}}}));
  const old=evaluateGroup(null,members,'W',time);
  const state={leader:'W',statuses:Object.fromEntries(members.map(m=>[m.name,m.status])),groupedCombat:old,
    partyFarmingMode:'default',headlessSlots:['W','P'],steamMembers:[],followers:{P:true},merchantCharacter:'B',combatLogs:{},
    combatEventHandoff:{startedAt:20000,endedAt:49000}};
  const ports={now:()=>time,tickDisengagement(){},disengagementActive:()=>false,intent:()=>({revision:1}),
    owned:name=>({type:name==='P'?'priest':'warrior'}),prepare:m=>m,evaluate:evaluateGroup,finalize:g=>g,blocksPulls:()=>false};
  function reports(){for(const m of members){m.status.seenAt=time;m.status.groupedCombat.state=old;}}
  return {state,old,members,target,alternative,run(){return coordinatorGroupedSnapshot(state,ports);},
    advance(at){time=at;reports();}};
}

test('unseen pre-event primary retires; yellow alternative becomes primary and cached reports cannot restore it', () => {
  const f=groupFixture();f.advance(50000);
  for(const m of f.members){m.status.groupedCombat.sightings=[f.alternative];m.status.groupedCombat.candidates=[f.alternative];}
  let group=f.run();assert.equal(group.fights.some(t=>t.id==='old'),false);assert.equal(group.resetAt,50000);
  f.advance(50100);
  for(const m of f.members)m.status.groupedCombat.epoch=50000;
  group=f.run();assert.equal(group.target.id,'yellow');assert.equal(group.queue[0].id,'yellow');
  assert.equal(group.fights.some(t=>t.id==='old'),false,'old attack evidence cannot revive retired target');
  assert.equal(f.state.combatLogs.W.filter(e=>e.message.includes('retired')).length,1);
});

for(const evidence of ['sightings','threats'])test(`event handoff preserves a pre-event target with fresh ${evidence}`,()=>{
  const f=groupFixture();f.advance(50000);
  for(const m of f.members){m.status.groupedCombat.sightings=[];m.status.groupedCombat[evidence]=[f.target];}
  assert.equal(f.run().target.id,'old');
});

test('stale member reports delay retirement; ordinary disappearance outside events retains its fight',()=>{
  const f=groupFixture();f.advance(50000);f.members[1].status.seenAt=45000;
  for(const m of f.members)m.status.groupedCombat.sightings=[];
  assert.equal(f.run().target.id,'old');assert.ok(f.state.combatEventHandoff);
  f.state.combatEventHandoff=null;f.advance(51000);assert.equal(f.run().target.id,'old');
});

test('blacklist labels distinguish expirations, legacy reasons, and mixed causes',()=>{
  assert.equal(huntBlacklistLabel({deaths:0,expirations:1}),'1 hunt expired');
  assert.equal(huntBlacklistLabel({deaths:0,reason:'Hunt quest expired before completion'}),'1 hunt expired');
  assert.equal(huntBlacklistLabel({deaths:2,expirations:3}),'2 hunt deaths · 3 hunts expired');
  assert.equal(huntBlacklistLabel({deaths:1}),'1 hunt death');
  assert.equal(huntBlacklistLabel({deaths:0,reason:'Manually blacklisted'}),'manually added');
});
