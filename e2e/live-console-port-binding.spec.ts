import {test,expect} from './live-fixtures';

// Failure inventory: a released probe port is claimed before child startup;
// the gateway or native CODE keeps the probe address; restart changes the
// published endpoint; the fixture closes somebody else's occupied listener.
test.use({occupyCoordinatorPort:true});
test('native coordinator starts beside an occupied probe port and reconnects after restart',async({live},info)=>{
  const binding=live.coordinatorBinding;
  expect(binding.occupiedPort).not.toBeNull();
  expect(binding.port).not.toBe(binding.occupiedPort);
  const occupant=()=>fetch(`http://127.0.0.1:${binding.occupiedPort}`).then(response=>response.text());
  expect(await occupant()).toBe('owned E2E port occupant');
  await live.post('/formation',{leader:'E2EWarrior'});
  const before=Object.fromEntries(await Promise.all(Object.entries(live.clients).map(async([name,client])=>[name,await client.snapshot()])));
  await live.restartCoordinator();
  await expect.poll(async()=>{
    const snapshots=await Promise.all(Object.entries(live.clients).map(async([name,client])=>({name,current:await client.snapshot()})));
    return snapshots.every(({name,current})=>current.connected&&current.statusAt>before[name].statusAt);
  },{timeout:30_000}).toBe(true);
  expect((await live.state()).leader).toBe('E2EWarrior');
  expect(await occupant()).toBe('owned E2E port occupant');
  await info.attach('native-coordinator-port-ownership',{body:JSON.stringify({binding,before,state:await live.state()}),contentType:'application/json'});
});
