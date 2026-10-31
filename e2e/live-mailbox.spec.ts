import {test,expect} from './live-fixtures';

// Failure inventory: docs/testing-mailbox-enhancements.md. Only the initial
// merchant inventory is declared; sending, pickup, native taken and deletion are real.
for(const deleteDuringCollection of [false,true]) test(`mailbox automation collects native attachments before deletion and records confirmed sent mail (${deleteDuringCollection?'delete enabled during collection':'delete enabled afterward'})`,async({live},info)=>{
  test.setTimeout(300000);const merchant='E2EMerchant',subject='ChronAL mailbox attachment proof '+info.testId,observations:any[]=[];
  // Native deletion removes account ownership, retaining the underlying mail
  // record. Check this account's inbox, scoped to this scenario's exact subject.
  const read=async()=>live.admin(`output=(async()=>{const p=get_player('E2EMerchant'),mail=await db.collection('mail').find({owner:p.owner,'info.subject':${JSON.stringify(subject)}}).toArray();
    return {items:p.items.filter(i=>i&&i.name==='beewings').reduce((n,i)=>n+(i.q||1),0),mail:mail.map(m=>({id:m._id,taken:m.taken,item:m.info.item,to:m.to}))};})()`);
  try{
    await expect.poll(async()=>!!(await live.state(true)).merchantCatalog?.allItems?.find((i:any)=>i.id==='beewings'),{timeout:90000}).toBe(true);
    const seed=await live.admin(`output=(()=>{const p=get_player('E2EMerchant');if(p.items[20]||p.items.some(i=>i&&i.name==='beewings'))throw Error('Requires empty mail source slot and no duplicate beewings');p.items[20]={name:'beewings',q:2};cache_player_items(p);resend(p,'reopen+cid');return {name:p.name,slot:20,item:p.items[20]};})()`);
    await info.attach('declared-native-mail-attachment',{body:JSON.stringify(seed),contentType:'application/json'});
    await expect.poll(async()=>(await live.state()).characters[merchant]?.items?.find((e:any)=>e?.slot===20)?.item?.q,{timeout:30000}).toBe(2);
    const order=await live.post('/merchant/send-mail',{recipient:'E2EWarrior',subject,message:'Native attachment round trip',quantity:2,source:{pack:'merchant',slot:20,item:{name:'beewings',q:2}}});
    await expect.poll(async()=>{const box=await live.post('/mail/refresh',{}),native=await read();observations.push({at:Date.now(),box,native});return {sent:box.outbox?.filter((m:any)=>m.id===order.jobId).length,carried:native.items,messages:box.messages.filter((m:any)=>m.subject===subject).length};},{timeout:120000}).toEqual({sent:1,carried:0,messages:1});
    const before=await live.post('/mail/refresh',{}),mail=before.messages.find((m:any)=>m.subject===subject);expect(mail.taken).toBe(false);expect(before.newCount).toBeGreaterThan(0);
    await live.post('/mail/seen',{});await live.post('/mail/settings',{autoCollect:true,autoDelete:deleteDuringCollection});
    await expect.poll(async()=>{const box=await live.post('/mail/refresh',{}),native=await read(),s=await live.state();observations.push({at:Date.now(),box,native});return {taken:deleteDuringCollection?native.mail.length===0:native.mail[0]?.taken,carried:native.items,pending:[s.merchantCurrent,...s.merchantQueue].filter(j=>j?.reason==='collect mail'&&j.mail?.id===mail.id).length};},{timeout:120000}).toEqual({taken:true,carried:2,pending:0});
    await live.post('/mail/settings',{autoCollect:true,autoDelete:true});
    await expect.poll(async()=>(await read()).mail.length,{timeout:30000}).toBe(0);
    const completed=await live.post('/mail/refresh',{});expect(completed.outbox.filter((m:any)=>m.id===order.jobId)).toHaveLength(1);
    await live.post('/mail/outbox-delete',{id:order.jobId});await live.restartCoordinator();
    const final=await live.post('/mail/refresh',{});expect(final.settings).toEqual({autoCollect:true,autoDelete:true});expect(final.outbox.filter((m:any)=>m.id===order.jobId)).toHaveLength(0);expect((await read()).items).toBe(2);
  }finally{await info.attach('native-mailbox-send-collect-delete-ledger',{body:JSON.stringify(observations),contentType:'application/json'});}
});
