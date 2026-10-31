import {test,expect} from './live-fixtures';
import {waitForGameplay} from './network-clock';
import {W,P} from './hunt-interruption-helpers';
import {contains} from '../dashboard/lib/farming-zones';
import {farmingAreas} from '../dashboard/lib/farming-areas';

// The live farm from 2026-10-25 00:21-00:28 UTC: 4 deaths in 7 minutes on uhills
// targetrons with a designated tank, while Ryan's base farms them without one. This spec
// farms the native uhills spawns for FARM_MS and records deaths, the peak count of monsters
// targeting the party, and the uhills packs' growth: targetron and sparkbot packs have
// grow:true, so kills respawn in 25 ms below 2/3 of count, add two temp monsters below
// half of count, and monsters level up (node/server.js).
// E2E_TANK picks the designated tank: warrior, priest, or unset; Ryan's base has no tank
// field and ignores it. E2E_LOADOUT=live-party seeds the live party's equipment and levels.
const B='E2EBankBoi',fighters=[W,P,B],FARM_MS=Number(process.env.E2E_FARM_MS)||420000;
const tank=({warrior:W,priest:P} as Record<string,string>)[process.env.E2E_TANK||'']||null;
test.use({loadout:(process.env.E2E_LOADOUT||'combat-range') as 'combat-range',extraFighter:'mage',initialPosition:{map:'uhills',x:-225,y:-207}});

test(`uhills targetron farm with tank ${tank||'unset'}`,async({live},info)=>{
  test.setTimeout(FARM_MS+240000);
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',tank?{leader:W,tank}:{leader:W});
  // E2E_PULL=1 turns on pull mode (fork tank layer only; Ryan's base ignores it).
  if(process.env.E2E_PULL)await live.post('/formation',{pullMode:true});
  for(const name of [P,B])await live.post('/formation',{character:name,follow:true});
  await live.post('/farming-mode',{character:W,mode:'default'});
  // The live party farmed the targetron area at uhills (-544,-257).
  const area=farmingAreas((await live.state(true)).monsterChoices,['targetron'])
    .find(candidate=>candidate.map==='uhills'&&contains(candidate,{map:'uhills',x:-544,y:-257},0,1));
  expect(area,'Native catalog must contain the live Targetron farm').toBeTruthy();
  await live.post('/navigate-to-monster',{monsterId:'targetron',location:area});
  await live.post('/focus',{monsterFocus:['targetron'],monsterPriorities:{},monsterSearchRadius:500});
  const stats=await live.admin(`output=${JSON.stringify(fighters)}.map(n=>{const p=get_player(n);return {name:n,level:p.level,max_hp:p.max_hp,armor:p.armor,resistance:p.resistance,attack:p.attack,range:p.range,
    slots:Object.fromEntries(Object.entries(p.slots).filter(([,v])=>v).map(([k,v])=>[k,v.name+'+'+(v.level||0)]))};})`);
  await info.attach('party-stats',{body:JSON.stringify(stats),contentType:'application/json'});
  const samples:any[]=[],deaths:any[]=[],wasDead:Record<string,boolean>={};
  let peak=0,minHp=1,packs:any=null;
  try{
    const end=Date.now()+FARM_MS;
    while(Date.now()<end){
      const world=await live.admin(`output=(()=>{const names=${JSON.stringify(fighters)};
        const ps=names.map(n=>get_player(n)).filter(Boolean),all=Object.values(instances.uhills.monsters).filter(m=>!m.dead);
        const ms=all.filter(m=>names.includes(m.target));
        return {serverLive:!!server.live,packs:(G.maps.uhills.monsters||[]).map(d=>({type:d.type,count:d.count,live:d.live,grow:!!d.grow})),
          players:ps.map(p=>({name:p.name,x:Math.round(p.x),y:Math.round(p.y),hp:p.hp,max_hp:p.max_hp,rip:!!p.rip})),
          attackers:ms.map(m=>({id:String(m.id),mtype:m.type,level:m.level,target:m.target})),
          levels:all.reduce((h,m)=>(h[m.type+':'+m.level]=(h[m.type+':'+m.level]||0)+1,h),{}),monsters:all.length};})()`);
      packs=world.packs;
      peak=Math.max(peak,world.attackers.length);
      for(const p of world.players)if(!p.rip)minHp=Math.min(minHp,p.hp/p.max_hp);
      for(const p of world.players){if(p.rip&&!wasDead[p.name])deaths.push({at:Date.now(),name:p.name,
        attackers:world.attackers.filter((a:any)=>a.target===p.name).map((a:any)=>a.mtype+':'+a.level)});wasDead[p.name]=p.rip;}
      samples.push({at:Date.now(),...world});
      await waitForGameplay(2000);
    }
  }finally{
    const last=samples.at(-1);
    const summary={tank,loadout:process.env.E2E_LOADOUT||'combat-range',deaths:deaths.length,peakAttackers:peak,minHp:Math.round(minHp*100)/100,
      serverLive:last?.serverLive,packs,firstLevels:samples[0]?.levels,lastLevels:last?.levels,maxMonsters:Math.max(0,...samples.map(s=>s.monsters)),deathLog:deaths,
      attackerHistogram:samples.reduce((h:Record<number,number>,s)=>(h[s.attackers.length]=(h[s.attackers.length]||0)+1,h),{})};
    console.log('FARM-SUMMARY '+JSON.stringify(summary));
    await info.attach('targetron-farm-summary',{body:JSON.stringify(summary),contentType:'application/json'});
    await info.attach('targetron-farm-samples',{body:JSON.stringify(samples),contentType:'application/json'});
  }
  expect(samples.length).toBeGreaterThan(10);
});
