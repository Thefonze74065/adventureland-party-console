import {test,expect} from './live-fixtures';

const merchant='E2EMerchant',target='E2EWarrior';
const policy=(item:string,autoAcquire:boolean,autoConsume=true,max=2)=>({character:target,hp:{min:0,max:0},mp:{min:0,max:0},elixir:{item,min:max===1?0:1,max,autoConsume,autoAcquire}});

for(const mode of ['stored','buy','craft'] as const) test(`elixir restock ${mode} uses native supply and consumption receipts`,async({live,page},info)=>{
  test.setTimeout(360000);
  const item=mode==='craft'?'elixirfires':'elixirluck',max=mode==='craft'?1:2;
  try {
    await live.admin(`output=(async()=>{const m=get_player('${merchant}'),p=get_player('${target}');
      if(p.slots.elixir||p.items.some(i=>i&&i.name==='${item}'))throw Error('Elixir fixture must start without selected stock');
      m.gold=1000000;
      if('${mode}'==='stored')await db.collection('user').updateOne({_id:m.owner},{$set:{'info.items0.20':{name:'${item}',q:2}}});
      if('${mode}'==='craft'){if(m.items[20]||m.items[21])throw Error('Craft fixture cells must be empty');m.items[20]={name:'cshell',q:1};m.items[21]={name:'hpot0',q:2000};}
      cache_player_items(m);resend(m,'reopen+cid');return true;})()`);
    await live.clients[merchant].run(`(()=>{globalThis.__elixirReceipts=[];parent.socket.on('game_response',data=>{if(['buy_success','craft','crafted'].includes(data?.response)||data?.place==='craft')globalThis.__elixirReceipts.push({at:Date.now(),data})});return true})()`);
    await live.clients[target].run(`(()=>{globalThis.__elixirUses=[];parent.socket.on('game_response',data=>{if(data?.response==='elixir')globalThis.__elixirUses.push({at:Date.now(),data})});return true})()`);
    await live.post('/command',{character:merchant,type:'bank'});
    await expect.poll(async()=>!!(await live.state()).bank?.packs,{timeout:90000}).toBe(true);
    await expect.poll(async()=>(await live.state()).merchantCurrent,{timeout:90000}).toBeNull();
    await live.post('/restock',policy(item,false,mode!=='buy',max));
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{restock:true}});
    if(mode!=='stored') {
      const before=(await live.clients[target].snapshot()).statusAt;
      await expect.poll(async()=>(await live.clients[target].snapshot()).statusAt,{timeout:30000}).toBeGreaterThan(before+10000);
      expect(await live.clients[merchant].run('globalThis.__elixirReceipts')).toEqual([]);
      await live.post('/restock',policy(item,true,mode!=='buy',max));
    }
    if(mode==='buy') {
      await expect.poll(async()=>(await live.clients[target].snapshot()).items.filter((i:any)=>i?.name===item).reduce((n:number,i:any)=>n+(i.q||1),0),{timeout:180000}).toBe(2);
      // A point inside scenery can pass a zero-length native collision check
      // while remaining unreachable. Retried jobs must not conceal that fault
      // behind eventual delivery from the merchant's already purchased stock.
      const navigation=(await live.state()).combatLogs?.[merchant]?.filter((entry:any)=>entry.type==='navigation')||[];
      await info.attach('elixir-native-acquisition-navigation',{body:JSON.stringify(navigation),contentType:'application/json'});
      expect(navigation.filter((entry:any)=>entry.details?.failureContext?.code==='route-failed'),
        'Ordinary elixir acquisition must use a reachable Winter Inn return route').toEqual([]);
      const unconsumed=await live.admin(`output=!!get_player('${target}').slots.elixir`);
      expect(unconsumed).toBe(false);
      await live.post('/restock',policy(item,false,true,max));
    }
    await expect.poll(async()=>await live.admin(`output=get_player('${target}').slots.elixir?.name||null`),{timeout:180000}).toBe(item);
    await expect.poll(async()=>{const c=(await live.state()).characters[target];return {item:c?.slots?.elixir?.item?.name,status:c?.conditions?.some((s:any)=>s.id==='elixir:'+item)};},{timeout:30000}).toEqual({item,status:true});
    const uses=await live.clients[target].run('globalThis.__elixirUses');
    expect(uses).toHaveLength(1);
    if(mode==='stored') expect(await live.clients[merchant].run('globalThis.__elixirReceipts')).toEqual([]);
    if(mode==='buy') expect((await live.clients[merchant].run('globalThis.__elixirReceipts')).filter((r:any)=>r.data.response==='buy_success'&&r.data.name===item).reduce((n:number,r:any)=>n+r.data.q,0)).toBe(2);
    if(mode==='craft') {
      const ingredients=await live.admin(`output=get_player('${merchant}').items.filter(i=>i&&['cshell','hpot0'].includes(i.name))`);
      expect(ingredients).toEqual([]);
    }
    await page.goto(live.url);
    const card=page.locator('article').filter({has:page.getByRole('heading',{name:target,exact:true})});
    await expect(card.getByText(mode==='craft'?'Elixir of Fire Resistance':'Liquid Luck',{exact:true}).first()).toBeVisible();
    await card.getByRole('button',{name:/^Active status/}).click();
    const activeStatuses=card.locator('section').filter({has:page.getByRole('heading',{name:'Active status',exact:true})});
    await expect(activeStatuses.getByRole('button',{name:mode==='craft'?/^Elixir of Fire Resistance/:/^Liquid Luck/})).toBeVisible();
    const equipped=card.getByLabel('Equipped elixir');
    await expect(equipped).toHaveCount(1);
    await expect(equipped).toContainText(/\d+[hms]/);
    await info.attach('active-elixir-slot-and-status',{body:await card.screenshot(),contentType:'image/png'});
    if(mode==='buy') {
      // This checks a potion's native consumption cost, not recovery priority.
      // Full pools avoid automatic regeneration repeatedly taking its cooldown.
      await live.admin(`output=(()=>{const p=get_player('${target}');if(p.items[20])throw Error('Potion fixture requires empty slot 20');p.items[20]={name:'hpot0',q:1};p.hp=p.max_hp;p.mp=p.max_mp;cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
      await expect.poll(async()=>(await live.clients[target].snapshot()).items[20]?.name).toBe('hpot0');
      await expect.poll(async()=>{
        const result=await live.clients[target].run(`(async()=>{if(!character.items[20])return {done:true};try{await consume(20);return {done:true};}catch(error){return {reason:error?.reason||error?.response||String(error)};}})()`);
        if(result.reason && result.reason!=='not_ready') throw Error('Native potion use failed: '+JSON.stringify(result));
        return result.done===true;
      },{timeout:15000,intervals:[100,250]}).toBe(true);
      await expect.poll(async()=>(await live.clients[target].snapshot()).items[20]).toBeNull();
    }
    await expect.poll(async()=>{const data=await (await page.request.get(live.url+'/party-api/metrics?from='+(Date.now()-120000)+'&to='+Date.now())).json();return data.points.flatMap((p:any)=>p.values).filter((r:any)=>r.character===target).some((r:any)=>r.last.consumableCost === (mode==='buy'?240020:240000));},{timeout:30000}).toBe(true);
    await live.restartCoordinator();
    await expect.poll(async()=>(await live.state()).restockPolicies[target].elixir.item).toBe(item);
    expect(await live.clients[target].run('globalThis.__elixirUses')).toHaveLength(1);
  } finally {
    await info.attach('elixir-native-evidence',{body:JSON.stringify({state:await live.state(),merchant:await live.clients[merchant].snapshot(),recipient:await live.clients[target].snapshot(),receipts:await live.clients[merchant].run('globalThis.__elixirReceipts||[]'),uses:await live.clients[target].run('globalThis.__elixirUses||[]')}),contentType:'application/json'});
  }
});


test('merchant restocks and consumes its own native elixir',async({live},info)=>{
  test.setTimeout(180000);
  try {
    await live.admin(`output=(async()=>{const m=get_player('${merchant}');if(m.slots.elixir)throw Error('Expected no active elixir');await db.collection('user').updateOne({_id:m.owner},{$set:{'info.items0.20':{name:'elixirluck',q:2}}});return true;})()`);
    await live.clients[merchant].run(`(()=>{globalThis.__elixirUses=[];parent.socket.on('game_response',data=>{if(data?.response==='elixir')globalThis.__elixirUses.push({at:Date.now(),data})});return true})()`);
    await live.post('/command',{character:merchant,type:'bank'});
    await expect.poll(async()=>!!(await live.state()).bank?.packs,{timeout:90000}).toBe(true);
    await expect.poll(async()=>(await live.state()).merchantCurrent,{timeout:90000}).toBeNull();
    await live.post('/restock',{...policy('elixirluck',false),character:merchant});
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{restock:true}});
    await expect.poll(async()=>await live.admin(`output=get_player('${merchant}').slots.elixir?.name||null`),{timeout:90000}).toBe('elixirluck');
    await expect.poll(async()=>{const s=await live.state();return {job:s.merchantCurrent,item:s.characters[merchant]?.slots?.elixir?.item?.name,quantity:s.characters[merchant]?.items?.filter((entry:any)=>entry?.item?.name==='elixirluck').reduce((n:number,entry:any)=>n+(entry.item.q||1),0)};},{timeout:30000}).toEqual({job:null,item:'elixirluck',quantity:1});
    expect(await live.clients[merchant].run('globalThis.__elixirUses')).toHaveLength(1);
  } finally {
    await info.attach('merchant-self-elixir-evidence',{body:JSON.stringify({state:await live.state(),native:await live.clients[merchant].snapshot(),uses:await live.clients[merchant].run('globalThis.__elixirUses||[]')}),contentType:'application/json'});
  }
});
