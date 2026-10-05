// Failure inventory: e2e/boss-chase-failures.md. Live incident: a trip to an
// unwinnable Giga Crab (ETK ~115,000 minutes) never ended.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createBossChase,initialBossChase}=require('../../runtime/coordinator/events/boss-chase.ts');

const MIN=60_000, HOME='SR_USII', AWAY='SR_USV';
function fixture() {
  let time=1_000_000, realm=HOME, crab=960_000, drain=0;
  const switches=[], party={bossChase:initialBossChase({enabled:true,minEtaMinutes:15})};
  const chase=createBossChase(party,{
    now:()=>time,
    fetchLive:async()=>[{type:'crabxx',id:'83862',hp:crab,lastSeen:new Date(time).toISOString(),serverRegion:'US',serverIdentifier:'V'}],
    currentRealm:()=>realm, homeRealm:()=>HOME, realmExists:()=>true, realmSwitchBusy:()=>false, paused:()=>false,
    selected:event=>event==='crabxx',
    switchRealm:async to=>{switches.push(to);realm=to;return {ok:true};},
    log(){}, persist(){},
  });
  return {party,switches,realm:()=>realm,
    /** Advance one minute at the current drain (HP per minute) and poll. */
    async minute(perMinute=drain){drain=perMinute;time+=MIN;crab=Math.max(1,crab-drain);await chase.tick();}};
}
const etk=(hp,perMinute)=>hp/perMinute;

test('an unwinnable boss is never chosen',async()=>{
  const r=fixture();
  for(let i=0;i<4;i++) await r.minute(8); // ~115,000-minute ETK, as seen live
  assert.ok(etk(960_000,8)>100_000);
  assert.deepEqual(r.switches,[],'an ETK beyond the stall limit must not start a trip');
  assert.equal(r.party.bossChase.trip,null);
});

test('a trip whose fight stalls ends after the party has had time to engage, and returns home',async()=>{
  const r=fixture();
  for(let i=0;i<3;i++) await r.minute(16_000); // ~60-minute ETK: worth a trip
  assert.deepEqual(r.switches,[AWAY]);
  for(let i=0;i<4;i++) await r.minute(0); // the fight stalls after arrival
  assert.deepEqual(r.switches,[AWAY],'the party gets five minutes to engage before the fight is judged');
  for(let i=0;i<3;i++) await r.minute(0);
  assert.deepEqual(r.switches,[AWAY,HOME],'a stalled fight ends the trip and returns home');
  assert.equal(r.party.bossChase.trip,null);
});

test('the party returns once a strong player brings the ETK back down, without ping-ponging',async()=>{
  const r=fixture();
  for(let i=0;i<3;i++) await r.minute(16_000);
  for(let i=0;i<7;i++) await r.minute(0);
  assert.deepEqual(r.switches,[AWAY,HOME]);
  for(let i=0;i<5;i++) await r.minute(20_000); // someone strong arrives (~40-minute ETK)
  assert.deepEqual(r.switches,[AWAY,HOME],'samples still span our own failed fight; wait before choosing it again');
  for(let i=0;i<7;i++) await r.minute(20_000);
  assert.deepEqual(r.switches,[AWAY,HOME,AWAY],'a reasonable ETK makes the boss worth chasing again');
});
