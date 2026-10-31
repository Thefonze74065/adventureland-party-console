import {observeNativeCaveCombat} from './native-cave-combat-observer';
import {nativePlannerCpuProfile} from './native-planner-cpu-profile';
import { test, expect } from './live-fixtures';
import { createRequire } from 'node:module';
import {createNativeProgressBudget} from './native-progress-budget.js';
import type {Route} from '@playwright/test';
const sharp: typeof import('../dashboard/node_modules/sharp') = createRequire(import.meta.url)('../dashboard/node_modules/sharp');
test.use({ initialPosition: { map: 'main', x: 816, y: 1180 } });

// Each journey owns a fresh native visit. UI detours must not consume the
// floor-completion scenario's finite game timer; all native rooms still fight.
for (const journey of ['interface', 'completion'] as const) test(journey === 'interface'
  ? 'Cave entry closes settings, shows native choices and keeps follower maps and travel working'
  : 'Cave completes native rooms and recovers displaced stairs after farewell',
async ({ live, page }, info) => {
  test.setTimeout(2_700_000);
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
  let visitRun: string | undefined, lastVisitRemaining: number | undefined;
  const dungeon = async () => {
    const view=await (await page.request.get(live.url + '/party-api/daily-dungeons',{maxRetries:1})).json();
    if(visitRun){
      const matching=view.members.filter((m:any)=>m.fresh&&m.observation?.cave?.run===visitRun);
      if(matching.length)lastVisitRemaining=Math.min(...matching.map((m:any)=>m.observation.cave.remainingMs));
      if(view.state.phase==='held'&&view.members.length===2&&view.members.every((m:any)=>m.fresh&&!m.observation?.cave))
        throw Error('Native Cave visit ended before journey completion; last observed remaining time: '+lastVisitRemaining+'ms');
    }
    return view;
  };
  await expect.poll(async () => {
    const view = await dungeon();
    return view.members.length === 2 && view.members.every((m: any) => m.fresh && m.observation?.ready && m.observation?.visit?.available &&
      m.observation.leader === 'E2EWarrior' && m.observation.members.length === 2 && m.observation.members.includes('E2EPriest'));
  }, { timeout: 90_000 }).toBe(true);
  await page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'E2EWarrior', exact: true }) }).getByRole('button', { name: /^Events/ }).click();
  await page.getByRole('button', { name: 'Cave of Many Dreams settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Cave of Many Dreams', exact: true });
  await expect(settings).toBeVisible();
  const entryResponses:any[]=[];
  let entryAccepted=false;
  // This journey asserts shop item inspection, so declare its native layout
  // input rather than depending on an optional merchant having space to spawn.
  // Randomized layouts and missing-shop behavior remain in the assembly cases.
  await live.admin(`globalThis.__entryRandomBytes=crypto.randomBytes;
    crypto.randomBytes=function(size,...args){
      if(size===16&&!args.length&&new Error().stack.includes('open_generated_zone')){
        crypto.randomBytes=globalThis.__entryRandomBytes;
        return Buffer.from('00000000000000000000000000000001','hex');
      }
      return globalThis.__entryRandomBytes.call(this,size,...args);
    };output=true;`);
  try{
    await expect.poll(async()=>{
      const view=await dungeon();
      if(entryAccepted)return view.state.phase==='active';
      expect(view.state.phase,'No unrelated dungeon operation may replace this native entry').toBe('idle');
      expect(view.state.run).toBeUndefined();
      const names=['E2EWarrior','E2EPriest'];
      if(view.members.length!==2||!names.every(name=>{
        const member=view.members.find((m:any)=>m.name===name),o=member?.observation;
        return member?.fresh&&o?.ready&&o.alive&&o.supported&&o.protocol===1&&o.visit?.available&&!o.cave&&
          o.leader==='E2EWarrior'&&o.members.length===2&&names.every(n=>o.members.includes(n));
      }))return false;
      const [response]=await Promise.all([page.waitForResponse(response=>response.request().method()==='POST'&&
        new URL(response.url()).pathname==='/party-api/daily-dungeons'&&response.request().postDataJSON()?.action==='enter',
        {timeout:20000}),settings.getByRole('button',{name:'Enter now',exact:true}).click()]);
      const body=await response.json();
      entryResponses.push({status:response.status(),body,operationId:response.request().postDataJSON()?.operationId});
      if(response.status()===409&&/^E2E(?:Warrior|Priest): fresh dungeon-compatible runtime required$/.test(body.error))return false;
      expect(response.status(),'Native entry may retry only its exact pre-mutation freshness rejection').toBe(200);
      expect(body.state.participants.slice().sort()).toEqual(names.slice().sort());
      entryAccepted=true;
      return body.state.phase==='active';
    },{timeout:90000,message:'A real UI entry must be accepted once and activate the native Cave'}).toBe(true);
  }finally{
    await live.admin('crypto.randomBytes=globalThis.__entryRandomBytes;delete globalThis.__entryRandomBytes;output=true');
    await info.attach('native-cave-entry-responses',{body:JSON.stringify(entryResponses),contentType:'application/json'});
  }
  const entryLayout=await live.admin(`output=(()=>{const run=generated_entry(get_player('E2EWarrior')).record,shop=run.cave.rooms.find(r=>r.id==='0:shop');
    return{run:run.key,seed:run.seed,shop:shop&&{id:shop.id,x:shop.x,y:shop.y,bounds:shop.bounds,npc:shop.npc?.id}};})()`);
  await info.attach('native-cave-entry-layout',{body:JSON.stringify(entryLayout),contentType:'application/json'});
  expect(entryLayout.seed).toBe('00000000000000000000000000000001');
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
  const cave = (await dungeon()).members[0].observation.cave;
  visitRun=cave.run;
  const fullMap = page.getByRole('dialog', {name:/Cave of Many Dreams — Floor/});
  const waitForStoppedTravel=()=>expect.poll(async()=>{
    const state=(await dungeon()).state;
    return !state.travel && state.progress?.enabled===false &&
      !Object.values(state.commands).some((c:any)=>c.action==='move');
  },{timeout:20_000,message:'Stop travel must acknowledge removal of owned moves and automatic progress'}).toBe(true);
  const roomChoices=new Map<string,{initial:string|undefined;resumed:Set<string>}>();
  const acceptRoom=async(point:{id:string;label:string;map:string},deferNativeChoice=false)=>{
    if(!roomChoices.has(point.id))roomChoices.set(point.id,{initial:(await dungeon()).members[0].observation.cave.choice?.id,resumed:new Set()});
    const expectedRun=point.map.slice(5,point.map.lastIndexOf('_')),expectedFloor=Number(point.map.split('_').at(-1));
    const requests:{request:import('@playwright/test').Request;response?:Promise<{status:number;body:any;request:any}>}[]=[],attempts:unknown[]=[];
    let consumed=0,acceptedState:any,deferred=false;
    const completedRequiredRoom=(view:any)=>deferNativeChoice&&view.state.phase==='active'&&view.state.run===expectedRun&&
      view.members.length===2&&view.members.every((m:any)=>m.fresh&&m.observation?.alive&&
        m.observation.cave?.run===expectedRun&&m.observation.cave.floor===expectedFloor&&!m.observation.cave.paused&&
        m.observation.cave.points.some((p:any)=>p.id===point.id&&p.map===point.map&&p.required&&p.done));
    const match=(request:import('@playwright/test').Request)=>request.method()==='POST'&&new URL(request.url()).pathname==='/party-api/daily-dungeons'&&
      request.postDataJSON()?.action==='move'&&request.postDataJSON()?.target===point.id;
    const requested=(request:import('@playwright/test').Request)=>{if(match(request))requests.push({request});};
    const responded=(reply:import('@playwright/test').Response)=>{
      const entry=requests.find(entry=>entry.request===reply.request());
      if(entry)entry.response=reply.json().then(body=>({status:reply.status(),body,request:reply.request().postDataJSON()}));
    };
    const identity=async()=>{
      const view=await dungeon();expect(view.state.phase).toBe('active');expect(view.state.run).toBe(expectedRun);
      expect(view.members.every((m:any)=>m.observation?.alive&&m.observation.cave?.run===expectedRun&&m.observation.cave.floor===expectedFloor)).toBe(true);
      if(completedRequiredRoom(view)){
        deferred=true;attempts.push({submitted:false,completedRoom:point.id,view});return null;
      }
      const paused=view.members.some((m:any)=>m.observation.cave.paused);
      if(paused&&deferNativeChoice&&requests.length===consumed){
        const nativeChoice=view.members.find((m:any)=>m.observation.cave.paused)?.observation.cave.choice;
        expect(view.members.every((m:any)=>m.fresh)&&nativeChoice&&!nativeChoice.resolved&&
          view.members.every((m:any)=>!m.observation.cave.paused||m.observation.cave.choice?.id===nativeChoice.id),
          'Only a fresh unresolved native choice may defer required-room selection').toBe(true);
        deferred=true;attempts.push({submitted:false,deferredChoice:nativeChoice.id});return null;
      }
      expect(paused,'Native room selection requires an unpaused run').toBe(false);
      return view;
    };
    page.on('request',requested);page.on('response',responded);
    try{
      await expect.poll(async()=>{
        if(requests.length===consumed){
          if(!await identity())return true;
          if(requests.length===consumed){
            const button=controls.getByRole('button',{name:point.label,exact:true}).first();
            if(!await button.isEnabled()){attempts.push({submitted:false,disabled:true});return false;}
            await button.click();
          }
        }
        let noEffect=false;
        await expect.poll(async()=>{
          if(requests[consumed]?.response)return true;
          if(requests.length>consumed)return false;
          const snapshot=await controls.evaluate((element,label)=>({
            enabled:Array.from(element.querySelectorAll('button')).find(button=>button.textContent?.trim()===label)?.disabled===false,
            error:Array.from(element.querySelectorAll('[role=alert]')).map(alert=>alert.textContent?.trim()).filter(Boolean),
          }),point.label);
          if(requests.length>consumed)return !!requests[consumed]?.response;
          if(snapshot.error.length)throw Error('Unaccepted room selection: '+snapshot.error.join('; '));
          noEffect=snapshot.enabled;return noEffect;
        },{timeout:10_000,message:'Room selection must receive its own response or remain an enabled no-effect control'}).toBe(true);
        if(noEffect&&requests.length===consumed){
          if(!await identity())return true;
          if(requests.length===consumed){attempts.push({submitted:false,noEffect:true});return false;}
        }
        await expect.poll(()=>!!requests[consumed]?.response,{timeout:10_000,message:'A pending room move must receive its own response before retry'}).toBe(true);
        const result=await requests[consumed++].response!;
        expect(result.request.run).toBe(expectedRun);expect(result.request.target).toBe(point.id);
        attempts.push({submitted:true,status:result.status,error:result.body.error});
        if(deferNativeChoice&&result.status===409&&result.body.error==='Destination unavailable'){
          // Combat may finish after selection but before the move reaches the
          // coordinator. Only both fresh native completion receipts retire it.
          let completed:any;
          await expect.poll(async()=>{
            completed=await dungeon();return completedRequiredRoom(completed);
          },{timeout:10_000,message:'Rejected required destination must have completed for both native participants'}).toBe(true);
          deferred=true;attempts.push({submitted:true,completedRoom:point.id,view:completed});return true;
        }
        if(result.status===409&&result.body.error==='Fresh matching dungeon run required'){if(!await identity())return true;return false;}
        expect(result.status,'Room selection must be accepted; unrelated errors are not retried').toBe(200);
        const accepted=result.body.state;expect(accepted.run).toBe(expectedRun);
        const targets=[accepted.travel?.target,...Object.values(accepted.commands).filter((c:any)=>c.action==='move'&&c.run===expectedRun).map((c:any)=>c.target)];
        expect(targets.some((target:any)=>target?.id===point.id&&target.map===point.map),'Accepted native room response must acknowledge the exact chosen target').toBe(true);
        acceptedState=accepted;
        return true;
      },{timeout:60_000,message:'Native room selection must receive an owned accepted action'}).toBe(true);
    }finally{
      page.off('request',requested);page.off('response',responded);
      await info.attach('native-cave-room-selection-acceptance',{body:JSON.stringify({point,attempts,consumed,requests:requests.map(entry=>({body:entry.request.postDataJSON(),responseObserved:!!entry.response}))}),contentType:'application/json'});
    }
    return deferred?undefined:acceptedState;
  };
  const answerNativeChoice=async(encounter:any,expectedFloor=cave.floor)=>{
    const deadline=Date.now()+30_000;
    const remaining=()=>{const ms=deadline-Date.now();if(ms<=0)throw Error('Native choice acknowledgement exceeded its 30-second deadline');return ms;};
    const reply=encounter.options.find((o:any)=>!o.unavailable&&!o.cost&&!o.amber);
    expect(reply,'Native interruption must offer a free UI reply').toBeTruthy();
    const resolved=(view:any)=>view.state.run===cave.run&&['E2EWarrior','E2EPriest'].every(name=>{
      const member=view.members.find((m:any)=>m.name===name),observed=member?.observation?.cave;
      return member?.fresh&&member.observation.alive&&observed?.run===cave.run&&observed.floor===expectedFloor&&
        observed.choice?.id===encounter.id&&observed.choice.resolved&&observed.choice.votes[name]===reply.id;
    });
    const ledger:any={choice:encounter.id,option:reply.id,run:cave.run,floor:expectedFloor,clicked:false};
    let observed:any;
    try{
      observed=await dungeon();
      if(!resolved(observed)){
        await expect.poll(async()=>{
          observed=await dungeon();
          if(resolved(observed))return true;
          return observed.state.run===cave.run&&['E2EWarrior','E2EPriest'].every(name=>{
            const member=observed.members.find((m:any)=>m.name===name),native=member?.observation,
              c=native?.cave,command=observed.state.commands[name],receipt=native?.action;
            if(!member?.fresh||!native?.alive||c?.run!==cave.run||c.floor!==expectedFloor||c.choice?.id!==encounter.id)return false;
            if(!command||['move','gather'].includes(command.action))return true;
            if(command.action==='vote'&&c.choice.id===command.choice&&c.choice.resolved)return true;
            return receipt?.id===command.id&&receipt.status==='complete';
          });
        },{timeout:remaining(),message:'The current native choice must wait for both preceding action receipts before its first vote'}).toBe(true);
        ledger.beforeClick={state:observed.state,members:observed.members.map((m:any)=>({name:m.name,fresh:m.fresh,receipt:m.observation?.action}))};
        if(!resolved(observed))try{
          await choice.getByRole('button',{name:reply.label,exact:true}).click({timeout:Math.min(20_000,remaining())});
          ledger.clicked=true;
        }catch(error){
          observed=await dungeon();
          // Native telemetry can lag the UI: a duplicate button disappears
          // after the same real vote has already resolved. No other error or
          // choice/option mismatch is eligible for this acknowledgement.
          if(!(error instanceof Error&&error.name==='TimeoutError')||!resolved(observed))throw error;
          ledger.resolvedDuringClick=true;
        }
      }else ledger.alreadyResolved=true;
      await expect.poll(async()=>{observed=await dungeon();return resolved(observed);},
        {timeout:remaining(),message:'The same native choice must acknowledge both actual votes for the chosen option'}).toBe(true);
    }finally{
      ledger.native=observed?.members.map((m:any)=>({name:m.name,choice:m.observation?.cave?.choice}));
      await info.attach('native-cave-choice-resolution',{body:JSON.stringify(ledger),contentType:'application/json'});
    }
  };
  let roomChoiceObserved:any;
  const continueRoomChoice=async(point:{id:string;label:string;map:string})=>{
    let view=await dungeon();roomChoiceObserved=view;
    const observation=view.members[0]?.observation,c=observation?.cave,encounter=c?.choice,tracked=roomChoices.get(point.id);
    if(!encounter||!tracked||encounter.id===tracked.initial||tracked.resumed.has(encounter.id))return;
    expect(view.state.run).toBe(cave.run);expect(c.run).toBe(cave.run);expect(c.floor).toBe(cave.floor);
    const ledger:any={point,choice:encounter.id,before:view.state};
    try{
      if(!encounter.resolved){
        await answerNativeChoice(encounter,c.floor);
        ledger.reply=encounter.options.find((o:any)=>!o.unavailable&&!o.cost&&!o.amber).id;
      }
      view=await dungeon();roomChoiceObserved=view;
      if(!view.members.every((m:any)=>m.fresh&&m.observation?.cave?.run===cave.run&&m.observation.cave.floor===cave.floor)||
          view.members[0].observation.cave.paused)return;
      const settledVotes=Object.entries(view.state.commands).every(([name,command]:[string,any])=>{
        const nativeChoice=view.members.find((m:any)=>m.name===name)?.observation?.cave?.choice;
        return command.action==='vote'&&command.run===cave.run&&command.choice===encounter.id&&
          nativeChoice?.id===encounter.id&&nativeChoice.resolved;
      });
      if(!settledVotes)return;
      expect(view.members[0].observation.cave.choice?.id).toBe(encounter.id);
      if(await shopResult.isVisible())await page.keyboard.press('Escape');
      const accepted=await acceptRoom(point);
      tracked.resumed.add(encounter.id);ledger.accepted=accepted;
      return accepted;
    }finally{
      await info.attach('native-cave-choice-continuation',{body:JSON.stringify(ledger),contentType:'application/json'});
    }
  };
  const sameTravelTarget=(a:any,b:any)=>!!a&&!!b&&['id','map','x','y','down','to','exit','room','kind','required'].every(key=>a[key]===b[key]);
  const repairedOwnedTravel=(view:any,prior:any)=>{
    const old=prior?.travel,t=view?.state?.travel;
    if(!old||!view?.state||view.state.phase!=='active'||view.state.run!==prior.run||!sameTravelTarget(t?.target,old.target))return;
    const delta=t.serial-old.serial,previous=old.repairs||0,count=t.repairs;
    if(!Number.isSafeInteger(t.serial)||!Number.isSafeInteger(count)||delta<=0||count>3||count-previous!==delta)return;
    const owned=['E2EWarrior','E2EPriest'].every(name=>{
      const member=view.members.find((m:any)=>m.name===name),command=view.state.commands[name],expected=`cave-travel:${prior.run}:${t.serial}:${name}`;
      return member?.fresh&&member.observation?.alive&&member.observation.cave?.run===prior.run&&
        member.observation.cave.floor===cave.floor&&command?.action==='move'&&command.run===prior.run&&
        command.id===expected&&sameTravelTarget(command.target,old.target)&&member.observation.travel?.id===expected;
    });
    if(owned)return view.state;
  };
  if (journey === 'interface') {
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
    try { await expect.poll(async () => {
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
        // The center anchors the feet, not the middle of the native sprite.
        // Sample its body above the anchor instead of clipping the head/torso
        // and spending half the region on the floor below its feet.
        if(Math.abs(x-size.width/2)<=12 && y>=size.height/2-24 && y<=size.height/2+2) {
          if(r>180 && g>180 && b>140)mapPixels.actor++;
          if(g>r*1.05 && b>r*1.15)mapPixels.armor++;
        }
      }
      return mapPixels.floor>200 && mapPixels.texture>200 && mapPixels.actor>=1 && mapPixels.armor>8;
    }, { timeout: 20_000, message: name + ' cave map must render textured native floor and its centered actor' }).toBe(true);
    } finally {
    await info.attach(name+'-cave-map-pixel-evidence',{body:JSON.stringify(mapPixels),contentType:'application/json'});
    if(mapScreenshot.length)await info.attach(name + '-cave-map', { body: mapScreenshot, contentType: 'image/png' });
    }
  }
  await expect.poll(async () => (await dungeon()).state.error || null, { timeout: 15_000 }).toBe(null);
  expect((await dungeon()).state.progress.enabled).toBe(false);
  expect(Object.values((await dungeon()).state.commands).some((c: any) => c.action === 'move')).toBe(false);
  const before = await live.state();
  await controls.getByRole('button', {name:'View full map', exact:true}).click();
  await expect(fullMap).toHaveAccessibleName(/Cave of Many Dreams — Floor \d+/);
  await expect(fullMap.locator('canvas')).toBeVisible();
  await expect(fullMap.getByText('E2EPriest', {exact:true})).toBeVisible();
  await info.attach('native-cave-full-map', {body:await fullMap.screenshot(),contentType:'image/png'});
  const acceptWaypoint=async(expectedMap:string)=>{
    const expectedFloor=Number(expectedMap.split('_').at(-1));
    const expectedRun=expectedMap.slice(5,expectedMap.lastIndexOf('_'));
    const set=fullMap.getByRole('button',{name:'Set waypoint',exact:true});
    const attempts:{submitted:boolean;status?:number;error?:string;heartbeatDisabled?:boolean;noEffect?:boolean}[]=[];
    const nomination=await fullMap.getByText(/^-?\d+, -?\d+$/).innerText();
    const heartbeatSnapshot=()=>fullMap.evaluate(element=>({
        disabled:Array.from(element.querySelectorAll('button')).find(button=>button.textContent?.trim()==='Set waypoint')?.disabled,
        waiting:Array.from(element.querySelectorAll('output')).some(status=>status.textContent==='Waiting for fresh participant reports.'),
        error:Array.from(element.querySelectorAll('[role=alert]')).some(alert=>!!alert.textContent?.trim()),
        nomination:Array.from(element.querySelectorAll('span')).find(span=>/^-?\d+, -?\d+$/.test(span.textContent?.trim()||''))?.textContent?.trim(),
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
    const requests:{request:import('@playwright/test').Request;response?:Promise<{status:number;body:any;request:any}>}[]=[];
    const requested=(request:import('@playwright/test').Request)=>{if(isWaypoint(request))requests.push({request});};
    const responded=(reply:import('@playwright/test').Response)=>{
      const entry=requests.find(entry=>entry.request===reply.request());
      if(entry)entry.response=reply.json().then(body=>({status:reply.status(),body,request:reply.request().postDataJSON()}));
    };
    page.on('request',requested);page.on('response',responded);
    let consumed=0;
    try{
      await expect.poll(async()=>{
        let submitted=requests.length>consumed;
        const response=()=>requests[consumed]?.response;
          const initial=await heartbeatSnapshot();
          submitted=requests.length>consumed;
          if(!submitted&&initial.disabled){
            expect(await staleHeartbeat(initial),'A disabled waypoint without a request must correspond to stale native reports').toBe(true);
            if(requests.length===consumed){attempts.push({submitted:false,heartbeatDisabled:true});return false;}
            submitted=true;
          }
          if(!submitted)await set.click();
          let suppressed:Awaited<ReturnType<typeof heartbeatSnapshot>>|undefined;
          await expect.poll(async()=>{
            submitted=requests.length>consumed;
            if(response())return true;
            if(submitted)return false;
            const snapshot=await heartbeatSnapshot();
            submitted=requests.length>consumed;
            if(submitted)return !!response();
            suppressed=snapshot;
            return snapshot.disabled&&snapshot.waiting || !snapshot.disabled&&!snapshot.error&&snapshot.nomination===nomination;
          },{timeout:10_000}).toBe(true);
          if(!submitted){
            expect(suppressed).toBeDefined();
            if(suppressed!.disabled){
              expect(await staleHeartbeat(suppressed!)).toBe(true);
            }else{
              expect(suppressed!.error).toBe(false);expect(suppressed!.nomination).toBe(nomination);
              const view=await dungeon();
              expect(view.state.phase).toBe('active');expect(view.state.run).toBe(expectedRun);
              expect(view.members.every((m:any)=>m.observation?.alive&&m.observation.cave?.run===expectedRun&&
                m.observation.cave.floor===expectedFloor&&!m.observation.cave.paused)).toBe(true);
            }
            submitted=requests.length>consumed;
            if(!submitted){attempts.push({submitted:false,heartbeatDisabled:!!suppressed!.disabled,noEffect:!suppressed!.disabled});return false;}
          }
          await expect.poll(()=>!!response(),{timeout:10_000,message:'A submitted waypoint must receive its own response before any retry'}).toBe(true);
          const result=await response()!;
          consumed++;
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
      },{timeout:60_000,message:'The actual UI waypoint request must receive fresh native acceptance'}).toBe(true);
    }finally{
      page.off('request',requested);page.off('response',responded);
      await info.attach('native-cave-waypoint-submission-ledger',{body:JSON.stringify({attempts,consumed,requests:requests.map(entry=>({body:entry.request.postDataJSON(),responseObserved:!!entry.response}))}),contentType:'application/json'});
    }
  };
  const activateWaypoint=async(expectedMap:string)=>{
    // A requested shop can resolve while outside its nearby radius, then reopen
    // its result when Stop/resume crosses the shop again. Dismiss that real
    // result before accessing the map; never dismiss an unresolved native vote.
    const parts=expectedMap.split("_");
    const expectedRun=parts[1],expectedFloor=Number(parts[2]);
    const attempts:unknown[]=[];
    const activationDeadline=Date.now()+60_000;
    let inputDispatched=false;
    const remaining=(cap:number)=>{
      const timeout=Math.min(cap,activationDeadline-Date.now());
      if(timeout<=0)throw Error('Waypoint activation exhausted its original 60-second window');
      return timeout;
    };
    const snapshot=()=>fullMap.evaluate(element=>({
      adding:element.textContent?.includes('Click the map to place your waypoint.'),
      disabled:Array.from(element.querySelectorAll('button')).find(button=>button.textContent?.trim()==='Add waypoint')?.disabled,
      waiting:Array.from(element.querySelectorAll('output')).some(status=>status.textContent==='Waiting for fresh participant reports.'),
      error:Array.from(element.querySelectorAll('[role=alert]')).some(alert=>!!alert.textContent?.trim()),
    }));
    try{
      await expect.poll(async()=>{
        const resolvedEncounter=page.getByRole('dialog').filter({has:page.getByText('Encounter result',{exact:true})});
        if(await resolvedEncounter.isVisible()){
          await resolvedEncounter.getByRole('button',{name:'Close',exact:true}).click({timeout:remaining(20_000)});
          await expect(resolvedEncounter).not.toBeVisible({timeout:remaining(15_000)});
          inputDispatched=false;
        }
        const before=await snapshot();
        if(before.adding)return true;
        if(!before.disabled&&!inputDispatched){
          expect(before.error,'Add activation may not retry an unrelated rendered error').toBe(false);
          try {
            const addWaypoint=fullMap.getByRole('button',{name:'Add waypoint',exact:true});
            // The native freshness gate can close between the snapshot and
            // input. Give readiness its own bounded wait, then dispatch input.
            await expect(addWaypoint).toBeEnabled({timeout:remaining(10_000)});
            expect((await snapshot()).error,'Freshness readiness must not hide a rendered error').toBe(false);
            await addWaypoint.click({timeout:remaining(30_000)});
            inputDispatched=true;
          } catch (error) {
            // A fresh native shop update may reopen its completed result
            // after Close. Only that observed modal obstruction is retryable.
            if(await resolvedEncounter.isVisible())return false;
            throw error;
          }
        }
        let observed=before;
        await expect.poll(async()=>{
          observed=await snapshot();
          return observed.adding || observed.disabled&&observed.waiting || !inputDispatched&&!observed.disabled&&!observed.error;
        },{timeout:remaining(10_000),message:'Add waypoint must activate placement or show its freshness hold'}).toBe(true);
        attempts.push(observed);
        if(observed.adding)return true;
        if(observed.disabled)expect(observed.waiting).toBe(true);
        else expect(observed.error).toBe(false);
        const view=await dungeon();
        expect(view.state.phase).toBe('active');expect(view.state.run).toBe(expectedRun);
        expect(view.members.every((m:any)=>m.observation?.alive&&m.observation.cave?.run===expectedRun&&
          m.observation.cave.floor===expectedFloor&&!m.observation.cave.paused)).toBe(true);
        return false;
      },{timeout:60_000,message:'Native map must visibly acknowledge waypoint placement mode'}).toBe(true);
    }finally{await info.attach('native-cave-add-waypoint-activation',{body:JSON.stringify(attempts),contentType:'application/json'});}
  };
  await activateWaypoint(before.characters.E2EWarrior.map);
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
  const clickCaveControl=async(name:string)=>{
    const deadline=Date.now()+20_000;
    const remaining=()=>{
      const timeout=deadline-Date.now();
      if(timeout<=0)throw Error(`${name} exhausted its original 20-second click window`);
      return timeout;
    };
    const resolvedEncounter=page.getByRole('dialog').filter({has:page.getByText('Encounter result',{exact:true})});
    const dismissed:unknown[]=[];
    await page.addLocatorHandler(resolvedEncounter,async()=>{
      dismissed.push({control:name,at:Date.now(),text:await resolvedEncounter.innerText(),dungeon:await dungeon()});
      await resolvedEncounter.getByRole('button',{name:'Close',exact:true}).click({timeout:remaining()});
    });
    try {
      await controls.getByRole('button',{name,exact:true}).click({timeout:remaining()});
    } finally {
      await page.removeLocatorHandler(resolvedEncounter);
      await info.attach('native-cave-control-result-obstructions',{body:JSON.stringify({control:name,dismissed}),contentType:'application/json'});
    }
  };
  await clickCaveControl('Stop travel');
  await expect.poll(async()=>{
    const state=(await dungeon()).state;
    return !state.travel && state.progress?.enabled===false &&
      !Object.values(state.commands).some((c:any)=>['move','gather'].includes(c.action));
  },{timeout:20_000,message:'Initial waypoint ownership must be released before native fixture staging'}).toBe(true);
  await info.attach('native-cave-map-waypoint',{body:JSON.stringify(await dungeon()),contentType:'application/json'});
  // The wrong-floor check is meaningful only after the preceding stop has
  // fresh matching-run observations; stale status is a separate valid rejection.
  await expect.poll(async()=>{
    const view=await dungeon();
    return view.state.phase==='active'&&view.state.run===initialWaypoint!.run&&
      view.members.length===2&&view.members.every((m:any)=>m.fresh&&m.observation?.ready&&m.observation?.cave?.run===initialWaypoint!.run);
  },{timeout:30_000,message:'Fresh matching native dungeon observations precede wrong-floor validation'}).toBe(true);
  const wrongFloor=await page.request.post(live.url+'/party-api/daily-dungeons',{headers:{Origin:live.url},data:{action:'waypoint',operationId:crypto.randomUUID(),run:(await dungeon()).state.run,map:before.characters.E2EWarrior.map.replace(/_0$/,'_1'),x:432,y:384}});
  expect(wrongFloor.status()).toBe(409);
  expect((await wrongFloor.json()).error).toContain('different floor');
  const safe=await live.admin(`output=(async()=>{
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
    for(const distance of [320,260,200])for(let radius=0;radius<=1200;radius+=20){
    await new Promise(resolve=>setImmediate(resolve));
    for(let i=0;i<32;i++){
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
  const farm = cave.points.find((p:any)=>p.kind==='farm'&&!p.done);
  expect(farm).toBeTruthy();
  const selectWaypoint=async()=>{
    const previous=(await dungeon()).state;
    const previousIds=new Set([previous.travel?.target?.id,...Object.values(previous.commands).map((c:any)=>c.target?.id)]);
    await clickCaveControl('View full map');
    await activateWaypoint(safe.target.map);
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
  let farmTravel=await acceptRoom(farm);
  expect(farmTravel?.travel?.target.id).toBe(farm.id);
  const farmGenerations:any[]=[{cause:'accepted',serial:farmTravel.travel.serial,repairs:farmTravel.travel.repairs||0}];
  const farmArrivals=new Map<string,unknown>();
  const farmPacketCandidates=new Map<string,any>();
  let farmAcceptedAt=Date.now();
  const recordFarmArrival=(native:any,status:any,observedAt:number)=>{
    const expected='cave-travel:'+cave.run+':'+farmTravel.travel.serial+':'+native.name;
    const receipt=native.runtime?.action;
    for(const packet of native.arrivalPackets||[]){
      const o=packet.caveOwner,p=packet.data;
      if(packet.at<farmAcceptedAt||packet.at>native.at+500||o?.command?.id!==expected||
        o.command.action!=='move'||o.command.run!==cave.run||o.runtimeGeneration!==native.runtimeGeneration||
        !o.codeHash||o.codeHash!==native.codeHash||o.name!==native.name||
        o.run!==cave.run||o.floor!==cave.floor||o.map!==farm.map||String(o.in??o.map)!==farm.map||
        o.rip||!(o.hp>0)||p?.id!==native.name||p?.rip||!(p?.hp>0)||p.map!==farm.map||String(p.in??p.map)!==farm.map||
        Math.hypot(p.x-farm.x,p.y-farm.y)>=70)continue;
      farmPacketCandidates.set(native.name,{at:packet.at,id:expected,map:p.map,in:p.in,x:p.x,y:p.y,
        runtimeGeneration:o.runtimeGeneration,codeHash:o.codeHash,source:'authoritative player packet'});
    }
    const candidate=farmPacketCandidates.get(native.name);
    if(candidate&&receipt?.id===expected&&receipt.status==='complete'&&native.commandIdentity?.id===expected&&
      native.commandIdentity.action==='move'&&native.commandIdentity.run===cave.run&&
      Date.now()-native.at<=3000&&native.at<=Date.now()+500&&
      candidate.runtimeGeneration===native.runtimeGeneration&&candidate.codeHash===native.codeHash&&
      native.runtime?.travel?.id===expected&&native.cave?.run===cave.run&&native.cave.floor===cave.floor&&
      native.map===farm.map&&String(native.in??native.map)===farm.map&&!native.rip&&native.hp>0&&
      status&&observedAt-status.seenAt<=3000&&status.seenAt<=observedAt+500&&!status.rip&&status.hp>0&&
      status.dungeon?.cave?.run===cave.run&&status.dungeon.cave.floor===cave.floor){
      farmArrivals.set(native.name,candidate);return;
    }
    if(farmArrivals.has(native.name)||!status||observedAt-status.seenAt>3000||status.seenAt>observedAt+500||
      Date.now()-native.at>3000||native.at>Date.now()+500||status.rip||!(status.hp>0)||
      status.dungeon?.cave?.run!==cave.run||status.dungeon.cave.floor!==cave.floor||
      native.rip||!(native.hp>0)||native.cave?.run!==cave.run||native.cave.floor!==cave.floor||
      native.map!==farm.map||String(native.in??native.map)!==farm.map||
      native.runtime?.travel?.id!==expected||Math.hypot(native.x-farm.x,native.y-farm.y)>=70)return;
    farmArrivals.set(native.name,{at:native.at,id:expected,map:native.map,in:native.in,x:native.x,y:native.y});
  };
  const farmCombatSamples:unknown[]=[];
  let farmSampledAt=0;
  try {
  await expect.poll(async()=>{
    const s=await live.state();
    if(farmArrivals.size<2){
      const continued=await continueRoomChoice(farm);
      if(continued?.travel?.serial!==undefined&&continued.travel.serial!==farmTravel.travel.serial){
        farmTravel=continued;farmArrivals.clear();farmPacketCandidates.clear();farmAcceptedAt=Date.now();
        farmGenerations.push({at:Date.now(),cause:'accepted native choice continuation',serial:farmTravel.travel.serial,repairs:farmTravel.travel.repairs||0});
      }
      const repaired=repairedOwnedTravel(roomChoiceObserved,farmTravel);
      if(repaired){
        farmGenerations.push({at:Date.now(),cause:'automatic repair',previous:farmTravel.travel.serial,
          serial:repaired.travel.serial,previousRepairs:farmTravel.travel.repairs||0,repairs:repaired.travel.repairs,
          target:repaired.travel.target,commands:repaired.commands,
          members:roomChoiceObserved.members.map((m:any)=>({name:m.name,fresh:m.fresh,alive:m.observation?.alive,
            receipt:m.observation?.action,travel:m.observation?.travel}))});
        farmTravel=repaired;farmArrivals.clear();farmPacketCandidates.clear();
      }
    }
    if(Date.now()-farmSampledAt>=5_000&&farmCombatSamples.length<125){
      farmSampledAt=Date.now();
      const native=await Promise.all(['E2EWarrior','E2EPriest'].map(name=>live.clients[name].frame.evaluate(({goal,acceptedAt})=>{
        const p=window as any,w=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
        const c=w.character,control=w.__partyGroupedCombat,entity=control?.target?.id?w.get_entity(control.target.id):null;
        const clock=w.__partyTravelTransport?.clock,now=Date.now(),selected=w.sharedRoutine?.getDungeonTarget?.();
        const raw=entity?Object.fromEntries(['id','type','visible','dead','hp','map','in','x','y','real_x','real_y','range','target','cave'].map(key=>[key,entity[key]])):null;
        return {at:now,name:c.name,map:c.map,in:c.in,x:c.real_x,y:c.real_y,rip:c.rip,hp:c.hp,cave:c.cave,
          runtimeGeneration:w.__partyRuntimeGeneration,codeHash:w.__partyCodeHash,commandIdentity:w.__partyDungeonRuntime?.commandIdentity?.(),
          arrivalPackets:(p.__e2eEvents||[]).filter((e:any)=>e.event==='player'&&e.at>=acceptedAt&&
            e.caveOwner?.name===c.name&&Math.hypot(e.data?.x-goal.x,e.data?.y-goal.y)<70).slice(-20),
          clock,adjustedAge:control?now+(clock?.offset||0)-control.seenAt:null,
          control:control?Object.fromEntries(['key','seenAt','target','committed','selection','members','caveScope'].map(key=>[key,control[key]])):null,
          entity:raw,selected:selected?.id||null,knownDead:entity?!!w.partyRoleRunner?.isKnownDead(entity.id):null,
          nativeWalk:entity?w.can_move_to(entity.x,entity.y):null,
          attackAllowed:entity?!!w.sharedRoutine?.groupedAttackAllowed?.(entity):null,
          runtime:w.__partyDungeonRuntime?.report(),occupied:w.sharedRoutine?.isOccupied?.()};
      },{goal:{x:farm.x,y:farm.y},acceptedAt:farmAcceptedAt})));
      for(const member of native)recordFarmArrival(member,s.characters[member.name],farmSampledAt);
      farmCombatSamples.push({at:farmSampledAt,native,characters:Object.fromEntries(['E2EWarrior','E2EPriest'].map(name=>[name,{dungeon:s.characters[name].dungeon,movement:s.characters[name].movement}]))});
    }
    return ['E2EWarrior','E2EPriest'].every(name=>farmArrivals.has(name));
  },{timeout:600_000,message:'Both characters must reach the original native farm after manual waypoint travel'}).toBe(true);
  console.log('[Cave verified] Both characters arrived at the original native farm');
  }finally{
    await info.attach('native-cave-farm-combat-samples',{body:JSON.stringify(farmCombatSamples),contentType:'application/json'});
    await info.attach('native-cave-farm-arrivals',{body:JSON.stringify({arrivals:Object.fromEntries(farmArrivals),packetCandidates:Object.fromEntries(farmPacketCandidates),acceptedAt:farmAcceptedAt,generations:farmGenerations,travel:farmTravel}),contentType:'application/json'});
  }
  await controls.getByRole('button',{name:'Stop travel',exact:true}).click();
  await waitForStoppedTravel();
  await info.attach('native-cave-manual-travel', { body: JSON.stringify({ dungeon: await dungeon(), state: await live.state() }), contentType: 'application/json' });
  const second = (await dungeon()).members[0].observation.cave.points.find((p: any) => p.kind === 'boss' && !p.done);
  if (second) {
    const accepted=await acceptRoom(second);
    let serial=accepted.travel?.serial,repairCount=accepted.travel?.repairs||0,bossTracked=accepted;
    const bossGenerations:any[]=[{cause:'accepted',serial,repairCount}],bossReceipts:any[]=[];
    expect(Number.isSafeInteger(serial),'Accepted boss move must identify its owned travel generation').toBe(true);
    const sameBossTarget=(target:any)=>sameTravelTarget(target,second);
    const bossOwnedMembers=(view:any,current:number)=>['E2EWarrior','E2EPriest'].every(name=>{
      const member=view.members.find((m:any)=>m.name===name),command=view.state.commands[name],
        expected=`cave-travel:${cave.run}:${current}:${name}`;
      return member?.fresh&&member.observation?.alive&&member.observation.cave?.run===cave.run&&
        member.observation.cave.floor===cave.floor&&command?.action==='move'&&command.run===cave.run&&
        command.id===expected&&sameBossTarget(command.target)&&member.observation.travel?.id===expected;
    });
    const ownedBoss=(view:any)=>{
      const t=view.state.travel;
      for(const member of view.members){const receipt=member.observation?.action;
        if(receipt?.status==='failed'&&!bossReceipts.some(r=>r.name===member.name&&r.receipt.id===receipt.id))
          bossReceipts.push({at:Date.now(),name:member.name,receipt});}
      if(view.state.phase!=='active'||view.state.run!==cave.run||!sameBossTarget(t?.target))return false;
      if(t.serial!==serial){
        const successor=repairedOwnedTravel(view,bossTracked),count=t.repairs;
        if(!successor)return false;
        bossGenerations.push({at:Date.now(),cause:'automatic repair',previous:serial,serial:t.serial,
          previousRepairs:repairCount,repairs:count,commands:view.state.commands,
          members:view.members.map((m:any)=>({name:m.name,fresh:m.fresh,alive:m.observation?.alive,
            receipt:m.observation?.action,travel:m.observation?.travel}))});
        serial=t.serial;repairCount=count;bossTracked=view.state;
      }
      return bossOwnedMembers(view,serial);
    };
    const continueBoss=async()=>{const next=await continueRoomChoice(second);if(next){
      expect(Number.isSafeInteger(next.travel?.serial)).toBe(true);serial=next.travel.serial;repairCount=next.travel.repairs||0;bossTracked=next;
      bossGenerations.push({at:Date.now(),cause:'accepted native choice continuation',serial,repairCount});
    }};
    try {
      await expect.poll(async()=>{await continueBoss();return ownedBoss(await dungeon());},{timeout:300_000,message:'Accepted boss generation must dispatch owned moves after native assembly'}).toBe(true);
    } finally {
      const native=await Promise.allSettled(['E2EWarrior','E2EPriest'].map(name=>live.clients[name].run(`(()=>{
        const id=sharedRoutine.sharedTargetId(),target=id?get_entity(id):null,selected=sharedRoutine.getDungeonTarget();
        return {name:character.name,at:Date.now(),x:character.real_x,y:character.real_y,
          retained:id,selected:selected?.id||null,position:globalThis.partyCombatPosition,
          target:target?{id:target.id,mtype:target.mtype,hp:target.hp,dead:target.dead,visible:target.visible,
            map:target.map,in:target.in,x:target.real_x??target.x,y:target.real_y??target.y,
            targeting:target.target,side:target.cave?.side,direct:can_move_to(target.x,target.y)}:null};
      })()`)));
      await info.attach('native-cave-boss-assembly-targets',{body:JSON.stringify({view:await dungeon(),native,generations:bossGenerations,observedFailedReceipts:bossReceipts}),contentType:'application/json'});
    }
    await expect.poll(async()=>{
      await continueBoss();
      const view=await dungeon();
      return ownedBoss(view) && ['E2EWarrior','E2EPriest'].every(name=>{
        const member=view.members.find((m:any)=>m.name===name),travel=member.observation?.travel;
        return travel?.id===view.state.commands[name].id && travel.prepared===true;
      });
    },{timeout:270_000,message:'The accepted boss generation must prepare both owned routes before physical arrival'}).toBe(true);
    console.log('[Cave verified] Owned boss route prepared');
    await info.attach('native-cave-boss-owned-preparation',{body:JSON.stringify({accepted,prepared:await dungeon()}),contentType:'application/json'});
    const planningSamples: unknown[] = [];
    let sampledAt = 0;
    let planningGeometry: unknown;
    try {
    await expect.poll(async () => {
      await continueBoss();
      const view = await dungeon();
      if (Date.now() - sampledAt >= 5_000 && planningSamples.length < 125) {
        sampledAt = Date.now();
        const native = await Promise.all(['E2EWarrior','E2EPriest'].map(name => live.clients[name].frame.evaluate(({target,capture}) => {
          const p=window as any,w=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
          const c=w.character,s=w.smart || {},q=w.queue || [],index=w.start;
          const probe=(x:number,y:number)=>({x,y,walkable:w.can_move({map:c.map,x,y,going_x:x,going_y:y,base:c.base})});
          const preparing=!!s.searching && !s.found;
          return {at:Date.now(),name:c.name,map:c.map,in:c.in,x:c.real_x,y:c.real_y,
            paused:!!w.__partyMovementPaused || !w.__partyDungeonRuntime?.canMove(),
            movementPaused:!!w.__partyMovementPaused,dungeonCanMove:w.__partyDungeonRuntime?.canMove(),
            nativePlanning:w.__partyMovement?.nativePlanning?.(),planningSchedule:w.__partyMovement?.report?.()?.planningSchedule,schedulerGate:!!w.__partyMovement?.gate?.owner,
            nativeMoving:!!c.moving,transporting:!!p.transporting,cavePaused:!!c.cave?.paused,
            nativeGraphics:{noGraphics:!!p.no_graphics,noHtml:p.no_html},
            nativeBodies:{self:{id:c.id||c.name,awidth:c.awidth,aheight:c.aheight,base:c.base,dimensions:p.G.dimensions[c.type]},
              monsters:Object.keys(p.entities||{}).map(id=>p.entities[id]).filter(e=>e.type==='monster'&&!e.dead)
                .sort((a,b)=>Math.hypot(a.real_x-c.real_x,a.real_y-c.real_y)-Math.hypot(b.real_x-c.real_x,b.real_y-c.real_y)).slice(0,5)
                .map(e=>({id:e.id,mtype:e.mtype,awidth:e.awidth,aheight:e.aheight,base:e.base,dimensions:p.G.dimensions[e.mtype]}))},
            ready:w.__partyDungeonRuntime?.report().ready,
            smart:{searching:s.searching,found:s.found,moving:s.moving,x:s.x,y:s.y,map:s.map,start_x:s.start_x,start_y:s.start_y},
            bfs:{length:q.length,index,best:w.best,current:q[index],last:q[q.length-1]},
            target:preparing?[-15,0,15].flatMap(dx=>[-15,0,15].map(dy=>probe(target.x+dx,target.y+dy))):undefined,
            geometry:capture&&preparing?{map:c.map,base:c.base,geometry:p.G.geometry[c.map],mapData:p.G.maps[c.map]}:undefined};
        },{target:second,capture:planningGeometry===undefined})));
        planningGeometry ??= native.find(sample=>sample.geometry)?.geometry;
        planningSamples.push({at:sampledAt,state:view.state,members:view.members.map((member:any)=>({name:member.name,fresh:member.fresh,ready:member.observation?.ready,action:member.observation?.action})),native:native.map(({geometry,...sample})=>sample)});
      }
      const state = await live.state();
      return Math.max(...['E2EWarrior','E2EPriest'].map(name => Math.hypot(state.characters[name].x-second.x,state.characters[name].y-second.y)));
    }, {timeout:600_000,message:'Both characters must navigate to Lockbreaker'}).toBeLessThan(70);
    } finally {
      await info.attach('native-cave-boss-planning-samples',{body:JSON.stringify(planningSamples),contentType:'application/json'});
      await info.attach('native-cave-boss-planning-geometry',{body:JSON.stringify(planningGeometry ?? null),contentType:'application/json'});
    }
    console.log('[Cave verified] Both characters arrived at Lockbreaker');
    await info.attach('native-cave-lockbreaker-arrival',{body:JSON.stringify({dungeon:await dungeon(),state:await live.state()}),contentType:'application/json'});
    // Arrival is not native encounter completion. A new artificial vote must
    // not replace encounter ownership while its real boss is still fighting.
    let completedBoss:any;
    const bossCombatObservation=await observeNativeCaveCombat(live.clients,['E2EWarrior','E2EPriest'],second);
    try{
      await expect.poll(async()=>{
        completedBoss=await live.admin(`output=(()=>{
          const p=get_player('E2EWarrior'),run=generated_entry(p).record;
          const room=run.cave.rooms.find(r=>r.id===${JSON.stringify(second.room)});
          if(!room)throw Error('Native Lockbreaker room missing');
          const enemies=room.actors.filter(a=>['enemy','predator'].includes(a.zone_actor?.side));
          return {room:room.id,done:room.done,enemies:enemies.map(a=>({id:String(a.id),dead:!!a.dead,hp:a.hp}))};
        })()`);
        return completedBoss.done&&completedBoss.enemies.every((actor:any)=>actor.dead||actor.hp<=0);
      },{timeout:120_000,message:'The native Lockbreaker must actually finish before creating the next encounter'}).toBe(true);
    }finally{await info.attach('native-cave-lockbreaker-completion',{body:JSON.stringify(completedBoss??null),contentType:'application/json'});await info.attach('native-cave-lockbreaker-combat-observations',{body:JSON.stringify(await bossCombatObservation.finish()),contentType:'application/json'});}

  }
  // Native encounter factory, bounded initial difficulty. Neither attacks,
  // deaths, receipts nor room completion are fabricated by this fixture.
  const duelDeclaration = await live.admin(`output=(()=>{
    const p=get_player('E2EWarrior'),run=generated_entry(p).record;
    const source=G.events.dreams.encounters.find(e=>e.id==='e11');
    const origin=safe_xy_nearby(p.map,p.x,p.y+48);
    if(!origin)throw Error('No native safe placement for declared duel');
    const room={id:'e2e-duel',floor:0,map:p.map,x:origin.x,y:origin.y-48,kind:'encounter',required:true,revealed:true,started:false,done:false,actors:[],enemies:[],encounter:{...source,options:source.options.filter(o=>['left','right'].includes(o.id))}};
    run.cave.rooms.push(room);
    globalThis.__e2eCaveDuel=room;
    globalThis.__e2eCaveDuelRun=run.key;
    return {run:run.key,room:room.id,required:room.required,issued:run.cave.issued,liveActors:run.cave.actors.size,origin};
  })()`);
  const duelAdmission:any[]=[];let duel:any;
  try{
    await expect.poll(async()=>{
      duel=await live.admin(`output=(()=>{
        const p=get_player('E2EWarrior'),run=generated_entry(p).record,room=globalThis.__e2eCaveDuel;
        if(run.key!==globalThis.__e2eCaveDuelRun||p.map!==room.map)throw Error('Declared duel native run or floor changed before admission');
        if(!room.started&&run.cave.actors.size<=52)cave_activate(run,room);
        const admitted=room.actors.length===2&&!!room.npc&&!!room.rival;
        if(admitted&&!room.e2eDifficultyDeclared){
          for(const a of room.actors){a.hp=a.max_hp=100000;a.zone_stats.attack=1;calculate_monster_stats(a);a.u=true;}
          room.e2eDifficultyDeclared=true;cave_begin_vote(run,room);
        }
        return {at:Date.now(),room:room.id,required:room.required,issued:run.cave.issued,liveActors:run.cave.actors.size,
          admitted,started:room.started,actors:room.actors.map(a=>({id:a.id,name:a.name,hp:a.hp}))};
      })()`);
      if(duelAdmission.length<100)duelAdmission.push(duel);
      return duel.admitted;
    },{timeout:60_000,message:'Native factory must admit both declared duel NPCs before voting'}).toBe(true);
  }finally{await info.attach('native-cave-duel-admission',{body:JSON.stringify({declaration:duelDeclaration,observations:duelAdmission}),contentType:'application/json'});}
  await expect(choice).toBeVisible();
  const duelChoice=(await dungeon()).members[0].observation.cave.choice;
  await choice.getByRole('button',{name:duelChoice.options.find((o:any)=>o.id==='left').label,exact:true}).click();
  await expect(choice).not.toBeVisible();
  console.log('[Cave verified] Injected duelist UI reply acknowledged');
  let latestDuel:{done:boolean;allyAlive:boolean;enemyDead:boolean;allyHp:number;enemyHp:number;at:number}|undefined;
  try{
    await expect.poll(async()=>{
      latestDuel=await live.admin("output={done:__e2eCaveDuel.done,allyAlive:!__e2eCaveDuel.npc.dead,enemyDead:!!__e2eCaveDuel.rival.dead,allyHp:__e2eCaveDuel.npc.hp,enemyHp:__e2eCaveDuel.rival.hp,at:Date.now()};");
      return {done:latestDuel!.done,allyAlive:latestDuel!.allyAlive,enemyDead:latestDuel!.enemyDead};
    },{timeout:120_000,message:'The real native duel must finish with the selected ally alive and rival dead'}).toEqual({done:true,allyAlive:true,enemyDead:true});
  }finally{
    const native=await live.state();
    await info.attach('native-cave-duel-combat-result',{body:JSON.stringify({duel,latest:latestDuel,party:['E2EWarrior','E2EPriest'].map(name=>({name,target:native.characters[name].activeCombatTarget,approach:native.characters[name].groupedCombat?.approach}))}),contentType:'application/json'});
  }
  console.log('[Cave verified] Native duelist combat completed with ally alive and rival dead');
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
  console.log('[Cave verified] Native Rogue blades rendered');
  await info.attach('native-cave-rogue-blades',{body:JSON.stringify({seed:blades,frame:bladeFrame}),contentType:'application/json'});
  await info.attach('native-cave-rogue-map',{body:await fullMap.screenshot(),contentType:'image/png'});
  await page.keyboard.press('Escape');
  } else {
  // Capture the same polled observations: a final expired visit cannot show
  // whether native BFS, route publication, or a follower gate stalled first.
  const requiredPlanning:any[]=[];
  const cpuProfile=nativePlannerCpuProfile(live.clients.E2EWarrior.frame);
  const requiredBudget=createNativeProgressBudget(Date.now,300_000,600_000);
  const requiredStartedAt=Date.now(),nativeMilestones=new Set<string>();
  const nearestDestination=new Map<string,number>();
  requiredBudget.observe([]);
  let requiredCompleted=false;
  let requiredProbeStarted=0,requiredProbeId="",requiredProbes=0;
  try{
  await expect.poll(async()=>{
    const v=await dungeon();
    const probeCommand=v.state.commands.E2EWarrior,probeTravel=v.members.find((m:any)=>m.name==='E2EWarrior')?.observation?.travel;
    const pendingOwned=v.state.travel?.stage==='travelling'&&probeCommand?.action==='move'&&
      probeTravel?.id===probeCommand.id&&probeTravel.prepared===false;
    if(pendingOwned&&requiredProbeId!==probeCommand.id){requiredProbeId=probeCommand.id;requiredProbeStarted=Date.now();}
    if(pendingOwned&&requiredProbes<3&&Date.now()-requiredProbeStarted>=[5000,15000,30000][requiredProbes]){
      requiredProbes++;
      const sample=await live.clients.E2EWarrior.frame.evaluate(({id,run})=>{
        const p=window as any,w=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
        const m=w?.__partyMovement,c=w?.character,command=w?.__partyDungeonRuntime?.commandIdentity?.();
        return {at:Date.now(),name:c?.name,map:c?.map,in:c?.in,
          active:!!(m?.state?.moving&&m.state.searching&&!m.state.found&&m.gate.owner&&command?.id===id&&command.run===run&&c?.cave?.run===run&&!c.cave.paused&&!w.__partyMovementPaused),
          command,movement:m?.report?.(),runtimeGeneration:w?.__partyRuntimeGeneration,codeHash:w?.__partyCodeHash,
          nativeMoving:!!w?.character?.moving,transporting:!!p.transporting,
          nativePlanning:w?.__partyMovement?.nativePlanning?.(),schedule:w?.__partyMovement?.report?.()?.planningSchedule,
          setInterval:String(w?.setInterval),isHidden:p.is_hidden?.(),noGraphics:!!p.no_graphics,noHtml:p.no_html};
      },{id:v.state.commands.E2EWarrior?.id,run:v.state.run}).catch(error=>({error:String(error)}));
      cpuProfile.observe(sample);
    }
    await cpuProfile.settle();cpuProfile.poll();
    if(requiredPlanning.length<600)requiredPlanning.push({at:Date.now(),phase:v.state.phase,
      travel:v.state.travel&&{stage:v.state.travel.stage,target:v.state.travel.target?.id,serial:v.state.travel.serial},
      members:v.members.map((m:any)=>({name:m.name,fresh:m.fresh,at:m.observation?.at,
        ready:m.observation?.ready,alive:m.observation?.alive,
        cave:m.observation?.cave&&{run:m.observation.cave.run,floor:m.observation.cave.floor,
          expires:m.observation.cave.expires,remainingMs:m.observation.cave.remainingMs,paused:m.observation.cave.paused,
          choice:m.observation.cave.choice&&{id:m.observation.cave.choice.id,resolved:m.observation.cave.choice.resolved}},
        action:m.observation?.action&&{id:m.observation.action.id,status:m.observation.action.status,error:m.observation.action.error},
        travel:m.observation?.travel&&{id:m.observation.travel.id,prepared:m.observation.travel.prepared,
          distance:m.observation.travel.distance,routeLength:m.observation.travel.route?.plot?.length,
          geometry:m.observation.travel.route?.identity}}))});
    if(v.state.run!==cave.run || v.members.length!==2 ||
        !v.members.every((m:any)=>m.fresh && m.observation?.alive && m.observation?.cave?.run===cave.run &&
          m.observation.cave.floor===cave.floor && Array.isArray(m.observation.cave.points))){requiredBudget.check();return false;}
    const c=v.members[0].observation.cave;
    const markers=c.points.filter((p:any)=>p.required&&p.done&&v.members.every((m:any)=>
      m.observation.cave.points.some((other:any)=>other.id===p.id&&other.required&&other.done))).map((p:any)=>'room:'+p.id);
    if(c.choice?.resolved&&v.members.every((m:any)=>{
      const choice=m.observation.cave.choice;return choice?.id===c.choice.id&&choice.resolved&&choice.votes?.[m.name]!=null;
    }))markers.push('choice:'+c.choice.id);
    // Native receipts and positions, never route distance counters (which can
    // grow while looping). Each destination's closest 100-unit band counts once.
    const nativeEvents=await live.clients.E2EWarrior.events();
    for(const event of nativeEvents){
      if(event.at>=requiredStartedAt&&event.event==='death'&&event.data?.death===true&&
          !v.members.some((m:any)=>m.name===String(event.data.id)))nativeMilestones.add('death:'+event.data.id);
    }
    const target=v.state.travel?.target;
    if(target){
      const positions=await Promise.all(v.members.map((m:any)=>live.clients[m.name].snapshot()));
      for(const p of positions){
        if(p.map!==target.map||!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;
        const key=target.id+':'+p.name,band=Math.floor(Math.hypot(p.x-target.x,p.y-target.y)/100);
        const best=nearestDestination.get(key);
        if(best===undefined||band<best){
          nearestDestination.set(key,band);
          if(best!==undefined)nativeMilestones.add('approach:'+key+':'+band);
        }
      }
    }
    if(c.choice)nativeMilestones.add('encounter:'+c.choice.id);
    requiredBudget.observe([...markers,...nativeMilestones]);
    if(c.choice&&!c.choice.resolved){
      await answerNativeChoice(c.choice,c.floor);
      requiredBudget.observe([...markers,...nativeMilestones,'choice:'+c.choice.id]);
      return false;
    }
    const required=c.points.find((p:any)=>p.required&&!p.done&&p.map.endsWith('_0'));
    if(!required)return true;
    if(v.members.some((m:any)=>m.observation.cave.choice&&!m.observation.cave.choice.resolved))return false;
    const current=v.state.travel?.target?.id || (Object.values(v.state.commands).find((c:any)=>c.action==='move') as any)?.target?.id;
    if(current!==required.id)await acceptRoom(required,true);
    return false;
  // Long native routes may progress across the old total five-minute boundary.
  // Only distinct native milestones renew quiet time; the total is bounded.
  },{timeout:600_000,message:'Required rooms must finish through native combat and votes'}).toBe(true);
  requiredCompleted=true;
  }finally{
    await info.attach('native-cave-cpu-profile',{body:JSON.stringify(await cpuProfile.finish()),contentType:'application/json'});
    await info.attach('native-cave-required-planning',{body:JSON.stringify(requiredPlanning),contentType:'application/json'});
    await info.attach('native-cave-required-progress-budget',{body:JSON.stringify(requiredBudget.snapshot()),contentType:'application/json'});
    if(!requiredCompleted){
      const geometry=await Promise.allSettled(['E2EWarrior','E2EPriest'].map(name=>live.clients[name].run(`(()=>{
        const m=globalThis.__partyMovement,p=parent,c=character;
        return {name:c.name,map:c.map,in:c.in,base:c.base,position:{x:c.real_x,y:c.real_y},
          identity:m?.identity,planning:m?.nativePlanning?.(),movement:m?.last?.(),
          nativeGraphics:{noGraphics:!!p.no_graphics,noHtml:p.no_html},
          nativeBodies:{self:{id:c.id||c.name,awidth:c.awidth,aheight:c.aheight,base:c.base,dimensions:p.G.dimensions[c.type]},
            monsters:Object.keys(p.entities||{}).map(id=>p.entities[id]).filter(e=>e.type==='monster'&&!e.dead)
              .sort((a,b)=>Math.hypot(a.real_x-c.real_x,a.real_y-c.real_y)-Math.hypot(b.real_x-c.real_x,b.real_y-c.real_y)).slice(0,5)
              .map(e=>({id:e.id,mtype:e.mtype,map:e.map,in:e.in,x:e.real_x,y:e.real_y,hp:e.hp,dead:e.dead,target:e.target,range:e.range,cave:e.cave,
                distance:Math.hypot(e.real_x-c.real_x,e.real_y-c.real_y),clear:can_move_to(e.real_x,e.real_y),
                awidth:e.awidth,aheight:e.aheight,base:e.base,dimensions:p.G.dimensions[e.mtype]}))},
          command:globalThis.__partyDungeonRuntime?.commandIdentity?.(),entitiesObservedAt:globalThis.__partyEntitiesObservedAt,
          selected:sharedRoutine.getDungeonTarget()?.id,
          cave:c.cave?{run:c.cave.run,floor:c.cave.floor,paused:c.cave.paused,choice:c.cave.choice}:null,
          geometry:p.G.geometry[c.map],mapData:p.G.maps[c.map]};
      })()`)));
      await info.attach('native-cave-required-geometry',{body:JSON.stringify(geometry),contentType:'application/json'});
      const remaining=await live.admin(`output=(()=>{
        const p=get_player('E2EWarrior'),entry=p&&generated_entry(p),run=entry?.record;
        if(!run?.cave)return {at:Date.now(),available:false};
        return {at:Date.now(),run:run.key,players:['E2EWarrior','E2EPriest'].map(name=>{
          const actor=get_player(name);return actor&&{name,map:actor.map,in:actor.in,x:actor.x,y:actor.y,hp:actor.hp,rip:actor.rip};}),
          roomsAvailable:Array.isArray(run.cave.rooms),
          rooms:(Array.isArray(run.cave.rooms)?run.cave.rooms:[]).filter(room=>room.required&&!room.done).slice(0,5).map(room=>({
            id:room.id,map:room.map,x:room.x,y:room.y,started:room.started,done:room.done,kind:room.kind,
            actorsAvailable:Array.isArray(room.actors),actors:Array.isArray(room.actors)?room.actors.slice(0,12).map(a=>({id:a.id,mtype:a.mtype,map:a.map,in:a.in,x:a.x,y:a.y,hp:a.hp,dead:a.dead,target:a.target,zone_actor:a.zone_actor})):null}))};
      })()` ).catch(error=>({error:String(error)}));
      await info.attach('native-cave-required-remaining-actors',{body:JSON.stringify(remaining),contentType:'application/json'});
    }
  }
  console.log('[Cave verified] Required native rooms completed');
  const stairs=(await dungeon()).members[0].observation.cave.points.find((p:any)=>p.down);
  expect(stairs.locked).toBe(false);
  const farewellDeclaration=await live.admin(`output=(()=>{
    const p=get_player('E2EWarrior'),run=generated_entry(p).record,source=G.events.dreams.encounters.find(e=>e.id==='e50');
    const room={id:'e2e-farewell',floor:0,map:p.map,x:${stairs.x},y:${stairs.y},kind:'encounter',required:false,revealed:true,started:false,done:false,actors:[],enemies:[],encounter:source};
    run.cave.rooms.push(room);cave_activate(run,room);cave_publish(run,true);return {run:run.key,room:room.id,map:room.map,x:room.x,y:room.y};
  })()`);
  // Failure inventory: a native conversation pause can begin after stairs
  // readiness was observed. Reject exactly the priest's first real transport
  // through the server's own pause gate, then unfreeze immediately after its
  // native response. No receipt is synthesized and unrelated traffic stays live.
  await live.admin(`output=(()=>{
    const p=get_player('E2EPriest'),socket=p.socket;
    const fault=globalThis.__e2eStairPause={to:${JSON.stringify(stairs.to)},socket,emit:socket.emit,attempts:0};
    fault.gate=function(data){
      const instance=instances[p.in];
      if(fault.started||data.to!==fault.to||instance.frozen)return;
      fault.started={at:Date.now(),map:p.map,to:data.to};fault.attempts++;
      fault.instance=instance;freeze_instance(instance,Date.now());fault.owned=instance.frozen;
    };
    socket.prependListener('transport',fault.gate);
    socket.emit=function(event,data,...args){
      const result=fault.emit.call(this,event,data,...args);
      if(fault.started&&!fault.receipt&&event==='game_response'&&data?.place==='transport'&&data.reason==='cave_paused'){
        fault.receipt={at:Date.now(),...data};socket.off('transport',fault.gate);socket.emit=fault.emit;
        if(fault.owned&&fault.instance.frozen===fault.owned)resume_frozen_instance(fault.instance,Date.now());
        fault.resumed=!fault.instance.frozen;
      }
      return result;
    };
    return true;
  })()`);
  let answeredFarewell=false;
  let pausedTransport:any=null;
  const stairReplies:{id:string;title:string;option:string;room:string;run:string}[]=[];
  const stairNativeChoices:any[]=[];
  const stairSamples:any[]=[];
  let lastStairKey='';
  let blockedStairAt=0,blockedStairId='';
  let stairMoveFlags:{name:string;enabled:boolean;count:number}[]=[];
  const stairNativeReads:Promise<unknown>[]=[];
  const stairPlanningReads:Promise<unknown>[]=[];
  const stairPlanningStarted=Date.now();
  let stairDisplacement:any=null, displacingStairArrival=false;
  const stairContext=live.clients.E2EWarrior.page.context();
  const displaceCompletedStairs=async(route:Route)=>{
    const body=route.request().method()==='POST'?route.request().postDataJSON():null;
    if(body?.name!=='E2EWarrior')return route.fallback();
    const receipt=body.dungeon?.action;
    const completedStairs=!body.dungeon?.cave?.paused&&receipt?.status==='complete'&&receipt.command?.action==='move'&&
      receipt.command?.run===farewellDeclaration.run&&receipt.command?.target?.id===stairs.id;
    if(displacingStairArrival&&completedStairs&&receipt.id===stairDisplacement?.receipt.id)return route.abort('failed');
    // Register before selecting stairs and intercept the first matching movement
    // completion after native movement resumes, without waiting for the choice
    // publication to catch up. An
    // already-published completion could otherwise authorize transport while the
    // fixture itself moves the actor away. Unrelated reports continue normally.
    if(!completedStairs||stairDisplacement)return route.fallback();
    displacingStairArrival=true;
    stairDisplacement={at:Date.now(),receipt};
    // Lose this completion packet while a real native walk displaces its actor.
    // Never fabricate a receipt, position, readiness flag or transport outcome.
    await route.abort('failed');
    try{
      const before=await dungeon();
      stairDisplacement.coordinatorBefore=before;
      const actor=before.members.find((m:any)=>m.name==='E2EWarrior');
      expect(actor?.observation?.action?.id===receipt.id&&actor.observation.action.status==='complete',
        'Displacement must precede publication of the exact completed movement').toBe(false);
      const point=await live.admin(`output=(()=>{const p=get_player('E2EWarrior');
        const before={map:p.map,x:p.x,y:p.y};
        if(Math.hypot(p.x-${stairs.x},p.y-${stairs.y})>65)return {before,alreadyDisplaced:true};
        for(let i=0;i<32;i++){const a=i*Math.PI/16,x=p.x+110*Math.cos(a),y=p.y+110*Math.sin(a);
          if(Math.hypot(x-${stairs.x},y-${stairs.y})>65&&can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base}))return {before,x,y};}
        throw Error('No native displacement from completed stairs');})()`);
      stairDisplacement.point=point;
      if(!point.alreadyDisplaced)await live.clients.E2EWarrior.frame.evaluate(({x,y})=>(window as any).move(x,y),point);
      await expect.poll(async()=>live.admin(`output=(()=>{const p=get_player('E2EWarrior');return Math.hypot(p.x-${stairs.x},p.y-${stairs.y});})()`),{timeout:20_000}).toBeGreaterThan(60);
      stairDisplacement.completed=true;
    }catch(error){stairDisplacement.error=String(error);}
    finally{displacingStairArrival=false;}
  };
  await stairContext.route('**/party-api/status',displaceCompletedStairs);
  await acceptRoom(stairs);
  const captureStairPlanning=()=>{
    const thresholds=[15000,60000,120000];
    if(answeredFarewell||stairPlanningReads.length>=thresholds.length||Date.now()-stairPlanningStarted<thresholds[stairPlanningReads.length])return;
    stairPlanningReads.push(Promise.allSettled(['E2EWarrior','E2EPriest'].map(name=>live.clients[name].frame.evaluate(()=>{
      const p=window as any,w=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
      const c=w?.character,m=w?.__partyMovement;
      return {at:Date.now(),name:c?.name,map:c?.map,in:c?.in,x:c?.real_x,y:c?.real_y,hp:c?.hp,rip:c?.rip,
        cavePaused:c?.cave?.paused,moving:c?.moving,transporting:p.transporting,
        schedulerGate:!!m?.gate?.owner,nativePlanning:m?.nativePlanning?.(),movement:m?.report?.()};
    }))));
  };

  const captureBlockedStairs=(v:any)=>{
    const t=v.state.travel,id=t?`${v.state.run}:${t.serial}:${t.target.id}`:'';
    if(!id){blockedStairAt=0;blockedStairId='';return;}
    if(id!==blockedStairId){blockedStairId=id;blockedStairAt=Date.now();}
    if(stairNativeReads.length>=3||Date.now()-blockedStairAt<(stairNativeReads.length+1)*20000)return;
    stairNativeReads.push(Promise.allSettled([...['E2EWarrior','E2EPriest'].map(name=>live.clients[name].run(`(()=>{
      const c=character,p=parent.character,now=Date.now();
      const body=o=>o?{name:o.name,map:o.map,in:o.in,x:o.x,y:o.y,real_x:o.real_x,real_y:o.real_y,
        hp:o.hp,rip:o.rip,moving:o.moving,base:o.base,width:o.width,height:o.height,
        cave:o.cave?{run:o.cave.run,floor:o.cave.floor,paused:o.cave.paused}:null}:null;
      const near=o=>Math.hypot((o.real_x??o.x)-c.x,(o.real_y??o.y)-c.y)<=500;
      return {at:now,code:body(c),parent:body(p),connected:parent.socket?.connected,
        codeActive:parent.code_active,runtimeGeneration:globalThis.__partyRuntimeGeneration,
        statusAt:globalThis.__partyStatusSuccessAt,planningSchedule:globalThis.__partyMovement?.report?.()?.planningSchedule,
        entities:Object.values(parent.entities||{}).filter(near).slice(0,30).map(o=>({...body(o),
          id:o.id,mtype:o.mtype,type:o.type,target:o.target,dead:o.dead,visible:o.visible,side:o.cave?.side})),
        chests:Object.entries(parent.chests||{}).filter(([id,o])=>near(o)).slice(0,20).map(([id,o])=>({
          id,map:o.map,in:o.in,x:o.x,y:o.y,deleted:o.to_delete,owner:o.owner,opened:o.opened,skin:o.skin}))};
    })()`)),live.admin(`output=(()=>{const people=['E2EWarrior','E2EPriest'].map(name=>get_player(name));return {at:Date.now(),version:G.version,players:people.map(p=>{if(!p)return null;const g=G.geometry[p.map];return {name:p.name,map:p.map,in:p.in,x:p.x,y:p.y,hp:p.hp,rip:p.rip,moving:p.moving,base:p.base,selfClear:can_move({map:p.map,x:p.x,y:p.y,going_x:p.x,going_y:p.y,base:p.base}),geometry:g?{x_lines:(g.x_lines||[]).filter(line=>Math.abs(line[0]-p.x)<=32&&line[1]-32<=p.y&&line[2]+32>=p.y).slice(0,12),y_lines:(g.y_lines||[]).filter(line=>Math.abs(line[0]-p.y)<=32&&line[1]-32<=p.x&&line[2]+32>=p.x).slice(0,12)}:null};})};})()`)]));
  };
  const recordStairs=(v:any)=>{
    const at=Date.now(),state=v.state;
    const sample={at,phase:state.phase,run:state.run,error:state.error,travel:state.travel,
      members:v.members.map((m:any)=>({name:m.name,fresh:m.fresh,expected:state.commands[m.name],
        observationAt:m.observation?.at,alive:m.observation?.alive,ready:m.observation?.ready,
        travel:m.observation?.travel,receipt:m.observation?.action,
        cave:m.observation?.cave?{run:m.observation.cave.run,floor:m.observation.cave.floor,
          paused:m.observation.cave.paused,remainingMs:m.observation.cave.remainingMs,
          choice:m.observation.cave.choice?{id:m.observation.cave.choice.id,
            resolved:m.observation.cave.choice.resolved,votes:m.observation.cave.choice.votes}:null}:null}))};
    const key=JSON.stringify({...sample,at:undefined,members:sample.members.map((m:any)=>({...m,
      observationAt:undefined,cave:m.cave?{...m.cave,remainingMs:undefined}:null}))});
    const transition=key!==lastStairKey;lastStairKey=key;
    if(transition||stairSamples.length<5)stairSamples.push({...sample,transition});
    else if(stairSamples.at(-1)?.transition)stairSamples.push({...sample,transition:false});
    else stairSamples[stairSamples.length-1]={...sample,transition:false};
    if(stairSamples.length>100)stairSamples.splice(5,1);
  };
  const advanceStairs=async()=>{
    const v=await dungeon(),c=v.members[0].observation.cave;
    recordStairs(v);captureStairPlanning();
    if(v.members.every((m:any)=>m.observation?.cave?.floor===1))return true;
    if(c?.choice&&!c.choice.resolved&&!stairReplies.some(r=>r.id===c.choice.id)){
      const identity=await live.admin(`output=(()=>{const p=get_player('E2EWarrior'),run=generated_entry(p).record,vote=run.cave.vote;return {run:run.key,id:vote?.id,room:vote?.room?.id,map:vote?.room?.map,x:vote?.room?.x,y:vote?.room?.y,resolved:vote?.resolved,players:cave_players(run).map(p=>({name:p.name,map:p.map,x:p.x,y:p.y,hp:p.hp}))};})()`);
      stairNativeChoices.push({at:Date.now(),advertised:c.choice.id,...identity});if(stairNativeChoices.length>100)stairNativeChoices.splice(5,1);
      if(identity.run!==c.run||identity.id!==c.choice.id||identity.resolved)return false;
      const reply=c.choice.options.find((o:any)=>!o.unavailable&&!o.cost&&!o.amber);
      if(!stairMoveFlags.length&&identity.run===farewellDeclaration.run&&identity.room===farewellDeclaration.room){
        stairMoveFlags=await Promise.all(['E2EWarrior','E2EPriest'].map(name=>live.clients[name].frame.evaluate(name=>{
          const g=window as Window&{__e2eObserveMoves?:boolean;__e2eObservedMoveCount?:number};
          const previous={name,enabled:g.__e2eObserveMoves===true,count:g.__e2eObservedMoveCount||0};
          g.__e2eObservedMoveCount=0;g.__e2eObserveMoves=true;return previous;
        },name)));
      }
      try{
        await choice.getByRole('button',{name:reply.label,exact:true}).click();
      }catch(error){
        if((await dungeon()).members.every((m:any)=>m.observation?.cave?.floor===1))return true;
        throw error;
      }
      stairReplies.push({id:c.choice.id,title:c.choice.title,option:reply.label,room:identity.room,run:identity.run});
      answeredFarewell ||= identity.run===farewellDeclaration.run&&identity.room===farewellDeclaration.room;
    }
    return v.members.every((m:any)=>m.observation?.cave?.floor===1);
  };
  // A long native approach can consume this entire window before its vote.
  // Give the acknowledged continuation its own bounded planning/travel window.
  try{
  await expect.poll(async()=>{await advanceStairs();return answeredFarewell;},
    {timeout:600_000,message:'Manual stairs must reach and answer the native farewell'}).toBe(true);
  const farewell=stairReplies.find(r=>r.run===farewellDeclaration.run&&r.room===farewellDeclaration.room)!;
  await expect.poll(async()=>(await dungeon()).members.every((m:any)=>
    m.fresh&&m.observation?.cave&&(!m.observation.cave.choice||
      m.observation.cave.choice.id!==farewell.id||m.observation.cave.choice.resolved)),
    {timeout:30_000,message:'Both native farewell votes must acknowledge before continuation'}).toBe(true);
  const nativeFarewell=await live.admin(`output=(()=>{const p=get_player('E2EWarrior'),run=generated_entry(p).record,room=run.cave.rooms.find(r=>r.id===${JSON.stringify(farewellDeclaration.room)});return {run:run.key,room:room?.id,done:room?.done,vote:room?.vote?{id:room.vote.id,resolved:room.vote.resolved}:null,map:room?.map,x:room?.x,y:room?.y,players:cave_players(run).map(p=>({name:p.name,map:p.map,x:p.x,y:p.y,hp:p.hp}))};})()`);
  expect(nativeFarewell.run).toBe(farewellDeclaration.run);expect(nativeFarewell.room).toBe(farewellDeclaration.room);
  expect(nativeFarewell.done,'The exact declared native farewell room must complete').toBe(true);
  expect(nativeFarewell.vote?.id).toBe(farewell.id);expect(nativeFarewell.vote?.resolved).toBe(true);
  await info.attach('native-cave-farewell-acknowledgement',{body:JSON.stringify({farewellDeclaration,farewell,nativeFarewell,dungeon:await dungeon()}),contentType:'application/json'});
    await expect.poll(async()=>{const completed=await advanceStairs();const latest=stairSamples.at(-1);
      if(latest)captureBlockedStairs({state:{phase:latest.phase,run:latest.run,travel:latest.travel}});return completed;},
      {timeout:300_000,message:'Manual stairs must continue after the farewell vote and transport both members'}).toBe(true);
  }finally{
    await stairContext.unroute('**/party-api/status',displaceCompletedStairs);
    pausedTransport=await live.admin(`output=(()=>{
      const fault=globalThis.__e2eStairPause;
      fault.socket.off('transport',fault.gate);fault.socket.emit=fault.emit;
      if(fault.owned&&fault.instance?.frozen===fault.owned)resume_frozen_instance(fault.instance,Date.now());
      delete globalThis.__e2eStairPause;
      return {started:fault.started,receipt:fault.receipt,attempts:fault.attempts,ownedPause:!!fault.owned,resumed:fault.resumed===true};
    })()`);
    await info.attach('native-stairs-pause-rejection',{body:JSON.stringify(pausedTransport),contentType:'application/json'});

    try{
      await info.attach('native-cave-stairs-readiness',{body:JSON.stringify({farewellDeclaration,stairDisplacement,nativeChoices:stairNativeChoices,samples:stairSamples,planning:await Promise.allSettled(stairPlanningReads),native:await Promise.allSettled(stairNativeReads),
        unavailable:['Coordinator status position/seenAt and CODE loading/socket ownership are not exposed by this dungeon response.']}),contentType:'application/json'});
    }finally{
      await Promise.all(stairMoveFlags.map(previous=>live.clients[previous.name].frame.evaluate(previous=>{
        const g=window as Window&{__e2eObserveMoves?:boolean;__e2eObservedMoveCount?:number};
        g.__e2eObserveMoves=previous.enabled;g.__e2eObservedMoveCount=previous.count;
      },previous)));
    }
  }
  expect(answeredFarewell).toBe(true);
  expect(pausedTransport.attempts).toBe(1);
  expect(pausedTransport.ownedPause).toBe(true);
  expect(pausedTransport.resumed).toBe(true);
  expect(pausedTransport.receipt).toMatchObject({failed:true,reason:'cave_paused',place:'transport'});
  await expect.poll(async()=>Promise.all(['E2EWarrior','E2EPriest'].map(async name=>
    (await live.clients[name].events()).filter(entry=>entry.event==='new_map'&&entry.data?.name===stairs.to).length)),
    {timeout:10_000,message:'Each participant must publish exactly one native arrival on the next floor'}).toEqual([1,1]);
  expect(stairDisplacement?.completed,'Native completed stairs must exercise actual displacement').toBe(true);
  expect(stairSamples.some(s=>s.members.some((m:any)=>m.expected?.independent===true)),
    'Displaced completion must receive a fresh independent movement command before stairs').toBe(true);
  console.log('[Cave verified] Both characters reached the next native floor');
  await info.attach('native-cave-floor-transition',{body:JSON.stringify({stairReplies,dungeon:await dungeon(),state:await live.state()}),contentType:'application/json'});
  const newFloorChoice=(await dungeon()).members[0].observation.cave.choice;
  if(newFloorChoice&&!newFloorChoice.resolved){
    const reply=newFloorChoice.options.find((o:any)=>!o.unavailable&&!o.cost&&!o.amber);
    expect(reply,'New-floor native encounter must have an available free reply').toBeTruthy();
    await answerNativeChoice(newFloorChoice,1);
    await expect(choice).not.toBeVisible({timeout:30_000});
    if(await shopResult.isVisible())await page.keyboard.press('Escape');
    await expect(shopResult).not.toBeVisible();
    await info.attach('native-cave-new-floor-reply',{body:JSON.stringify({choice:newFloorChoice.id,title:newFloorChoice.title,option:reply.id,label:reply.label,dungeon:await dungeon()}),contentType:'application/json'});
  }
  }
  await controls.getByRole('button', { name: 'Exit dungeon', exact: true }).click();
  const exit = page.getByRole('dialog', { name: 'Exit the dungeon?' });
  await expect(exit).toBeVisible();
  await exit.getByRole('button', { name: 'Stay in dungeon' }).click();
  expect((await dungeon()).state.phase).toBe('active');
  await controls.getByRole('button', { name: 'Exit dungeon', exact: true }).click();
  visitRun=undefined;
  await page.getByRole('dialog', { name: 'Exit the dungeon?' }).getByRole('button', { name: 'Confirm exit' }).click();
  await expect.poll(async () => (await dungeon()).state.phase, { timeout: 60_000 }).toBe('held');
  await info.attach('native-cave-exit', { body: JSON.stringify(await dungeon()), contentType: 'application/json' });
});

test('Cave shared-route pacing keeps the party together and stops the selected route', async ({live,page},info)=>{
  test.setTimeout(540_000);
  await live.admin("Dev=true;Prod=false;G.events.dreams.disabled=false;G.events.dreams.encounters=G.events.dreams.encounters.filter(e=>['e11','e20','e31','e50'].includes(e.id));output=true");
  await live.post('/formation',{leader:'E2EWarrior'});
  await live.post('/formation',{character:'E2EPriest',follow:true});
  const view=async()=>await (await page.request.get(live.url+'/party-api/daily-dungeons',{maxRetries:1})).json();
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
    await expect.poll(async()=>{
      const current=await view();
      return current.state.run===c.run&&current.members.length===2&&current.members.every((m:any)=>{
        const observed=m.observation?.cave,choice=observed?.choice;
        return m.fresh&&m.observation?.alive&&observed?.run===c.run&&observed.floor===c.floor&&
          choice?.id===c.choice.id&&choice.resolved&&choice.votes?.[m.name]===option.id;
      });
    },{timeout:20_000,message:'Both native participant votes must settle before pacing travel'}).toBe(true);
    return true;
  }
  await reply(await view());
  const initial=await live.state(),cave=(await view()).members[0].observation.cave;
  const target=cave.points.filter((p:any)=>p.kind==='farm'&&!p.done).sort((a:any,b:any)=>Math.hypot(a.x-initial.characters.E2EWarrior.x,a.y-initial.characters.E2EWarrior.y)-Math.hypot(b.x-initial.characters.E2EWarrior.x,b.y-initial.characters.E2EWarrior.y))[0];
  await act({action:'move',run:cave.run,target:target.id});
  const preparation:any[]=[];let sampledAt=0;
  try{
    await expect.poll(async()=>{
      const v=await view();
      if(await reply(v)){await act({action:'move',run:cave.run,target:target.id});return false;}
      if(Date.now()-sampledAt>=5000){
        sampledAt=Date.now();
        const native=await live.clients.E2EWarrior.run('({at:Date.now(),searching:smart.searching,found:smart.found,index:typeof start==="number"?start:null,queued:typeof queue!=="undefined"?queue.length:null})');
        preparation.push({at:sampledAt,native,travel:v.members.map((m:any)=>({name:m.name,travel:m.observation?.travel,action:m.observation?.action}))});
      }
      return v.members.every((m:any)=>{
        const command=v.state.commands[m.name];
        return command?.action==='move'&&command.target?.id===target.id&&command.run===cave.run&&
          m.observation?.travel?.id===command.id&&m.observation.travel.prepared;
      });
    },{timeout:270_000,message:'The owned Cave routes must prepare within the progressive native planning allowance'}).toBe(true);
  }finally{await info.attach('native-cave-pacing-route-preparation',{body:JSON.stringify(preparation),contentType:'application/json'});}
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
  const dashboardReady=page.waitForResponse(response=>response.request().method()==='GET'&&
    new URL(response.url()).pathname==='/party-api/daily-dungeons'&&response.ok(),{timeout:60_000});
  await Promise.all([dashboardReady,page.goto(live.url)]);
  // Walking can reveal a fresh encounter even after travel is stopped. Its
  // native modal correctly hides background controls until the party answers.
  await reply(await view());
  await expect(page.getByRole('region',{name:'Cave of Many Dreams controls'})).toBeVisible();
  await info.attach('native-cave-stopped-pacing',{body:await page.getByRole('region',{name:'Cave of Many Dreams controls'}).screenshot(),contentType:'image/png'});
});




for (const layout of ['random', 'unavailable entry shop'] as const) {
test(`Cave assembly regroups displaced completed participants before departure (${layout})`, async ({live,page},info) => {
  test.setTimeout(300_000);
  await live.admin("Dev=true;Prod=false;G.events.dreams.disabled=false;G.events.dreams.encounters=G.events.dreams.encounters.filter(e=>['e11','e20','e31','e50'].includes(e.id));output=true");
  await live.post('/formation',{leader:'E2EWarrior'});
  await live.post('/formation',{character:'E2EPriest',follow:true});
  const view=async()=>await (await page.request.get(live.url+'/party-api/daily-dungeons',{maxRetries:1})).json();
  const act=(body:Record<string,unknown>)=>live.post('/daily-dungeons',{operationId:crypto.randomUUID(),...body});
  const positions=()=>live.admin("output=Object.fromEntries(['E2EWarrior','E2EPriest'].map(name=>{const p=get_player(name);return [name,{map:p.map,x:p.x,y:p.y,moving:!!p.moving,cruise:p.cruise}]}))");
  const point=(name:string,distance:number)=>live.admin(`output=(()=>{
    const p=get_player(${JSON.stringify(name)}),run=generated_entry(p).record;
    const rooms=run.cave.rooms.filter(r=>r.map===p.map&&['farm','patrol','fight','boss','darkmage'].includes(r.kind)).map(r=>({id:r.id,kind:r.kind,x:r.x,y:r.y}));
    const encounters=run.cave.rooms.filter(r=>r.map===p.map&&r.encounter&&!r.voted&&!r.done).map(r=>({id:r.id,x:r.x,y:r.y,npc:r.npc?{id:r.npc.id,x:r.npc.x,y:r.npc.y}:null}));
    for(let i=0;i<16;i++){
      const a=i*Math.PI/8,x=p.x+${distance}*Math.cos(a),y=p.y+${distance}*Math.sin(a);
      if(!can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base}))continue;
      let clearance=Infinity;
      const samples=Math.ceil(${distance}/20);
      for(let j=0;j<=samples;j++)for(const r of rooms)clearance=Math.min(clearance,Math.hypot(p.x+(x-p.x)*j/samples-r.x,p.y+(y-p.y)*j/samples-r.y));
      if(clearance>=410&&encounters.every(r=>{const steps=Math.max(1,Math.ceil(${distance}/20));for(let j=0;j<=steps;j++)if(Math.hypot(p.x+(x-p.x)*j/steps-r.x,p.y+(y-p.y)*j/steps-r.y)<300)return false;return true;}))return {map:p.map,x,y,clearance,rooms,encounters};
    }
    throw Error('No collision-safe native displacement outside combat room aggro');
  })()`);
  const move=async(name:string,destination:{x:number;y:number})=>{
    await live.clients[name].frame.evaluate(({x,y})=>(window as any).move(x,y),destination);
    await expect.poll(async()=>{const p=(await positions())[name];return Math.hypot(p.x-destination.x,p.y-destination.y);},{timeout:20_000}).toBeLessThan(5);
  };
  await expect.poll(async()=>{const v=await view();return v.members.length===2&&v.members.every((m:any)=>m.fresh&&m.observation?.ready&&m.observation?.visit?.available&&m.observation.members.length===2);},{timeout:60_000}).toBe(true);
  // Declare only the native layout's random input. Generation, NPC placement,
  // entry, votes and all later movement still run through the real server.
  if(layout==='unavailable entry shop')await live.admin(`
    globalThis.__assemblyRandomBytes=crypto.randomBytes;
    crypto.randomBytes=function(size,...args){
      if(size===16&&!args.length&&new Error().stack.includes('open_generated_zone')){
        crypto.randomBytes=globalThis.__assemblyRandomBytes;
        return Buffer.from('00000000000000000000000000000020','hex');
      }
      return globalThis.__assemblyRandomBytes.call(this,size,...args);
    };output=true;`);
  try {
    await act({action:'enter'});
    await expect.poll(async()=>(await view()).state.phase,{timeout:60_000}).toBe('active');
  } finally {
    if(layout==='unavailable entry shop')await live.admin('crypto.randomBytes=globalThis.__assemblyRandomBytes;delete globalThis.__assemblyRandomBytes;output=true');
  }
  const nativeShop=()=>live.admin(`output=(()=>{
    const p=get_player('E2EWarrior'),run=generated_entry(p).record,room=run.cave.rooms.find(r=>r.id===G.maps[p.map].generated.floor+':shop');
    const placements=[];
    if(room?.bounds){const b=room.bounds;
      for(const dy of [96,128,160])for(let dx=64;dx<=(b[2]-b[0])/2;dx+=32)for(const x of [b[0]+dx,b[2]-dx]){
        const y=b[1]+dy;
        if(is_xy_safe(room.map,x,y)&&closest_line(room.map,x,y)>=32&&!G.maps[room.map].spawns.some(s=>Math.hypot(x-s[0],y-s[1])<112))placements.push({x,y});
      }
    }
    return {run:run.key,seed:run.seed,map:p.map,paused:!!run.paused_at,placements,room:room?{id:room.id,map:room.map,x:room.x,y:room.y,bounds:room.bounds,started:!!room.started,encounter:room.encounter?.id,voted:!!room.voted,done:!!room.done,npc:room.npc?{id:room.npc.id,x:room.npc.x,y:room.npc.y}:null,vote:room.vote?{id:room.vote.id,resolved:room.vote.resolved}:null}:null};})()`);
  const cave=(await view()).members[0].observation.cave;
  const initialNativeShop=await nativeShop();
  if(cave.choice&&!cave.choice.resolved&&initialNativeShop.room?.vote?.id!==cave.choice.id){
    const option=cave.choice.options.find((o:any)=>!o.unavailable&&!o.cost&&!o.amber);
    expect(option).toBeTruthy();
    await act({action:'vote',run:cave.run,choice:cave.choice.id,option:option.id});
    await expect.poll(async()=>{
      const current=await view();
      return current.state.run===cave.run&&current.members.length===2&&current.members.every((m:any)=>{
        const observed=m.observation?.cave,choice=observed?.choice;
        return m.fresh&&m.observation?.alive&&observed?.run===cave.run&&observed.floor===cave.floor&&
          choice?.id===cave.choice.id&&choice.resolved&&choice.votes?.[m.name]===option.id;
      });
    },{timeout:30_000,message:'Both native participant votes must settle before assembly staging'}).toBe(true);
  }
  const shopSetupStarted=Date.now(),shopSetupEvidence:any[]=[];
  let shop=await nativeShop();
  try {
  if(layout==='unavailable entry shop'){
    expect(shop.seed).toBe('00000000000000000000000000000020');
    expect(shop.room?.encounter).toBe('e31');
    expect(shop.room?.npc).toBeNull();
    expect(shop.placements).toEqual([]);
  }
  if(shop.room?.encounter==='e31'&&!shop.room.done){
    await expect.poll(async()=>{
      shop=await nativeShop();shopSetupEvidence.push({stage:'availability',native:shop});
      return !!shop.room?.npc||(!shop.paused&&!shop.room?.vote&&!shop.room?.started&&shop.placements.length===0);
    },{timeout:10_000,message:'Entry shop must spawn or have no valid native placement'}).toBe(true);
  }
  if(shop.room?.encounter==='e31'&&!shop.room.done&&shop.room.npc){
    if(!shop.room.vote||shop.room.vote.resolved){
    const goals=await live.admin(`output=(()=>{const people=['E2EWarrior','E2EPriest'].map(name=>get_player(name)),run=generated_entry(people[0]).record,room=run.cave.rooms.find(r=>r.id===${JSON.stringify(shop.room.id)}),npc=room.npc;if(!npc)throw Error('Entry shop NPC unavailable');return people.map(p=>{const goals=[];for(const radius of [120,80,0])for(let i=0;i<16;i++){const x=npc.x+radius*Math.cos(i*Math.PI/8),y=npc.y+radius*Math.sin(i*Math.PI/8);if(Math.hypot(x-room.x,y-room.y)<260&&can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base}))goals.push({name:p.name,x,y});}goals.sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y));if(!goals.length)throw Error('No native-clear entry shop setup walk');return goals[0];});})()`);
    for(const goal of goals) {
      await live.clients[goal.name].frame.evaluate(({x,y})=>(window as any).move(x,y),goal);
    }
    }
    let entryChoice:any;
    await expect.poll(async()=>{
      const native=await nativeShop(),v=await view();
      shopSetupEvidence.push({stage:'walking',native});
      entryChoice=v.members[0]?.observation?.cave?.choice;
      return native.run===shop.run&&!!entryChoice&&!!native.room?.vote&&native.room.vote.id===entryChoice.id&&!entryChoice.resolved;},{timeout:Math.max(1,30_000-(Date.now()-shopSetupStarted)),message:'Real entry shop must present its own native choice'}).toBe(true);
    shopSetupEvidence.push({stage:'choice',choice:entryChoice});
    const nativeReplies=await live.admin(`output=G.events.dreams.encounters.find(encounter=>encounter.id==='e31').options.map(option=>({id:option.id,effect:option.effect}));`);
    shopSetupEvidence.push({stage:'native-reply-effects',replies:nativeReplies});
    const option=entryChoice.options.find((o:any)=>nativeReplies.some((reply:any)=>reply.id===o.id&&['leave','story','inspect'].includes(reply.effect))&&!o.unavailable&&!o.cost&&!o.amber);
    expect(option,'Only the free noncombat entry-shop reply may be used for setup').toBeTruthy();
    shopSetupEvidence.push({stage:'selected-reply',choice:entryChoice.id,option});
    await act({action:'vote',run:shop.run,choice:entryChoice.id,option:option.id});
    await expect.poll(async()=>{
      const native=await nativeShop(),v=await view();
      shopSetupEvidence.push({stage:'voted',native});
      return native.run===shop.run&&native.room?.id===shop.room.id&&native.room.voted&&native.room.vote?.id===entryChoice.id&&native.room.vote.resolved&&!native.paused&&v.members.length===2&&v.members.every((m:any)=>m.fresh&&m.observation.alive&&!m.observation.cave.paused&&m.observation.cave.choice?.id===entryChoice.id&&m.observation.cave.choice.resolved&&m.observation.cave.choice.votes?.[m.name]===option.id);},{timeout:Math.max(1,30_000-(Date.now()-shopSetupStarted)),message:'Both real entry shop votes and native pause must settle'}).toBe(true);
  }
  } finally {
    await info.attach('native-cave-entry-shop-setup',{body:JSON.stringify({shop,samples:shopSetupEvidence.slice(-40),elapsedMs:Date.now()-shopSetupStarted}),contentType:'application/json'});
  }
  const staging=await live.admin(`output=(async()=>{
    const people=['E2EWarrior','E2EPriest'].map(name=>get_player(name)),p=people[0],run=generated_entry(p).record;
    const cpuNow=()=>globalThis.__e2eChronalClock?.cpuNow?.()??performance.now();
    const started=cpuNow(),map=p.map,instance=p.in;
    let sliceStarted=started,yields=0,maxWorkSliceMs=0;
    const assertOwnership=()=>{if(people.some(actor=>get_player(actor.name)!==actor||actor.map!==map||actor.in!==instance||actor.rip))throw Error('Native staging participants changed during search');};
    const yieldToNative=async()=>{
      maxWorkSliceMs=Math.max(maxWorkSliceMs,cpuNow()-sliceStarted);
      await new Promise(resolve=>setImmediate(resolve));yields++;assertOwnership();enemies=currentEnemies();sliceStarted=cpuNow();
    };
    const timing=()=>({elapsedMs:cpuNow()-started,yields,maxWorkSliceMs:Math.max(maxWorkSliceMs,cpuNow()-sliceStarted)});
    const rooms=run.cave.rooms.filter(r=>r.map===p.map&&['farm','patrol','fight','boss','darkmage'].includes(r.kind)).map(r=>({id:r.id,kind:r.kind,x:r.x,y:r.y}));
    const encounters=run.cave.rooms.filter(r=>r.map===p.map&&r.encounter&&!r.voted&&!r.done).map(r=>({id:r.id,x:r.x,y:r.y,npc:r.npc?{id:r.npc.id,x:r.npc.x,y:r.npc.y}:null}));
    const currentEnemies=()=>Array.from(run.cave.actors).filter(a=>!a.dead&&a.map===p.map&&['enemy','predator'].includes(a.zone_actor?.side)).map(a=>({id:a.id,x:a.x,y:a.y}));
    let enemies=currentEnemies();
    const pathClear=(from,to,obstacles,minimum)=>{
      const samples=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/20));
      for(let j=0;j<=samples;j++)for(const r of obstacles)if(Math.hypot(from.x+(to.x-from.x)*j/samples-r.x,from.y+(to.y-from.y)*j/samples-r.y)<minimum)return false;
      return true;
    };
    const displacement=(origin,distance)=>{
      // Every candidate segment includes its origin. Reject unsafe origins
      // before doing the same native collision work for all sixteen angles.
      if(!pathClear(origin,origin,rooms,420)||!pathClear(origin,origin,encounters,300)||!pathClear(origin,origin,enemies,300))return;
      for(let i=0;i<16;i++){
        const a=i*Math.PI/8,target={x:origin.x+distance*Math.cos(a),y:origin.y+distance*Math.sin(a)};
        if(target.x<geometry.min_x||target.x>geometry.max_x||target.y<geometry.min_y||target.y>geometry.max_y)continue;
        if(people.every(actor=>can_move({map:p.map,x:origin.x,y:origin.y,going_x:target.x,going_y:target.y,base:actor.base}))&&
          pathClear(origin,target,rooms,420)&&pathClear(origin,target,encounters,300)&&pathClear(origin,target,enemies,300))return target;
      }
    };
    // This is the declared initial staging seed, before testing assembly.
    // Safe corridors can be around entry walls on a randomized native floor.
    const geometry=G.geometry[p.map];
    if(!geometry||![geometry.min_x,geometry.min_y,geometry.max_x,geometry.max_y].every(Number.isFinite))throw Error('Native floor bounds unavailable');
    const floor=require('./logic/dream_layout').generateDungeon(run.seed).floors[G.maps[p.map].generated.floor];
    const nativeFloor={geometry:{min_x:geometry.min_x,min_y:geometry.min_y,max_x:geometry.max_x,max_y:geometry.max_y,
      x_lines:geometry.x_lines,y_lines:geometry.y_lines},grid:floor.grid,bases:people.map(actor=>({name:actor.name,base:actor.base}))};
    const tile=floor.tileSize,grid=floor.grid,seen=new Set(),connected=[{x:p.x,y:p.y,cx:Math.floor(p.x/tile),cy:Math.floor(p.y/tile),parent:-1}];
    seen.add(connected[0].cx+':'+connected[0].cy);
    for(let index=0;index<connected.length;index++){
      if(cpuNow()-sliceStarted>=8)await yieldToNative();
      const node=connected[index];
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const cx=node.cx+dx,cy=node.cy+dy,key=cx+':'+cy;
        if(grid[cy]?.[cx]!==1||seen.has(key))continue;
        const next={x:(cx+.5)*tile,y:(cy+.5)*tile,cx,cy,parent:index};
        if(!people.every(actor=>can_move({map:p.map,x:node.x,y:node.y,going_x:next.x,going_y:next.y,base:actor.base})))continue;
        seen.add(key);connected.push(next);
      }
    }
    // Prefer a connected corridor away from entry activity; the native search
    // and delivery share one turn, with current actors refreshed after every yield.
    for(let index=connected.length-1;index>=0;index--){
      if(cpuNow()-sliceStarted>=8)await yieldToNative();
      const {x,y}=connected[index],target={map:p.map,x,y};
      if(!people.every(actor=>actor.map===p.map&&can_move({map:p.map,x,y,going_x:x,going_y:y,base:actor.base})))continue;
      const offset=displacement(target,160),displaced=displacement(target,85);
      if(offset&&displaced){
        const seed={map:p.map,x,y,offset,displaced};
        if(people.some(p=>!p||p.rip||p.map!==seed.map||p.in!==people[0].in))throw Error('Native staging participants unavailable');
        const obstacles=[...run.cave.rooms.filter(r=>r.map===seed.map&&['farm','patrol','fight','boss','darkmage'].includes(r.kind)).map(r=>({...r,clearance:420})),
          ...run.cave.rooms.filter(r=>r.map===seed.map&&r.encounter&&!r.voted&&!r.done).map(r=>({...r,clearance:300})),
          ...Array.from(run.cave.actors).filter(a=>!a.dead&&a.map===seed.map&&['enemy','predator'].includes(a.zone_actor?.side)).map(a=>({x:a.x,y:a.y,clearance:300}))];
        for(const target of [seed.offset,seed.displaced]){
          if(!people.every(p=>can_move({map:seed.map,x:seed.x,y:seed.y,going_x:target.x,going_y:target.y,base:p.base})))throw Error('Native staging collision changed');
          const samples=Math.max(1,Math.ceil(Math.hypot(target.x-seed.x,target.y-seed.y)/20));
          for(let j=0;j<=samples;j++)if(obstacles.some(r=>Math.hypot(seed.x+(target.x-seed.x)*j/samples-r.x,seed.y+(target.y-seed.y)*j/samples-r.y)<r.clearance))throw Error('Native staging clearance changed');
        }
        const beforePositions=people.map(actor=>({name:actor.name,x:actor.x,y:actor.y}));
        const delivery=people.map(p=>{const name=p.name;
        if(p.map!==seed.map)throw Error('Native staging floor changed');
        const context=()=>({map:p.map,in:p.in,generated:G.maps[p.map].generated,info:instances[p.in].info,duel:p.duel,team:p.team,action:p.c});
        const before=JSON.parse(JSON.stringify(context()));
        const instance=p.in;transport_player_to(p,instance,[seed.x,seed.y]);
        if(p.in!==instance||p.map!==seed.map)throw Error('Initial native staging changed instance or floor');
        const after=JSON.parse(JSON.stringify(context()));
        if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Initial native staging changed cave action context');
        return {name,map:p.map,x:p.x,y:p.y,before,after};});
        const path=[];for(let cursor=index;cursor>=0;cursor=connected[cursor].parent)path.push({x:connected[cursor].x,y:connected[cursor].y});
        return {found:true,...target,offset,displaced,delivery,rooms,encounters,enemies,nativeFloor,timing:timing(),connectivity:{seed:run.seed,floor:floor.level,tile,reachableCells:connected.length,path:path.reverse()},
          before:beforePositions};
      }
    }
    return {found:false,map:p.map,rooms,encounters,enemies,nativeFloor,timing:timing(),connectivity:{seed:run.seed,floor:floor.level,tile,reachableCells:connected.length},
      before:people.map(actor=>({name:actor.name,x:actor.x,y:actor.y}))};
  })()`);
  await info.attach('declared-native-cave-safe-staging',{body:JSON.stringify(staging),contentType:'application/json'});
  expect(staging.found,'The actual connected native floor must provide both required safe displacements').toBe(true);
  const stagingDelivery=staging.delivery;
  await info.attach('native-cave-staging-delivery-context',{body:JSON.stringify(stagingDelivery),contentType:'application/json'});
  await expect.poll(async()=>Promise.all(['E2EWarrior','E2EPriest'].map(name=>live.clients[name].run(
    `character.map===${JSON.stringify(staging.map)}&&Math.hypot(character.real_x-(${staging.x}),character.real_y-(${staging.y}))<5`))),
    {timeout:20_000,message:'Both actual native clients must observe the declared initial staging seed'}).toEqual([true,true]);
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
}
