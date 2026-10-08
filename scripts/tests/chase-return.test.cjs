// Failure inventory: e2e/chase-return-failures.md (#46). Written before the change.
// Live incident: a refused return switch left the party off home with no retry.
// Real realm switches and live ALData can't run in the disposable E2E server, so
// these drive both chases with simulated payloads and a switch that can refuse.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createBossChase,initialBossChase}=require('../../runtime/coordinator/events/boss-chase.ts');
const {createDailyChase,initialDailyChase,dailySlotIndex,dailySlotStart}=require('../../runtime/coordinator/events/daily-chase.ts');

const MIN=60_000, HOME='SR_USII', AWAY='SR_USV';
const refusal={ok:false,error:'every active character must be connected before switching'};

function bossFixture(saved) {
  let time=1_000_000, realm=HOME, crab=960_000, refuse=false, other=null;
  const attempts=[], party={bossChase:initialBossChase(saved||{enabled:true,minEtaMinutes:15})};
  const ports={
    now:()=>time,
    fetchLive:async()=>[{type:'crabxx',id:'83862',hp:crab,lastSeen:new Date(time).toISOString(),serverRegion:'US',serverIdentifier:'V'},
      ...(other?[{type:'crabxx',id:'90001',hp:other.hp,lastSeen:new Date(time).toISOString(),serverRegion:'US',serverIdentifier:'III'}]:[])],
    currentRealm:()=>realm, homeRealm:()=>HOME, realmExists:()=>true, hopAllowed:to=>!to.endsWith('PVP'), realmSwitchBusy:()=>false, paused:()=>false,
    selected:event=>event==='crabxx',
    switchRealm:async to=>{attempts.push(to);if(refuse)return refusal;realm=to;return {ok:true};},
    log(){}, persist(){},
  };
  const chase=createBossChase(party,ports);
  return {party,chase,attempts,realm:()=>realm,
    refuse(value){refuse=value;}, move(to){realm=to;}, elsewhere(){other={hp:960_000};},
    async minute(drain,otherDrain=0){time+=MIN;crab=Math.max(1,crab-drain);if(other)other.hp=Math.max(1,other.hp-otherDrain);await chase.tick();}};
}

/** A trip to AWAY whose fight stalls; the return home is refused. */
async function stranded() {
  const r=bossFixture();
  for(let i=0;i<3;i++) await r.minute(16_000);
  assert.deepEqual(r.attempts,[AWAY]);
  r.refuse(true);
  // Stop at the refused return, so the retry window below starts from it.
  for(let i=0;i<10&&!r.attempts.includes(HOME);i++) await r.minute(0);
  assert.equal(r.party.bossChase.trip,null);
  assert.deepEqual(r.attempts,[AWAY,HOME],'the stalled trip ends and asks to return home');
  assert.equal(r.realm(),AWAY,'the refused switch leaves the party away');
  return r;
}

test('1, 3, 4: a refused return is retried after the retry delay and stops once home',async()=>{
  const r=await stranded();
  assert.deepEqual(r.party.bossChase.returning,{from:AWAY,to:HOME});
  r.refuse(false);
  for(let i=0;i<4;i++) await r.minute(0);
  assert.deepEqual(r.attempts,[AWAY,HOME],'no retry inside the 5-minute delay');
  await r.minute(0);
  assert.deepEqual(r.attempts,[AWAY,HOME,HOME],'retried once the delay passes');
  assert.equal(r.realm(),HOME);
  assert.equal(r.party.bossChase.returning,null);
  for(let i=0;i<6;i++) await r.minute(0);
  assert.deepEqual(r.attempts,[AWAY,HOME,HOME],'nothing more once home');
});

test('2: a pending return survives a coordinator restart',async()=>{
  const r=await stranded();
  const restored=bossFixture(JSON.parse(JSON.stringify(r.party.bossChase)));
  assert.deepEqual(restored.party.bossChase.returning,{from:AWAY,to:HOME});
});

test('5: a manual move elsewhere drops the pending return',async()=>{
  const r=await stranded();
  r.refuse(false);
  r.move('SR_USIII');
  for(let i=0;i<8;i++) await r.minute(0);
  assert.equal(r.party.bossChase.returning,null);
  assert.deepEqual(r.attempts,[AWAY,HOME],'the chase leaves a hand-picked realm alone');
});

test('6: no new trip starts while a return is pending',async()=>{
  const r=await stranded();
  // A winnable crab appears on a third realm; past the retry delay the party must
  // still only try to go home, never onward.
  r.elsewhere();
  for(let i=0;i<12;i++) await r.minute(0,16_000);
  assert.ok(!r.attempts.includes('SR_USIII'),'no trip onward while stranded: '+r.attempts.join(','));
  assert.equal(r.party.bossChase.trip,null);
});

test('8: disabling the chase drops its pending return',async()=>{
  const r=await stranded();
  let body;
  r.chase.update({body:{enabled:false}},{status(){return this;},json(value){body=value;return value;}});
  assert.equal(r.party.bossChase.returning,null);
  assert.equal(body.bossChase.returning,null);
});

test('1 (event prediction): a refused return home is retried',async()=>{
  const next=dailySlotIndex('US',Date.UTC(2026,9,4,12),'nightly')+1, slotAt=dailySlotStart('US',next,'nightly');
  let time=slotAt+100*MIN, realm='SR_USIII', refuse=true;
  const attempts=[], party={dailyChase:initialDailyChase({enabled:true,leadMinutes:16,observations:{},
    trip:{rotation:'nightly',realm:'SR_USIII',event:'icegolem',slot:next,slotAt,returnRealm:HOME,startedAt:slotAt-16*MIN,arrived:true,quietChecks:0}})};
  const chase=createDailyChase(party,{
    now:()=>time, gameVersion:()=>0, fetchBosses:async()=>[], reports:()=>[],
    currentRealm:()=>realm, homeRealm:()=>HOME, realms:()=>['SR_USIII','SR_USV',HOME],
    hopAllowed:()=>true, realmSwitchBusy:()=>false, paused:()=>false, selected:event=>event==='icegolem',
    switchRealm:async to=>{attempts.push(to);if(refuse)return refusal;realm=to;return {ok:true};},
    log(){}, persist(){},
  });
  await chase.tick(); // the event window has elapsed: the trip ends and asks to go home
  assert.equal(party.dailyChase.trip,null);
  assert.deepEqual(attempts,[HOME]);
  assert.deepEqual(party.dailyChase.returning,{from:'SR_USIII',to:HOME});
  refuse=false;
  time+=MIN; await chase.tick();
  assert.deepEqual(attempts,[HOME],'no retry inside the 5-minute delay');
  time+=5*MIN; await chase.tick();
  assert.deepEqual(attempts,[HOME,HOME]);
  assert.equal(realm,HOME);
  assert.equal(party.dailyChase.returning,null);
});
