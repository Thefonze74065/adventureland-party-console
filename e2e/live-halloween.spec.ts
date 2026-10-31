import {waitForGameplay} from './network-clock';
import {observeNativeNavigationHttp} from './native-navigation-http-observer';
import {installTerminalSettlementFault} from './native-terminal-settlement-fault';
import {observeNativeStatus} from './native-status-observer';
import { test, expect, type LiveGame } from './live-fixtures';
import { killNativeCharacter } from './hunt-interruption-helpers';
import { nativeEventSpawn } from './game/event-spawn';
import { supportedEvents } from '../dashboard/lib/event-policy';

const W = 'E2EWarrior', P = 'E2EPriest', fighters = [W, P];

const statusObservers=new Map<string,Awaited<ReturnType<typeof observeNativeStatus>>>();
test.beforeEach(async({live},info)=>{
  if(info.title.includes('recovers death and returns after deselection')||info.title.includes('returns after native death')){
    try{statusObservers.set(info.testId,await observeNativeStatus(live.clients,fighters));}
    catch(error){await info.attach('native-status-observer-install-error',{body:String(error),contentType:'text/plain'});throw error;}
  }
});
test.afterEach(async({},info)=>{
  const observer=statusObservers.get(info.testId);if(!observer)return;
  try{await info.attach('native-event-status-metadata',{body:JSON.stringify(await observer.finish()),contentType:'application/json'});}
  finally{statusObservers.delete(info.testId);}
});

test.beforeEach(async ({live},info) => {
  // Reset only declarations from previous Halloween cases, before this case
  // creates any encounter. Never manufacture a kill or absence during a fight.
  const cleanup=await live.admin(`output=(()=>{
    for(const [type,entry] of Object.entries(globalThis.__e2eHalloweenCatalogs||{})){
      if(G.monsters[type]!==entry.configured)throw Error('Declared native catalog changed before cleanup: '+type);
      G.monsters[type]=entry.original;
    }
    globalThis.__e2eHalloweenCatalogs={};
    const declared=globalThis.__e2eHalloweenDeclared||{},owned=new Set(Object.keys(declared));
    const monsters=Object.values(instances).flatMap(instance=>Object.values(instance.monsters||{}));
    // Native irregular reconstitution drops ad-hoc fields. Keep fixture identity
    // outside the native object; offspring belong only by actual master chains.
    let changed=true;while(changed){changed=false;for(const monster of monsters)
      if(monster.master!=null&&owned.has(String(monster.master))&&!owned.has(String(monster.id))){owned.add(String(monster.id));changed=true;}}
    const removed=[];
    for(const monster of monsters){const id=String(monster.id),definition=declared[id];
      if(monster.e2eHalloween||owned.has(id)&&(!definition||definition.type===monster.type)){
        removed.push({id,type:monster.type,master:monster.master});remove_monster(monster,{silent:true});}}
    globalThis.__e2eHalloweenDeclared={};
    if(globalThis.__e2eHalloweenSpawnOriginal)new_monster=globalThis.__e2eHalloweenSpawnOriginal;
    const nativeSpawn=new_monster;globalThis.__e2eHalloweenSpawnOriginal=nativeSpawn;
    new_monster=function(instance,mapDef,args){
      const declared=globalThis.__e2eHalloweenDeclared[String(args?.last_state?.id)];
      if(!declared?.definition||declared.type!==mapDef.type)return nativeSpawn(instance,mapDef,args);
      // Native irregular warp preserves hp/id, but reconstructs other stats
      // from G. Keep only this declared encounter's initial difficulty scoped.
      const original=G.monsters[mapDef.type];G.monsters[mapDef.type]=declared.definition;
      try{const monster=nativeSpawn(instance,mapDef,args);if(monster){
        monster.zone_stats={...declared.definition};monster.e2eHalloween=true;
      }return monster;}finally{G.monsters[mapDef.type]=original;}
    };
    for(const entry of Object.values(globalThis.__e2eHalloweenAnnouncements||{}))clearInterval(entry.timer);
    globalThis.__e2eHalloweenAnnouncements={};
    for(const type of ['mrgreen','mrpumpkin','slenderman'])delete E[type];
    broadcast_e();return {removed,scope:'between-case exact declared native IDs and actual descendants'};})()`);
  await info.attach('native-halloween-between-case-cleanup',{body:JSON.stringify(cleanup),contentType:'application/json'});
});

test.afterEach(async({live},info)=>{
  try{
  if(info.status!==info.expectedStatus){
    const geometry=await Promise.allSettled(fighters.map(name=>live.clients[name].run(`(()=>{
      const movement=globalThis.__partyMovement;return {name:character.name,version:G.version,
        identity:movement?.identity,base:character.base,map:character.map,in:character.in,
        position:{x:character.real_x,y:character.real_y},movement:movement?.last?.(),
        maps:['halloween','spookytown'].map(map=>({map,geometry:G.geometry[map],definition:G.maps[map]}))};
    })()`)));
    await info.attach('native-halloween-return-geometry',{body:JSON.stringify(geometry),contentType:'application/json'});
  }
  }finally{
  const restored=await live.admin(`output=(()=>{
    if(Object.hasOwn(globalThis,'__e2eSlenderWarpSeason')){events.halloween=globalThis.__e2eSlenderWarpSeason;delete globalThis.__e2eSlenderWarpSeason;}
    const restored=[];for(const [type,entry] of Object.entries(globalThis.__e2eHalloweenCatalogs||{})){
    if(G.monsters[type]!==entry.configured)throw Error('Declared native catalog changed during encounter: '+type);
    G.monsters[type]=entry.original;
    restored.push({type,declaredCharge:entry.configured.charge,originalCharge:entry.original.charge,restoredOriginal:G.monsters[type]===entry.original});
  }globalThis.__e2eHalloweenCatalogs={};
  if(globalThis.__e2eHalloweenSpawnOriginal){new_monster=globalThis.__e2eHalloweenSpawnOriginal;delete globalThis.__e2eHalloweenSpawnOriginal;}return restored;})()`);
  await info.attach('native-halloween-catalog-restoration',{body:JSON.stringify(restored),contentType:'application/json'});
  }
});

// Failure inventory, written before runtime implementation: unsupported native
// bosses, legacy surprise opt-in, staging treated as live combat, early session
// retirement, timer changes extending ownership forever, absent-spawn retries,
// stale Slender sightings, map-only native announcements, obsolete warp routes,
// reflected magic, death losing attendance, and return losing saved ownership.
// These fixtures declare initial encounters/announcements, never damage, deaths,
// successful moves, loot receipts or event completion.
async function prepare(live: LiveGame, event: string) {
  await live.post('/formation', { leader: W });
  await live.post('/formation', { character: P, follow: true });
  let checkpoint!: {map:string;x:number;y:number};
  await expect.poll(async () => {
    const native = await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});return {map:p.map,x:p.x,y:p.y}})()`);
    const state = await live.state();
    const leader=state.characters[W];
    const matched=!!leader&&Date.now()-leader.seenAt<3000&&leader.map===native.map&&
      Math.hypot(leader.x-native.x,leader.y-native.y)<1;
    if(matched)checkpoint=native;
    return matched;
  }, { timeout: 30_000, message:'Save only the fresh native leader checkpoint' }).toBe(true);
  const checkpointReceipt=await live.post('/checkpoint', {}),saved=checkpointReceipt.partyLocation;
  expect(saved?.map,'The actual checkpoint receipt must match the independently observed native map').toBe(checkpoint.map);
  expect(Number.isFinite(saved?.x)&&Number.isFinite(saved?.y),'The saved native checkpoint must have finite coordinates').toBe(true);
  expect(checkpointReceipt.ok,'The actual native checkpoint must be accepted').toBe(true);
  const after=await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});return {map:p.map,x:p.x,y:p.y}})()`);
  const savedCheckpoint={location:{map:saved.map,x:saved.x,y:saved.y},nativeBefore:checkpoint,nativeAfter:after,receipt:checkpointReceipt};
  await live.post('/formation', { character: W, eventSelections: [event] });
  return savedCheckpoint;
}

async function world(live: LiveGame, event: string) {
  return live.admin(`output=(()=>{const m=get_monster(${JSON.stringify(event)});return {
    event:E[${JSON.stringify(event)}]||null,boss:m?{id:m.id,map:m.map,x:m.x,y:m.y,hp:m.hp}:null,
    players:Object.fromEntries(${JSON.stringify(fighters)}.map(name=>{const p=get_player(name);return [name,p?{map:p.map,x:p.x,y:p.y,rip:!!p.rip}:null]}))}})()`);
}

async function announceSpawn(live: LiveGame, event: string, leadMs: number) {
  return live.admin(`output=(()=>{
    const type=${JSON.stringify(event)},spawn=new Date(Date.now()+${leadMs}),announcement={live:false,spawn};
    globalThis.__e2eHalloweenAnnouncements ||= {};
    clearInterval(globalThis.__e2eHalloweenAnnouncements[type]?.timer);
    // The pinned backend deletes non-live E entries in event_loop even before
    // their timer. Declare this schedule at the native server_info read boundary;
    // actual boss creation/damage/death/movement stay entirely native.
    if(!globalThis.__e2eHalloweenNativeBroadcast){
      globalThis.__e2eHalloweenNativeBroadcast=broadcast_e;
      broadcast_e=function(dontSend){
        if(dontSend)return;
        const snapshot={...E};
        for(const [name,entry] of Object.entries(globalThis.__e2eHalloweenAnnouncements)){
          if(get_monster(name))entry.liveSeen=true;
          if(!entry.liveSeen&&Date.now()<=entry.expiresAt)snapshot[name]=entry.announcement;
        }
        broadcast('server_info',snapshot);
      };
    }
    const entry={announcement,expiresAt:spawn.getTime()+125000,liveSeen:false,timer:null};
    globalThis.__e2eHalloweenAnnouncements[type]=entry;
    const publish=()=>{
      if(get_monster(type))entry.liveSeen=true;
      if(entry.liveSeen||Date.now()>entry.expiresAt){clearInterval(entry.timer);return;}
      broadcast_e();
    };
    entry.timer=setInterval(publish,500);publish();
    return {...announcement,fixture:'immutable native server_info schedule boundary',expiresAt:spawn.getTime()+125000};
  })()`);
}

async function spawn(live: LiveGame, event: string, map: string, x: number, y: number, nativeAdds = false) {
  return live.admin(`output=(()=>{
    const type=${JSON.stringify(event)}, original=G.monsters[type];
    if(Object.values(instances).some(instance=>Object.values(instance.monsters||{}).some(monster=>monster.type===type)))throw Error('Expected clean native encounter');
    const configured={...original,charge:0};let constructed=false;
    const eligible=${JSON.stringify(fighters)}.map(name=>get_player(name)).filter(p=>{
      const damage=p.damage_type||G.items[p.slots?.mainhand?.name]?.damage_type||G.classes[p.ctype]?.damage_type;
      return type!=='slenderman'||['physical','pure'].includes(damage);
    });
    const dps=eligible.reduce((n,p)=>n+p.attack*p.frequency,0);
    if(!dps)throw Error('No native fighter eligible for declared encounter');
    const nominalSeconds=${nativeAdds ? 30 : event === 'slenderman' ? 40 : ['mrgreen','mrpumpkin'].includes(event) ? 45 : 90};
    try {
      G.monsters[type]={...original,hp:Math.ceil(dps*nominalSeconds),attack:1,speed:0,charge:0,range:1,aggro:0,phresistance:0,spawns:${nativeAdds ? 'original.spawns' : '[]'}};
      const m=new_monster(${JSON.stringify(map)},{type,count:1,boundary:[${x},${y},${x},${y}]},{temp:1});
      m.e2eHalloween=true;
      m.zone_stats={...G.monsters[type]};
      (globalThis.__e2eHalloweenCatalogs||={})[type]={original,configured};constructed=true;
      (globalThis.__e2eHalloweenDeclared||={})[String(m.id)]={type,map:m.map,definition:{...G.monsters[type]}};
      E[type]={live:true,map:m.map,hp:m.hp,max_hp:m.max_hp,target:m.target};
      // Native Slender status deliberately omits coordinates.
      if(type!=='slenderman'){E[type].x=m.x;E[type].y=m.y;}
      broadcast_e();return {id:m.id,type,map:m.map,x:m.x,y:m.y,hp:m.hp,eligibleFighters:eligible.map(p=>p.name),difficultyDps:dps,
        difficulty:{nominalSeconds,observedNativeCadence:93/240,nominalCadence:1.2,scope:'initial encounter HP only'},initialDefinition:G.monsters[type],catalogLifetime:{type,declaredCharge:configured.charge,originalCharge:original.charge,onlyChangedProperty:'charge'},nativeStatus:E[type]};
    } finally {G.monsters[type]=constructed?configured:original;}
  })()`);
}

for (const encounter of [{id:'mrgreen',add:'greenjr',drop:'ashleaf',map:'spookytown',x:636,y:995},
  {id:'mrpumpkin',add:'jr',drop:'pstem',map:'halloween',x:-495,y:685}]) {
  test.describe(`${encounter.id} native adds`,()=>{
    test.use({initialPosition:{map:encounter.map,x:encounter.x+160,y:encounter.y}});
    test(`Halloween ${encounter.id} prioritizes native threshold adds, loots and resumes boss`,async({live},info)=>{
      test.setTimeout(600_000);
      // Failure inventory: bosses always outrank adds; followers split targets;
      // reflected Green Jr magic; selected add replaces boss reentry coordinates;
      // fabricated spawn/death/loot; add policy survives event deselection.
      const ledgers:any[]=[];
      const observedHits=new Map<string,any>();
      const attacks:any[]=[];
      const issuedPackets=new Map<string,{at:number;actor:string;id:string;sequence:number}>();
      let scenarioError:unknown;
      // Canonical observers retain actual outgoing native packets across frame
      // retirement; a second wrapper must not tie proof to a cached document.
      const attackStartedAt=Date.now();
      const before=await live.admin(`output=${JSON.stringify(fighters)}.map(name=>({name,items:get_player(name).items}))`);
      await live.admin(`output=(()=>{
        globalThis.__e2eThresholdAdds=[];
        const original=new_monster;globalThis.__e2eAddSpawner=original;
        new_monster=function(...args){const m=original.apply(this,args);
          if(m&&m.type===${JSON.stringify(encounter.add)}&&m.master){
            if(globalThis.__e2eHalloweenDeclared?.[String(m.master)])
              globalThis.__e2eHalloweenDeclared[String(m.id)]={type:m.type,map:m.map,master:String(m.master)};
            const boss=instances[m.in]?.monsters[m.master];globalThis.__e2eThresholdAdds.push({id:String(m.id),master:String(m.master),type:m.type,at:Date.now(),bossHp:boss?.hp,bossMaxHp:boss?.max_hp});
          }return m;};return true;})()`);
      try {
        await prepare(live,encounter.id);
        const seed=await spawn(live,encounter.id,encounter.map,encounter.x,encounter.y,true);
        await info.attach('native-threshold-spawn-definition',{body:JSON.stringify(seed),contentType:'application/json'});
        await expect.poll(async()=>{
          const sample=await live.admin(`output=(()=>{const boss=instances[${JSON.stringify(seed.map)}]?.monsters[${JSON.stringify(seed.id)}];return {adds:globalThis.__e2eThresholdAdds,boss:boss?{id:String(boss.id),hp:boss.hp,max_hp:boss.max_hp,map:boss.map,x:boss.x,y:boss.y}:null}})()`);
          ledgers.push({at:Date.now(),...sample});
          const selection=await live.state();
          ledgers[ledgers.length-1].selections=fighters.map(name=>({name,target:selection.characters[name]?.combatSelection?.target}));
          const actorEvents=await Promise.all(fighters.map(name=>live.clients[name].events()));
          const events=actorEvents[0];
          for(let index=0;index<fighters.length;index++)for(const event of actorEvents[index]){
            const id=String(event.data?.id);
            if(event.event!=='attack-issued'||event.data?.actor!==fighters[index]||event.at<attackStartedAt||!Number.isFinite(event.sequence)||
              id!==String(seed.id)&&!sample.adds.some((add:any)=>add.id===id))continue;
            const key=JSON.stringify([fighters[index],event.sequence,event.at,id]);
            if(!issuedPackets.has(key)&&issuedPackets.size>=2048)throw Error('Native threshold issued-packet evidence exceeded2048 records');
            issuedPackets.set(key,{at:event.at,actor:event.data.actor,id,sequence:event.sequence});
          }
          attacks.length=0;attacks.push(...issuedPackets.values());
          for(const event of events) {
            if(event.event==='hit'&&fighters.includes(event.data?.hid)&&event.data?.damage>0&&
              (String(event.data.id)===String(seed.id)||sample.adds.some((add:any)=>String(event.data.id)===add.id)))
              observedHits.set(String(event.data.pid||`${event.at}:${event.data.id}`),event);
          }
          return [0.75,0.5,0.25].every(threshold=>sample.adds.some((add:any)=>
            add.master===String(seed.id)&&add.bossHp/add.bossMaxHp<=threshold&&add.bossHp/add.bossMaxHp>threshold-0.2&&
            attacks.some(attack=>attack.id===add.id&&attacks.some(previous=>previous.actor===attack.actor&&
              previous.id===String(seed.id)&&previous.at<attack.at)&&
              [...observedHits.values()].some((event:any)=>String(event.data.id)===add.id&&event.data.hid===attack.actor&&event.at>=attack.at))));
        },{timeout:300_000,intervals:[250,500],message:'Native boss damage must spawn and the party must attack adds at each threshold'}).toBe(true);
        const firstAddHit=[...observedHits.values()].filter(event=>String(event.data.id)!==String(seed.id)).sort((a,b)=>a.at-b.at)[0];
        expect([...observedHits.values()].some(event=>String(event.data.id)===String(seed.id)&&event.at>firstAddHit.at),
          'Actual party boss damage must resume after a native add engagement').toBe(true);
        await expect.poll(async()=>!(await world(live,encounter.id)).boss,{timeout:180_000}).toBe(true);
        await expect.poll(async()=>{
          const items=await live.admin(`output=${JSON.stringify(fighters)}.flatMap(name=>get_player(name).items)`);
          return items.reduce((n:number,item:any)=>n+(item?.name===encounter.drop?(item.q||1):0),0)>
            before.flatMap((p:any)=>p.items).reduce((n:number,item:any)=>n+(item?.name===encounter.drop?(item.q||1):0),0);
        },{timeout:30_000,message:'Real native add loot must reach party inventory'}).toBe(true);
        await info.attach('native-threshold-add-combat-and-loot',{body:JSON.stringify({seed,before,ledgers,attacks,
          events:await live.clients[W].events(),after:await live.admin(`output=${JSON.stringify(fighters)}.map(name=>({name,items:get_player(name).items}))`),state:await live.state()}),contentType:'application/json'});
      } catch(error){scenarioError=error;throw error;}
      finally {
        const cleanupErrors:{step:string;error:string}[]=[];
        const cleanup=async(step:string,action:()=>Promise<unknown>)=>{
          try{await action();}catch(error){cleanupErrors.push({step,error:String(error)});}
        };
        await cleanup('capture final native threshold evidence',async()=>info.attach('native-threshold-observer-final',{body:JSON.stringify({ledgers,attacks,hits:[...observedHits.values()],
          native:await live.admin(`output={adds:globalThis.__e2eThresholdAdds,players:${JSON.stringify(fighters)}.map(name=>{const p=get_player(name);return p?{name,present:true,map:p.map,x:p.x,y:p.y,rip:p.rip}:{name,present:false}})}`),
          state:await live.state()}),contentType:'application/json'}));
        await cleanup('restore native add spawner',()=>live.admin(`if(globalThis.__e2eAddSpawner){new_monster=globalThis.__e2eAddSpawner;delete globalThis.__e2eAddSpawner;}output=true`));
        await cleanup('deselect native event',()=>live.post('/formation',{character:W,eventSelections:[]}));
        if(cleanupErrors.length){
          await info.attach('native-threshold-cleanup-errors',{body:JSON.stringify({scenarioError:String(scenarioError||''),cleanupErrors}),contentType:'application/json'});
          if(!scenarioError)throw Error('Native threshold cleanup failed: '+JSON.stringify(cleanupErrors));
        }
      }
    });
  });
}

test.describe('authorized pre-join native staging',()=>{
  test.use({initialEventSpawn:'mrpumpkin'});
  test('Halloween future staging survives delayed genuine permission responses before both clients join',async({live},info)=>{
    test.setTimeout(180_000);
    const encounter={id:'mrpumpkin',...await nativeEventSpawn(live.admin,'mrpumpkin')};
    const context=live.clients[W].page.context(),first:Record<string,number>={},ledger:any[]=[];
    let release!:()=>void,holding=true;const gate=new Promise<void>(resolve=>{release=resolve;});
    const pending=new Set<Promise<void>>();
    const handler=async(route:import('@playwright/test').Route)=>{
      let body:any;try{body=route.request().postDataJSON();}catch{await route.fallback();return;}
      if(!holding || !fighters.includes(body?.character) || body?.event!=='mrpumpkin'){await route.fallback();return;}
      const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:5000}),result=await response.json();
      if(!response.ok() || result.allowed!==true){await route.fulfill({response});return;}
      first[body.character]??=Date.now();
      if(ledger.length<64)ledger.push({at:Date.now(),action:'actual-authorization-response-held',character:body.character,status:response.status(),allowed:result.allowed});
      const task=(async()=>{await gate;try{await route.fulfill({response});if(ledger.length<64)ledger.push({at:Date.now(),action:'original-authorization-response-delivered',character:body.character});}
        catch(error){if(ledger.length<64)ledger.push({at:Date.now(),action:'original-request-already-timed-out',character:body.character,error:String(error)});}})();
      pending.add(task);try{await task;}finally{pending.delete(task);}
    };
    await context.route('**/party-api/hunt-event-permission',handler);
    let beforeRelease:any,arrival:any,firstPrematureReturn:any;
    try{
      const timer=await announceSpawn(live,'mrpumpkin',55000);
      await prepare(live,'mrpumpkin');
      await expect.poll(()=>fighters.every(name=>Number.isFinite(first[name])),{timeout:30_000,message:'Both actual native event permissions must be authorized before their genuine responses are delayed'}).toBe(true);
      await expect.poll(async()=>{
        const state=await live.state(),now=Date.now(),authorizedAt=Math.max(...fighters.map(name=>first[name]));
        if(state.eventReturn){firstPrematureReturn??={at:now,cycleId:state.eventReturn.cycleId,event:state.eventReturn.event,phase:state.eventReturn.phase};return false;}
        if(firstPrematureReturn)return false;
        const ready=fighters.every(name=>{const c=state.characters[name];return c && !c.joinedEvent && c.seenAt>=authorizedAt+10000 && now-c.seenAt<3000 &&
          c.eventFeedConnected!==false && !c.eventClockStale && c.serverStagingEvents?.some((event:any)=>event.name==='mrpumpkin'&&event.spawnId===Date.parse(timer.spawn));});
        if(now-authorizedAt>=11000&&ready){beforeRelease={at:now,authorizedAt,timer,characters:Object.fromEntries(fighters.map(name=>[name,{seenAt:state.characters[name].seenAt,joinedEvent:state.characters[name].joinedEvent,server:state.characters[name].server,serverStagingEvents:state.characters[name].serverStagingEvents}])),eventReturn:state.eventReturn};return true;}
        return false;
      },{intervals:[100,250],timeout:20_000,message:'Eleven seconds of actual fresh pre-join native staging must retain authorized attendance'}).toBe(true);
      holding=false;release();await Promise.all([...pending]);
      await expect.poll(async()=>{const native=await world(live,'mrpumpkin');if(native.boss)return false;
        const reached=fighters.every(name=>native.players[name]?.map===encounter.map&&Math.hypot(native.players[name].x-encounter.x,native.players[name].y-encounter.y)<80);
        if(reached)arrival={at:Date.now(),native};return reached;
      },{timeout:35_000,message:'Both actual native characters must walk to the fixed announced spawn after original permission delivery'}).toBe(true);
    }finally{
      holding=false;release();await Promise.allSettled([...pending]);await context.unroute('**/party-api/hunt-event-permission',handler);
      await info.attach('native-authorized-prejoin-staging',{body:JSON.stringify({first,beforeRelease,arrival,firstPrematureReturn,ledger}),contentType:'application/json'});
    }
  });
});

for (const original of [{ id: 'mrgreen',terminalFault:false }, { id: 'mrpumpkin',terminalFault:false },{id:'mrpumpkin',terminalFault:true}]) {
  test.describe(original.id, () => {
    test.use({ initialEventSpawn: original.id });
    test(`Halloween ${original.id} stages from native timer, fights, recovers death and returns after deselection${original.terminalFault?' with a lost final native completion response':''}`, async ({ live }, info) => {
      const encounter={id:original.id,...await nativeEventSpawn(live.admin,original.id)};
      test.setTimeout(600_000);
      const timer = await announceSpawn(live, encounter.id, 55000);
      await info.attach('declared-native-spawn-announcement', { body: JSON.stringify(timer), contentType: 'application/json' });
      const savedCheckpoint=await prepare(live, encounter.id);
      await info.attach('native-pre-event-checkpoint-receipt',{body:JSON.stringify(savedCheckpoint),contentType:'application/json'});
      await expect.poll(async () => {
        const state = await live.state();
        return fighters.every(name => state.characters[name]?.joinedEvent === encounter.id &&
          state.characters[name]?.serverStagingEvents?.some((event: any) => event.name === encounter.id));
      }, { timeout: 35_000, message: 'Both real clients must attend the announced boss before it is live' }).toBe(true);
      await expect.poll(async () => {
        const native = await world(live, encounter.id);
        return !native.boss && fighters.every(name => native.players[name] && Math.hypot(native.players[name].x - encounter.x, native.players[name].y - encounter.y) < 80);
      }, { timeout: 35_000, message: 'Staging must actually walk to the fixed native spawn region' }).toBe(true);
      await live.restartCoordinator();
      await expect.poll(async () => (await live.state()).characters[W]?.joinedEvent, { timeout: 20_000 }).toBe(encounter.id);
      await expect.poll(() => Date.now() >= Date.parse(timer.spawn), { timeout: 60_000 }).toBe(true);
      expect((await live.state()).eventReturn, 'Ten seconds of non-live staging must not retire attendance').toBeFalsy();
      const seeded = await spawn(live, encounter.id, encounter.map, encounter.x, encounter.y);
      await info.attach('native-halloween-encounter-seed', { body: JSON.stringify(seeded), contentType: 'application/json' });
      await expect.poll(async () => (await world(live, encounter.id)).boss?.hp, { timeout: 60_000 }).toBeLessThan(seeded.hp);
      const death = await killNativeCharacter(live, W);
      await expect.poll(async () => {
        const native = await world(live, encounter.id), state = await live.state();
        const packets = await live.clients[W].events();
        const dead = packets.find((entry: any) => entry.at >= death.at && entry.event === 'player' && entry.data?.rip && entry.data?.hp === 0);
        const respawn = dead && packets.find((entry: any) => entry.at > dead.at && entry.event === 'player' && !entry.data?.rip && entry.data?.hp > 0);
        const reentryHit = respawn && packets.some((entry: any) => entry.at > respawn.at && entry.event === 'hit' &&
          String(entry.data?.id) === String(seeded.id) && entry.data?.hid === W && entry.data?.damage > 0);
        return native.players[W] && !native.players[W].rip && native.players[W].map === encounter.map && state.characters[W]?.joinedEvent === encounter.id && reentryHit;
      }, { timeout: 180_000, message: 'Native death must preserve event reentry instead of losing the saved activity' }).toBe(true);
      await info.attach('native-halloween-death-and-reentry', { body: JSON.stringify({ death, native: await world(live, encounter.id), coordinator: await live.state() }), contentType: 'application/json' });
      const navigationHttp=encounter.id==='mrpumpkin'?observeNativeNavigationHttp(live.clients[W].page):null;
      const terminalFault=original.terminalFault?await installTerminalSettlementFault(live,live.clients[W].page):null;
      const returnPhases:{deselectedAt:number;replacementRequestedAt?:number;replacementAcknowledgedAt?:number;recoveryStartedAt:number;recoveryDeadline:number;arrivalObservedAt?:number}={
        deselectedAt:Date.now(),recoveryStartedAt:Date.now(),recoveryDeadline:0};
      let returnDeadline = returnPhases.deselectedAt + (encounter.id === 'mrgreen' ? 240_000 : 180_000);
      returnPhases.recoveryDeadline=returnDeadline;
      try{
      await live.post('/formation', { character: W, eventSelections: [] });
      if (encounter.id === 'mrgreen') {
        let before:any, after:any;
        const observations:any[]=[];
        try {
          await expect.poll(async () => {
            const state=await live.state(), convoy=state.activeConvoy, warrior=state.characters[W];
            const parent=convoy?.walkingParents?.[W];
            if(convoy?.purpose!=='shared-walk-return'||convoy.walkingActivity!=='event-return'||
              convoy.phase!=='travel'||parent?.command?.type!=='event-return-town'||
              parent.command.cycleId!==state.eventReturn?.cycleId) return false;
            if(!Number.isFinite(warrior?.convoyNavigation?.commandId)||!Number.isFinite(warrior?.lastCommandId)||
              warrior.convoyNavigation.commandId<=parent.command.id||
              warrior.lastCommandId<=parent.command.id||warrior?.movement?.progress?.phase!=='walking')return false;
            before=state;return true;
          },{timeout:90_000,message:'Turn over CODE only during the actual owned event-exit child walk'}).toBe(true);
          returnPhases.replacementRequestedAt=Date.now();
          await live.clients[W].frame.evaluate(()=>{
            const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
            game.start_runner('maincode',`$.getScript(${JSON.stringify(runner.__partyServer+'/CODE/adventure_land/universal-loader.js')});`);
          });
          await expect.poll(async()=>{
            const state=await live.state(),warrior=state.characters[W];
            observations.push({at:Date.now(),recovery:state.eventReturn,warrior});
            if(!warrior||warrior.dashboardRuntime===before.characters[W].dashboardRuntime||
              Date.now()-warrior.seenAt>3000)return false;
            const original=before.eventReturn;
            expect(state.eventReturn?.cycleId).toBe(original.cycleId);
            for(const name of fighters)expect(state.eventReturn?.waypoints[name].revision).toBe(original.waypoints[name].revision);
            after=state;returnPhases.replacementAcknowledgedAt=Date.now();return true;
          },{timeout:30_000,message:'A fresh replacement CODE runtime must retain the original event-return owner'}).toBe(true);
          returnPhases.recoveryStartedAt=returnPhases.replacementAcknowledgedAt!;
          returnDeadline=returnPhases.recoveryDeadline=returnPhases.recoveryStartedAt+240_000;
        } finally {
          await info.attach('native-green-exit-code-turnover',{body:JSON.stringify({before,after,observations,phases:returnPhases,native:await world(live,encounter.id)}),contentType:'application/json'});
        }
      }
      if(terminalFault){
        const proof=await terminalFault.prove(returnDeadline);
        const retired=await terminalFault.finish();
        expect(retired.forwardingErrors,'Fault transport must drain cleanly before normal checkpoint travel').toEqual([]);
        expect(retired.pendingHeld,'No completed fault may retain a native request during checkpoint travel').toBe(false);
        await info.attach('native-terminal-settlement-fault-proof',{body:JSON.stringify(proof),contentType:'application/json'});
      }
      await expect.poll(async () => {
        const native = await world(live, encounter.id);
        return fighters.every(name => native.players[name] && native.players[name].map === savedCheckpoint.location.map && Math.hypot(native.players[name].x - savedCheckpoint.location.x, native.players[name].y - savedCheckpoint.location.y) < 100);
      }, { timeout: Math.max(1,returnDeadline-Date.now()), message: 'Deselection must return both actual clients to their saved pre-event checkpoint' }).toBe(true);
      returnPhases.arrivalObservedAt=Date.now();
      const nativeArrivalReceipts=await Promise.all(fighters.map(async name=>{
        const events=await live.clients[name].events(),main=events.filter((event:any)=>event.event==='new_map'&&
          event.at>=returnPhases.recoveryStartedAt&&event.data?.name==='main').at(-1);
        const arrival=main&&events.find((event:any)=>event.event==='player'&&event.at>main.at&&event.data?.map===savedCheckpoint.location.map&&
          Math.hypot(event.data.x-savedCheckpoint.location.x,event.data.y-savedCheckpoint.location.y)<100);
        return {name,main,arrival};
      }));
      await info.attach('halloween-saved-checkpoint-return', { body: JSON.stringify({savedCheckpoint,phases:returnPhases,nativeArrivalReceipts, native: await world(live, encounter.id), coordinator: await live.state() }), contentType: 'application/json' });
      }finally{
        try{await info.attach('native-event-return-phase-timing',{body:JSON.stringify({phases:returnPhases,observedAt:Date.now(),native:await world(live,encounter.id)}),contentType:'application/json'});}
        finally{
        try{if(terminalFault)await info.attach('native-terminal-settlement-fault-final',{body:JSON.stringify(await terminalFault.finish()),contentType:'application/json'});}
        finally{if(navigationHttp)await info.attach('native-pumpkin-return-http',{body:JSON.stringify(await navigationHttp.finish()),contentType:'application/json'});}
        }
      }
    });
  });
}

test.describe('Slenderman', () => {
  test.use({ initialPosition: { map: 'halloween', x: 0, y: 0 } });
  test('Halloween Slenderman follows native map-only sightings, reacquires a warp and returns after native death', async ({ live }, info) => {
    test.setTimeout(600_000);
    // This case declares one observed warp below. The seasonal random warp
    // scheduler otherwise relocates Slender before the first selected attack,
    // and repeatedly during reacquisition, making the declared journey vanish.
    const warpSchedule=await live.admin(`output=(()=>{globalThis.__e2eSlenderWarpSeason=events.halloween;events.halloween=false;
      return {autonomousSeasonalWarps:false,declaredWarps:1,nativeCombat:true};})()`);
    await info.attach('declared-slenderman-warp-schedule',{body:JSON.stringify(warpSchedule),contentType:'application/json'});
    const seeded = await spawn(live, 'slenderman', 'halloween', 120, 0);
    await prepare(live, 'slenderman');
    await expect.poll(async () => (await world(live, 'slenderman')).boss?.hp, { timeout: 60_000 }).toBeLessThan(seeded.hp);
    const warp = await live.admin(`output=(()=>{const m=get_monster('slenderman');if(!m)throw Error('Missing living native Slender');
      xy_emit(m,'disappear',{id:m.id});delete instances[m.in].monsters[m.id];m.oin=m.in=m.map='spookytown';instances[m.in].monsters[m.id]=m;
      const point=G.maps.spookytown.spawns[0];m.x=point[0]+120;m.y=point[1];m.moving=false;m.abs=true;m.u=true;m.cid++;m.last_jump=new Date();
      m.map_def.i=m.map;m.map_def.boundary=[m.x,m.y,m.x,m.y];
      // Upstream Slender warps do not refresh E.slenderman.map. Preserve that
      // exact native limitation; actual discovery must outlive its initial hint.
      broadcast_e();
      return {id:m.id,map:m.map,x:m.x,y:m.y,hp:m.hp,nativeStatus:E.slenderman,scope:'native relocation only; no damage or arrival seeded'};})()`);
    await info.attach('native-slenderman-map-only-warp', { body: JSON.stringify(warp), contentType: 'application/json' });
    await expect.poll(async () => {
      const native = await world(live, 'slenderman');
      return fighters.every(name => native.players[name] && native.players[name].map === 'spookytown') && native.boss?.hp < warp.hp;
    }, { timeout: 180_000, message: 'Bounded native-map discovery must reacquire Slender despite the unchanged initial server map hint' }).toBe(true);
    const killProgress:any[]=[];
    try {
      await expect.poll(async () => {const native=await world(live,'slenderman');killProgress.push({at:Date.now(),...native});return !native.boss;},
        { timeout: 240_000, message: 'Actual native combat must kill Slender' }).toBe(true);
    } finally {await info.attach('slenderman-native-kill-progress',{body:JSON.stringify(killProgress),contentType:'application/json'});}
    await live.admin('delete E.slenderman;broadcast_e();output=true');
    await expect.poll(async () => {
      const native = await world(live, 'slenderman');
      const state = await live.state();
      const checkpointPhase = !!state.eventReturn?.returnDispatchedAt ||
        !state.eventReturn && (!state.activeConvoy || state.activeConvoy.phase === 'complete');
      return checkpointPhase && fighters.every(name => native.players[name] && !state.characters[name]?.joinedEvent && native.players[name].map === 'halloween' &&
        Math.hypot(native.players[name].x, native.players[name].y) < 100);
    }, { timeout: 180_000, message: 'Both native clients must actually return to the saved point' }).toBe(true);
    await expect.poll(async () => {
      const native = await world(live, 'slenderman');
      const state = await live.state();
      const recoveryFinished = !state.eventReturn && (!state.activeConvoy || state.activeConvoy.phase === 'complete');
      return recoveryFinished && fighters.every(name => native.players[name] && !state.characters[name]?.joinedEvent &&
        native.players[name].map === 'halloween' && Math.hypot(native.players[name].x, native.players[name].y) < 100);
    }, { timeout: 30_000, message: 'Saved-point arrival must be acknowledged and retire recovery before resuming activity' }).toBe(true);
    await info.attach('slenderman-native-completion-and-return', { body: JSON.stringify({ native: await world(live, 'slenderman'), coordinator: await live.state(), packets: await live.clients[W].events() }), contentType: 'application/json' });
  });
});

test.describe('Absent Halloween spawn', () => {
  test.use({ initialPosition: { map: 'halloween', x: -335, y: 685 } });
  test('Halloween staging abandons an absent native spawn after its fixed deadline and returns without reopening', async ({ live }, info) => {
    test.setTimeout(420_000);
    // October's native season now runs automatically in the pinned server.
    // Declare this encounter's absent spawn before admission; otherwise the
    // unrelated season timer creates a real boss halfway through the timeout.
    const timerSeed=await live.admin(`output=(()=>{if(get_monster('mrpumpkin'))throw Error('Absent-spawn fixture requires no boss');
      globalThis.__e2eAbsentPumpkinTimer=timers.mrpumpkin;timers.mrpumpkin=new Date(Date.now()+3600000);
      return {at:Date.now(),original:globalThis.__e2eAbsentPumpkinTimer,delayedUntil:timers.mrpumpkin};})()`);
    await info.attach('absent-native-spawn-timer-declaration',{body:JSON.stringify(timerSeed),contentType:'application/json'});
    try {
    const announcement = await announceSpawn(live, 'mrpumpkin', 15000);
    const savedCheckpoint = await prepare(live, 'mrpumpkin');
    expect(savedCheckpoint.location.map).toBe('halloween');
    await info.attach('absent-native-spawn-saved-checkpoint',{body:JSON.stringify(savedCheckpoint),contentType:'application/json'});
    await expect.poll(async () => (await live.state()).characters[W]?.joinedEvent, { timeout: 30_000 }).toBe('mrpumpkin');
    await expect.poll(async () => {
      const state = await live.state();
      return state.eventReturn?.event === 'mrpumpkin' || fighters.every(name => !state.characters[name]?.joinedEvent);
    }, { timeout: 155_000, message: 'No native boss may hold saved activity beyond spawn plus 120 seconds' }).toBe(true);
    await expect.poll(async () => {
      const state = await live.state();
      return !!state.eventReturn?.returnDispatchedAt || !state.eventReturn;
    }, { timeout: 120_000, message: 'Both native Main exits must be explicitly acknowledged before checkpoint dispatch' }).toBe(true);
    await expect.poll(async () => {
      const native = await world(live, 'mrpumpkin'), state = await live.state();
      return fighters.every(name => native.players[name] && native.players[name].map === 'halloween' && Math.hypot(native.players[name].x - savedCheckpoint.location.x, native.players[name].y - savedCheckpoint.location.y) < 100 && !state.characters[name]?.joinedEvent);
    }, { timeout: 120_000 }).toBe(true);
    await live.admin('broadcast_e();output=true');
    await waitForGameplay(11000);
    expect((await live.state()).characters[W]?.joinedEvent, 'Another native feed must not reopen the expired timer').toBeFalsy();
    await info.attach('absent-native-spawn-bounded-return', { body: JSON.stringify({ announcement, savedCheckpoint, native: await world(live, 'mrpumpkin'), coordinator: await live.state() }), contentType: 'application/json' });
    } finally {
      await live.admin("output=(()=>{timers.mrpumpkin=globalThis.__e2eAbsentPumpkinTimer;delete globalThis.__e2eAbsentPumpkinTimer;return true;})()");
    }
  });
});

// Earlier Halloween journeys can leave a native boss behind (its natural respawn);
// these declared two-boss scenes start from no Green or Pumpkin at all.
async function clearHalloweenBosses(live: LiveGame) {
  return live.admin(`output=(()=>{const removed=[];for(const instance of Object.values(instances))for(const m of Object.values(instance.monsters||{}))
    if(['mrgreen','mrpumpkin'].includes(m.type)){removed.push({id:m.id,type:m.type});remove_monster(m,{nospawn:true,silent:true});}
    for(const type of ['mrgreen','mrpumpkin'])delete E[type];broadcast_e();return removed;})()`);
}

// Failure inventory: e2e/event-follow-leader-failures.md. Live: with two Halloween
// bosses up, the leader and its followers attended different bosses. A follower
// already in one boss that starts following a leader in the other must switch to the
// leader's boss, and switching must not strand it in a return to checkpoint.
test('a follower switches to its leader\'s Halloween boss without a stranded return', async ({ live }, info) => {
  test.setTimeout(420_000);
  await clearHalloweenBosses(live);
  await live.post('/formation', { leader: W });
  await live.post('/formation', { character: P, follow: false });
  const checkpoint = await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});return {map:p.map,x:p.x,y:p.y}})()`);
  await live.post('/travel', checkpoint);
  await expect.poll(async () => { const state = await live.state(); return !state.activeConvoy || state.activeConvoy.phase === 'complete'; }, { timeout: 30_000 }).toBe(true);
  await live.post('/formation', { character: P, eventSelections: ['mrgreen'] });
  await live.post('/formation', { character: W, eventSelections: ['mrgreen', 'mrpumpkin'] });
  // The leader ranks Mr. Pumpkin first; the follower inherits that order once it follows.
  await live.post('/formation', { character: W, eventPriorities: ['mrpumpkin', 'mrgreen', ...supportedEvents.filter(id => id !== 'mrpumpkin' && id !== 'mrgreen')] });
  // The leader attends Mr. Pumpkin first; the independent follower can only attend Mr. Green.
  const pumpkin = await spawn(live, 'mrpumpkin', 'halloween', -495, 685);
  await expect.poll(async () => (await live.state()).characters[W]?.joinedEvent, { timeout: 120_000 }).toBe('mrpumpkin');
  const green = await spawn(live, 'mrgreen', 'spookytown', 636, 995);
  await expect.poll(async () => { const state = await live.state();
    return [state.characters[W]?.joinedEvent, state.characters[P]?.joinedEvent]; },
  { timeout: 120_000, message: 'The leader attends Mr. Pumpkin and the independent follower Mr. Green' }).toEqual(['mrpumpkin', 'mrgreen']);
  await live.post('/formation', { character: P, follow: true });
  const samples: any[] = [];
  const hits = async () => (await live.clients[P].events()).filter((event: any) => event.event === 'hit' &&
    event.data?.hid === P && String(event.data?.id) === String(pumpkin.id) && event.data?.damage > 0);
  try {
    await expect.poll(async () => {
      const state = await live.state();
      samples.push({ at: Date.now(), leader: state.characters[W]?.joinedEvent, follower: state.characters[P]?.joinedEvent,
        followerMap: state.characters[P]?.map, eventReturn: state.eventReturn ? { event: state.eventReturn.event,
          participants: state.eventReturn.participants, phase: state.eventReturn.phase } : null });
      return state.characters[P]?.joinedEvent === 'mrpumpkin' && (await hits()).length > 0;
    }, { timeout: 180_000, intervals: [1000], message: 'The follower must switch to its leader\'s boss and fight it' }).toBe(true);
    const state = await live.state();
    expect(state.eventReturn?.participants?.includes(P) || false, 'No return holds the switched follower').toBe(false);
  } finally {
    await info.attach('follower-switches-to-leader-event', { body: JSON.stringify({ green, pumpkin, samples }, null, 2), contentType: 'application/json' });
  }
});

// Leaving one Halloween boss while another selected boss is live (here by deselecting
// it) must send the party on to the other boss. Live, the open return refused event
// travel while the live event blocked the walk home, so the fighter could do neither.
test('leaving one Halloween boss while another is live sends the party to the other', async ({ live }, info) => {
  test.setTimeout(480_000);
  await clearHalloweenBosses(live);
  await prepare(live, 'mrgreen');
  await live.post('/formation', { character: W, eventSelections: ['mrgreen', 'mrpumpkin'] });
  const green = await spawn(live, 'mrgreen', 'spookytown', 636, 995);
  await expect.poll(async () => { const state = await live.state();
    return fighters.every(name => state.characters[name]?.joinedEvent === 'mrgreen'); },
  { timeout: 120_000, message: 'Both fighters attend Mr. Green' }).toBe(true);
  const pumpkin = await spawn(live, 'mrpumpkin', 'halloween', -495, 685);
  const samples: any[] = [];
  const hits = async (name: string) => (await live.clients[name].events()).filter((event: any) => event.event === 'hit' &&
    event.data?.hid === name && String(event.data?.id) === String(pumpkin.id) && event.data?.damage > 0);
  try {
    await live.post('/formation', { character: W, eventSelections: ['mrpumpkin'] });
    await expect.poll(async () => {
      const [state, native] = await Promise.all([live.state(), world(live, 'mrpumpkin')]);
      samples.push({ at: Date.now(), events: Object.fromEntries(fighters.map(name => [name, state.characters[name]?.joinedEvent])),
        positions: native.players, eventReturn: state.eventReturn ? { event: state.eventReturn.event,
          participants: state.eventReturn.participants, phase: state.eventReturn.phase } : null });
      return (await Promise.all(fighters.map(hits))).every(list => list.length > 0);
    }, { timeout: 240_000, intervals: [1000], message: 'Both fighters must go on to fight Mr. Pumpkin' }).toBe(true);
    const state = await live.state();
    expect(fighters.some(name => state.eventReturn?.participants?.includes(name)), 'No return holds a fighter with Mr. Pumpkin live').toBe(false);
  } finally {
    await info.attach('leave-one-boss-other-live', { body: JSON.stringify({ green, pumpkin, samples }, null, 2), contentType: 'application/json' });
    const logs = await (await fetch(live.url + '/party-api/state?section=logs')).json();
    await info.attach('leave-one-boss-character-logs', { body: JSON.stringify(Object.fromEntries(fighters.map(name => [name,
      { game: (logs.gameLogs?.[name] || []).filter((entry: any) => !/^E2EMerchant:/.test(entry.message)).slice(-400), combat: (logs.combatLogs?.[name]?.events || logs.combatLogs?.[name] || []).slice(-80) }])), null, 2),
      contentType: 'application/json' });
  }
});
