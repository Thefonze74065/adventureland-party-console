import {test,expect} from './live-fixtures';
import {farmingAreas} from '../dashboard/lib/farming-areas';

const W='E2EWarrior',P='E2EPriest';
// The leader is in main while the follower fights a live event boss in halloween.
test.use({initialPositions:{[W]:{map:'main',x:0,y:0},[P]:{map:'halloween',x:-495,y:600}}});
test('a follower fighting a live event boss a map away does not hold the leader in travel defense',async({live},info)=>{
  test.setTimeout(420_000);
  const seed=await live.admin(`output=(()=>{const original=G.monsters.mrpumpkin;
    globalThis.__defenseOriginalPumpkin=original;
    G.monsters.mrpumpkin={...original,hp:100000000,attack:1,speed:0,charge:0,range:400,aggro:1,spawns:[]};
    const p=get_player('${P}');
    const m=new_monster('halloween',{type:'mrpumpkin',count:1,boundary:[p.x+40,p.y,p.x+40,p.y]},{temp:1});
    E.mrpumpkin={live:true,id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();
    target_player(m,p);
    return {id:String(m.id),map:m.map,x:m.x,y:m.y};
  })()`);
  const samples:any[]=[];
  try{
    await expect.poll(async()=>{
      const s=await live.state(),leader=s.characters[W],follower=s.characters[P],now=Date.now();
      // Attacker and LIVE-feed publication are independent. Establish both
      // before asking the coordinator to classify this remote event fight.
      return [leader,follower].every(c=>c&&now-c.seenAt<=3000&&c.seenAt<=now+500)&&
        !!leader.server&&leader.server===follower.server&&leader.map!==follower.map&&
        follower.serverLiveEvents?.some((event:any)=>event.name==='mrpumpkin')&&
        follower.groupedCombat?.currentAttackers?.some((t:any)=>String(t.id)===seed.id&&t.mtype==='mrpumpkin'&&t.target===P);
    },{timeout:60_000,message:'Fresh reports must establish the seeded attacker as a live event boss on another map'}).toBe(true);
    await live.post('/formation',{leader:W});
    await live.post('/formation',{character:P,follow:true});
    const choices=(await live.state(true)).monsterChoices;
    const area=farmingAreas(choices,['crab']).find((a:any)=>a.map==='main')||farmingAreas(choices,['bee']).find((a:any)=>a.map==='main');
    expect(area).toBeTruthy();
    await live.post('/navigate-to-monster',{monsterId:area!.monsterIds[0],location:area});
    const deadline=Date.now()+60_000;
    while(Date.now()<deadline){
      const s=await live.state(),c=s.activeConvoy;
      samples.push({at:Date.now(),convoy:c&&{id:c.id,phase:c.phase,participants:c.participants,defenseReason:c.defenseReason},
        leader:{map:s.characters[W]?.map,x:s.characters[W]?.x,y:s.characters[W]?.y},follower:{map:s.characters[P]?.map},
        reports:[W,P].map(name=>({name,seenAt:s.characters[name]?.seenAt,server:s.characters[name]?.server,
          live:s.characters[name]?.serverLiveEvents,attackers:s.characters[name]?.groupedCombat?.currentAttackers}))});
      if(samples.length>120)samples.splice(1,1);
      expect(c?.phase,'The leader must not be held in defense for a fight a map away').not.toBe('defending');
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    expect(samples.some(sample=>sample.convoy?.participants?.includes(W))).toBe(true);
  }finally{
    await info.attach('convoy-event-defense',{body:JSON.stringify({seed,samples,state:await live.state()}),contentType:'application/json'});
    await live.admin(`output=(()=>{const m=get_monster('mrpumpkin');if(String(m?.id)===${JSON.stringify(seed.id)})remove_monster(m,{silent:true});
      if(globalThis.__defenseOriginalPumpkin)G.monsters.mrpumpkin=globalThis.__defenseOriginalPumpkin;delete globalThis.__defenseOriginalPumpkin;delete E.mrpumpkin;broadcast_e();return true;})()`);
  }
});
