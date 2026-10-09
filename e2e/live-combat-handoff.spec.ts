import {test,expect} from './live-fixtures';
import {W,M,spawnGoo,seedCargo,totalLeather,evidence} from './hunt-interruption-helpers';

test('bag-only native merchant collection finishes while the fighter keeps fighting',async({live},info)=>{
  test.setTimeout(240000);
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',{leader:W});
  await seedCargo(live);
  const total=await totalLeather(live),monster=await spawnGoo(live,W,300);
  await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{},monsterSearchRadius:400});
  const hits=async()=> (await live.clients[W].events()).filter((event:any)=>event.event==='hit'&&String(event.data?.id)===String(monster.id)&&event.data?.hid===W&&event.data?.damage>0);
  await expect.poll(async()=>(await hits()).length,{timeout:45000}).toBeGreaterThan(0);
  const before=await live.clients[W].snapshot(),initialHits=(await hits()).length;
  await live.post('/bank-party',{});
  await live.post('/merchant/force-stand',{enabled:false});
  await expect.poll(async()=>live.admin(`output=get_player(${JSON.stringify(M)}).items.some(i=>i?.name==='leather'&&i.q>=7)`),{timeout:90000}).toBe(true);
  const during=await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)}),m=instances[p.in].monsters[${JSON.stringify(monster.id)}];return {monster:m&&{id:m.id,hp:m.hp},fighter:{x:p.x,y:p.y,hp:p.hp},merchant:get_player(${JSON.stringify(M)}).items}})()`);
  expect(during.monster?.hp).toBeGreaterThan(0);
  await expect.poll(async()=>(await hits()).length,{timeout:15000}).toBeGreaterThan(initialHits);
  expect(await totalLeather(live)).toBe(total);
  await expect.poll(async()=>(await live.state()).merchantMarked?.[W]?.length??0,{timeout:30000}).toBe(0);
  await evidence(live,info,'native-bag-handoff-mid-combat',{monster,before,during,total,hits:await hits()});
  await info.attach('native-combat-handoff-client',{body:await live.clients[W].page.screenshot(),contentType:'image/png'});
});

test('native collection times out a held call-cost window and retains unsent marks',async({live},info)=>{
  test.setTimeout(240000);
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',{leader:W});
  await seedCargo(live);
  const total=await totalLeather(live),monster=await spawnGoo(live,W,300);
  await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{},monsterSearchRadius:400});
  const hits=async()=> (await live.clients[W].events()).filter((event:any)=>event.event==='hit'&&String(event.data?.id)===String(monster.id)&&event.data?.hid===W&&event.data?.damage>0);
  await expect.poll(async()=>(await hits()).length,{timeout:45000}).toBeGreaterThan(0);
  // Declared observation fault: hold only the client-visible call-cost reading.
  // Native attack/send handlers and server call-cost accounting remain active.
  await live.clients[W].run(`(()=>{let observed=character.cc;globalThis.__e2eHoldHandoffCost=true;
    Object.defineProperty(character,'cc',{configurable:true,get:()=>globalThis.__e2eHoldHandoffCost?150:observed,set:value=>{observed=value}});return true})()`);
  const receipts:any[]=[];
  await live.clients[W].page.route('**/party-api/merchant/handoff-complete',async route=>{
    receipts.push(route.request().postDataJSON());await route.continue();
  });
  await live.post('/bank-party',{});
  await live.post('/merchant/force-stand',{enabled:false});
  await expect.poll(()=>receipts.some(receipt=>receipt.partial&&receipt.reason.includes('30 seconds')),{timeout:90000}).toBe(true);
  await live.post('/merchant/force-stand',{enabled:true});
  const partial=receipts.find(receipt=>receipt.partial);
  expect(partial.sent).toEqual([]);expect(partial.gold).toBe(0);
  expect((await live.state()).merchantMarked[W].length).toBeGreaterThan(0);
  expect(await totalLeather(live)).toBe(total);
  const hitCount=(await hits()).length;
  await expect.poll(async()=>(await hits()).length,{timeout:15000}).toBeGreaterThan(hitCount);
  await live.clients[W].run('globalThis.__e2eHoldHandoffCost=false');
  await live.post('/merchant/force-stand',{enabled:false});
  await live.post('/bank-party',{});
  await expect.poll(async()=>live.admin(`output=get_player(${JSON.stringify(W)}).items.some(i=>i?.name==='leather')`),{timeout:90000}).toBe(false);
  expect(await totalLeather(live)).toBe(total);
  await evidence(live,info,'native-handoff-window-timeout-and-retry',{monster,total,receipts,hits:await hits()});
});
