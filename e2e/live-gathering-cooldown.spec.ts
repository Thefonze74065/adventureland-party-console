import {waitForGameplay} from './network-clock';
import { test, expect, type LiveGame } from './live-fixtures';

// Failure inventory: e2e/gathering-cooldown-failures.md. The game server resolves a finished
// fishing/mining channel with one Math.random() roll and starts the reuse cooldown only on a
// success. The fixture declares the outcome of exactly that roll: a proxy on the merchant's
// conditions (`player.c`) arms an override when the server deletes the finished channel, and the
// next Math.random() call, which is the gathering roll, returns a hit or a miss. Every other roll,
// and every native action (travel, tool equip, cast, item grant, cooldown), is the real game.
const name = 'E2EMerchant';
const gatheringTest = test.extend({initialGatheringReady:true});
type Roll = { mode: string; outcome: string; at: number };

async function rolls(live: LiveGame): Promise<Roll[]> {
  return live.admin(`output=(globalThis.__e2eGather?.log||[]).slice()`);
}
async function stock(live: LiveGame): Promise<number> {
  return live.admin(`output=get_player('${name}').items.filter(item=>item&&!['rod','pickaxe','hpot0','mpot0','hpot1','mpot1'].includes(item.name)).reduce((n,item)=>n+(item.q||1),0)`);
}

gatheringTest('a missed fishing or mining channel is recast at once; a success waits for the game cooldown', async ({ live }, info) => {
  test.setTimeout(600_000);
  for (const mode of ['fishing', 'mining']) await live.post('/merchant/gather', { mode, enabled: false });
  await expect.poll(async () => (await live.state()).gatheringModes, { timeout: 30_000 }).toEqual([]);
  await expect.poll(() => live.clients[name].frame.evaluate(() => {
    const root = (document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
    return !root.__merchantGatheringSession && !root.__merchantGatheringAttempt;
  }), { timeout: 30_000 }).toBe(true);

  // Declared fixture: the last twelve cells hold a rod, a pickaxe and ten free cells
  // (gathering skips casts at three or fewer), and MP is full.
  const seed = await live.admin(`output=(()=>{const p=get_player('${name}');
    const size=p.isize||p.items.length;
    for(let i=size-12;i<size;i++)p.items[i]=null;
    const free=p.items.map((item,i)=>item?-1:i).filter(i=>i>=0);
    p.items[free[0]]={name:'rod',level:0};p.items[free[1]]={name:'pickaxe',level:0};
    p.mp=p.max_mp;cache_player_items(p);resend(p,'reopen+cid');
    return {level:p.level,mp:p.mp,free:free.length-2};})()`);
  expect(seed.level, 'Fishing and Mining need level 16').toBeGreaterThanOrEqual(16);
  await expect.poll(async () => (await live.state()).characters[name]?.items?.some((entry: any) => entry?.item?.name === 'pickaxe'), { timeout: 30_000 }).toBe(true);

  // Declare availability before native login. Clearing a live cooldown races
  // status replies already in the browser, which correctly preserve known
  // cooldowns. Observe agreement without rewriting live skill state.
  let availability:any;
  await expect.poll(async()=>{
    const [state,client,server]=await Promise.all([live.state(),live.clients[name].frame.evaluate(()=>{
      const game=window as any,root=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      return {now:Date.now(),next:Object.fromEntries(['fishing','mining'].map(mode=>[mode,Number(new Date(game.next_skill[mode]||0))])),
        recorded:{...root.__merchantGatheringCooldowns},session:!!root.__merchantGatheringSession,attempt:!!root.__merchantGatheringAttempt};
    }),live.admin(`output=(()=>{const p=get_player('${name}');return {fishing:p.last.fishing,mining:p.last.mining};})()`)]);
    availability={coordinator:state.gatheringCooldowns,client,server};
    return !client.session&&!client.attempt&&['fishing','mining'].every(mode=>
      Number(new Date(server[mode]))===0&&Number(client.next[mode])<=client.now&&
      Number(client.recorded[mode]||0)===0&&Number(state.gatheringCooldowns[mode]||0)===0);
  },{timeout:15000,message:'Native gathering availability must agree before the first cast'}).toBe(true);
  await info.attach('native-gathering-initial-availability',{body:JSON.stringify(availability),contentType:'application/json'});

  // Declared outcomes of the server's gathering rolls, in order per mode.
  const hook = await live.admin(`output=(()=>{const p=get_player('${name}');
    globalThis.__e2eGather={armed:null,outcomes:{fishing:['miss','miss','hit'],mining:['miss','hit']},log:[]};
    if(!globalThis.__e2eOrigRandom)globalThis.__e2eOrigRandom=Math.random;
    const original=globalThis.__e2eOrigRandom;
    Math.random=function(){const g=globalThis.__e2eGather;
      if(g&&g.armed){const mode=g.armed;g.armed=null;const outcome=(g.outcomes[mode]||[]).shift();
        if(outcome){g.log.push({mode,outcome,at:Date.now()});return outcome==='hit'?0.001:0.999;}}
      return original();};
    // A reconnect creates a new player object; keep its conditions wrapped.
    const wrap=()=>{const q=get_player('${name}');if(!q||!q.c||q.c.__e2eTarget)return;
      q.c=new Proxy(q.c,{get(t,k){return k==='__e2eTarget'?t:t[k];},deleteProperty(t,k){
        if((k==='fishing'||k==='mining')&&globalThis.__e2eGather)globalThis.__e2eGather.armed=k;return delete t[k];}});};
    wrap();clearInterval(globalThis.__e2eGatherTimer);globalThis.__e2eGatherTimer=setInterval(wrap,50);
    return {outcomes:globalThis.__e2eGather.outcomes,wrapped:!!p.c.__e2eTarget};})()`);
  expect(hook.wrapped, 'The roll hook wraps the merchant conditions').toBe(true);
  const before = await stock(live);

  try {
    for (const mode of ['fishing', 'mining']) await live.post('/merchant/gather', { mode, enabled: true });

    // 1. Every declared roll happens, misses first: a miss is followed by another real cast.
    await expect.poll(async () => (await rolls(live)).length, { timeout: 480_000, intervals: [2000],
      message: 'Both modes must recast after each miss until their declared hit' }).toBe(5);
    const log = await rolls(live);
    for (const mode of ['fishing', 'mining']) {
      const own = log.filter(entry => entry.mode === mode);
      expect(own.map(entry => entry.outcome), mode + ' rolls').toEqual(mode === 'fishing' ? ['miss', 'miss', 'hit'] : ['miss', 'hit']);
      // A miss starts no cooldown, so the next cast of that mode follows within a channel or two.
      for (let i = 1; i < own.length; i++)
        expect(own[i].at - own[i - 1].at, mode + ' recast after a miss').toBeLessThan(120_000);
    }

    // 2. Each hit granted its catch.
    await expect.poll(() => stock(live), { timeout: 30_000 }).toBeGreaterThanOrEqual(before + 2);

    // 3. After the hits, the recorded cooldowns are the game's, and no mode casts again.
    const server = await live.admin(`output=(()=>{const p=get_player('${name}');return {fishing:new Date(p.last.fishing).getTime(),mining:new Date(p.last.mining).getTime()};})()`);
    await expect.poll(async () => {
      const recorded = (await live.state()).gatheringCooldowns;
      return ['fishing', 'mining'].every(mode => Math.abs(recorded[mode] - (server[mode as 'fishing' | 'mining'] +
        (mode === 'fishing' ? 2_880_000 : 7_440_000))) < 15_000);
    }, { timeout: 30_000, message: 'Recorded cooldowns follow the game after a success' }).toBe(true);
    const settled = (await rolls(live)).length;
    await waitForGameplay(60_000);
    expect((await rolls(live)).length, 'No cast while the game cooldown runs').toBe(settled);

    // 4. The success cooldowns survive a coordinator restart.
    const recorded = (await live.state()).gatheringCooldowns;
    await live.restartCoordinator();
    await expect.poll(async () => (await live.state()).gatheringCooldowns, { timeout: 30_000 }).toEqual(recorded);
    await info.attach('gathering-cooldown-evidence', { body: JSON.stringify({ seed, hook, before, after: await stock(live), log: await rolls(live), server, recorded,
      activity: ((await live.state()).merchantActivity || []).filter((entry: any) => /fish|min|gather|caught|catch/i.test(entry.message || '')) }, null, 2), contentType: 'application/json' });
  } finally {
    await info.attach('gathering-before-cleanup', {body:JSON.stringify({at:Date.now(),
      server:await live.admin(`output=(()=>{const p=get_player('${name}');return {rolls:globalThis.__e2eGather,c:p.c,last:p.last,mp:p.mp};})()`),
      client:await live.clients[name].run(`({c:character.c,mp:character.mp,nextSkill:parent.next_skill,session:globalThis.__merchantGatheringSession,
        attempt:globalThis.__merchantGatheringAttempt,inventoryCommands:globalThis.__partyInventoryCommands,queue:sharedRoutine.queueReport()})`),
      state:await live.state()}),contentType:'application/json'}).catch(()=>{});
    await live.admin(`output=(()=>{clearInterval(globalThis.__e2eGatherTimer);if(globalThis.__e2eOrigRandom)Math.random=globalThis.__e2eOrigRandom;globalThis.__e2eGather=null;
      const p=get_player('${name}');if(p&&p.c&&p.c.__e2eTarget)p.c=p.c.__e2eTarget;return true;})()`).catch(() => {});
    for (const mode of ['fishing', 'mining']) await live.post('/merchant/gather', { mode, enabled: false }).catch(() => {});
  }
});
