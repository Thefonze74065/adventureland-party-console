import {test,expect} from './live-fixtures';
import {M,P,beginAnniversary,endAnniversary,world,quantity} from './game/hunt-events';

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
    await live.post('/command',{character:M,type:'mark',slot:10,item:{name:'leather',q:3}});
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
