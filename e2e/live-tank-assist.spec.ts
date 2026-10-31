import {test,expect} from './live-fixtures';
import {waitForGameplay} from './network-clock';
import {W,P} from './hunt-interruption-helpers';

// On 2026-10-25 00:18 UTC a live party (priest tank, warrior leader, mage) on uhills
// targetrons had the priest fighting while the warrior and mage stood still nearby. Any
// class can be the designated tank, so each case puts one class on tank at the live
// priest's spot and the other two at the live warrior's and mage's spots. The
// Targetron spawns idle beside the tank, and the other two fighters
// must land native hits on it within ASSIST_MS of the first party hit.
const B='E2EBankBoi',fighters=[W,P,B],ASSIST_MS=20000;
const spots=[{x:297,y:-269},{x:282,y:-457},{x:435,y:-607}],spawn={x:360,y:-250};

for(const [label,tank] of [['warrior',W],['priest',P],['mage',B]] as const)test.describe(`${label} tank`,()=>{
  const others=fighters.filter(name=>name!==tank);
  test.use({loadout:'combat-range',extraFighter:'mage',initialPositions:{
    [tank]:{map:'uhills',...spots[0]},[others[0]]:{map:'uhills',...spots[1]},[others[1]]:{map:'uhills',...spots[2]},
    E2EMerchant:{map:'main',x:-63,y:100}}});
  test(`the party assists a ${label} designated tank on its Targetron`,async({live},info)=>{
    test.setTimeout(240000);
    await live.post('/merchant/force-stand',{enabled:true});
    await live.post('/focus',{monsterFocus:[]});
    const isolated=await live.admin(`output=(()=>{
      globalThis.__e2eAssistRespawns=[];
      for(let i=monster_respawns.length-1;i>=0;i--)if(monster_respawns[i][0]?.map==='uhills')
        __e2eAssistRespawns.push(monster_respawns.splice(i,1)[0]);
      const removed=[];for(const m of Object.values(instances.uhills.monsters)){
        removed.push(String(m.id));remove_monster(m,{method:'disappear',nospawn:true});
      }return {removed};})()`);
    let seed:any;const samples:any[]=[],events:Record<string,any[]>={},seen:Record<string,number>={};
    try{
      await expect.poll(async()=>Promise.all(fighters.map(name=>live.clients[name].run(
        `${JSON.stringify(isolated.removed)}.filter(id=>parent.entities[id]&&!parent.entities[id].dead).length`))),
        {timeout:15000}).toEqual([0,0,0]);
      await live.post('/formation',{leader:W,tank});
      for(const name of [P,B])await live.post('/formation',{character:name,follow:true});
      await expect.poll(async()=>(await live.state()).designatedTank).toBe(tank);
      await expect.poll(async()=>{const views=await Promise.all(fighters.map(name=>live.clients[name].run(
        '({grouped:!!sharedRoutine.usesGroupedCombat(),members:sharedRoutine.queueMembers()})')));
        return views.every(v=>v.grouped&&fighters.every(name=>v.members.includes(name)));},
        {timeout:30000,message:'All three fighters must adopt the grouped formation'}).toBe(true);
      seed=await live.admin(`output=(()=>{
        const m=new_monster('uhills',{type:'targetron',count:1,position:[${spawn.x},${spawn.y}],radius:0},{temp:1});
        m.hp=m.max_hp=10000000;m.attack=20;return {id:String(m.id),x:m.x,y:m.y};})()`);
      await live.post('/focus',{monsterFocus:['targetron'],monsterPriorities:{targetron:999},monsterSearchRadius:600});
      await live.post('/farming-mode',{character:W,mode:'default'});
      // Event timestamps arrive batched, so the poll records when each fighter's first hit shows up.
      const hit=(name:string)=>(events[name]||[]).some(e=>e.event==='hit'&&String(e.data?.id)===seed.id&&
        e.data?.hid===name&&e.data?.source!=='taunt'&&e.data?.damage>1);
      const firstHit=()=>Object.values(seen).sort((a,b)=>a-b)[0];
      const deadline=Date.now()+150000;
      while(Date.now()<deadline){
        for(const name of fighters){events[name]=await live.clients[name].events();if(!seen[name]&&hit(name))seen[name]=Date.now();}
        const views=await Promise.all(fighters.map(name=>live.clients[name].run(`(()=>{const p=globalThis.partyCombatPosition,
          e=parent.entities[${JSON.stringify(seed.id)}];return {name:character.name,x:Math.round(character.real_x),y:Math.round(character.real_y),
          hp:character.hp,mode:p&&p.mode,reason:p&&p.reason,target:p&&p.target!=null?String(p.target):null,
          shared:sharedRoutine.sharedTargetId(),enemyTarget:e&&e.target||null,distance:e?Math.round(Math.hypot(character.x-e.x,character.y-e.y)):null};})()`)));
        const state=await live.state();
        samples.push({at:Date.now(),views,group:fighters.map(name=>{const g=state.characters[name]?.groupedCombat?.state;
          return g&&{phase:g.phase,committed:g.committed,target:g.target&&{id:g.target.id,state:g.target.state},blockers:g.blockers};})});
        const first=firstHit();
        if(first&&fighters.every(name=>seen[name]))break;
        if(first&&Date.now()-first>ASSIST_MS+5000)break;
        await waitForGameplay(1000);
      }
      const first=firstHit();
      expect(first,'Somebody must engage the Targetron').toBeTruthy();
      for(const name of others){
        expect(seen[name],`${name} must hit the ${label} tank's Targetron`).toBeTruthy();
        expect(seen[name]-first,`${name} must assist within ${ASSIST_MS} ms`).toBeLessThanOrEqual(ASSIST_MS);
      }
    }finally{
      await info.attach('tank-assist-observations',{body:JSON.stringify({tank,seed,seen,samples}),contentType:'application/json'});
      await live.admin(`output=(()=>{
        const m=instances.uhills.monsters[${JSON.stringify(seed?.id||'')}];if(m)remove_monster(m,{method:'disappear',nospawn:true});
        monster_respawns.push(...(globalThis.__e2eAssistRespawns||[]));delete globalThis.__e2eAssistRespawns;return true;})()`);
    }
  });
});
