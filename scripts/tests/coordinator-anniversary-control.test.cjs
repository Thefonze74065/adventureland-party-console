const test=require('node:test');
const assert=require('node:assert/strict');
const {merchantAnniversaryControl}=require('../../runtime/coordinator/merchant/anniversary-control.ts');
const control=(event,state={},now=100000,visit=true,enabled=true,aborted={})=>merchantAnniversaryControl('M',enabled,
  {anniversaryServer:event,anniversaryState:state,anniversaryVisit:visit},aborted,now);

test('merchant staging reserves ninety seconds and tolerates a fifteen-second late live payload',()=>{
  for(const [next,reserved] of [[190001,false],[190000,true],[85000,true],[84999,false]]){
    assert.equal(control({live:false,next}).preWindow,reserved);
  }
});

test('featured merchant leaves after one minute of the five-minute round',()=>{
  const event={live:true,target:'M',expires:400000};
  assert.equal(control(event,{},159999).featured,true);
  const done=control(event,{},160000);assert.equal(done.featured,false);assert.equal(done.reserved,false);assert.equal(done.kissDue,false);
});

test('kiss attempts honor completion, availability, retries, disabled events and aborted rounds',()=>{
  const event={live:true,target:'P',expires:400000,round:'round'};
  assert.equal(control(event).kissDue,true);assert.equal(control(event,{retryAt:100001}).kissDue,false);
  assert.equal(control(event,{mode:'complete'}).reserved,false);assert.equal(control({...event,available:false}).kissDue,false);
  assert.equal(control(event,{},100000,true,false).live,false);assert.equal(control(event,{},100000,true,true,{round:true}).live,false);
  assert.equal(control(event,{mode:'kiss-active'}).busy,true);
});

// Failure inventory: e2e/merchant-anniversary-wait-failures.md. Written before the change.
test('an unavailable featured player does not reserve the merchant for the round',()=>{
  const live={live:true,target:'P',expires:400000,round:'round'};
  const away=control({...live,available:false});
  assert.equal(away.reserved,false,'queued work runs while the featured player is unavailable');
  assert.equal(away.kissDue,false);
  const back=control({...live,available:true});
  assert.equal(back.kissDue,true,'a returning featured player makes the visit due again');
  assert.equal(back.reserved,true);
  assert.equal(control(live).reserved,true,'a payload without the flag counts as available');
  assert.equal(control({live:false,next:150000,available:false}).reserved,true,'the pre-window stays reserved');
  assert.equal(control({live:true,target:'M',expires:400000,available:false},{},150000).featured,true,'the featured merchant still holds');
  assert.equal(control({...live,available:false},{mode:'kiss-active'}).busy,true,'an active visit still owns the merchant');
});
