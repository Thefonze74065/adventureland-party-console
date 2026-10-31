import {test,expect} from './live-fixtures';
import {waitForGameplay} from './network-clock';
import {W,P} from './hunt-interruption-helpers';
import {contains} from '../dashboard/lib/farming-zones';
import {farmingAreas} from '../dashboard/lib/farming-areas';

// Pull mode on the uhills targetron farm: "if the party has a ranged class like a mage,
// priest or ranger, then they attack first to draw the monster to the party, then the
// tank holds them away so it doesn't create these swarms." Declared inputs: the map's
// monsters are replaced by four targetrons at the four natural targetron spawns nearest
// each other, with 15000 HP and 20 attack so fights finish inside the observation.
// The party must fight them one at a time, and no member may stand inside an idle
// targetron's aggro check (AGGRO_REACH in runtime/combat/pulling.ts).
const B='E2EBankBoi',fighters=[W,P,B],AGGRO_REACH=96,FARM_MS=240000;
test.use({loadout:'combat-range',extraFighter:'mage',initialPosition:{map:'uhills',x:-225,y:-207}});

test('pull mode fights a uhills targetron pack one at a time from outside its aggro reach',async({live},info)=>{
  test.setTimeout(FARM_MS+240000);
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',{leader:W,tank:W,pullMode:true});
  for(const name of [P,B])await live.post('/formation',{character:name,follow:true});
  await expect.poll(async()=>(await live.state()).pullMode).toBe(true);
  const pack=await live.admin(`output=(()=>{
    const natural=Object.values(instances.uhills.monsters).filter(m=>m.type==='targetron').map(m=>({x:m.x,y:m.y}));
    if(natural.length<4)throw Error('Expected four natural targetrons, found '+natural.length);
    const spread=set=>Math.max(...set.flatMap(a=>set.map(b=>Math.hypot(a.x-b.x,a.y-b.y))));
    let best=null;for(const seed of natural){const set=natural.slice().sort((a,b)=>Math.hypot(a.x-seed.x,a.y-seed.y)-Math.hypot(b.x-seed.x,b.y-seed.y)).slice(0,4);
      if(!best||spread(set)<spread(best))best=set;}
    globalThis.__e2ePullRespawns=[];
    for(let i=monster_respawns.length-1;i>=0;i--)if(monster_respawns[i][0]?.map==='uhills')__e2ePullRespawns.push(monster_respawns.splice(i,1)[0]);
    for(const m of Object.values(instances.uhills.monsters))remove_monster(m,{method:'disappear',nospawn:true});
    return best.map(p=>{const m=new_monster('uhills',{type:'targetron',count:1,position:[p.x,p.y],radius:0},{temp:1});
      m.hp=m.max_hp=15000;m.attack=20;return {id:String(m.id),x:m.x,y:m.y};});})()`);
  await info.attach('targetron-pack',{body:JSON.stringify(pack),contentType:'application/json'});
  // The party arrives by the farm convoy, whose destination is the area's center inside
  // the pack: pull mode must hand the travel off on sight and stage outside the pack.
  const area=farmingAreas((await live.state(true)).monsterChoices,['targetron'])
    .find(candidate=>candidate.map==='uhills'&&contains(candidate,{map:'uhills',x:-544,y:-257},0,1));
  expect(area).toBeTruthy();
  await live.post('/farming-mode',{character:W,mode:'default'});
  await live.post('/navigate-to-monster',{monsterId:'targetron',location:area});
  await live.post('/focus',{monsterFocus:['targetron'],monsterPriorities:{},monsterSearchRadius:600});
  const samples:any[]=[];let peak=0;const breaches:any[]=[];
  try{
    const end=Date.now()+FARM_MS;
    while(Date.now()<end){
      const world=await live.admin(`output=(()=>{const names=${JSON.stringify(fighters)},ids=${JSON.stringify(pack.map((m:any)=>m.id))};
        const ps=names.map(get_player),ms=ids.map(id=>instances.uhills.monsters[id]).filter(m=>m&&!m.dead);
        return {players:ps.map(p=>({name:p.name,x:Math.round(p.x),y:Math.round(p.y),hp:p.hp,rip:!!p.rip})),
          monsters:ms.map(m=>({id:String(m.id),x:Math.round(m.x),y:Math.round(m.y),target:m.target||null}))};})()`);
      const attackers=world.monsters.filter((m:any)=>fighters.includes(m.target));
      peak=Math.max(peak,attackers.length);
      for(const m of world.monsters.filter((m:any)=>!m.target))for(const p of world.players)
        if(!p.rip&&Math.hypot(p.x-m.x,p.y-m.y)<=AGGRO_REACH)breaches.push({at:Date.now(),player:p.name,monster:m.id,distance:Math.round(Math.hypot(p.x-m.x,p.y-m.y))});
      const modes=await Promise.all(fighters.map(name=>live.clients[name].run(`(()=>{const p=globalThis.partyCombatPosition||{};
        return {mode:p.mode||null,reason:p.reason||null,pull:!!sharedRoutine.pullModeActive?.(),grouped:!!sharedRoutine.usesGroupedCombat?.(),range:character.range};})()`).catch(()=>null)));
      samples.push({at:Date.now(),modes,...world});
      if(!world.monsters.length)break;
      await waitForGameplay(2000);
    }
  }finally{
    await info.attach('targetron-pull-samples',{body:JSON.stringify({peak,breaches,samples}),contentType:'application/json'});
    await live.admin(`output=(()=>{for(const m of Object.values(instances.uhills.monsters))remove_monster(m,{method:'disappear',nospawn:true});
      monster_respawns.push(...(globalThis.__e2ePullRespawns||[]));delete globalThis.__e2ePullRespawns;return true;})()`).catch(()=>{});
  }
  // The puller stands inside its own pull target's reach to hit it: a breach of the monster
  // that targets the party within 6 s afterwards is that pull, not a walk into the pack.
  const pulled=(b:any)=>samples.some(s=>s.at>=b.at&&s.at<=b.at+6000&&s.monsters.some((m:any)=>m.id===b.monster&&fighters.includes(m.target)));
  const strays=breaches.filter(b=>!pulled(b));
  const killed=pack.length-samples.at(-1).monsters.length;
  console.log('PULL-SUMMARY '+JSON.stringify({killed,peak,breaches:strays.length,pullBreaches:breaches.length-strays.length}));
  expect(killed,'The party must kill at least two pulled targetrons').toBeGreaterThanOrEqual(2);
  expect(peak,'Never more than one targetron on the party at once').toBeLessThanOrEqual(1);
  expect(strays,'No member inside an idle targetron aggro check').toEqual([]);
  for(const name of fighters)expect(await live.clients[name].run('character.rip')).toBeFalsy();
});
