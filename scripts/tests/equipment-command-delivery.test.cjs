const test=require('node:test'),assert=require('node:assert/strict');
const {run}=require('./helpers/coordinator-host.cjs');
const policies=require('../../runtime/coordinator/index.ts');
// The startup harness has no workers; register its account character only in the command fixture.
const commandPolicies={...policies,createCoordinatorCharacterCommands(state,workers,ports){
  return policies.createCoordinatorCharacterCommands(state,{...workers,P:{}},ports);
}};

for(const type of ['unequip','equip'])test(`${type} survives combat-only reports and polling until a full heartbeat acknowledges acceptance`,async()=>{
  const host=await run(1900000000000,{
    '../../.build/runtime/coordinator-policies.cjs':commandPolicies,
  });
  const status=host.handlers.get('/party-api/status');
  const item={name:'intbelt',level:0};
  const report={name:'P',ctype:'priest',runtime:'native',steamPrimary:true,map:'main',x:0,y:0,server:'USII',gold:0,items:Array(42).fill(null),
    slots:{belt:{item}},hp:100,max_hp:100};
  function send(handler,body){let value;handler({body},{status(code){assert.equal(code,200);return this;},json(data){value=data;}});return value;}
  send(status,report);
  assert.equal(send(host.handlers.get('/party-api/command'),{character:'P',type,slot:'belt',item}).ok,true);
  const fast=send(status,{name:'P',combatOnly:true,hp:100});
  assert.equal(fast.command,undefined,'combat responses do not deliver equipment actions');
  send(status,{name:'P',combatWait:true,combatRevision:fast.combatRevision});
  send(status,{name:'P',combatWait:true,combatRevision:'old'});
  send(status,{name:'P',combatOnly:true,hp:100});
  const delivered=send(status,report);
  assert.equal(delivered.command?.type,type);
  assert.deepEqual(JSON.parse(JSON.stringify(delivered.command.item)),item);
  if(type==='unequip')assert.equal(delivered.command.slot,'belt');
  assert.equal(send(status,report).command.id,delivered.command.id,'delivery alone does not acknowledge client acceptance');
  assert.equal(send(status,{...report,lastCommandId:delivered.command.id}).command,null,'accepted equipment retires on the full heartbeat');
});

test('escape suppression holds unequip until a full heartbeat can actually deliver it',async()=>{
  let escaping=true;
  const host=await run(1900000000000,{
    '../../.build/runtime/coordinator-policies.cjs':{...commandPolicies,
      createCoordinatorHeartbeatResponse(state,ports){return policies.createCoordinatorHeartbeatResponse(state,{...ports,escapeOwns:()=>escaping});},
    },
  });
  const status=host.handlers.get('/party-api/status');
  const report={name:'P',ctype:'priest',map:'main',x:0,y:0,server:'USII',gold:0,items:Array(42).fill(null),hp:100,max_hp:100};
  function heartbeat(acceptance={}){let response;status({body:{...report,...acceptance}},{json(value){response=value;},status(){return this;}});return response;}
  heartbeat();
  host.handlers.get('/party-api/command')({body:{character:'P',type:'unequip',slot:'belt',item:{name:'intbelt',level:0}}},
    {status(code){assert.equal(code,200);return this;},json(value){assert.equal(value.ok,true);}});
  assert.equal(heartbeat().command,null);
  assert.equal(heartbeat().command,null);
  escaping=false;
  const delivered=heartbeat().command;
  assert.equal(delivered.type,'unequip');
  assert.equal(heartbeat().command.id,delivered.id);
  assert.equal(heartbeat({lastCommandId:delivered.id}).command,null);
});
