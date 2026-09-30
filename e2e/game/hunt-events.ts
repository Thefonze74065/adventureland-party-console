import type { LiveGame } from '../live-fixtures';
import { expect } from '../live-fixtures';

export const W='E2EWarrior', P='E2EPriest', M='E2EMerchant';
export const quantity=(items:any[],id:string)=>items.reduce((n,item)=>n+(item?.name===id?item.q||1:0),0);
export async function world(live:LiveGame) {
  return live.admin(`output={anniversary:E.anniversary||null,players:Object.fromEntries(${JSON.stringify([W,P,M])}.map(name=>{const p=get_player(name);return [name,{map:p.map,x:p.x,y:p.y,moving:!!p.moving,hp:p.hp,items:p.items,gold:p.gold,xp:p.xp,quest:p.s.monsterhunt||null,conditions:p.s}]}))}`);
}
export async function prepareHunt(live:LiveGame) {
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  await expect.poll(async()=>(await live.state(true)).monsterChoices?.some((m:any)=>m.id==='goo'),{timeout:120_000}).toBe(true);
  const location=(await live.state(true)).monsterChoices.find((m:any)=>m.id==='goo').locations.find((l:any)=>l.map==='main');
  await live.admin(`output=${JSON.stringify([W,P])}.map(name=>{const p=get_player(name);p.s.monsterhunt={sn:region+' '+server_name,id:'goo',c:500,ms:1800000};resend(p,'u+cid+reopen');return p.s.monsterhunt})`);
  await expect.poll(async()=>(await live.state()).characters[W]?.monsterHunt?.count,{timeout:20_000}).toBe(500);
  await live.post('/farming-mode',{character:W,mode:'hunt',backup:{monsterFocus:['goo'],location}});
  await expect.poll(async()=>(await live.state()).monsterHunt?.cycleId,{timeout:30_000}).toBeTruthy();
  return {cycleId:(await live.state()).monsterHunt.cycleId,location};
}
/** Real upstream rule factory; only its initial scheduling clock/selection seed is controlled. */
export async function beginAnniversary(live:LiveGame,host=P) {
  return live.admin(`output=(()=>{
    if(events.anniversary)throw Error('Anniversary already active');
    const interval=anniversary_rules.INTERVAL;
    const offset=Math.ceil(Date.now()/interval)*interval-Date.now()+100;
    let first=true;
    anniversary_controller=anniversary_rules.createEvent({
      now:()=>{const now=Date.now()+offset;if(first){first=false;return now-interval;}return now;},
      random:()=>0,players:()=>Object.values(players).sort((a,b)=>Number(b.name===${JSON.stringify(host)})-Number(a.name===${JSON.stringify(host)})),
      active:anniversary_is_active,reachable:anniversary_reachable,realm:region+' '+server_name,homeRealm:region+server_name,
      addCondition:add_condition,resend,distance
    });
    events.anniversary=true;anniversary_tick();broadcast_e();
    return {seed:'upstream createEvent with initial round boundary and deterministic eligible-player order',clockOffset:offset,round:E.anniversary};
  })()`);
}
export async function endAnniversary(live:LiveGame) {
  await live.admin(`events.anniversary=false;anniversary_tick();anniversary_controller=null;broadcast_e();output=true`);
}
/** Native monster creation with explicit initial difficulty; never seed death or loot. */
export async function spawnRare(live:LiveGame,type:string,hp=12000) {
  return live.admin(`output=(()=>{
    const p=get_player(${JSON.stringify(W)}),type=${JSON.stringify(type)},original=G.monsters[type];
    globalThis.__e2eHuntRareOriginal ||= {};if(globalThis.__e2eHuntRareOriginal[type])throw Error('Duplicate seeded rare');
    globalThis.__e2eHuntRareOriginal[type]=original;
    // Tiny P's native self-healing makes inflated HP a different combat task on
    // slower clients. Keep its real HP; socket hit receipts prove even short fights.
    const requestedHp=type==='tinyp'?original.hp:${hp},observableCombatSeconds=type==='tinyp'?0:5;
    const partyDps=${JSON.stringify([W,P])}.reduce((total,name)=>{const fighter=get_player(name);return total+fighter.attack*fighter.frequency;},0);
    const initialHp=Math.max(requestedHp,Math.ceil(partyDps*observableCombatSeconds));
    try {
      G.monsters[type]={...original,hp:initialHp,attack:1,speed:1,charge:1,aggro:0,range:1};
      let point;for(let i=0;i<16;i++){const a=i*Math.PI/8,x=p.x+90*Math.cos(a),y=p.y+90*Math.sin(a);if(can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base})){point={x,y};break;}}
      if(!point)throw Error('No native reachable encounter point');
      const monster=new_monster(p.in,{type,count:1,boundary:[point.x,point.y,point.x+1,point.y+1]},{temp:1});
      // Native recalculation reads zone_stats before the global definition.
      // Bound this workflow's initial difficulty without changing other bees or
      // fabricating an attack outcome; native 99.9% avoidance is a separate gap.
      if(type==='cutebee') {monster.zone_stats={...G.monsters[type],avoidance:0};calculate_monster_stats(monster);}
      monster.drops=[[1000000,'gem0',1]];monster.e2eHunt=true;return {id:monster.id,type,map:monster.map,x:monster.x,y:monster.y,requestedHp,partyDps,observableCombatSeconds,initialHp:monster.hp,originalHp:original.hp,originalAvoidance:original.avoidance||0,initialAvoidance:monster.avoidance||0,instanceDifficulty:!!monster.zone_stats,originalRespawn:original.respawn,temporary:!!monster.temp,initialDrops:monster.drops};
    } finally {
      G.monsters[type]=original;
      delete globalThis.__e2eHuntRareOriginal[type];
    }
  })()`);
}
export async function cleanupEvents(live:LiveGame) {
  await endAnniversary(live);
  await live.admin(`output=(()=>{for(const instance of Object.values(instances))for(const monster of Object.values(instance.monsters||{}))if(monster.type==='fieldgen0'&&monster.owner===${JSON.stringify(W)})remove_monster(monster,{silent:true});return true})()`);
  await live.admin(`output=(()=>{
    for(const instance of Object.values(instances))for(const monster of Object.values(instance.monsters||{}))if(monster.e2eHunt)remove_monster(monster,{silent:true});
    // Legacy crash recovery only: new setup restores the definition synchronously.
    for(const [type,definition] of Object.entries(globalThis.__e2eHuntRareOriginal||{})) {
      for(const key of Object.keys(G.monsters[type]))if(!Object.hasOwn(definition,key))delete G.monsters[type][key];
      Object.assign(G.monsters[type],definition);
    }
    delete globalThis.__e2eHuntRareOriginal;return true;
  })()`);
}
