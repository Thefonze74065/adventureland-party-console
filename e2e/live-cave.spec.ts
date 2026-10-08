import { test, expect } from './live-fixtures';
import { createRequire } from 'node:module';
const sharp: typeof import('../dashboard/node_modules/sharp') = createRequire(import.meta.url)('../dashboard/node_modules/sharp');
test.use({ initialPosition: { map: 'main', x: 816, y: 1180 } });

test('Cave entry closes settings, shows native choices and keeps follower maps and travel working', async ({ live, page }, info) => {
  test.setTimeout(900_000);
  page.setDefaultTimeout(20_000);
  await live.admin('Dev=true; Prod=false; G.events.dreams.disabled=false; output=true');
  // Bound encounter selection to native duels/gifts/shops; the six level-100
  // wolves prompt is a separate long combat challenge, not a travel fixture.
  await live.admin("G.events.dreams.encounters=G.events.dreams.encounters.filter(e=>['e11','e20','e31','e50'].includes(e.id));output=true");
  await live.post('/formation', { leader: 'E2EWarrior' });
  await live.post('/formation', { character: 'E2EPriest', follow: true });
  await page.route('https://adventure.land/images/**', async route => {
    const response = await page.request.get(new URL(live.clients.E2EWarrior.page.url()).origin + new URL(route.request().url()).pathname);
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
  });
  await page.goto(live.url);
  const dungeon = async () => (await page.request.get(live.url + '/party-api/daily-dungeons')).json();
  await expect.poll(async () => {
    const view = await dungeon();
    return view.members.length === 2 && view.members.every((m: any) => m.fresh && m.observation?.ready && m.observation?.visit?.available &&
      m.observation.leader === 'E2EWarrior' && m.observation.members.length === 2 && m.observation.members.includes('E2EPriest'));
  }, { timeout: 90_000 }).toBe(true);
  await page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'E2EWarrior', exact: true }) }).getByRole('button', { name: /^Events/ }).click();
  await page.getByRole('button', { name: 'Cave of Many Dreams settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Cave of Many Dreams', exact: true });
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'Enter now' }).click();
  await expect.poll(async () => (await dungeon()).state.phase, { timeout: 90_000 }).toBe('active');
  await info.attach('native-cave-entry', { body: JSON.stringify(await dungeon()), contentType: 'application/json' });
  await expect(settings).not.toBeVisible();
  const controls = page.getByRole('region', { name: 'Cave of Many Dreams controls' });
  if (!(await dungeon()).members.some((m: any) => m.observation?.cave?.choice && !m.observation.cave.choice.resolved)) {
    await controls.getByRole('button', { name: 'The Shop with One Item', exact: true }).click();
  }
  const choice = page.getByRole('dialog').filter({ has: page.getByText('The cave timer and route are paused until the party answers.', { exact: true }) });
  await expect(choice).toBeVisible({ timeout: 90_000 });
  await expect(choice.getByText(/Party funds: .* gold · .* Amber/)).toBeVisible();
  await choice.getByRole('button', { name: 'Inspect cave shop item' }).click();
  const details = page.getByRole('dialog').filter({has: page.getByText('E2EWarrior · slot -1', {exact:true})});
  await expect(details).toBeVisible();
  await info.attach('native-cave-shop-item-details',{body:await details.screenshot(),contentType:'image/png'});
  await page.keyboard.press('Escape');
  await expect(details).not.toBeVisible();
  await expect(choice).toBeVisible();
  await info.attach('native-cave-choice', { body: await choice.screenshot(), contentType: 'image/png' });
  await info.attach('native-cave-before-vote', { body: JSON.stringify(await dungeon()), contentType: 'application/json' });
  const options = (await dungeon()).members[0].observation.cave.choice.options;
  const option = options.find((o: any) => !o.unavailable && !o.cost && !o.amber);
  expect(option).toBeTruthy();
  await choice.getByRole('button', { name: option.label, exact: true }).click();
  await expect(choice).not.toBeVisible({ timeout: 30_000 });
  const shopResult=page.getByRole('dialog').filter({has:page.getByText('Encounter result',{exact:true})});
  if(await shopResult.isVisible())await page.keyboard.press('Escape');
  await expect(controls.getByRole('button', { name: 'Exit dungeon', exact: true })).toBeEnabled();
  for (const name of ['E2EWarrior', 'E2EPriest']) {
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await card.getByRole('button', { name: 'Expand live map' }).click();
    await expect.poll(async () => {
      const response = await page.request.get(live.url + '/party-api/maps/' + (await live.state()).characters[name].map);
      return response.ok();
    }, { timeout: 20_000 }).toBe(true);
    await expect(card.locator('canvas')).toBeVisible();
    let mapScreenshot: Buffer = Buffer.alloc(0);
    await expect.poll(async () => {
      mapScreenshot = await card.locator('canvas').screenshot();
      const { data } = await sharp(mapScreenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const colors = new Set<number>();
      for (let i = 0; i < data.length; i += 3) colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      return colors.size;
    }, { timeout: 20_000, message: name + ' cave map must render terrain and actors' }).toBeGreaterThan(150);
    await info.attach(name + '-cave-map', { body: mapScreenshot, contentType: 'image/png' });
  }
  await expect.poll(async () => (await dungeon()).state.error || null, { timeout: 15_000 }).toBe(null);
  expect((await dungeon()).state.progress.enabled).toBe(false);
  expect(Object.values((await dungeon()).state.commands).some((c: any) => c.action === 'move')).toBe(false);
  const before = await live.state();
  await controls.getByRole('button', {name:'View full map', exact:true}).click();
  const fullMap = page.getByRole('dialog', {name:/Cave of Many Dreams — Floor/});
  await expect(fullMap.locator('canvas')).toBeVisible();
  await expect(fullMap.getByText('E2EPriest', {exact:true})).toBeVisible();
  await info.attach('native-cave-full-map', {body:await fullMap.screenshot(),contentType:'image/png'});
  await fullMap.getByRole('button', {name:'Add waypoint',exact:true}).click();
  const bounds=await (await page.request.get(live.url+'/party-api/maps/'+before.characters.E2EWarrior.map)).json();
  const mapBox=(await fullMap.locator('canvas').boundingBox())!;
  const fit=Math.min(mapBox.width/(bounds.max_x-bounds.min_x+100),mapBox.height/(bounds.max_y-bounds.min_y+100));
  await fullMap.locator('canvas').click({position:{x:mapBox.width/2+(before.characters.E2EWarrior.x-(bounds.min_x+bounds.max_x)/2)*fit,y:mapBox.height/2+(before.characters.E2EWarrior.y-(bounds.min_y+bounds.max_y)/2)*fit}});
  await expect(fullMap.getByRole('button',{name:'Set waypoint',exact:true})).toBeEnabled();
  await fullMap.getByRole('button',{name:'Set waypoint',exact:true}).click();
  await expect(fullMap).not.toBeVisible();
  await expect.poll(async()=>Object.values((await dungeon()).state.commands).every((c:any)=>c.target?.label==='Waypoint'),{timeout:15_000}).toBe(true);
  await expect.poll(async()=>{
    const s=await live.state();
    return Math.max(...['E2EWarrior','E2EPriest'].map(n=>Math.hypot(s.characters[n].x-before.characters.E2EWarrior.x,s.characters[n].y-before.characters.E2EWarrior.y)));
  },{timeout:45_000,message:'Setting the map waypoint must gather and move the actual party'}).toBeLessThan(50);
  await info.attach('native-cave-map-waypoint',{body:JSON.stringify(await dungeon()),contentType:'application/json'});
  const wrongFloor=await page.request.post(live.url+'/party-api/daily-dungeons',{headers:{Origin:live.url},data:{action:'waypoint',operationId:crypto.randomUUID(),run:(await dungeon()).state.run,map:before.characters.E2EWarrior.map.replace(/_0$/,'_1'),x:432,y:384}});
  expect(wrongFloor.status()).toBe(409);
  expect((await wrongFloor.json()).error).toContain('different floor');
  const departure = await live.state();
  const cave = (await dungeon()).members[0].observation.cave;
  const target = cave.points.find((p: any) => p.kind === 'farm' && !p.done && Math.hypot(p.x - departure.characters.E2EWarrior.x, p.y - departure.characters.E2EWarrior.y) > 150);
  expect(target).toBeTruthy();
  await controls.getByRole('button', { name: target.label, exact: true }).first().click();
  await expect.poll(async () => {
    const view = await dungeon(), state = view.state;
    return state.travel?.stage === 'travelling' && state.travel.target?.id === target.id &&
      state.run === cave.run && ['E2EWarrior', 'E2EPriest'].every(name => {
        const observation = view.members.find((member: any) => member.name === name)?.observation;
        const command = state.commands[name];
        return command?.target?.id === target.id && command.run === cave.run &&
          observation?.cave?.run === cave.run && observation.cave.floor === cave.floor &&
          observation.travel?.id === command.id && observation.travel.prepared === true;
      });
  }, { timeout: 120_000, message: 'The selected native Cave route must prepare for both owned commands' }).toBe(true);
  let lastNative: unknown;
  await expect.poll(async () => {
    const state = await live.state();
    return Math.min(...['E2EWarrior', 'E2EPriest'].map(name => Math.hypot(state.characters[name].x - departure.characters[name].x, state.characters[name].y - departure.characters[name].y)));
  }, { timeout: 45_000 }).toBeGreaterThan(80);
  expect((await live.state()).characters.E2EPriest.movement.engine).toBe('cave-convoy');
  const cruise = await live.admin("output=['E2EWarrior','E2EPriest'].map(n=>({name:n,cruise:get_player(n).cruise}));");
  expect(cruise[0].cruise).toBeGreaterThan(0);
  expect(cruise[0].cruise).toBe(cruise[1].cruise);
  await info.attach('native-cave-cruise',{body:JSON.stringify(cruise),contentType:'application/json'});
  await controls.getByRole('button', { name: 'Stop travel', exact: true }).click();
  expect(Object.values((await dungeon()).state.commands).some((c: any) => c.action === 'move')).toBe(false);
  await info.attach('native-cave-stopped-en-route', {body:JSON.stringify(await dungeon()), contentType:'application/json'});
  await controls.getByRole('button', { name: target.label, exact: true }).first().click();
  try {
  await expect.poll(async () => {
    const state = await live.state();
    lastNative = await Promise.all(['E2EWarrior','E2EPriest'].map(name => live.clients[name].frame.evaluate(() => {
      const p = window as any, w = (document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      return {name:w.character?.name,run:w.character?.cave?.run,opened:w.__partyDungeonOpenedChests,
        chests:Object.entries(p.chests || {}).map(([id,c]:[string,any]) => ({id,map:c.map,in:c.in,x:c.x,y:c.y,to_delete:c.to_delete,cave:c.cave})),
        code:p.__partyLoadedClassHash,ready:w.__partyDungeonRuntime?.report().ready};
    })));
    return Math.max(...['E2EWarrior', 'E2EPriest'].map(name => Math.hypot(state.characters[name].x - target.x, state.characters[name].y - target.y)));
  }, { timeout: 120_000, message: 'Both characters must reach the selected room, not merely move' }).toBeLessThan(70);
  } finally { await info.attach('native-cave-route-client-state',{body:JSON.stringify(lastNative),contentType:'application/json'}); }
  await controls.getByRole('button', { name: 'Stop travel', exact: true }).click();
  expect(Object.values((await dungeon()).state.commands).some((c: any) => c.action === 'move')).toBe(false);
  await info.attach('native-cave-manual-travel', { body: JSON.stringify({ dungeon: await dungeon(), state: await live.state() }), contentType: 'application/json' });
  const second = (await dungeon()).members[0].observation.cave.points.find((p: any) => p.kind === 'boss' && !p.done);
  if (second) {
    await controls.getByRole('button', {name:second.label, exact:true}).click();
    await expect.poll(async () => {
      const encounter = (await dungeon()).members[0].observation.cave.choice;
      if (encounter && !encounter.resolved) {
        const reply = encounter.options.find((o: any) => !o.unavailable && !o.cost && !o.amber);
        expect(reply, 'Encounter must have a free native reply').toBeTruthy();
        await choice.getByRole('button',{name:reply.label,exact:true}).click();
        await expect(choice).not.toBeVisible({timeout:30_000});
        expect(Object.values((await dungeon()).state.commands).some((c: any) => c.action === 'move')).toBe(false);
        await controls.getByRole('button',{name:second.label,exact:true}).click();
      }
      const state = await live.state();
      return Math.max(...['E2EWarrior','E2EPriest'].map(name => Math.hypot(state.characters[name].x-second.x,state.characters[name].y-second.y)));
    }, {timeout:300_000,message:'Both characters must navigate to Lockbreaker'}).toBeLessThan(70);
    await info.attach('native-cave-lockbreaker-arrival',{body:JSON.stringify({dungeon:await dungeon(),state:await live.state()}),contentType:'application/json'});
  }
  // Native encounter factory, bounded initial difficulty. Neither attacks,
  // deaths, receipts nor room completion are fabricated by this fixture.
  const duel = await live.admin(`output=(()=>{
    const p=get_player('E2EWarrior'),run=generated_entry(p).record;
    const source=G.events.dreams.encounters.find(e=>e.id==='e11');
    const room={id:'e2e-duel',floor:0,map:p.map,x:p.x,y:p.y,kind:'encounter',required:false,revealed:true,started:false,done:false,actors:[],enemies:[],encounter:{...source,options:source.options.filter(o=>['left','right'].includes(o.id))}};
    run.cave.rooms.push(room);cave_activate(run,room);
    for(const a of room.actors){a.hp=a.max_hp=100000;a.zone_stats.attack=1;calculate_monster_stats(a);a.u=true;}
    cave_begin_vote(run,room);
    globalThis.__e2eCaveDuel=room;
    return {room:room.id,actors:room.actors.map(a=>({id:a.id,name:a.name,hp:a.hp}))};
  })()`);
  await expect(choice).toBeVisible();
  const duelChoice=(await dungeon()).members[0].observation.cave.choice;
  await choice.getByRole('button',{name:duelChoice.options.find((o:any)=>o.id==='left').label,exact:true}).click();
  await expect(choice).not.toBeVisible();
  await expect.poll(async()=>await live.admin("output={done:__e2eCaveDuel.done,allyAlive:!__e2eCaveDuel.npc.dead,enemyDead:!!__e2eCaveDuel.rival.dead};"),{timeout:45_000}).toEqual({done:true,allyAlive:true,enemyDead:true});
  await info.attach('native-cave-help-duelist',{body:JSON.stringify(duel),contentType:'application/json'});
  const blades=await live.admin(`output=(()=>{
    const p=get_player('E2EWarrior'),run=generated_entry(p).record;
    const room={id:'e2e-blades',floor:0,map:p.map,x:p.x+40,y:p.y,kind:'visual',required:false,started:true,actors:[],enemies:[]};
    run.cave.rooms.push(room);const actor=cave_spawn(run,room,'cave_rogue','neutral',0);actor.u=true;
    return {id:String(actor.id),slots:actor.slots};
  })()`);
  const bladeFrame:any=await page.evaluate(({url,id})=>new Promise((resolve,reject)=>{
    const stream=new EventSource(url),timeout=setTimeout(()=>{stream.close();reject(Error('Rogue blade telemetry timed out'));},20000);
    stream.onmessage=event=>{const frame=JSON.parse(event.data),actor=frame.entities.find((e:any)=>e.id===id);
      if(actor?.weapons?.length===2){clearTimeout(timeout);stream.close();resolve(actor);}};
  }),{url:live.url+'/party-api/map-stream/E2EWarrior',id:blades.id});
  expect(bladeFrame.weapons.map((w:any)=>w.hand).sort()).toEqual(['mainhand','offhand']);
  expect(bladeFrame.weapons.every((w:any)=>w.sprite?.url)).toBe(true);
  await controls.getByRole('button',{name:'View full map',exact:true}).click();
  await fullMap.getByRole('button',{name:'Native-size view',exact:true}).click();
  await expect(fullMap.getByText('E2EPriest',{exact:true})).toBeVisible();
  await info.attach('native-cave-rogue-blades',{body:JSON.stringify({seed:blades,frame:bladeFrame}),contentType:'application/json'});
  await info.attach('native-cave-rogue-map',{body:await fullMap.screenshot(),contentType:'image/png'});
  await page.keyboard.press('Escape');
  await expect.poll(async()=>{
    const c=(await dungeon()).members[0].observation.cave;
    if(c.choice&&!c.choice.resolved){
      const reply=c.choice.options.find((o:any)=>!o.unavailable&&!o.cost&&!o.amber);
      await choice.getByRole('button',{name:reply.label,exact:true}).click();
      return false;
    }
    const required=c.points.find((p:any)=>p.required&&!p.done&&p.map.endsWith('_0'));
    if(!required)return true;
    const v=await dungeon();
    const current=v.state.travel?.target?.id || (Object.values(v.state.commands).find((c:any)=>c.action==='move') as any)?.target?.id;
    if(current!==required.id)await controls.getByRole('button',{name:required.label,exact:true}).click();
    return false;
  // Random floors can require several long trips with native combat along the
  // corridors. Allow the final vote's acknowledged result to reach telemetry.
  },{timeout:300_000,message:'Required rooms must finish through native combat and votes'}).toBe(true);
  const stairs=(await dungeon()).members[0].observation.cave.points.find((p:any)=>p.down);
  expect(stairs.locked).toBe(false);
  await live.admin(`output=(()=>{
    const p=get_player('E2EWarrior'),run=generated_entry(p).record,source=G.events.dreams.encounters.find(e=>e.id==='e50');
    const room={id:'e2e-farewell',floor:0,map:p.map,x:${stairs.x},y:${stairs.y},kind:'encounter',required:false,revealed:true,started:false,done:false,actors:[],enemies:[],encounter:source};
    run.cave.rooms.push(room);cave_activate(run,room);cave_publish(run,true);return {room:room.id};
  })()`);
  await controls.getByRole('button',{name:'Stairs down',exact:true}).click();
  let answeredFarewell=false;
  await expect.poll(async()=>{
    const v=await dungeon(),c=v.members[0].observation.cave;
    if(c?.choice&&!c.choice.resolved){
      const reply=c.choice.options.find((o:any)=>!o.unavailable&&!o.cost&&!o.amber);
      answeredFarewell ||= c.choice.title==='Before You Leave';
      await choice.getByRole('button',{name:reply.label,exact:true}).click();
    }
    return v.members.every((m:any)=>m.observation?.cave?.floor===1);
  // Random native floors can put these stairs over 4,000 walking units away.
  // Preserve the vote and actual floor assertions while allowing that route.
  },{timeout:240_000,message:'Manual stairs must continue after the farewell vote and transport both members'}).toBe(true);
  expect(answeredFarewell).toBe(true);
  await info.attach('native-cave-floor-transition',{body:JSON.stringify({dungeon:await dungeon(),state:await live.state()}),contentType:'application/json'});
  await controls.getByRole('button', { name: 'Exit dungeon', exact: true }).click();
  const exit = page.getByRole('dialog', { name: 'Exit the dungeon?' });
  await expect(exit).toBeVisible();
  await exit.getByRole('button', { name: 'Stay in dungeon' }).click();
  expect((await dungeon()).state.phase).toBe('active');
  await controls.getByRole('button', { name: 'Exit dungeon', exact: true }).click();
  await page.getByRole('dialog', { name: 'Exit the dungeon?' }).getByRole('button', { name: 'Confirm exit' }).click();
  await expect.poll(async () => (await dungeon()).state.phase, { timeout: 60_000 }).toBe('held');
  await info.attach('native-cave-exit', { body: JSON.stringify(await dungeon()), contentType: 'application/json' });
});

test('Cave shared-route pacing keeps the party together and stops the selected route', async ({live,page},info)=>{
  test.setTimeout(180_000);
  await live.admin("Dev=true;Prod=false;G.events.dreams.disabled=false;G.events.dreams.encounters=G.events.dreams.encounters.filter(e=>['e11','e20','e31','e50'].includes(e.id));output=true");
  await live.post('/formation',{leader:'E2EWarrior'});
  await live.post('/formation',{character:'E2EPriest',follow:true});
  const view=async()=>await (await page.request.get(live.url+'/party-api/daily-dungeons')).json();
  const act=(body:Record<string,unknown>)=>live.post('/daily-dungeons',{operationId:crypto.randomUUID(),...body});
  await expect.poll(async()=>{
    const v=await view();
    return v.members.length===2&&v.members.every((m:any)=>m.fresh&&m.observation?.ready&&m.observation?.visit?.available&&m.observation.members.length===2&&m.observation.leader==='E2EWarrior');
  },{timeout:60_000}).toBe(true);
  await act({action:'enter'});
  await expect.poll(async()=>(await view()).state.phase,{timeout:60_000}).toBe('active');
  async function reply(v:any) {
    const c=v.members[0].observation.cave;
    if(!c.choice||c.choice.resolved)return false;
    const option=c.choice.options.find((o:any)=>!o.unavailable&&!o.cost&&!o.amber);
    await act({action:'vote',run:c.run,choice:c.choice.id,option:option.id});
    await expect.poll(async()=>(await view()).members[0].observation.cave.choice.resolved,{timeout:20_000}).toBe(true);
    return true;
  }
  await reply(await view());
  const initial=await live.state(),cave=(await view()).members[0].observation.cave;
  const target=cave.points.filter((p:any)=>p.kind==='farm'&&!p.done).sort((a:any,b:any)=>Math.hypot(a.x-initial.characters.E2EWarrior.x,a.y-initial.characters.E2EWarrior.y)-Math.hypot(b.x-initial.characters.E2EWarrior.x,b.y-initial.characters.E2EWarrior.y))[0];
  await act({action:'move',run:cave.run,target:target.id});
  let evidence:any;
  await expect.poll(async()=>{
    const v=await view();
    if(await reply(v)){await act({action:'move',run:cave.run,target:target.id});return false;}
    const s=await live.state(),w=s.characters.E2EWarrior,p=s.characters.E2EPriest;
    evidence={view:v,characters:{E2EWarrior:w,E2EPriest:p},gap:Math.hypot(w.x-p.x,w.y-p.y)};
    return v.members.every((m:any)=>m.observation.travel?.prepared)&&p.movement?.engine==='cave-convoy'&&
      Math.min(Math.hypot(w.x-initial.characters.E2EWarrior.x,w.y-initial.characters.E2EWarrior.y),Math.hypot(p.x-initial.characters.E2EPriest.x,p.y-initial.characters.E2EPriest.y))>100;
  },{timeout:60_000}).toBe(true);
  expect(evidence.gap).toBeLessThan(220);
  const cruise=await live.admin("output=['E2EWarrior','E2EPriest'].map(n=>({name:n,cruise:get_player(n).cruise}));");
  expect(cruise[0].cruise).toBeGreaterThan(0);expect(cruise[0].cruise).toBe(cruise[1].cruise);
  await info.attach('native-cave-shared-pacing',{body:JSON.stringify({initial,target,cruise,...evidence}),contentType:'application/json'});
  await act({action:'progress',enabled:false});
  expect(Object.values((await view()).state.commands).some((c:any)=>['move','gather'].includes(c.action))).toBe(false);
  for(const name of ['E2EWarrior','E2EPriest'])await expect.poll(async()=>live.clients[name].frame.evaluate(()=>{
    const w=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
    return !!w.__partyMovement.state.moving;
  }),{timeout:10_000}).toBe(false);
  await page.goto(live.url);
  // Walking can reveal a fresh encounter even after travel is stopped. Its
  // native modal correctly hides background controls until the party answers.
  await reply(await view());
  await expect(page.getByRole('region',{name:'Cave of Many Dreams controls'})).toBeVisible();
  await info.attach('native-cave-stopped-pacing',{body:await page.getByRole('region',{name:'Cave of Many Dreams controls'}).screenshot(),contentType:'image/png'});
});



