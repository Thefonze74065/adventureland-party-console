import {test,expect} from './live-fixtures';
import {W,P,M,seedCargo,totalLeather} from './hunt-interruption-helpers';
for(const departure of [{label:'Desert',map:'desertland',x:0,y:0},{label:'Winter Inn exit',map:'winterland',x:-280,y:-123}])test.describe(departure.label,()=>{
test.use({liveHeadless:true,initialPositions:{E2EWarrior:{map:'main',x:0,y:0},E2EPriest:{map:'main',x:0,y:0},E2EMerchant:{map:departure.map,x:departure.x,y:departure.y}}});
test(`native headless merchant approaches ${departure.label} transporter within range and collects real cargo`,async({live},info)=>{
 test.setTimeout(240000);const samples:any[]=[];
 await live.post('/focus',{monsterFocus:[],monsterPriorities:{}});
 await live.post('/merchant/force-stand',{enabled:true});
 await live.post('/steam/action',{character:M,action:'logout'});
 await expect.poll(async()=>{const s=await live.state();return !s.activeSlots.some((slot:any)=>slot.character===M)&&(!s.steamSwitch||s.steamSwitch.phase==='complete');},{timeout:60000}).toBe(true);
 await expect.poll(()=>live.admin(`output=!!get_player('${M}')||Object.values(dc_players).some(p=>p.name==='${M}')`),{timeout:30000}).toBe(false);
 const initial=await live.admin(`output=(async()=>{if(get_player('${M}')||Object.values(dc_players).some(p=>p.name==='${M}'))throw Error('Initial Merchant placement requires disconnected native player');const point=${JSON.stringify({map:departure.map,x:departure.x,y:departure.y})},body={type:'character',...point};set_base(body);if(!can_move({...body,going_x:point.x,going_y:point.y}))throw Error('Native geometry rejects Merchant initial point');const result=await db.collection('character').updateOne({name:'${M.toLowerCase()}'},{$set:{'info.map':point.map,'info.in':point.map,'info.x':point.x,'info.y':point.y}});if(result.matchedCount!==1)throw Error('Initial Merchant fixture character missing');return {point,base:body.base,disconnected:true,matchedCount:result.matchedCount};})()`);
 await info.attach('native-disconnected-headless-merchant-initial-position',{body:JSON.stringify(initial),contentType:'application/json'});
 const slots=(await live.state()).activeSlots,slot=slots.find((slot:any)=>!slot.character&&slot.kind!=='steam');
 await live.post('/slots/'+(slot?.slot??slot?.index??1)+'/spawn',{character:M});
 await expect.poll(async()=>{const c=(await live.state()).characters[M],actual=await live.admin(`output=(()=>{const p=get_player('${M}');return p&&{map:p.map,x:p.x,y:p.y,hp:p.hp,rip:p.rip,clear:can_move({...p,going_x:p.x,going_y:p.y})};})()`);return c?.runtime==='headless'&&Date.now()-c.seenAt<3000&&c.map===departure.map&&Math.hypot(c.x-departure.x,c.y-departure.y)<15&&actual?.map===departure.map&&Math.hypot(actual.x-departure.x,actual.y-departure.y)<15&&actual.hp>0&&!actual.rip&&actual.clear;},{timeout:90000}).toBe(true);
 try{
  await live.post('/config',{itemCollectionThreshold:1});await seedCargo(live,W);expect(await totalLeather(live)).toBe(7);
  await live.admin(`output=(()=>{const p=get_player('${M}');if(!p||typeof p.socket.prependListener!=='function')throw Error('Native transport socket observer unavailable');const observation={socket:p.socket,samples:[],listener:null};observation.listener=function(packet){if(observation.samples.length>=16)return;const npc=G.maps.${departure.map}.npcs.find(n=>n.id==='transporter').position;observation.samples.push({at:Date.now(),from:{map:p.map,x:p.x,y:p.y},range:Math.hypot(p.x-npc[0],p.y-npc[1]),clear:can_move({...p,going_x:p.x,going_y:p.y}),legalRange:B.transporter_dist,to:packet?.to,spawn:packet?.s});};p.socket.prependListener('transport',observation.listener);globalThis.__e2eMerchantTransportObservation=observation;return true;})()`);
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'party collection':true}});
  await live.post('/merchant/force-stand',{enabled:false});
  let approached=false,crossed=false;
  await expect.poll(async()=>{
   const s=await live.state(),actual=await live.admin(`output=(()=>{const m=get_player('${M}'),w=get_player('${W}'),npc=G.maps.${departure.map}.npcs.find(n=>n.id==='transporter').position;return {merchant:m&&{map:m.map,x:m.x,y:m.y,hp:m.hp,rip:m.rip,range:Math.hypot(m.x-npc[0],m.y-npc[1]),clear:can_move({...m,going_x:m.x,going_y:m.y})},stock:w.items.reduce((n,i)=>n+(i?.name==='leather'?i.q||1:0),0),transports:globalThis.__e2eMerchantTransportObservation?.samples||[]};})()`);
   approached ||= actual.transports.some((packet:any)=>packet.from.map===departure.map&&Number.isFinite(packet.legalRange)&&packet.legalRange>0&&packet.range<packet.legalRange&&packet.clear&&packet.to==='main');
   crossed ||= actual.merchant?.map==='main';
   if(samples.length<200)samples.push({at:Date.now(),actual,movement:s.characters[M]?.movement,current:s.merchantCurrent,queue:s.merchantQueue});
   return approached&&crossed&&actual.stock===0;
  },{timeout:120000,intervals:[200,500],message:'Native transporter approach, actual transport and real cargo receipt'}).toBe(true);
  expect(await totalLeather(live)).toBe(7);
 }finally{const transports=await live.admin(`output=(()=>{const o=globalThis.__e2eMerchantTransportObservation;if(!o)return [];o.socket.removeListener('transport',o.listener);delete globalThis.__e2eMerchantTransportObservation;return o.samples;})()`);await info.attach('native-merchant-transporter-collection',{body:JSON.stringify({samples,transports,final:await live.state(),total:await totalLeather(live)}),contentType:'application/json'});}
});

});
