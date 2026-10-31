import {test,expect} from './live-fixtures';
import {waitForGameplay} from './network-clock';
import {warrior as W, priest as P, location} from './game/hunt-lifecycle';

// The priest tanks. The warrior off tank takes the priest's attacker while the priest is
// low and hands it back once the priest recovers. Declared inputs: one goo with
// raised HP and zeroed damage that attacks the priest, and the priest's HP set to 30% and
// later restored through the admin channel. Taunt, absorb and movement are native.
const B='E2EBankBoi';
test.use({loadout:'combat-range',extraFighter:'mage'});

test('the warrior off tank takes a low priest tank\'s attacker and hands it back once the priest recovers',async({live},info)=>{
  test.setTimeout(300000);
  const samples:any[]=[];let goo='';
  const sample=async(phase:string)=>{const s=await live.admin(`output=(()=>{const m=instances[get_player('${P}').in].monsters[${JSON.stringify(goo)}],p=get_player('${P}');
    return {target:m&&m.target||null,priestHp:Math.round(p.hp/p.max_hp*100)};})()`);samples.push({at:Date.now(),phase,...s});return s;};
  try{
    await live.post('/formation',{leader:W,tank:P,offTank:W});
    for(const name of [P,B])await live.post('/formation',{character:name,follow:true});
    await expect.poll(async()=>{const s=await live.state();return [s.designatedTank,s.offTank];}).toEqual([P,W]);
    await live.post('/farming-mode',{character:W,mode:'default'});
    await live.post('/focus',{character:W,monsterFocus:['goo']});
    const farm=await location(live);
    await live.post('/travel',farm);
    await expect.poll(async()=>live.admin(`output=(()=>{const ps=${JSON.stringify([W,P,B])}.map(get_player),f=${JSON.stringify(farm)};
      return ps.every(p=>p.map===f.map&&!p.moving&&Math.hypot(p.x-f.x,p.y-f.y)<300)&&ps.every(p=>Math.hypot(p.x-ps[0].x,p.y-ps[0].y)<250);})()`),{timeout:120000}).toBe(true);
    goo=await live.admin(`output=(()=>{const t=get_player('${P}');
      const m=new_monster(t.in,{type:'goo',position:[t.x+80,t.y],radius:0,count:1},{temp:1});
      m.hp=m.max_hp=5000000;m.attack=0;target_player(m,t);return String(m.id);})()`);
    // 1: the priest main tank holds the goo while healthy.
    await expect.poll(async()=>(await sample('healthy')).target,{timeout:20000}).toBe(P);
    for(let i=0;i<5;i++){expect((await sample('healthy')).target,'The healthy priest keeps its goo').toBe(P);await waitForGameplay(1000);}
    // 2: the priest drops to 30% and the warrior off tank takes the goo.
    await live.admin(`output=(()=>{const p=get_player('${P}');p.hp=Math.floor(p.max_hp*.3);resend(p,'reopen+cid');return p.hp;})()`);
    await expect.poll(async()=>(await sample('takeover')).target,{timeout:20000,intervals:[500],message:'The warrior off tank must take the low priest\'s goo'}).toBe(W);
    // 3: restored to full, the priest takes the goo back.
    await live.admin(`output=(()=>{const p=get_player('${P}');p.hp=p.max_hp;resend(p,'reopen+cid');return p.hp;})()`);
    await expect.poll(async()=>(await sample('return')).target,{timeout:30000,intervals:[500],message:'The recovered priest must take its goo back'}).toBe(P);
    for(const name of [W,P,B])expect(await live.clients[name].run('character.rip')).toBeFalsy();
  }finally{
    await info.attach('offtank-samples',{body:JSON.stringify(samples),contentType:'application/json'});
    if(goo)await live.admin(`output=(()=>{const m=instances[get_player('${P}').in].monsters[${JSON.stringify(goo)}];if(m)remove_monster(m,{silent:true});return true;})()`).catch(()=>{});
  }
});
