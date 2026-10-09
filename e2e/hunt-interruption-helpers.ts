import { expect, type LiveGame } from './live-fixtures';
import type { TestInfo } from '@playwright/test';
export const W='E2EWarrior', P='E2EPriest', M='E2EMerchant', fighters=[W,P], names=[W,P,M];
export const quantity=(items:any[],id:string)=>items.reduce((n,item)=>n+(item?.name===id?item.q||1:0),0);
export const hunt=(s:any)=>s.monsterHunt||s.farmingProfiles?.[W]?.monsterHunt;
export async function observed(live:LiveGame):Promise<Record<string,any>> {
  return live.admin(`output=Object.fromEntries(${JSON.stringify(names)}.map(name=>{const p=get_player(name);return [name,{map:p.map,in:p.in,x:p.x,y:p.y,hp:p.hp,rip:!!p.rip,moving:!!p.moving,items:p.items,quest:p.s.monsterhunt||null}]}))`);
}
export async function killNativeCharacter(live:LiveGame,name:string) {
  // Native Rime Shatter disables stacked-hit sharing; ordinary monster attacks
  // can kill both overlapping fighters and accidentally consume two death counts.
  const fault=await live.admin(`output=(()=>{
    const p=get_player(${JSON.stringify(name)});if(!p||p.rip)throw Error('Death fault requires a living player');
    const peers=()=>Object.fromEntries(${JSON.stringify(names)}.filter(name=>name!==p.name).map(name=>{const peer=get_player(name);return [name,{hp:peer.hp,rip:!!peer.rip}]}));
    const beforePeers=peers(),m=new_monster(p.in,{type:'rimedjinn',position:[p.x,p.y],radius:0,count:1},{temp:1});
    m.e2eHunt=true;const at=Date.now();let attempts=0;
    try {
      while(!p.rip&&attempts<512){attempts++;const result=commence_attack(m,p,'rimeshatter');if(result?.failed)throw Error('Native death skill rejected: '+result.reason);}
      if(!p.rip)throw Error('Native Rime Shatter did not kill its target within 512 casts');
      return {name:p.name,rip:!!p.rip,hp:p.hp,attacker:String(m.id),skill:'rimeshatter',at,attempts,beforePeers,afterPeers:peers()};
    } finally {if(instances[m.in]?.monsters[m.id])remove_monster(m,{method:'disappear'});}
  })()`);
  expect(fault.afterPeers,'A single-character death fault must not damage or kill another fixture character').toEqual(fault.beforePeers);
  let receipts:{hit:unknown;death:unknown}|undefined;
  await expect.poll(async()=>{
    const events=await live.clients[name].events();
    const hit=events.find((e:any)=>e.at>=fault.at&&e.event==='hit'&&String(e.data?.hid)===fault.attacker&&e.data?.id===name&&e.data?.source==='rimeshatter'&&e.data?.damage>0);
    const death=events.find((e:any)=>e.at>=fault.at&&e.event==='player'&&e.data?.rip===true&&e.data?.hp===0);
    if(!hit||!death)return false;
    expect((hit.data?.stacked||[]).filter((id:string)=>id!==name),'Native death fault must not share damage with stacked peers').toEqual([]);
    receipts={hit,death};return true;
  },{timeout:15000,intervals:[100,250],message:'The native lethal attack must publish damage and death to its client'}).toBe(true);
  return {...fault,...receipts};
}
export async function evidence(live:LiveGame,info:TestInfo,label:string,detail:unknown={}) {
  await info.attach(label,{body:JSON.stringify({detail,server:await observed(live),coordinator:await live.state()},null,2),contentType:'application/json'});
}
export async function prepareHunt(live:LiveGame,id='armadillo',count=1) {
  await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
  await expect.poll(async()=>!!(await live.state(true)).monsterChoices?.find((m:any)=>m.id===id),{timeout:120000}).toBe(true);
  await live.admin(`output=${JSON.stringify(fighters)}.map(name=>{const p=get_player(name);p.s.monsterhunt={sn:region+' '+server_name,id:${JSON.stringify(id)},c:${count},ms:1800000};resend(p,'u+cid+reopen');return p.s.monsterhunt})`);
  await expect.poll(async()=>{
    const state=await live.state();
    return fighters.every(name=>state.characters[name]?.monsterHunt?.id===id&&state.characters[name]?.monsterHunt?.count===count);
  },{timeout:30000,message:'Both native quest observations must arrive before Hunt selects its owners'}).toBe(true);
  const state=await live.state(true),choice=state.monsterChoices.find((m:any)=>m.id===id);
  const location=choice.locations.find((l:any)=>l.map==='main')||choice.locations[0];
  expect(location).toBeTruthy();
  return {id,location,before:await observed(live)};
}
export async function beginHunt(live:LiveGame,setup:Awaited<ReturnType<typeof prepareHunt>>) {
  await live.post('/farming-mode',{character:W,mode:'hunt',backup:{monsterFocus:[setup.id],location:setup.location}});
}
export async function reward(live:LiveGame,before:Record<string,any>,timeout=240000) {
  await expect.poll(async()=>{
    const current=await observed(live);
    return fighters.every(name=>quantity(current[name].items,'monstertoken')===quantity(before[name].items,'monstertoken')+1);
  },{timeout,intervals:[250,500,1000],message:'Native quest kills and Daisy turn-in must yield exactly one real token for each owner'}).toBe(true);
  await live.post('/farming-mode',{character:W,mode:'default'});
}
export async function spawnGoo(live:LiveGame,name=W,observableCombatSeconds=0,ahead=0) {
  let seeded: any;
  const seed = async () => {
  // Native temp suppresses this encounter's respawn without changing species rules.
  // A newly introduced encounter is setup; no existing monster health or death is changed.
  // Native paths can split one straight corridor into short waypoints. Read the
  // already planned route to place the encounter ahead without needing a long
  // individual move packet or changing any route/character movement.
  const goal=ahead?await live.clients[name].run(`(()=>{
    const points=[{map:character.map,x:character.going_x,y:character.going_y},...(smart.plot||[])];
    return points.filter(p=>p.map===character.map&&!p.town&&!p.transport&&p.method!=='leave'&&can_move_to(p.x,p.y))
      .sort((a,b)=>Math.hypot(character.real_x-b.x,character.real_y-b.y)-Math.hypot(character.real_x-a.x,character.real_y-a.y))[0]||null;
  })()`):null;
  return live.admin(`output=(()=>{const p=get_player(${JSON.stringify(name)}),goal=${JSON.stringify(goal)},distance=goal?Math.hypot(goal.x-p.x,goal.y-p.y):0,ahead=${ahead}?Math.min(${ahead},distance-35):0;
    if(${ahead}&&(!p.moving||ahead<35))return null;
    const offsets=ahead?[[ahead*(goal.x-p.x)/distance,ahead*(goal.y-p.y)/distance]]:[[35,0],[-35,0],[0,35],[0,-35]];
    for(const [dx,dy] of offsets){const x=p.x+dx,y=p.y+dy;if(can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base})){const m=new_monster(p.in,{type:'goo',position:[x,y],radius:0,count:1},{temp:1});m.e2eHunt=true;${observableCombatSeconds ? `m.hp=m.max_hp=Math.ceil(${JSON.stringify(fighters)}.map(get_player).reduce((sum,p)=>sum+Math.max(1,p.attack)*Math.max(0.1,p.frequency),0)*${observableCombatSeconds});` : ''}return {id:m.id,map:m.map,x:m.x,y:m.y,hp:m.hp,ahead,origin:{x:p.x,y:p.y},observableCombatSeconds:${observableCombatSeconds}};}}throw Error('No reachable encounter seed')})()`);
  };
  if(!ahead)return seed();
  // A client walking sample can precede a Town step or the server's next move
  // packet. Seed atomically only when the server is also walking with room ahead.
  await expect.poll(async()=>!!(seeded=await seed()),{timeout:30_000,intervals:[100,250],
    message:'Introduce one passing encounter on an actual native walking leg'}).toBe(true);
  return seeded;
}
export async function killedByParty(live:LiveGame,id:string,timeout=45000,observations?:unknown[]) {
  let matched:{hit:unknown;death:unknown}|undefined;
  let sampledAt=0;
  await expect.poll(async()=>{
    // Keep polling observational and small. Copying both full player-event
    // ledgers through CDP repeatedly can delay the very admission traffic being
    // tested on a loaded runner. The complete ledgers remain final artifacts.
    const sample=!!observations&&Date.now()-sampledAt>=1000;
    if(sample)sampledAt=Date.now();
    const receipts=await Promise.all(fighters.map(async observer=>({observer,
      ...await live.clients[observer].frame.evaluate(({id,fighters,sample})=>{
        const events=(window as any).__e2eEvents||[];
        const game=window as any, runner=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
        const target=game.entities?.[id], c=game.character, shared=runner?.sharedRoutine;
        const candidate=sample&&shared?.getWalkingPassiveTarget?.(true);
        return {
          hit:events.find((e:any)=>e.event==='hit'&&String(e.data?.id)===id&&fighters.includes(String(e.data?.hid))),
          death:events.find((e:any)=>e.event==='death'&&String(e.data?.id)===id),
          ...(sample?{diagnostic:{at:Date.now(),id,position:{map:c.map,x:c.real_x,y:c.real_y,going_x:c.going_x,going_y:c.going_y,moving:c.moving,range:c.range},
            target:target&&{id:target.id,x:target.real_x??target.x,y:target.real_y??target.y,hp:target.hp,visible:target.visible,dead:target.dead,inRange:runner?.is_in_range?.(target)},
            candidate:candidate&&{id:candidate.id,mtype:candidate.mtype},combatOwner:runner?.__partyCombatOwner,
            attackState:runner?.partyCombatState&&{stage:runner.partyCombatState.stage,skippedAttack:runner.partyCombatState.skippedAttack,targetRejection:runner.partyCombatState.targetRejection,selectedTarget:runner.partyCombatState.selectedTarget},
            acknowledgement:runner?.partyQueueClient?.passingAcknowledgement?.(),
            encounters:Object.values(game.__partyPassingEncounters||{}).filter((e:any)=>String(e.id)===id),
            recentHandoffs:(runner?.__partyHandoffTrace||[]).slice(-6)}}:{}),
        };
      },{id,fighters,sample})})));
    if(sample&&observations){observations.push({id,clients:receipts.map(({observer,diagnostic})=>({observer,...diagnostic}))});if(observations.length>180)observations.shift();}
    const hitReceipt=receipts.find(receipt=>receipt.hit), deathReceipt=receipts.find(receipt=>receipt.death);
    const hit=hitReceipt&&{observer:hitReceipt.observer,...hitReceipt.hit};
    const death=deathReceipt&&{observer:deathReceipt.observer,...deathReceipt.death};
    if(!hit||!death)return false;
    matched={hit,death};return true;
  },{timeout,intervals:[200,500],message:`Native party attacks must kill encounter ${id}`}).toBe(true);
  expect(await live.admin(`output=Object.values(instances).some(i=>!!i.monsters?.[${JSON.stringify(id)}])`)).toBe(false);
  if(!matched)throw new Error(`Missing native kill evidence for ${id}`);
  return {monsterId:id,...matched,serverAbsent:true};
}
export async function seedCargo(live:LiveGame,name=W) {
  await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(name)});if(p.items[10])throw Error('Occupied seed slot');p.items[10]={name:'leather',q:7};cache_player_items(p);resend(p,'u+cid+reopen');return true})()`);
  await expect.poll(async()=>(await live.state()).characters[name]?.items?.[10]?.item?.q,{timeout:30000}).toBe(7);
  await live.post('/command',{character:name,type:'merchant-mark',slot:10,item:{name:'leather',q:7}});
}
export async function totalLeather(live:LiveGame):Promise<number> {
  return live.admin(`output=(async()=>{const ps=${JSON.stringify(names)}.map(get_player),owner=ps[0].owner,mounted=Object.values(players).find(p=>p.owner===owner&&p.user),user=await db.collection('user').findOne({_id:owner});const bank=mounted?mounted.user:user.info;const count=items=>items.reduce((n,i)=>n+(i?.name==='leather'?i.q||1:0),0);return ps.reduce((n,p)=>n+count(p.items),0)+Object.entries(bank).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v)).reduce((n,[k,v])=>n+count(v),0)})()`);
}
