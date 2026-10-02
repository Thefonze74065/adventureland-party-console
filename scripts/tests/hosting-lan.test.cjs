const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createServer,request}=require('node:http');
const {Access}=require('../../tools/hosting/access.ts');
const {gateway}=require('../../tools/hosting/gateway.ts');
const {setupAddress}=require('../../tools/hosting/address.ts');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const close=server=>new Promise(resolve=>server.close(resolve));

test('setup detects the reachable address without exposing a Docker container IP',()=>{
 const interfaces={Ethernet:[{address:'192.168.1.25',family:'IPv4',internal:false}]};
 const req={headers:{host:'localhost:3010'}};
 assert.equal(setupAddress(req,undefined,interfaces,'win32'),'http://192.168.1.25:3010');
 assert.equal(setupAddress(req,undefined,interfaces,'linux'),'http://localhost:3010');
 assert.equal(setupAddress({headers:{host:'192.168.1.30:8080'}},undefined,interfaces,'linux'),'http://192.168.1.30:8080');
 assert.equal(setupAddress(req,'https://party.example',interfaces,'win32'),'https://party.example');
});

test('legacy credential files remain protected; explicit off persists despite credentials',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lan-migration-')),file=path.join(dir,'access.json');
 try {
  const fresh=new Access(file);await fresh.load();assert.equal(fresh.required,false);
  const browser=await fresh.setRequired(true),steam=await fresh.steam();
  const legacy=JSON.parse(await fs.readFile(file,'utf8'));delete legacy.requirePairing;await fs.writeFile(file,JSON.stringify(legacy));
  const restored=new Access(file);await restored.load();assert.equal(restored.required,true);assert.ok(restored.valid('browsers',browser));
  await restored.setRequired(false);const off=new Access(file);await off.load();assert.equal(off.required,false);assert.ok(off.valid('steam',steam));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('LAN gateway toggles without lockout, forwards API/builds, and guards both loader modes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lan-gateway-')),file=path.join(dir,'access.json');
 const access=new Access(file);await access.load();
 const upstream=createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');res.end(JSON.stringify({url:req.url,origin:req.headers.origin,cookie:req.headers.cookie}));});
 const port=await listen(upstream),server=gateway({access,configured:()=>true,dashboardPort:port,apiPort:port,publicUrl:"http://192.168.1.50:3010"});
 const base='http://127.0.0.1:'+await listen(server),lan='http://192.168.1.50:3010';
 const headers={Host:'192.168.1.50:3010',Origin:lan,'Content-Type':'application/json'};
 const post=(route,data,extra={})=>fetch(base+route,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(data)});
 try {
  assert.equal((await fetch(base)).status,200);
  assert.deepEqual(await (await fetch(base+'/setup/state')).json(),{configured:true,requirePairing:false,canConfigureAccount:false,serverAddress:lan,realms:[]});
  assert.equal((await (await post('/setup/steam',{origin:lan})).json()).code,'$.getScript("'+lan+'/CODE/adventure_land/universal-loader.js");');
  assert.equal((await post('/setup/pairing',{requirePairing:'yes'})).status,400);
  assert.equal((await post('/setup/pairing',{requirePairing:true},{Origin:'https://evil.example'})).status,403);
  const forwarded=await (await post('/__dashboard/mode',{mode:'development'})).json();assert.equal(forwarded.origin,'http://127.0.0.1:'+port);
  assert.equal((await (await post('/',{})).json()).origin,'http://127.0.0.1:'+port);
  assert.equal((await post('/',{}, {Origin:'https://evil.example'})).status,403);
  const game=await post('/party-api/state',{}, {Origin:'https://adventure.land'});assert.equal(game.status,200);assert.equal(game.headers.get('access-control-allow-origin'),'https://adventure.land');
  assert.equal((await game.json()).origin,'https://adventure.land');
  assert.equal((await post('/party-api/state',{}, {Origin:'https://evil.example'})).status,403);
  const enabled=await post('/setup/pairing',{requirePairing:true});assert.equal(enabled.status,200);
  const Cookie=enabled.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base+'/setup/state')).status,401);
  assert.equal((await post('/setup/pairing',{requirePairing:false})).status,401);
  assert.equal((await post('/party-api/state',{}, {Origin:'https://adventure.land'})).status,403);
  const code=(await (await post('/setup/steam',{origin:lan},{Cookie})).json()).code,credential=code.match(/bridge\/([a-f0-9]{64})/)[1];
  const bridge='/bridge/'+credential+'/party-api/state';
  assert.equal((await post(bridge,{}, {Origin:'https://adventure.land'})).status,200);
  assert.equal((await post('/setup/pairing',{requirePairing:false},{Cookie})).status,200);
  assert.equal((await fetch(base)).status,200);assert.equal((await fetch(base+bridge)).status,200);
  await post('/setup/revoke',{});assert.equal((await fetch(base+bridge)).status,401);
  const restarted=new Access(file);await restarted.load();assert.equal(restarted.required,false);
 }finally{await close(server);await close(upstream);await fs.rm(dir,{recursive:true,force:true});}
});

test('development upgrades forward bytes and require same-origin authorized browsers',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lan-ws-')),access=new Access(path.join(dir,'access.json'));await access.load();
 const upstream=createServer();upstream.on('upgrade',(req,socket)=>socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nhello'));
 const server=gateway({access,configured:()=>true,dashboardPort:await listen(upstream)}),port=await listen(server);
 const upgrade=(Origin,Cookie='')=>new Promise((resolve,reject)=>{
  const req=request({port,host:'127.0.0.1',path:'/__vite_hmr',headers:{Origin,Cookie,Connection:'Upgrade',Upgrade:'websocket'}});
  req.on('upgrade',(res,socket,head)=>{assert.equal(head.toString(),'hello');socket.destroy();resolve(res.statusCode);});req.on('response',res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();
 });
 try {
  assert.equal(await upgrade('http://127.0.0.1:'+port),101);assert.equal(await upgrade('https://evil.example'),403);
  const browser=await access.setRequired(true);assert.equal(await upgrade('http://127.0.0.1:'+port),403);assert.equal(await upgrade('http://127.0.0.1:'+port,'party='+browser),101);
 }finally{await close(server);await close(upstream);await fs.rm(dir,{recursive:true,force:true});}
});

test('pairing cookies authorize LAN HTTP alongside a public HTTPS origin',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lan-cookie-')),access=new Access(path.join(dir,'access.json'));await access.load();
 const server=gateway({access,configured:()=>true,dashboardPort:1,publicUrl:'https://party.example'}),base='http://127.0.0.1:'+await listen(server);
 try {
  const enabled=await fetch(base+'/setup/pairing',{method:'POST',headers:{Origin:base},body:JSON.stringify({requirePairing:true})});
  assert.equal(enabled.status,200);assert.ok(!enabled.headers.get('set-cookie').includes('Secure'));
  const Cookie=enabled.headers.get('set-cookie').split(';')[0];
  const secure=await fetch(base+'/setup/pairing',{method:'POST',headers:{Origin:'https://party.example',Cookie},body:JSON.stringify({requirePairing:true})});
  assert.equal(secure.status,200);assert.ok(secure.headers.get('set-cookie').includes('; Secure'));
 }finally{await close(server);await fs.rm(dir,{recursive:true,force:true});}
});

test('setup omits pairing when off and account setup where unsupported',async()=>{
 const {JSDOM}=require('../../.caracal/node_modules/jsdom'),{setupPage}=require('../../tools/hosting/page.ts');
 for(const state of [{configured:true,requirePairing:false,canConfigureAccount:false},{configured:false,requirePairing:false,canConfigureAccount:true},{configured:true,requirePairing:true,canConfigureAccount:true}]) {
  const dom=new JSDOM(setupPage,{url:'http://lan:3010/setup',runScripts:'dangerously',beforeParse(w){w.fetch=async()=>({ok:true,json:async()=>state});}});
  try {
   await new Promise(resolve=>setImmediate(resolve));
   const el=id=>dom.window.document.getElementById(id);
   assert.equal(el('pair').hidden,true);assert.equal(el('settings').hidden,false);
   assert.equal(el('account').hidden,!state.canConfigureAccount||state.configured);
   assert.equal(el('invite').hidden,!state.requirePairing);assert.equal(el('address').textContent,'http://lan:3010');
  }finally{dom.window.close();}
 }
});

test('game session starts masked, toggles visibly without changing it, and clears after connecting',async()=>{
 const {JSDOM}=require('../../.caracal/node_modules/jsdom'),{setupPage}=require('../../tools/hosting/page.ts');
 const calls=[];let configured=false;
 const dom=new JSDOM(setupPage,{url:'http://lan:3010/setup',runScripts:'dangerously',beforeParse(w){w.fetch=async(url,options)=>{
  if(url==='/setup/session'){calls.push(JSON.parse(options.body));configured=true;}
  return {ok:true,json:async()=>({configured,requirePairing:false,canConfigureAccount:true,realms:['SR_USII']})};
 };}});
 try {
  await new Promise(resolve=>setImmediate(resolve));
  const el=id=>dom.window.document.getElementById(id),input=el('session'),toggle=el('toggleSession');
  assert.equal(input.type,'password');assert.equal(toggle.getAttribute('aria-pressed'),'false');
  input.value='US_Abc123-privateToken';toggle.click();
  assert.equal(input.type,'text');assert.equal(toggle.getAttribute('aria-label'),'Hide game session');
  assert.equal(toggle.getAttribute('aria-pressed'),'true');assert.equal(input.value,'US_Abc123-privateToken');
  toggle.click();assert.equal(input.type,'password');assert.equal(toggle.getAttribute('aria-label'),'Show game session');
  toggle.click();el('connect').click();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[{session:'US_Abc123-privateToken',realm:'SR_USII'}]);
  assert.equal(input.value,'');assert.equal(input.type,'password');assert.equal(el('account').hidden,true);
  assert.equal(el('success').hidden,false);assert.match(el('success').textContent,/Account connected/);
  assert.doesNotMatch(el('success').textContent,/Returning/);assert.equal(el('paths').hidden,false);
 }finally{dom.window.close();}
});

test('only a connected client starts the green countdown; failed authentication never redirects',async()=>{
 const {JSDOM}=require('../../.caracal/node_modules/jsdom'),{setupPage}=require('../../tools/hosting/page.ts');
 for(const accepted of [true,false]) {
  let tick,poll,cleared=false,connected=false;
  const dom=new JSDOM(setupPage,{url:'http://lan:3010/setup',runScripts:'dangerously',beforeParse(w){
   w.setInterval=(fn,delay)=>{assert.equal(delay,1000);tick=fn;return 42;};
   w.clearInterval=id=>{if(id===42)cleared=true;};
   w.setTimeout=fn=>{poll=fn;return 43;};w.clearTimeout=()=>{};
   w.fetch=async url=>({ok:url!=='/setup/session'||accepted,json:async()=>({connected,code:'loader',configured:accepted,canConfigureAccount:true,requirePairing:false,realms:['SR_USII'],error:'Invalid game session'})});
  }});
  try {
   await new Promise(r=>setImmediate(r));
   const el=id=>dom.window.document.getElementById(id);
   el('connect').click();await new Promise(r=>setImmediate(r));
   if(!accepted){assert.equal(tick,undefined);assert.equal(el('success').hidden,true);assert.equal(el('error').textContent,'Invalid game session');continue;}
   assert.equal(dom.window.getComputedStyle(el('success')).color,'rgb(134, 239, 172)');assert.equal(el('error').textContent,'');
   el('placement').value='same';el('client').value='windows-steam';el('client').onchange();await new Promise(r=>setImmediate(r));
   assert.equal(tick,undefined);assert.equal(el('code').value,'loader');
   connected=true;await poll();assert.match(el('linkStatus').textContent,/Client connected. Taking you to the dashboard in 5/);
   assert.equal(dom.window.getComputedStyle(el('linkStatus')).color,'rgb(134, 239, 172)');
   for(const remaining of [4,3,2,1]){tick();assert.ok(el('linkStatus').textContent.includes('in '+remaining));}
   dom.window.dispatchEvent(new dom.window.Event('pagehide'));assert.equal(cleared,true);
  }finally{dom.window.close();}
 }
});

test('choosing a supported local setup generates its loader automatically; LAN copy fallback selects code',async()=>{
 const {JSDOM}=require('../../.caracal/node_modules/jsdom'),{setupPage}=require('../../tools/hosting/page.ts');
 const calls=[];let tick,poll;
 const dom=new JSDOM(setupPage,{url:'http://lan:3010/setup',runScripts:'dangerously',beforeParse(w){
  w.setInterval=fn=>{tick=fn;return 1;};w.clearInterval=()=>{};
  w.setTimeout=fn=>{poll=fn;return 2;};w.clearTimeout=()=>{};
  w.fetch=async(url,options)=>{calls.push([url,options]);if(url.includes('/connection'))throw Error('unavailable');return {ok:true,json:async()=>({configured:true,code:'client loader',serverAddress:'http://192.168.1.10:3010'})};};
 }});
 try {
  const flush=()=>new Promise(r=>setImmediate(r));await flush();const el=id=>dom.window.document.getElementById(id);
  assert.equal(calls.length,1);assert.equal(tick,undefined);assert.equal(poll,undefined);
  el('placement').value='same';el('client').value='windows-steam';el('client').onchange();
  await flush();assert.equal(el('loader'),null);assert.deepEqual(JSON.parse(calls.find(([url])=>url==='/setup/client')[1].body),{placement:'same',client:'windows-steam',https:false});assert.deepEqual(JSON.parse(calls.find(([url])=>url==='/setup/steam')[1].body),{origin:'http://127.0.0.1:3010',placement:'same',client:'windows-steam',https:false});
  assert.equal(tick,undefined);assert.match(el('linkStatus').textContent,/retry/);
  el('copy').click();await flush();assert.equal(el('code').selectionStart,0);assert.equal(el('code').selectionEnd,'client loader'.length);
  assert.equal(el('continue').getAttribute('href'),'/');el('continue').onclick();
  const count=calls.length;await poll();assert.equal(calls.length,count,'headless continuation stops polling without starting characters');
 }finally{dom.window.close();}
});

test('setup bounds connection requests, rechecks on focus, and starts only one inline countdown',async()=>{
 const {JSDOM}=require('../../.caracal/node_modules/jsdom'),{setupPage}=require('../../tools/hosting/page.ts');
 const timers=new Map();let next=1,requests=0,countdowns=0,connected=false;
 const dom=new JSDOM(setupPage,{url:'http://lan:3010/setup',runScripts:'dangerously',beforeParse(w){
  w.setTimeout=(fn,ms)=>{const id=next++;timers.set(id,{fn,ms});return id};w.clearTimeout=id=>timers.delete(id);
  w.setInterval=()=>{countdowns++;return 50};w.clearInterval=()=>{};
  w.fetch=async(url,options)=>{
   if(url.includes('/connection')){requests++;if(requests===1)return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('timeout'))));return {ok:true,json:async()=>({connected})}}
   return {ok:true,json:async()=>({configured:true,code:'loader'})};
  };
 }});
 const flush=()=>new Promise(r=>setImmediate(r));
 try{
  await flush();const el=id=>dom.window.document.getElementById(id);
  el('placement').value='same';el('client').value='windows-steam';el('client').onchange();await flush();
  dom.window.dispatchEvent(new dom.window.Event('focus'));assert.equal(requests,1);
  [...timers.values()].find(t=>t.ms===8000).fn();await flush();assert.match(el('linkStatus').textContent,/retry/);
  connected=true;dom.window.dispatchEvent(new dom.window.Event('focus'));await flush();
  assert.equal(requests,2);assert.equal(countdowns,1);assert.match(el('linkStatus').textContent,/dashboard in 5/);
  dom.window.dispatchEvent(new dom.window.Event('focus'));dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));await flush();
  assert.equal(countdowns,1);assert.equal(requests,2);
  el('client').value='linux-steam';el('client').onchange();assert.equal(el('linkStatus').textContent,'');
  assert.equal(el('certificateHelp').previousElementSibling.id,'helperCommand');
  assert.equal(el('certificateHelp').open,false);
  assert.ok(el('certificateHelp').querySelector('a[href="/setup/trust/certificate"]'));
  assert.doesNotMatch(dom.window.document.body.textContent,/Trust applies to certificates|Restart the Adventure Land Steam client afterward/);
 }finally{dom.window.close()}
});
