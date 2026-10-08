import {test,expect} from './live-fixtures';
import {W,P,hunt,observed,prepareHunt,beginHunt,reward,spawnGoo,killedByParty,evidence,quantity,killNativeCharacter} from './hunt-interruption-helpers';

test.describe('native Hunt travel combat and death ownership',()=>{
  test.setTimeout(480000);
  test('armadillo Hunt kills passing goos outbound and returning before claiming Daisy',async({live},info)=>{
    const setup=await prepareHunt(live);
    await live.post('/rare-hunting',{rules:{goo:{enabled:true,keepMoving:true,priority:100}},useFieldGenerators:false});
    await beginHunt(live,setup);
    await expect.poll(async()=>{
      const s=await live.state();
      return hunt(s)?.stage==='mission-travel'&&s.activeConvoy?.phase==='travel'&&
        await live.clients[W].run('!!character.moving && !(character.c && character.c.town)');
    },{timeout:90000,intervals:[100,250],message:'Introduce the outbound Goo during native walking, after any Town cast'}).toBe(true);
    // Seed ahead on the actual walking leg so native visibility and the party's
    // reservation exchange can precede reaching melee range on slower hosts.
    const outbound=await spawnGoo(live,W,0,400);
    await info.attach('outbound-passing-goo-seed',{body:JSON.stringify(outbound),contentType:'application/json'});
    const outboundKill=await killedByParty(live,String(outbound.id));
    expect((await observed(live))[W].quest?.id).toBe('armadillo');
    await evidence(live,info,'outbound-passing-goo-killed',{outbound,outboundKill});
    await expect.poll(async()=>{const p=(await observed(live))[W];return p.quest?.id==='armadillo'&&p.quest.c===0;},{timeout:240000,intervals:[100,250]}).toBe(true);
    await expect.poll(async()=>{
      const s=await live.state();
      return hunt(s)?.stage==='returning'&&s.activeConvoy?.phase==='travel'&&
        await live.clients[W].run('!!character.moving && !(character.c && character.c.town)');
    },{timeout:90000,intervals:[100,250],message:'Introduce the return Goo during native walking, after any Town cast'}).toBe(true);
    const returning=await spawnGoo(live,W,0,400);
    await info.attach('returning-passing-goo-seed',{body:JSON.stringify(returning),contentType:'application/json'});
    const returningKill=await killedByParty(live,String(returning.id));
    await reward(live,setup.before);
    await evidence(live,info,'armadillo-return-goo-and-daisy-reward',{outbound,outboundKill,returning,returningKill});
  });

  test('fighter death during Hunt releases the failed mission and recovers with native respawn',async({live},info)=>{
    const setup=await prepareHunt(live,'goo',30);
    await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(P)});p.s.monsterhunt={sn:region+' '+server_name,id:'armadillo',c:2,ms:1800000};resend(p,'u+cid+reopen');return true})()`);
    await expect.poll(async()=>(await live.state()).characters[P]?.monsterHunt?.id,{timeout:30000}).toBe('armadillo');
    await beginHunt(live,setup);
    await expect.poll(async()=>hunt(await live.state())?.stage,{timeout:90000}).toBe('farming');
    const cycle=hunt(await live.state()).cycleId;
    const death=await killNativeCharacter(live,W);
    await expect.poll(async()=>(await observed(live))[W].rip,{timeout:15000}).toBe(true);
    await expect.poll(async()=>{const p=(await observed(live))[W];return !p.rip&&p.hp>0;},{timeout:120000}).toBe(true);
    await expect.poll(async()=>{const h=hunt(await live.state());return h?.owner===P&&h.target==='armadillo';},{timeout:150000,message:'Failed leader quest must yield to the eligible follower quest'}).toBe(true);
    await expect.poll(async()=>quantity((await observed(live))[P].items,'monstertoken'),{timeout:240000}).toBe(quantity(setup.before[P].items,'monstertoken')+1);
    await live.post('/farming-mode',{character:W,mode:'default'});
    await evidence(live,info,'hunt-fighter-death-native-recovery',{cycle,death});
  });

  test('stop-required passive Goo combat resumes the original armadillo Hunt after the actual kill',async({live},info)=>{
    const setup=await prepareHunt(live);
    await beginHunt(live,setup);
    await expect.poll(async()=>{const s=await live.state();return hunt(s)?.stage==='mission-travel'&&s.activeConvoy?.phase==='travel';},{timeout:90000,intervals:[100,250]}).toBe(true);
    // Initial encounter HP keeps the native fight observable across a coordinator sample.
    const cycle=hunt(await live.state()).cycleId,encounter=await spawnGoo(live,W,5);
    await live.post('/rare-hunting',{rules:{goo:{enabled:true,keepMoving:false,priority:100}},useFieldGenerators:false});
    await expect.poll(async()=>{
      const s=await live.state(),c=s.activeConvoy;
      return c?.phase==='defending'&&c.huntTravel?.committed?.some((m:any)=>String(m.id)===String(encounter.id));
    },{timeout:30000,intervals:[100,200],message:'The configured neutral Goo must actually stop the owned Hunt route'}).toBe(true);
    await evidence(live,info,'passive-stop-owned-native-encounter',{cycle,encounter});
    // Re-enabling passing attacks must not abandon a fight already committed by the party.
    await live.post('/rare-hunting',{rules:{goo:{enabled:true,keepMoving:true,priority:100}},useFieldGenerators:false});
    const committed=(await live.state()).activeConvoy;
    expect(committed.phase).toBe('defending');
    expect(committed.huntTravel.committed.some((m:any)=>String(m.id)===String(encounter.id))).toBe(true);
    const kill=await killedByParty(live,String(encounter.id));
    const resumed=hunt(await live.state());
    expect(resumed.cycleId).toBe(cycle);expect(resumed.target).toBe('armadillo');
    await reward(live,setup.before);
    await evidence(live,info,'passive-stop-native-kill-and-hunt-handback',{cycle,encounter,kill});
  });
});
