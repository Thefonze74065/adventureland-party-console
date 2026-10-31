import {test,expect} from './live-fixtures';

const W='E2EWarrior',P='E2EPriest';

test('realm departure retires an old native convoy before destination arrival',async({live},info)=>{
  test.setTimeout(240_000);
  // Keep merchant stand/home work out of this party realm ownership journey.
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'merchant idle':false,'stand maintenance':false}});
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  const ready=async()=>{
    const state=await live.state();
    return state.steamSwitch?.phase==='complete'&&[W,P,'E2EMerchant'].every(name=>{
      const report=state.characters[name];
      return report?.runtime==='native'&&report.server==='USI'&&Date.now()-report.seenAt<3000;
    });
  };
  await expect.poll(ready,{timeout:30_000}).toBe(true);
  const destination=await live.admin(`output=(()=>{const members=['${W}','${P}'].map(name=>get_player(name)),p=members[0];for(let i=0;i<16;i++){const a=i*Math.PI/8,x=p.x+600*Math.cos(a),y=p.y+600*Math.sin(a);if(members.every(member=>can_move({map:member.map,x:member.x,y:member.y,going_x:x,going_y:y,base:member.base})))return {map:p.map,x,y};}throw Error('No native collision-free convoy destination')})()`);
  await info.attach('native-reachable-realm-convoy-destination',{body:JSON.stringify(destination),contentType:'application/json'});
  await live.post('/travel',destination);
  await expect.poll(async()=>(await live.state()).activeConvoy?.id,{timeout:30_000}).toBeTruthy();
  await expect.poll(ready,{timeout:15_000}).toBe(true);
  const before=await live.state(),old=before.activeConvoy;
  await live.post('/realm/switch',{realm:'SR_USII',setHome:false});
  await expect.poll(async()=>{
    const state=await live.state();
    if(state.steamSwitch?.phase==='awaiting-realm-choice')
      await live.post('/steam/realm-choice',{operationId:state.steamSwitch.id,choice:'stay'});
    return state.realmControl.operation.phase;
  },{timeout:120_000}).toBe('complete');
  await expect.poll(async()=>(await live.state()).activeConvoy?.id || null).not.toBe(old.id);
  await expect.poll(async()=>await live.adminRealm('USII',`output=!!get_player('${W}')&&!!get_player('${P}')`)).toBe(true);
  const after=await live.state();
  expect(after.combatLogs[W].some((entry:any)=>entry.details?.convoyId===old.id&&entry.message==='Convoy cancelled')).toBe(true);
  await info.attach('native-realm-convoy-retirement',{body:JSON.stringify({before,after}),contentType:'application/json'});
});

test('superseded native Town progress ends quietly and stale pending membership retires',async({live},info)=>{
  test.setTimeout(180_000);
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  const stagingStartedAt=Date.now(),origin={map:'main',x:0,y:350};
  const previousReceipt=await live.clients[P].run('globalThis.__partyLastCommand||0');
  expect(await live.clients[P].run("can_move({map:'main',x:0,y:350,going_x:0,going_y:350,base:character.base})"),'The declared native Town origin must be walkable').toBe(true);
  const admission=await live.post('/command',{character:P,type:'character-travel',location:origin,label:'Native Town supersession origin'});
  await expect.poll(async()=>{
    const native=await live.clients[P].snapshot(),state=await live.state(),report=state.characters[P];
    const receipt=await live.clients[P].run('globalThis.__partyLastCommand||0');
    const server=await live.admin(`output=(()=>{const p=get_player('${P}');return !!p&&p.map==='main'&&!p.moving&&Math.hypot(p.x,p.y-350)<25})()`);
    return server&&receipt>previousReceipt&&native.map==='main'&&Math.hypot(native.x,native.y-350)<25&&
      report?.seenAt>=stagingStartedAt&&report.map==='main'&&!report.moving&&Math.hypot(report.x,report.y-350)<25;
  },{timeout:30_000,message:'Native priest, authoritative server and fresh receipt must reach the real Town incident origin'}).toBe(true);
  const staging={origin,admission,previousReceipt,currentReceipt:await live.clients[P].run('globalThis.__partyLastCommand'),native:await live.clients[P].snapshot()};
  let held=false,heldAt=0,releasedAt=0,release!:()=>void,heldBody:{navigationRevision:number;cycleId:string}|undefined;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const responses:unknown[]=[];
  await live.clients[P].page.route('**/party-api/return-progress',async route=>{
    // All native clients share this page. Actor ownership comes from the POST.
    if(route.request().postDataJSON()?.character!==P){await route.continue();return;}
    if(!held){heldBody=route.request().postDataJSON();heldAt=Date.now();held=true;await gate;}
    try{
      const response=await route.fetch();
      responses.push({body:route.request().postDataJSON(),status:response.status(),response:await response.json()});
      await route.fulfill({response});
    }catch(error){responses.push({body:route.request().postDataJSON(),error:String(error)});throw error;}
  });
  try{
    await live.post('/town-party',{});
    await expect.poll(()=>held,{timeout:30_000}).toBe(true);
    const before=await live.state(),revision=heldBody!.navigationRevision;
    await expect.poll(()=>live.savedTownCycle()?.pending.includes(P)).toBe(true);
    const savedBefore=live.savedTownCycle();
    expect(savedBefore?.revisions?.[P]).toBe(revision);
    // Clear party focus under the same controller, advancing its actual
    // navigation revision without replacing the retained Town command.
    await live.post('/focus',{monsterFocus:[]});
    // The API has already persisted supersession. Release before waiting for
    // a heartbeat to update native CODE; its real request timeout is ten seconds.
    releasedAt=Date.now();
    release();
    await expect.poll(async()=>await live.clients[P].run('window.__partyNavigationIntent.revision')).toBeGreaterThan(revision);
    await expect.poll(()=>responses.some((entry:any)=>entry.status===409)).toBe(true);
    await expect.poll(()=>live.savedTownCycle()?.pending.includes(P) || false).toBe(false);
    await expect.poll(async()=>(await live.state()).characters[P].navigationState).not.toBe('town');
    // Local game_log output is DOM text, not a native server game_log packet.
    const nativeLog=await live.clients[P].frame.locator('body').innerText();
    expect(nativeLog).not.toContain('Party command failed: POST /return-progress');
    const restartedAt=Date.now();
    await live.restartCoordinator();
    await expect.poll(async()=>{
      const state=await live.state();
      return [W,P].every(name=>state.characters[name]?.runtime==='native'&&state.characters[name].seenAt>=restartedAt);
    },{timeout:30_000}).toBe(true);
    const after=await live.state();
    const savedAfter=live.savedTownCycle();
    expect(savedAfter?.pending.includes(P)||false).toBe(false);
    // A fresh admission must ignore the old local return-progress record.
    const freshTown=await live.post('/town-party',{});
    expect(freshTown.queued).toContain(P);
    await expect.poll(()=>responses.some((entry:any)=>entry.body.cycleId!==heldBody!.cycleId&&entry.status===200),{timeout:30_000}).toBe(true);
    await expect.poll(()=>live.savedTownCycle()?.pending.length || 0,{timeout:90_000}).toBe(0);
    await expect.poll(async()=>{
      const native=await live.clients[P].snapshot();
      return native.map==='main'&&Math.hypot(native.x,native.y)<=90;
    }).toBe(true);
    const resumed=await live.state();
    const events=await live.clients[P].events();
    const finalLog=await live.clients[P].frame.locator('body').innerText();
    expect(finalLog).not.toContain('Party command failed: POST /return-progress');
    await info.attach('native-town-supersession',{body:JSON.stringify({before,savedBefore,after,savedAfter,resumed,savedResumed:live.savedTownCycle(),responses,events,nativeLog,finalLog}),contentType:'application/json'});
  }finally{
    release();
    await live.clients[P].page.unrouteAll({behavior:'wait'});
    await info.attach('native-town-progress-transport',{body:JSON.stringify({staging,heldBody,heldAt,releasedAt,responses,savedTownCycle:live.savedTownCycle()}),contentType:'application/json'});
  }
});

test('restored native Town keeps subsequent party travel commands increasing',async({live},info)=>{
  test.setTimeout(240_000);
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  const receipts:any[]=[];
  const context=live.clients[W].page.context();
  let hold=true;
  const gate=async(route:import('@playwright/test').Route)=>{
    if(!hold)return route.fallback();
    receipts.push({at:Date.now(),body:route.request().postDataJSON()});
    await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Declared delayed Town completion acknowledgement'})});
  };
  await context.route('**/party-api/town-complete',gate);
  try{
    await live.post('/town-party',{});
    await expect.poll(()=>receipts.some(r=>r.body.character===W)&&receipts.some(r=>r.body.character===P),{timeout:60_000}).toBe(true);
    const before=Object.fromEntries(await Promise.all([W,P].map(async n=>[n,Math.max(await live.clients[n].run('globalThis.__partyLastCommand'),...receipts.filter(r=>r.body.character===n).map(r=>r.body.commandId))])));
    const restartingAt=Date.now();
    await live.restartCoordinator();
    await expect.poll(async()=>[W,P].every(n=>receipts.some(r=>r.at>=restartingAt&&r.body.character===n&&r.body.commandId>before[n])),{timeout:60_000}).toBe(true);
    const restored=Object.fromEntries(await Promise.all([W,P].map(async n=>[n,await live.clients[n].run('globalThis.__partyLastCommand')])));
    hold=false;
    await expect.poll(()=>live.savedTownCycle()?.pending.length||0,{timeout:60_000}).toBe(0);
    await live.post('/travel',{map:'main',x:0,y:350});
    let native:any;
    await expect.poll(async()=>{
      const [s,positions]=await Promise.all([live.state(),live.admin(`output=Object.fromEntries(['${W}','${P}'].map(n=>{const p=get_player(n);return [n,{map:p.map,x:p.x,y:p.y,moving:!!p.moving}]}))`)]);
      native=positions;
      return !s.activeConvoy&&[W,P].every(n=>s.characters[n]?.map==='main'&&Math.hypot(s.characters[n].x,s.characters[n].y-350)<35&&
        s.characters[n].lastCommandId>restored[n]&&Date.now()-s.characters[n].seenAt<3000&&
        native[n].map==='main'&&!native[n].moving&&Math.hypot(native[n].x,native[n].y-350)<35);
    },{timeout:90_000,message:'Both native fighters must apply newer commands and physically reach the farming waypoint after restored Town'}).toBe(true);
    for(const n of [W,P]){expect(native[n].map).toBe('main');expect(Math.hypot(native[n].x,native[n].y-350)).toBeLessThan(35);}
    await info.attach('native-restored-town-command-sequence',{body:JSON.stringify({before,restored,receipts,native,final:await live.state()}),contentType:'application/json'});
  }finally{hold=false;await context.unroute('**/party-api/town-complete',gate);}
});
