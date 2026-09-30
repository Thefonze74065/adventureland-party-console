import { test, expect } from './live-fixtures';
import { warrior as W, priest as P, fighters, party, quests, start, world, tokens, artifact } from './game/hunt-lifecycle';
import { spawnGoo } from './hunt-interruption-helpers';

test('a missing native sprite frame preserves actual convoy walking and draw scheduling', async ({live}, info) => {
  test.setTimeout(240_000);
  await party(live);
  const {id: monsterId} = await spawnGoo(live, W, 20);
  await expect.poll(() => live.clients[W].frame.evaluate(id => Boolean((window as any).entities[id]), monsterId)).toBe(true);
  const fault = await live.clients[W].frame.evaluate(id => {
    const game = window as any, c = game.character;
    const sprite = game.entities[id], frames = game.textures[sprite.skin];
    if (!Array.isArray(frames) || !frames[1]) throw Error('Native sprite fixture requires an idle frame');
    const saved = frames[1], started = Date.now(), draws = game.draws;
    // Cosmetic cache fault only. Native movement, sockets and physics are untouched.
    delete frames[1];
    sprite.cskin = null;
    const samples: unknown[] = [];
    const timer = setInterval(() => samples.push({at:Date.now(),draws:game.draws,lastDraw:+game.last_draw,x:c.real_x,y:c.real_y}), 100);
    game.__e2eRenderFault = {skin:sprite.skin, started, draws, samples, reschedules:0, restored:false};
    const requestFrame = game.requestAnimationFrame;
    // Observe scheduling without changing its callbacks or timing. Host FPS is
    // not a correctness requirement; a throwing draw never reaches this call.
    game.requestAnimationFrame = function(callback: FrameRequestCallback) {
      if (callback === game.draw) game.__e2eRenderFault.reschedules++;
      return requestFrame.call(game, callback);
    };
    setTimeout(() => {frames[1] = saved; clearInterval(timer); game.requestAnimationFrame = requestFrame; game.__e2eRenderFault.restored = true;}, 7000);
    return {skin:sprite.skin, started, draws, origin:{map:c.map,x:c.real_x,y:c.real_y}};
  }, monsterId);
  const destination = await live.clients[W].run(`(()=>{for(let i=0;i<16;i++){const a=i*Math.PI/8,x=character.real_x+400*Math.cos(a),y=character.real_y+400*Math.sin(a);if(can_move_to(x,y))return {map:character.map,x,y};}throw Error('No reachable native walk')})()`);
  await info.attach('declared-native-render-fault', {body:JSON.stringify({fault,destination}),contentType:'application/json'});
  await live.post('/travel', destination);
  await expect.poll(async () => live.clients[W].frame.evaluate(() => (window as any).__e2eRenderFault.restored), {timeout:15_000}).toBe(true);
  const observations = await live.clients[W].frame.evaluate(() => (window as any).__e2eRenderFault);
  await info.attach('native-render-scheduling', {body:JSON.stringify(observations),contentType:'application/json'});
  expect(observations.reschedules, 'Native draw must continue scheduling its own frames during the texture fault').toBeGreaterThan(2);
  expect(live.clients[W].errors.filter(error => /texture|reading/.test(error))).toEqual([]);
  await expect.poll(async () => {
    const current = await world(live);
    return fighters.every(name => current[name].map === destination.map && Math.hypot(current[name].x-destination.x,current[name].y-destination.y)<35);
  }, {timeout:90_000}).toBe(true);
  await artifact(live,info,'native-render-fault-walking',{fault,destination,observations});
});

test('native Ice Roamer Hunt engages successive enemies and returns both real rewards', async ({live}, info) => {
  test.setTimeout(480_000);
  await party(live);
  await quests(live,info,{[W]:{id:'iceroamer',count:3},[P]:{id:'iceroamer',count:3}});
  const before = await world(live), destination = await start(live,W,'iceroamer');
  expect(destination.map).toBe('winterland');
  await expect.poll(async () => {
    const current = await world(live);
    return fighters.every(name => tokens(current[name]) === tokens(before[name])+1);
  }, {timeout:360_000, message:'Three native Ice Roamer kills must progress to both Daisy rewards'}).toBe(true);
  const events = await live.clients[W].events();
  const kills = events.filter((entry:any) => entry.event==='hit' && entry.data?.kill && fighters.includes(entry.data?.hid));
  expect(new Set(kills.map((entry:any)=>entry.data.id)).size).toBeGreaterThanOrEqual(3);
  await live.post('/farming-mode',{character:W,mode:'default'});
  await artifact(live,info,'native-ice-roamer-successors-and-rewards',{before,destination,kills});
});
