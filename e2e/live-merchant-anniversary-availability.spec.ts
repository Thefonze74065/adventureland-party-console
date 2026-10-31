import {test,expect} from './live-fixtures';
import {M,P,beginAnniversary,endAnniversary,world,quantity} from './game/hunt-events';

for(const kind of ['current','deferred'] as const)test(`merchant Main arrival retires ${kind} empty event return and sells a full inventory during Hunt`,async({live},info)=>{
  test.setTimeout(240_000);
  // Failure inventory: a merchant with no farming waypoint inherits the Hunt
  // return barrier; a deferred owner survives actual Main arrival; cleanup
  // cancels fighter travel or leaves client ownership latched; sales never run.
  const warrior='E2EWarrior',cycle='merchant-empty-'+kind,samples:any[]=[];
  await live.post('/formation',{leader:warrior});
  await live.post('/formation',{character:M,eventSelections:[]});
  const choice=(await live.state(true)).monsterChoices.find((m:any)=>m.id==='goo');
  await live.post('/farming-mode',{mode:'hunt',backup:{monsterFocus:['goo'],location:choice.locations[0]}});
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':false}});
  await live.admin(`output=(()=>{const p=get_player('${M}');p.items=[{name:'stand0'},{name:'hpot1',q:9999},{name:'mpot1',q:9999},...Array.from({length:39},()=>({name:'helmet',level:0}))];cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
  await expect.poll(async()=>(await live.state()).characters[M].items.filter((e:any)=>e?.item?.name==='helmet').length).toBe(39);
  await live.post('/merchant/auto-npc-sale',{item:{name:'helmet',level:0},keep:0});
  await live.restoreHistoricalSettings(()=>kind==='current'?{eventReturn:{cycleId:cycle,event:'witchcipher',participants:[M],pending:[],exited:[M],deferred:[],startedAt:Date.now()-60000,checkpoint:null,waypoints:{[M]:{revision:0,location:null}},phase:'evacuating'}}:
    {deferredEventReturns:{[M]:{cycleId:cycle,event:'witchcipher',checkpoint:null,navigationRevision:0,deferredAt:Date.now()-60000,phase:'awaiting-event-handoff'}}});
  try{
    await expect.poll(async()=>{
      const s=await live.state();samples.push({at:Date.now(),return:s.eventReturn,deferred:s.deferredEventReturns,merchant:s.characters[M]?.merchantEventReserved,hunt:s.monsterHunt});
      return !s.eventReturn?.participants.includes(M)&&!s.deferredEventReturns[M]&&!s.characters[M]?.merchantEventReserved;
    },{timeout:30_000}).toBe(true);
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':true}});
    await expect.poll(async()=>{
      const s=await live.state(),native=await live.admin(`output=get_player('${M}').items.filter(i=>i?.name==='helmet').length`);
      return native===0&&s.merchantActivity.filter((a:any)=>a.message.startsWith('Sold 1 × helmet to NPC')).length===39;
    },{timeout:120_000}).toBe(true);
    const s=await live.state();expect(s.farmingPolicy).toBe('hunt');expect(s.monsterHunt.participants).not.toContain(M);
    await live.restartCoordinator();
    await expect.poll(async()=>{const s=await live.state();return !s.eventReturn?.participants.includes(M)&&!s.deferredEventReturns[M]&&!s.characters[M]?.merchantEventReserved;}).toBe(true);
  }finally{await info.attach('merchant-empty-event-return-'+kind,{body:JSON.stringify({samples,state:await live.state(),events:await live.clients[M].events()}),contentType:'application/json'});}
});

test.describe('merchant October admission',()=>{
  test('merchant adopts a deferred Cipher return into the native door tour and resumes NPC sales',async({live},info)=>{
    test.setTimeout(360_000);
    // The saved return predates a new native door tour. The merchant must use
    // coordinator admission without becoming a Hunt participant, finish native
    // doors, acknowledge its Main exit and resume its already queued sales.
    await live.post('/formation',{leader:'E2EWarrior'});
    const goo=(await live.state(true)).monsterChoices.find((m:any)=>m.id==='goo');
    await live.post('/farming-mode',{mode:'hunt',backup:{monsterFocus:['goo'],location:goo.locations[0]}});
    await live.clients[M].run(`(()=>{globalThis.__merchantEventMoves=[];const service=globalThis.__partyMovement,move=service.move;service.move=function(destination,...args){globalThis.__merchantEventMoves.push({at:Date.now(),destination,job:globalThis.__merchantActiveJob?.jobId,stack:new Error().stack});if(globalThis.__merchantEventMoves.length>128)globalThis.__merchantEventMoves.shift();return move.call(this,destination,...args);};return true;})()`);
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':false}});
    await live.admin(`output=(()=>{events.halloween=true;E.halloween=true;const p=get_player('${M}');p.items=[{name:'stand0'},{name:'hpot1',q:9999},{name:'mpot1',q:9999},...Array.from({length:39},()=>({name:'helmet',level:0}))];p.p.trickortreat=null;p.trickortreat=trick_or_treat_status(p);cache_player_items(p);resend(p,'u+reopen+cid');broadcast_e();return true;})()`);
    await expect.poll(async()=>(await live.state()).characters[M].items.filter((e:any)=>e?.item?.name==='helmet').length).toBe(39);
    await live.post('/merchant/auto-npc-sale',{item:{name:'helmet',level:0},keep:0});
    await live.restoreHistoricalSettings(()=>({deferredEventReturns:{[M]:{cycleId:'merchant-cipher-before-doors',event:'witchcipher',checkpoint:null,navigationRevision:0,deferredAt:Date.now()-60000,phase:'awaiting-event-handoff'}}}));
    const samples:any[]=[];
    try{
      await live.post('/formation',{character:M,eventSelections:['trickortreat']});
      await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':true}});
      await expect.poll(async()=>{
        const s=await live.state(),doors=await live.clients[M].run('character.trickortreat?.doors?.length??0');
        samples.push({at:Date.now(),doors,deferred:s.deferredEventReturns,return:s.eventReturn,merchant:{map:s.characters[M]?.map,joined:s.characters[M]?.joinedEvent,reserved:s.characters[M]?.merchantEventReserved},current:s.merchantCurrent});
        if(samples.length>128)samples.shift();
        return doors===7&&!s.deferredEventReturns[M]&&!s.eventReturn?.participants.includes(M)&&!s.characters[M]?.merchantEventReserved&&
          s.merchantActivity.filter((a:any)=>a.message.startsWith('Sold 1 × helmet to NPC')).length===39;
      },{timeout:300_000,intervals:[250,500]}).toBe(true);
      expect((await live.state()).monsterHunt.participants).not.toContain(M);
    }finally{await info.attach('merchant-cipher-door-handoff',{body:JSON.stringify({samples,state:await live.state(),events:await live.clients[M].events(),moves:await live.clients[M].run('globalThis.__merchantEventMoves')}),contentType:'application/json'});}
  });
});

test('unavailable native Anniversary host releases merchant bank work then visit resumes on reconnect',async({live},info)=>{
  test.setTimeout(360_000);
  try {
    const before=await world(live);
    const seed=await beginAnniversary(live,P);
    await expect.poll(async()=>await live.admin('output=E.anniversary?.live')).toBe(true);
    await live.post('/steam/action',{character:P,action:'logout'});
    await expect.poll(async()=>{
      const operation=(await live.state()).steamSwitch;
      return !operation || operation.phase==='complete';
    },{timeout:90_000}).toBe(true);
    await expect.poll(async()=>await live.admin(`output=!!get_player('${P}')`),{timeout:30_000}).toBe(false);
    await expect.poll(async()=>await live.admin('output=E.anniversary?.available'),{timeout:30_000}).toBe(false);
    await live.post('/formation',{character:M,eventSelections:['anniversary']});
    // Native initial stock, not a fabricated withdrawal/deposit result.
    await live.admin(`output=(()=>{const p=get_player('${M}');p.items[10]={name:'leather',q:3};cache_player_items(p);resend(p,'reopen+cid');return true})()`);
    await expect.poll(async()=>(await live.clients[M].snapshot()).items[10]?.q).toBe(3);
    // The client bag update and coordinator inventory publication are separate
    // milestones. An older report can otherwise retire the newly created mark.
    await expect.poll(async()=>{
      const entry=(await live.state()).characters[M].items.find((entry:any)=>entry?.slot===10);
      return {name:entry?.item?.name,q:entry?.item?.q};
    },{timeout:30_000}).toEqual({name:'leather',q:3});
    await live.post('/command',{character:M,type:'mark',slot:10,item:{name:'leather',q:3}});
    await expect.poll(async()=>(await live.state()).marked[M].filter((mark:any)=>mark.slot===10&&mark.item?.name==='leather').length).toBe(1);
    await live.post('/command',{character:M,type:'bank'});
    await expect.poll(async()=>await live.admin(`output=get_player('${M}').items.some(i=>i&&i.name==='leather')`),{timeout:120_000}).toBe(false);
    const banked=await live.state();
    expect(await live.admin('output=E.anniversary?.available')).toBe(false);
    const nativeBank=await live.admin(`output=(async()=>{const p=get_player('${M}'),user=await db.collection('user').findOne({_id:p.owner});return Object.entries(p.user||user.info).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v)).flatMap(([,v])=>v).filter(i=>i?.name==='leather')})()`);
    expect(quantity(nativeBank,'leather')).toBe(3);
    await info.attach('anniversary-unavailable-native-bank-work',{body:JSON.stringify({seed,before,banked,nativeBank,events:await live.clients[M].events()}),contentType:'application/json'});
    // The native deposit receipt precedes completion of its coordinator inventory
    // handoff. Login resumes once the real banking operation reports finished.
    await expect.poll(async()=>{
      const state=await live.state(), merchant=state.characters[M];
      return !state.merchantCurrent && !state.bankboiTransaction &&
        !merchant.banking && !merchant.stocking && !merchant.upgrading;
    },{timeout:30_000}).toBe(true);
    await live.post('/steam/action',{character:P,action:'login'});
    await expect.poll(async()=>await live.admin(`output=!!get_player('${P}')`),{timeout:90_000}).toBe(true);
    await expect.poll(async()=>await live.admin('output=E.anniversary?.available'),{timeout:30_000}).toBe(true);
    await expect.poll(async()=>quantity((await world(live)).players[M].items,'anniversarygift'),{timeout:120_000}).toBe(quantity(before.players[M].items,'anniversarygift')+1);
    await info.attach('anniversary-availability-native-visit-resumed',{body:JSON.stringify({before,after:await world(live),state:await live.state(),events:await live.clients[M].events()}),contentType:'application/json'});
  } finally {await endAnniversary(live);}
});
