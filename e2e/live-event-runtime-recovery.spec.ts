import {test,expect} from './live-fixtures';

const W='E2EWarrior',P='E2EPriest',fighters=[W,P];
test.use({initialPosition:{map:'halloween',x:-550,y:-290}});

test('native event walking recovers owned CODE turnover after coordinator restart',async({live},info)=>{
  test.setTimeout(360_000);
  await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
  const seed=await live.admin(`output=(()=>{
    const type='mrpumpkin',original=G.monsters[type],dps=${JSON.stringify(fighters)}.reduce((n,name)=>{const p=get_player(name);return n+p.attack*p.frequency;},0);
    try{G.monsters[type]={...original,hp:Math.ceil(dps*600),attack:1,speed:0,charge:0,range:1,aggro:0,spawns:[]};
      const m=new_monster('halloween',{type,count:1,boundary:[-495,685,-495,685]},{temp:1});m.e2eRuntimeRecovery=true;
      E[type]={live:true,map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();return {id:m.id,map:m.map,x:m.x,y:m.y};
    }finally{G.monsters[type]=original;}})()`);
  let before:any,failed:any,recovered:any;
  try{
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
    await expect.poll(async()=>{const s=await live.state(),c=s.activeConvoy;
      if(c?.walkingActivity==='event'&&c.walkingEvent==='mrpumpkin'&&c.phase==='travel'){before=s;return true;}return false;
    },{timeout:90_000}).toBe(true);
    // Actual upstream CODE iframe replacement, with the same maintained loader.
    await live.clients[P].frame.evaluate(()=>{
      const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      game.start_runner('maincode',`$.getScript(${JSON.stringify(runner.__partyServer+'/CODE/adventure_land/universal-loader.js')});`);
    });
    await expect.poll(async()=>{const s=await live.state();
      if(s.activeConvoy?.id===before.activeConvoy.id&&s.activeConvoy.phase==='failed'&&s.activeConvoy.failureCode==='runtime-lost'){failed=s;return true;}return false;
    },{timeout:30_000}).toBe(true);
    await live.restartCoordinator();
    await expect.poll(async()=>{const s=await live.state(),c=s.activeConvoy;
      if(c?.id!==before.activeConvoy.id&&c?.walkingEvent==='mrpumpkin'&&
        c.runtimes?.[P]&&c.runtimes[P]!==before.activeConvoy.runtimes[P]&&
        c.runtimes?.[W]===before.activeConvoy.runtimes[W]){recovered=s;return true;}return false;
    },{timeout:60_000}).toBe(true);
    expect(recovered.activeConvoy.recoveryAttempts||0).toBeGreaterThanOrEqual(failed.activeConvoy.recoveryAttempts||0);
    await expect.poll(async()=>{const events=await live.clients[W].events();return events.some((e:any)=>e.event==='hit'&&String(e.data?.id)===String(seed.id)&&fighters.includes(e.data?.hid));},{timeout:120_000}).toBe(true);
  }finally{
    await info.attach('native-event-runtime-turnover',{body:JSON.stringify({seed,before,failed,recovered,final:await live.state(),events:await live.clients[W].events()}),contentType:'application/json'});
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.admin(`output=(()=>{const m=get_monster('mrpumpkin');if(m?.e2eRuntimeRecovery)remove_monster(m,{silent:true});delete E.mrpumpkin;broadcast_e();return true;})()`);
  }
});

test.describe('visible event boss separated by native terrain',()=>{
  test.use({initialPosition:{map:'halloween',x:-200,y:460}});
  test('native event route retains ownership until the visible boss is attack reachable',async({live},info)=>{
    test.setTimeout(240_000);
    await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
    const seed=await live.admin(`output=(()=>{
      const original=G.monsters.mrpumpkin;
      try{G.monsters.mrpumpkin={...original,hp:10000000,attack:1,speed:0,charge:0,range:1,aggro:0,spawns:[]};
        const m=new_monster('halloween',{type:'mrpumpkin',count:1,boundary:[-534,763,-534,763]},{temp:1});m.e2eTerrainApproach=true;
        E.mrpumpkin={live:true,map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();return {id:m.id,map:m.map,x:m.x,y:m.y};
      }finally{G.monsters.mrpumpkin=original;}})()`);
    let baseline:any,walk:any;
    try{
      await expect.poll(async()=>live.clients[W].frame.evaluate((id)=>!!(window as any).entities[id],String(seed.id)),{timeout:20_000}).toBe(true);
      baseline=await live.clients[W].frame.evaluate((id)=>{
        const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any,m=game.entities[id];
        return {visible:!!m,position:{map:game.character.map,x:game.character.x,y:game.character.y},boss:{x:m.x,y:m.y},direct:runner.can_move_to(m.x,m.y),inRange:runner.is_in_range(m)};
      },String(seed.id));
      expect(baseline.visible).toBe(true);expect(baseline.direct).toBe(false);expect(baseline.inRange).toBe(false);
      await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
      await expect.poll(async()=>{const s=await live.state();if(s.activeConvoy?.walkingEvent==='mrpumpkin'){walk=s;return true;}return false;},{timeout:30_000}).toBe(true);
      await expect.poll(async()=>{const events=await live.clients[W].events();return events.some((e:any)=>e.event==='hit'&&String(e.data?.id)===String(seed.id)&&fighters.includes(e.data?.hid));},{timeout:150_000}).toBe(true);
    }finally{
      await info.attach('native-visible-boss-terrain-approach',{body:JSON.stringify({seed,baseline,walk,final:await live.state(),events:await live.clients[W].events()}),contentType:'application/json'});
      await live.post('/formation',{character:W,eventSelections:[]});
      await live.admin(`output=(()=>{const m=get_monster('mrpumpkin');if(m?.e2eTerrainApproach)remove_monster(m,{silent:true});delete E.mrpumpkin;broadcast_e();return true;})()`);
    }
  });
});
