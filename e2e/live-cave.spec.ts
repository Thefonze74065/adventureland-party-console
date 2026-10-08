import { test, expect } from './live-fixtures';
import { createRequire } from 'node:module';
const sharp: typeof import('../dashboard/node_modules/sharp') = createRequire(import.meta.url)('../dashboard/node_modules/sharp');
test.use({ initialPosition: { map: 'main', x: 816, y: 1180 } });

test('Cave entry closes settings, shows native choices and keeps follower maps and travel working', async ({ live, page }, info) => {
  test.setTimeout(1_500_000);
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
    let mapPixels = {floor:0,texture:0,actor:0,armor:0};
    await expect.poll(async () => {
      mapScreenshot = await card.locator('canvas').screenshot();
      const { data, info: size } = await sharp(mapScreenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      mapPixels = {floor:0,texture:0,actor:0,armor:0};
      for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++) {
        const i=(y*size.width+x)*3,r=data[i],g=data[i+1],b=data[i+2];
        if(r>g*1.3 && g>b*1.3) {
          mapPixels.floor++;
          if(x && data[i-3]>=data[i-2] && data[i-2]>=data[i-1] &&
            Math.abs(r-data[i-3])+Math.abs(g-data[i-2])+Math.abs(b-data[i-1])>20)mapPixels.texture++;
        }
        // This minimap follows its actor: native sprite feet are at its center.
        if(Math.abs(x-size.width/2)<=12 && Math.abs(y-size.height/2)<=12) {
          if(r>180 && g>180 && b>140)mapPixels.actor++;
          if(g>r*1.05 && b>r*1.15)mapPixels.armor++;
        }
      }
      return mapPixels.floor>200 && mapPixels.texture>200 && mapPixels.actor>=1 && mapPixels.armor>8;
    }, { timeout: 20_000, message: name + ' cave map must render textured native floor and its centered actor' }).toBe(true);
    await info.attach(name+'-cave-map-pixel-evidence',{body:JSON.stringify(mapPixels),contentType:'application/json'});
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
  const acceptWaypoint=async(expectedMap:string)=>{
    const expectedFloor=Number(expectedMap.split('_').at(-1));
    const expectedRun=expectedMap.slice(5,expectedMap.lastIndexOf('_'));
    const set=fullMap.getByRole('button',{name:'Set waypoint',exact:true});
    const attempts:{submitted:boolean;status?:number;error?:string;heartbeatDisabled?:boolean}[]=[];
    const heartbeatSnapshot=()=>fullMap.evaluate(element=>({
        disabled:Array.from(element.querySelectorAll('button')).find(button=>button.textContent?.trim()==='Set waypoint')?.disabled,
        waiting:Array.from(element.querySelectorAll('output')).some(status=>status.textContent==='Waiting for fresh participant reports.'),
      }));
    const staleHeartbeat=async(snapshot:Awaited<ReturnType<typeof heartbeatSnapshot>>)=>{
      expect(snapshot.disabled,'A suppressed waypoint must be disabled in the same DOM snapshot as its freshness reason').toBe(true);
      if(snapshot.waiting){
        const view=await dungeon();
        expect(view.state.phase).toBe('active');
        expect(view.state.run).toBe(expectedRun);
        expect(view.members.every((m:any)=>m.observation?.alive&&m.observation.cave?.run===expectedRun&&
          m.observation.cave.floor===expectedFloor&&!m.observation.cave.paused),
          'Freshness recovery may not hide a changed run, floor, death, or native pause').toBe(true);
        await info.attach('native-cave-suppressed-waypoint-snapshot',{body:JSON.stringify({snapshot,expectedMap,dungeon:view}),contentType:'application/json'});
      }
      return snapshot.waiting;
    };
    const isWaypoint=(request:import('@playwright/test').Request)=>request.method()==='POST'&&
      new URL(request.url()).pathname==='/party-api/daily-dungeons'&&request.postDataJSON()?.action==='waypoint';
    try{
      await expect.poll(async()=>{
        let submitted=false,response:Promise<{status:number;body:any;request:any}>|undefined;
        const requested=(request:import('@playwright/test').Request)=>{if(isWaypoint(request))submitted=true;};
        const responded=(reply:import('@playwright/test').Response)=>{
          if(isWaypoint(reply.request()))response=reply.json().then(body=>({status:reply.status(),body,request:reply.request().postDataJSON()}));
        };
        page.on('request',requested);page.on('response',responded);
        try{
          const initial=await heartbeatSnapshot();
          if(initial.disabled){
            expect(await staleHeartbeat(initial),'A disabled waypoint without a request must correspond to stale native reports').toBe(true);
            attempts.push({submitted:false,heartbeatDisabled:true});return false;
          }
          await set.click();
          let suppressed:Awaited<ReturnType<typeof heartbeatSnapshot>>|undefined;
          await expect.poll(async()=>{
            if(response)return true;
            if(submitted)return false;
            const snapshot=await heartbeatSnapshot();
            if(submitted)return !!response;
            if(snapshot.disabled&&snapshot.waiting){suppressed=snapshot;return true;}
            return false;
          },{timeout:10_000}).toBe(true);
          if(!submitted){
            expect(suppressed,'A suppressed click must retain its simultaneous disabled/waiting DOM evidence').toBeDefined();
            expect(await staleHeartbeat(suppressed!),'A suppressed waypoint click must correspond to stale native reports').toBe(true);
            // A POST arriving while the live identity check ran must still finish,
            // rather than being duplicated as a suppressed click.
            if(!submitted){attempts.push({submitted:false,heartbeatDisabled:true});return false;}
          }
          await expect.poll(()=>!!response,{timeout:10_000,message:'A submitted waypoint must receive its own response before any retry'}).toBe(true);
          const result=await response!;
          expect(result.request.map).toBe(expectedMap);
          expect(result.request.run).toBe(expectedRun);
          attempts.push({submitted:true,status:result.status,error:result.body.error});
          if(result.status===409&&result.body.error==='Fresh matching dungeon run required'){
            const view=await dungeon(),requested=result.request;
            const floor=Number(requested.map?.split('_').at(-1));
            expect(view.state.phase).toBe('active');
            expect(view.state.run).toBe(requested.run);
            expect(requested.map).toBe('zone_'+requested.run+'_'+floor);
            expect(view.members.every((m:any)=>m.observation?.alive&&m.observation.cave?.run===requested.run&&
              m.observation.cave.floor===floor&&!m.observation.cave.paused),
              'A freshness rejection may not hide a different run, floor, death, or native pause').toBe(true);
            await info.attach('native-cave-waypoint-freshness-rejection',{body:JSON.stringify({request:requested,response:result.body,dungeon:view}),contentType:'application/json'});
            return false;
          }
          expect(result.status,'Waypoint submission must be accepted; other errors are not retried').toBe(200);
          await expect(fullMap).not.toBeVisible();
          return true;
        }finally{page.off('request',requested);page.off('response',responded);}
      },{timeout:60_000,message:'The actual UI waypoint request must receive fresh native acceptance'}).toBe(true);
    }finally{await info.attach('native-cave-waypoint-submission-ledger',{body:JSON.stringify(attempts),contentType:'application/json'});}
  };
  await fullMap.getByRole('button', {name:'Add waypoint',exact:true}).click();
  const bounds=await (await page.request.get(live.url+'/party-api/maps/'+before.characters.E2EWarrior.map)).json();
  const mapBox=(await fullMap.locator('canvas').boundingBox())!;
  const fit=Math.min(mapBox.width/(bounds.max_x-bounds.min_x+100),mapBox.height/(bounds.max_y-bounds.min_y+100));
  await fullMap.locator('canvas').click({position:{x:mapBox.width/2+(before.characters.E2EWarrior.x-(bounds.min_x+bounds.max_x)/2)*fit,y:mapBox.height/2+(before.characters.E2EWarrior.y-(bounds.min_y+bounds.max_y)/2)*fit}});
  await expect(fullMap.getByRole('button',{name:'Set waypoint',exact:true})).toBeEnabled();
  await acceptWaypoint(before.characters.E2EWarrior.map);
  let initialWaypoint: {id:string;map:string;x:number;y:number;label:string;run:string}|undefined;
  await expect.poll(async()=>{
    const view=await dungeon(),state=view.state;
    const candidates=[state.travel?.target,...Object.values(state.commands).filter((c:any)=>c.action==='move'&&c.run===state.run).map((c:any)=>c.target)];
    const target=candidates.find(target=>target?.label==='Waypoint'&&target.map===before.characters.E2EWarrior.map&&
      Math.hypot(target.x-before.characters.E2EWarrior.x,target.y-before.characters.E2EWarrior.y)<15);
    if(target)initialWaypoint={...target,run:state.run};
    return !!initialWaypoint;
  },{timeout:15_000,message:'The map selection must acknowledge the actual native waypoint'}).toBe(true);
  await expect.poll(async()=>{
    const view=await dungeon();
    return ['E2EWarrior','E2EPriest'].every(name=>{
      const command=view.state.commands[name];
      return command?.action==='move' && command.target?.id===initialWaypoint!.id && command.run===initialWaypoint!.run && view.state.run===initialWaypoint!.run;
    });
  },{timeout:120_000,message:'Both owned map-waypoint moves must dispatch after native assembly'}).toBe(true);
  await expect.poll(async()=>{
    const s=await live.state();
    return Math.max(...['E2EWarrior','E2EPriest'].map(n=>Math.hypot(s.characters[n].x-before.characters.E2EWarrior.x,s.characters[n].y-before.characters.E2EWarrior.y)));
  },{timeout:45_000,message:'Setting the map waypoint must gather and move the actual party'}).toBeLessThan(50);
  await expect.poll(async()=>{
    const view=await dungeon();
    return view.state.run===initialWaypoint!.run && ['E2EWarrior','E2EPriest'].every(name=>{
      const member=view.members.find((m:any)=>m.name===name),receipt=member?.observation?.action;
      return member?.fresh && receipt?.status==='complete' && receipt.command?.action==='move' &&
        receipt.command.run===initialWaypoint!.run && receipt.command.target?.id===initialWaypoint!.id &&
        receipt.id===view.state.commands[name]?.id;
    });
  },{timeout:120_000,message:'Both initial native waypoint moves must complete before raw fixture staging'}).toBe(true);
  await controls.getByRole('button',{name:'Stop travel',exact:true}).click();
  await expect.poll(async()=>{
    const state=(await dungeon()).state;
    return !state.travel && state.progress?.enabled===false &&
      !Object.values(state.commands).some((c:any)=>['move','gather'].includes(c.action));
  },{timeout:20_000,message:'Initial waypoint ownership must be released before native fixture staging'}).toBe(true);
  await info.attach('native-cave-map-waypoint',{body:JSON.stringify(await dungeon()),contentType:'application/json'});
  const wrongFloor=await page.request.post(live.url+'/party-api/daily-dungeons',{headers:{Origin:live.url},data:{action:'waypoint',operationId:crypto.randomUUID(),run:(await dungeon()).state.run,map:before.characters.E2EWarrior.map.replace(/_0$/,'_1'),x:432,y:384}});
  expect(wrongFloor.status()).toBe(409);
  expect((await wrongFloor.json()).error).toContain('different floor');
  const safe=await live.admin(`output=(()=>{
    const people=['E2EWarrior','E2EPriest'].map(n=>get_player(n)),p=people[0],run=generated_entry(p).record;
    const rooms=run.cave.rooms.filter(r=>r.map===p.map&&['farm','patrol','fight','boss','darkmage'].includes(r.kind)).map(r=>({id:r.id,x:r.x,y:r.y}));
    const enemies=Array.from(run.cave.actors).filter(a=>!a.dead&&a.map===p.map&&['enemy','predator'].includes(a.zone_actor?.side)).map(a=>({id:a.id,x:a.x,y:a.y}));
    const clearanceSquared=(from,to,obstacles)=>{
      let result=Infinity;
      const dx=to.x-from.x,dy=to.y-from.y,length=dx*dx+dy*dy;
      for(const r of obstacles){
        const t=length?Math.max(0,Math.min(1,((r.x-from.x)*dx+(r.y-from.y)*dy)/length)):0;
        const x=from.x+t*dx-r.x,y=from.y+t*dy-r.y;
        result=Math.min(result,x*x+y*y);
      }
      return result;
    };
    const walk=(from,to)=>can_move({map:p.map,x:from.x,y:from.y,going_x:to.x,going_y:to.y,base:p.base});
    for(const distance of [320,260,200])for(let radius=0;radius<=200;radius+=20)for(let i=0;i<32;i++){
      const a=i*Math.PI/16,origin={map:p.map,x:p.x+radius*Math.cos(a),y:p.y+radius*Math.sin(a)};
      if(clearanceSquared(origin,origin,rooms)<410*410 || !people.every(actor=>clearanceSquared(actor,origin,enemies)>=300*300))continue;
      if(!people.every(actor=>walk(actor,origin)))continue;
      for(let k=0;k<32;k++){
        const angle=k*Math.PI/16,target={map:p.map,x:origin.x+distance*Math.cos(angle),y:origin.y+distance*Math.sin(angle)};
        const endpoints=[-20,0,20].flatMap(dx=>[-20,0,20].map(dy=>({x:target.x+dx,y:target.y+dy})));
        const roomSquared=Math.min(...endpoints.map(point=>clearanceSquared(origin,point,rooms)));
        if(roomSquared<410*410)continue;
        const enemySquared=Math.min(...endpoints.map(point=>clearanceSquared(origin,point,enemies)));
        if(enemySquared<300*300)continue;
        if(endpoints.every(point=>walk(origin,point)))return {origin,target,distance,roomClearance:Math.sqrt(roomSquared),enemyClearance:Math.sqrt(enemySquared),endpointMargin:20,rooms,enemies};
      }
    }
    throw Error('No collision-safe noncombat native Stop/resume segment');
  })()`);
  await info.attach('declared-native-cave-manual-travel-segment',{body:JSON.stringify(safe),contentType:'application/json'});
  await Promise.all(['E2EWarrior','E2EPriest'].map(async name=>{
    await live.clients[name].frame.evaluate(({x,y})=>(window as any).move(x,y),safe.origin);
    await expect.poll(async()=>{const s=await live.state();return Math.hypot(s.characters[name].x-safe.origin.x,s.characters[name].y-safe.origin.y);},{timeout:20_000}).toBeLessThan(5);
  }));
  await expect.poll(async()=>(await dungeon()).members.every((m:any)=>m.fresh&&m.observation.ready),{timeout:30_000}).toBe(true);
  const departure = await live.state();
  const cave = (await dungeon()).members[0].observation.cave;
  const farm = cave.points.find((p:any)=>p.kind==='farm'&&!p.done);
  expect(farm).toBeTruthy();
  const selectWaypoint=async()=>{
    const previous=(await dungeon()).state;
    const previousIds=new Set([previous.travel?.target?.id,...Object.values(previous.commands).map((c:any)=>c.target?.id)]);
    await controls.getByRole('button',{name:'View full map',exact:true}).click();
    await fullMap.getByRole('button',{name:'Add waypoint',exact:true}).click();
    const box=(await fullMap.locator('canvas').boundingBox())!;
    const scale=Math.min(box.width/(bounds.max_x-bounds.min_x+100),box.height/(bounds.max_y-bounds.min_y+100));
    await fullMap.locator('canvas').click({position:{x:box.width/2+(safe.target.x-(bounds.min_x+bounds.max_x)/2)*scale,y:box.height/2+(safe.target.y-(bounds.min_y+bounds.max_y)/2)*scale}});
    const nomination=await fullMap.getByText(/^-?\d+, -?\d+$/).innerText();
    const [x,y]=nomination.split(',').map(Number);
    expect(Math.hypot(x-safe.target.x,y-safe.target.y),'Canvas nomination must remain within the validated native endpoint margin').toBeLessThan(10);
    await info.attach('native-cave-visible-waypoint-nomination',{body:JSON.stringify({nomination,intended:safe.target,endpointMargin:safe.endpointMargin}),contentType:'application/json'});
    await acceptWaypoint(safe.target.map);
    let selected:{id:string;map:string;x:number;y:number}|undefined;
    await expect.poll(async()=>{
      const view=await dungeon(),state=view.state;
      const candidates=[state.travel?.target,...Object.values(state.commands).filter((c:any)=>c.action==='move'&&c.run===cave.run).map((c:any)=>c.target)];
      selected=candidates.find(point=>point?.label==='Waypoint'&&!previousIds.has(point.id)&&state.run===cave.run&&point.map===safe.target.map&&Math.hypot(point.x-safe.target.x,point.y-safe.target.y)<10);
      return !!selected;
    },{timeout:15_000}).toBe(true);
    const nativeValid=await live.admin(`output=can_move({map:${JSON.stringify(safe.origin.map)},x:${safe.origin.x},y:${safe.origin.y},going_x:${selected!.x},going_y:${selected!.y},base:get_player('E2EWarrior').base});`);
    expect(nativeValid,'Actual canvas-selected waypoint must pass native collision validation').toBe(true);
    await info.attach('native-cave-selected-waypoint',{body:JSON.stringify(selected),contentType:'application/json'});
    return selected!;
  };
  let target=await selectWaypoint();
  const waitForSelectedRoute = async (requireTravelling: boolean) => expect.poll(async () => {
    const view = await dungeon(), state = view.state;
    return (!requireTravelling || state.travel?.stage === 'travelling') && state.travel?.target?.id === target.id &&
      state.run === cave.run && ['E2EWarrior', 'E2EPriest'].every(name => {
        const observation = view.members.find((member: any) => member.name === name)?.observation;
        const command = state.commands[name];
        return command?.target?.id === target.id && command.run === cave.run &&
          observation?.cave?.run === cave.run && observation.cave.floor === cave.floor &&
          observation.travel?.id === command.id && observation.travel.prepared === true;
      });
  }, { timeout: 120_000, message: 'The selected native Cave route must prepare for both owned commands' }).toBe(true);
  await waitForSelectedRoute(true);
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
  const waitForStoppedTravel=()=>expect.poll(async()=>{
    const state=(await dungeon()).state;
    return !state.travel && state.progress?.enabled===false &&
      !Object.values(state.commands).some((c:any)=>c.action==='move');
  },{timeout:20_000,message:'Stop travel must acknowledge removal of owned moves and automatic progress'}).toBe(true);
  await controls.getByRole('button', { name: 'Stop travel', exact: true }).click();
  await waitForStoppedTravel();
  await info.attach('native-cave-stopped-en-route', {body:JSON.stringify(await dungeon()), contentType:'application/json'});
  target=await selectWaypoint();
  // Defensive combat and real reassembly must finish before charging the
  // native route planner's preparation budget on this resumed selection.
  await expect.poll(async()=>{
    const view=await dungeon(),state=view.state;
    return state.travel?.target?.id===target.id && state.run===cave.run &&
      ['E2EWarrior','E2EPriest'].every(name=>{
        const member=view.members.find((m:any)=>m.name===name),command=state.commands[name];
        return member?.fresh && member.observation?.ready &&
          member.observation.cave?.run===cave.run && member.observation.cave.floor===cave.floor &&
          command?.action==='move' && command.run===cave.run && command.target?.id===target.id;
      });
  },{timeout:300_000,message:'Resumed Cave selection must dispatch owned moves after native combat and assembly'}).toBe(true);
  // A prepared owned route can pause while the native Bat Roost fight resolves.
  await waitForSelectedRoute(false);
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
  }, { timeout: 300_000, message: 'Both characters must reach the selected room, not merely move' }).toBeLessThan(70);
  } finally { await info.attach('native-cave-route-client-state',{body:JSON.stringify(lastNative),contentType:'application/json'}); }
  await expect.poll(async()=>{
    const view=await dungeon(),native=await live.state();
    return view.state.run===cave.run && ['E2EWarrior','E2EPriest'].every(name=>{
      const member=view.members.find((m:any)=>m.name===name),receipt=member?.observation?.action;
      return member?.fresh && receipt?.status==='complete' && receipt.command?.action==='move' &&
        receipt.command.run===cave.run && receipt.command.target?.id===target.id &&
        receipt.id===view.state.commands[name]?.id &&
        Math.hypot(native.characters[name].x-target.x,native.characters[name].y-target.y)<5;
    });
  },{timeout:120_000,message:'Both resumed waypoint moves must finish at the validated endpoint before native farm assembly'}).toBe(true);
  await controls.getByRole('button', { name: 'Stop travel', exact: true }).click();
  await waitForStoppedTravel();
  await controls.getByRole('button',{name:farm.label,exact:true}).first().click();
  await expect.poll(async()=>{
    const s=await live.state();
    return Math.max(...['E2EWarrior','E2EPriest'].map(name=>Math.hypot(s.characters[name].x-farm.x,s.characters[name].y-farm.y)));
  },{timeout:600_000,message:'Both characters must reach the original native farm after manual waypoint travel'}).toBeLessThan(70);
  await controls.getByRole('button',{name:'Stop travel',exact:true}).click();
  await waitForStoppedTravel();
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
    }, {timeout:600_000,message:'Both characters must navigate to Lockbreaker'}).toBeLessThan(70);
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
  const stairReplies:{id:string;title:string;option:string}[]=[];
  const advanceStairs=async()=>{
    const v=await dungeon(),c=v.members[0].observation.cave;
    if(v.members.every((m:any)=>m.observation?.cave?.floor===1))return true;
    if(c?.choice&&!c.choice.resolved&&!stairReplies.some(r=>r.id===c.choice.id)){
      const reply=c.choice.options.find((o:any)=>!o.unavailable&&!o.cost&&!o.amber);
      try{
        await choice.getByRole('button',{name:reply.label,exact:true}).click();
      }catch(error){
        if((await dungeon()).members.every((m:any)=>m.observation?.cave?.floor===1))return true;
        throw error;
      }
      stairReplies.push({id:c.choice.id,title:c.choice.title,option:reply.label});
      answeredFarewell ||= c.choice.title==='Before You Leave';
    }
    return v.members.every((m:any)=>m.observation?.cave?.floor===1);
  };
  // A long native approach can consume this entire window before its vote.
  // Give the acknowledged continuation its own bounded planning/travel window.
  await expect.poll(async()=>{await advanceStairs();return answeredFarewell;},
    {timeout:600_000,message:'Manual stairs must reach and answer the native farewell'}).toBe(true);
  const farewell=stairReplies.find(r=>r.title==='Before You Leave')!;
  await expect.poll(async()=>(await dungeon()).members.every((m:any)=>
    m.fresh&&m.observation?.cave&&(!m.observation.cave.choice||
      m.observation.cave.choice.id!==farewell.id||m.observation.cave.choice.resolved)),
    {timeout:30_000,message:'Both native farewell votes must acknowledge before continuation'}).toBe(true);
  await info.attach('native-cave-farewell-acknowledgement',{body:JSON.stringify({farewell,dungeon:await dungeon()}),contentType:'application/json'});
  await expect.poll(advanceStairs,
    {timeout:300_000,message:'Manual stairs must continue after the farewell vote and transport both members'}).toBe(true);
  expect(answeredFarewell).toBe(true);
  await info.attach('native-cave-floor-transition',{body:JSON.stringify({stairReplies,dungeon:await dungeon(),state:await live.state()}),contentType:'application/json'});
  const newFloorChoice=(await dungeon()).members[0].observation.cave.choice;
  if(newFloorChoice&&!newFloorChoice.resolved){
    const reply=newFloorChoice.options.find((o:any)=>!o.unavailable&&!o.cost&&!o.amber);
    expect(reply,'New-floor native encounter must have an available free reply').toBeTruthy();
    await choice.getByRole('button',{name:reply.label,exact:true}).click();
    await expect.poll(async()=>{
      const current=(await dungeon()).members[0].observation.cave.choice;
      return !current||current.id!==newFloorChoice.id||current.resolved;
    },{timeout:30_000,message:'New-floor encounter must acknowledge the actual reply'}).toBe(true);
    await expect(choice).not.toBeVisible({timeout:30_000});
    if(await shopResult.isVisible())await page.keyboard.press('Escape');
    await expect(shopResult).not.toBeVisible();
    await info.attach('native-cave-new-floor-reply',{body:JSON.stringify({choice:newFloorChoice.id,title:newFloorChoice.title,option:reply.id,label:reply.label,dungeon:await dungeon()}),contentType:'application/json'});
  }
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




test('Cave assembly regroups displaced completed participants before departure', async ({live,page},info) => {
  test.setTimeout(300_000);
  await live.admin("Dev=true;Prod=false;G.events.dreams.disabled=false;G.events.dreams.encounters=G.events.dreams.encounters.filter(e=>['e11','e20','e31','e50'].includes(e.id));output=true");
  await live.post('/formation',{leader:'E2EWarrior'});
  await live.post('/formation',{character:'E2EPriest',follow:true});
  const view=async()=>await (await page.request.get(live.url+'/party-api/daily-dungeons')).json();
  const act=(body:Record<string,unknown>)=>live.post('/daily-dungeons',{operationId:crypto.randomUUID(),...body});
  const positions=()=>live.admin("output=Object.fromEntries(['E2EWarrior','E2EPriest'].map(name=>{const p=get_player(name);return [name,{map:p.map,x:p.x,y:p.y,moving:!!p.moving,cruise:p.cruise}]}))");
  const point=(name:string,distance:number)=>live.admin(`output=(()=>{
    const p=get_player(${JSON.stringify(name)}),run=generated_entry(p).record;
    const rooms=run.cave.rooms.filter(r=>r.map===p.map&&['farm','patrol','fight','boss','darkmage'].includes(r.kind)).map(r=>({id:r.id,kind:r.kind,x:r.x,y:r.y}));
    for(let i=0;i<16;i++){
      const a=i*Math.PI/8,x=p.x+${distance}*Math.cos(a),y=p.y+${distance}*Math.sin(a);
      if(!can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base}))continue;
      let clearance=Infinity;
      const samples=Math.ceil(${distance}/20);
      for(let j=0;j<=samples;j++)for(const r of rooms)clearance=Math.min(clearance,Math.hypot(p.x+(x-p.x)*j/samples-r.x,p.y+(y-p.y)*j/samples-r.y));
      if(clearance>=410)return {map:p.map,x,y,clearance,rooms};
    }
    throw Error('No collision-safe native displacement outside combat room aggro');
  })()`);
  const move=async(name:string,destination:{x:number;y:number})=>{
    await live.clients[name].frame.evaluate(({x,y})=>(window as any).move(x,y),destination);
    await expect.poll(async()=>{const p=(await positions())[name];return Math.hypot(p.x-destination.x,p.y-destination.y);},{timeout:20_000}).toBeLessThan(5);
  };
  await expect.poll(async()=>{const v=await view();return v.members.length===2&&v.members.every((m:any)=>m.fresh&&m.observation?.ready&&m.observation?.visit?.available&&m.observation.members.length===2);},{timeout:60_000}).toBe(true);
  await act({action:'enter'});
  await expect.poll(async()=>(await view()).state.phase,{timeout:60_000}).toBe('active');
  const cave=(await view()).members[0].observation.cave;
  if(cave.choice&&!cave.choice.resolved){
    const option=cave.choice.options.find((o:any)=>!o.unavailable&&!o.cost&&!o.amber);
    expect(option).toBeTruthy();
    await act({action:'vote',run:cave.run,choice:cave.choice.id,option:option.id});
    await expect.poll(async()=>(await view()).members[0].observation.cave.choice.resolved,{timeout:30_000}).toBe(true);
  }
  const staging=await live.admin(`output=(()=>{
    const people=['E2EWarrior','E2EPriest'].map(name=>get_player(name)),p=people[0],run=generated_entry(p).record;
    const rooms=run.cave.rooms.filter(r=>r.map===p.map&&['farm','patrol','fight','boss','darkmage'].includes(r.kind)).map(r=>({id:r.id,kind:r.kind,x:r.x,y:r.y}));
    const enemies=Array.from(run.cave.actors).filter(a=>!a.dead&&a.map===p.map&&['enemy','predator'].includes(a.zone_actor?.side)).map(a=>({id:a.id,x:a.x,y:a.y}));
    const pathClear=(from,to,obstacles,minimum)=>{
      const samples=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/20));
      for(let j=0;j<=samples;j++)for(const r of obstacles)if(Math.hypot(from.x+(to.x-from.x)*j/samples-r.x,from.y+(to.y-from.y)*j/samples-r.y)<minimum)return false;
      return true;
    };
    const displacement=(origin,distance)=>{
      for(let i=0;i<16;i++){
        const a=i*Math.PI/8,target={x:origin.x+distance*Math.cos(a),y:origin.y+distance*Math.sin(a)};
        if(can_move({map:p.map,x:origin.x,y:origin.y,going_x:target.x,going_y:target.y,base:p.base})&&pathClear(origin,target,rooms,420))return target;
      }
    };
    for(let radius=0;radius<=200;radius+=20)for(let i=0;i<32;i++){
      const a=i*Math.PI/16,target={map:p.map,x:p.x+radius*Math.cos(a),y:p.y+radius*Math.sin(a)};
      if(!people.every(actor=>actor.map===p.map&&can_move({map:p.map,x:actor.x,y:actor.y,going_x:target.x,going_y:target.y,base:actor.base})&&pathClear(actor,target,enemies,300)))continue;
      const offset=displacement(target,160),displaced=displacement(target,85);
      if(offset&&displaced)return {...target,offset,displaced,rooms,enemies,before:people.map(actor=>({name:actor.name,x:actor.x,y:actor.y}))};
    }
    throw Error('No nearby collision-safe native staging position');
  })()`);
  await info.attach('declared-native-cave-safe-staging',{body:JSON.stringify(staging),contentType:'application/json'});
  await Promise.all(['E2EWarrior','E2EPriest'].map(name=>move(name,staging)));
  await expect.poll(async()=>(await view()).members.every((m:any)=>m.fresh&&m.observation.ready),{timeout:30_000}).toBe(true);
  const before=await positions(),offset=await point('E2EPriest',160);
  // Real native walking and a temporary native cruise keep assembly open.
  // No command completion, heartbeat or game response is synthesized.
  await move('E2EPriest',offset);
  await live.clients.E2EPriest.run('cruise(1)');
  let initialId='',regroupId='';
  try {
    await expect.poll(async()=>(await view()).members.every((m:any)=>m.fresh&&m.observation.ready),{timeout:30_000}).toBe(true);
    await act({action:'waypoint',run:cave.run,map:before.E2EWarrior.map,x:offset.x,y:offset.y});
    await expect.poll(async()=>{
      const v=await view(),command=v.state.commands.E2EWarrior,report=v.members.find((m:any)=>m.name==='E2EWarrior').observation.action;
      initialId=command?.id;
      return v.state.travel?.stage==='assembling'&&command?.action==='gather'&&report?.id===initialId&&report.status==='complete';
    },{timeout:30_000,intervals:[100,250]}).toBe(true);
    const displaced=await point('E2EWarrior',85);
    await info.attach('declared-native-cave-assembly-displacement',{body:JSON.stringify({before,offset,displaced,temporaryPriestCruise:1,initialId}),contentType:'application/json'});
    // Recovery may turn the actor back before the manual walk reaches its end.
    await live.clients.E2EWarrior.frame.evaluate(({x,y})=>(window as any).move(x,y),displaced);
    await expect.poll(async()=>{
      const v=await view(),command=v.state.commands.E2EWarrior;
      regroupId=command?.id;
      return command?.action==='gather'&&regroupId!==initialId&&v.state.travel?.assemblyRepairs===1;
    },{timeout:30_000,intervals:[100,250]}).toBe(true);
    await expect.poll(async()=>{
      const v=await view(),report=v.members.find((m:any)=>m.name==='E2EWarrior').observation.action,p=(await positions()).E2EWarrior;
      return report?.id===regroupId&&report.status==='complete'&&Math.hypot(p.x-before.E2EWarrior.x,p.y-before.E2EWarrior.y)<50;
    },{timeout:30_000}).toBe(true);
  } finally {
    await live.clients.E2EPriest.run(`cruise(${Number(before.E2EPriest.cruise)||500})`);
  }
  await expect.poll(async()=>{const p=await positions();return ['E2EWarrior','E2EPriest'].every(name=>Math.hypot(p[name].x-offset.x,p[name].y-offset.y)<35);},{timeout:90_000}).toBe(true);
  await info.attach('native-cave-completed-assembly-regroup',{body:JSON.stringify({initialId,regroupId,positions:await positions(),dungeon:await view()}),contentType:'application/json'});
});
