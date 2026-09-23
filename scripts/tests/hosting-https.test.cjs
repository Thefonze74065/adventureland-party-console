const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const http=require('node:http'),https=require('node:https');
const nodeTLS=require('node:tls');
const {LocalTLS}=require('../../tools/hosting/tls.ts');
const {tlsHost,certificateProbes}=require('../../tools/hosting/tls-config.ts');
const {Access}=require('../../tools/hosting/access.ts');
const {gateway}=require('../../tools/hosting/gateway.ts');
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s.address().port)));
const close=s=>new Promise(r=>{s.closeAllConnections();s.close(r)});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('certificate readiness probes preserve DNS SNI and verify the current no-SNI LAN fallback',()=>{
 const probes=certificateProbes(['127.0.0.1','localhost','192.168.1.20','127.0.0.2','192.168.1.30']);
 assert.deepEqual(probes,[
  {host:'127.0.0.1',servername:'',identity:'127.0.0.1'},
  {host:'127.0.0.1',servername:'localhost',identity:'localhost'},
  {host:'127.0.0.2',servername:'',identity:'127.0.0.2'},
  {host:'127.0.0.3',servername:'',identity:'192.168.1.30'},
 ]);
 assert.equal(certificateProbes(['127.0.0.1','localhost']).at(-1).identity,'127.0.0.1');
});
test('HTTPS address validation rejects public addresses, credentials, paths, and non-HTTP schemes',async()=>{
 for(const address of ['http://8.8.8.8','http://user@127.0.0.1','http://127.0.0.1/path','file:///tmp/cert','http://127.0.0.1/?x=1'])await assert.rejects(tlsHost(address));
 for(const host of ['127.0.0.1','192.168.1.239','localhost','[::1]'])assert.equal(await tlsHost('http://'+host+':3010'),host.replace(/^\[|\]$/g,''));
});
test('setup matrix uses localhost only for supported same-machine clients and keeps headless bypass',async()=>{
 const {JSDOM}=require('../../.caracal/node_modules/jsdom'),{setupPage}=require('../../tools/hosting/page.ts');
 for(const placement of ['same','remote'])for(const client of ['windows-steam','windows-browser','linux-steam','linux-browser']){
  const dom=new JSDOM(setupPage,{url:'http://lan:3010/setup',runScripts:'dangerously',beforeParse(w){w.fetch=async()=>({ok:true,json:async()=>({configured:true,serverAddress:'http://lan:3010',httpPort:3010,tls:{ready:true}})})}});
  try{await delay(0);const el=id=>dom.window.document.getElementById(id);el('placement').value=placement;el('client').value=client;el('client').onchange();
   const secure=placement==='remote'||client==='linux-steam';assert.equal(el('tlsSteps').hidden,!secure);assert.equal(el('loaderArea').hidden,secure);
   assert.equal(el('continue').getAttribute('href'),'/');if(!secure){assert.equal(el('address').textContent,'http://127.0.0.1:3010');el('fallback').click();assert.equal(el('tlsSteps').hidden,false)}
  }finally{dom.window.close()}
 }
});
test('HTTPS check stays on setup and shows inline success or certificate troubleshooting',async()=>{
 const {JSDOM}=require('../../.caracal/node_modules/jsdom'),{setupPage}=require('../../tools/hosting/page.ts');
 let fail=false;const secure='https://192.168.1.239:3443';
 const dom=new JSDOM(setupPage,{url:'http://192.168.1.239:3010/setup',runScripts:'dangerously',beforeParse(w){
  w.AbortSignal.timeout=()=>undefined;
  w.fetch=async(url,options)=>{
   if(String(url).startsWith(secure)){if(fail)throw Error('certificate error');assert.equal(options.credentials,'omit');assert.equal(options.body.get('ticket'),'one-time');return {ok:true,json:async()=>({ok:true,origin:secure})}}
   if(url==='/setup/steam'){assert.deepEqual(JSON.parse(options.body),{origin:secure});return {ok:true,json:async()=>({code:'$.getScript("'+secure+'/CODE/adventure_land/universal-loader.js");'})}}
   const values={'/setup/state':{configured:true,serverAddress:'http://192.168.1.239:3010',tls:{ready:true}},'/setup/https':{origin:secure,fingerprint:'test'},'/setup/transfer':{action:secure+'/setup/check-https',ticket:'one-time'},'/party-api/steam/connection':{connected:false}};
   return {ok:true,json:async()=>values[url]};
  };
 }});
 try{
  await delay(0);const el=id=>dom.window.document.getElementById(id);
  el('placement').value='remote';el('client').value='windows-steam';el('client').onchange();
  await el('prepare').onclick();await el('checkHttps').onclick();
  assert.match(el('httpsStatus').textContent,/connection verified/);assert.equal(el('loaderArea').hidden,false);
  assert.equal(el('loader'),null);assert.equal(el('copy').disabled,false);
  assert.equal(el('code').value,'$.getScript("'+secure+'/CODE/adventure_land/universal-loader.js");');
  assert.equal(el('address').textContent,secure);assert.equal(dom.window.location.pathname,'/setup');assert.equal(dom.window.document.querySelector('form'),null);
  fail=true;await el('checkHttps').onclick();assert.match(el('httpsStatus').textContent,/Could not verify HTTPS/);assert.ok(el('httpsStatus').textContent.includes(secure+'/setup'));
  assert.equal(el('loaderArea').hidden,true);assert.equal(el('code').value,'');
 }finally{dom.window.close()}
});

test('real Caddy HTTPS preserves CA, proxies CODE, enforces origins, and transfers pairing without URL credentials',async()=>{
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'party-tls-'));
 const upstream=http.createServer((req,res)=>{res.setHeader('Content-Type','application/javascript');res.end('/* fixture */')});
 const sockets=new Set();upstream.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 upstream.on('upgrade',(req,socket)=>{assert.ok(!req.headers['x-party-tls']);socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n');socket.on('error',()=>{});});
 const upstreamPort=await listen(upstream),reservation=http.createServer(),tlsPort=await listen(reservation);await close(reservation);
 const old=process.env.AL_HTTPS_PORT;process.env.AL_HTTPS_PORT=String(tlsPort);
 const access=new Access(path.join(temporary,'access.json'));await access.load();
 const options={access,configured:()=>true,dashboardPort:upstreamPort,apiPort:upstreamPort};
 const server=gateway(options);server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 const port=await listen(server),base='http://127.0.0.1:'+port;
 let tls=new LocalTLS(path.resolve(__dirname,'../..'),temporary,port);options.tls=tls;
 const request=(pathname,ca,extra={})=>new Promise((resolve,reject)=>{
  const req=https.request({host:'127.0.0.1',port:tlsPort,path:pathname,ca,...extra},res=>{let body='';res.on('data',d=>body+=d);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}))});req.on('error',reject);req.end(extra.body);
 });
 const ready=async()=>{for(let i=0;i<80;i++){if((await tls.status()).ready)return;await delay(100)}throw Error((await tls.status()).error)};
 const upgrade=(ca,cookie='')=>new Promise((resolve,reject)=>{
  const req=https.request({host:'127.0.0.1',port:tlsPort,path:'/__vite_hmr',ca,headers:{Origin:'https://127.0.0.1:'+tlsPort,Cookie:cookie,Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':'dGhlIHNhbXBsZSBub25jZQ=='} });
  req.on('upgrade',(res,socket)=>{socket.destroy();resolve(res.statusCode)});req.on('response',res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end();
 });
 try{
  await tls.start();await ready();const ca=await tls.certificate();
  // A healthy admin API and existing CA must not imply a working TLS listener.
  const config=JSON.parse(await fs.readFile(path.join(temporary,'tls/caddy.json'),'utf8'));
  const reload=async value=>{const result=await fetch('http://'+config.admin.listen+'/load',{method:'POST',headers:{Origin:'http://'+config.admin.listen,'Content-Type':'application/json'},body:JSON.stringify(value)});assert.equal(result.status,200)};
  await reload({...config,apps:{...config.apps,http:{servers:{}}}});
  assert.equal((await tls.status()).ready,false);assert.equal(await tls.certificate(),ca);
  await reload(config);await ready();await tls.prepare(base);
  const secured=await request('/setup',ca);assert.equal(secured.status,200);assert.match(secured.body,/Choose/);
  assert.equal(secured.headers['referrer-policy'],'strict-origin-when-cross-origin');
  assert.equal((await fetch(base+'/setup')).headers.get('referrer-policy'),'strict-origin-when-cross-origin');
  const direct=await request('/setup/continue',ca);assert.equal(direct.status,303);assert.equal(direct.headers.location,'/setup');
  assert.equal(await upgrade(ca),101);
  await assert.rejects(request('/setup',undefined));
  const game=await request('/CODE/adventure_land/universal-loader.js',ca,{headers:{Origin:'https://adventure.land'}});assert.equal(game.status,200);assert.equal(game.headers['access-control-allow-origin'],'https://adventure.land');
  assert.equal((await request('/setup/state',ca,{headers:{Origin:'https://evil.example'}})).status,403);
  const spoof=await fetch(base+'/setup/state',{headers:{Origin:'https://127.0.0.1:'+tlsPort,'X-Forwarded-Proto':'https','X-Party-TLS':'fake'}});assert.equal(spoof.status,403);
  const added=await tls.prepare('http://192.168.1.239:3010');assert.equal(added.origin,'https://192.168.1.239:'+tlsPort);assert.equal(await tls.certificate(),ca);
  // Simulate Docker NAT: the local socket IP differs from the browser's URL,
  // and an IP URL sends no SNI. Still verify both the CA and intended IP.
  const noSNI=()=>new Promise((resolve,reject)=>{
   const socket=nodeTLS.connect({host:'127.0.0.2',port:tlsPort,servername:'',ca,
    checkServerIdentity:(_host,cert)=>nodeTLS.checkServerIdentity('192.168.1.239',cert)},()=>{socket.end();resolve()});
   socket.setTimeout(5000,()=>socket.destroy(Error('No-SNI TLS timed out')));socket.on('error',reject);
  });
  // prepare() must wait for the newly requested leaf certificate, not just the CA/admin API.
  await noSNI();
  const credential=await access.setRequired(true),cookie='party='+credential;
  assert.equal(await upgrade(ca),403);assert.equal(await upgrade(ca,cookie),101);
  const transfer=await(await fetch(base+'/setup/transfer',{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({origin:base,placement:'remote',client:'windows-steam'})})).json();
  assert.equal(transfer.action,'https://127.0.0.1:'+tlsPort+'/setup/check-https');assert.equal(transfer.action.includes(transfer.ticket),false);
  for(const origin of ['null','https://evil.example'])assert.equal((await request('/setup/continue',ca,{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket:transfer.ticket}).toString()})).status,400);
  const moved=await request('/setup/continue',ca,{method:'POST',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket:transfer.ticket}).toString()});
  assert.equal(moved.status,303);assert.ok(moved.headers['set-cookie'][0].includes('Secure'));assert.ok(!moved.headers.location.includes(transfer.ticket));
  const newCookie=moved.headers['set-cookie'][0].split(';')[0];assert.equal((await request('/setup/state',ca,{headers:{Cookie:newCookie}})).status,200);
  const inline=await(await fetch(base+'/setup/transfer',{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({origin:base,placement:'remote',client:'windows-steam'})})).json();
  const check={method:'POST',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket:inline.ticket}).toString()};
  const verified=await request('/setup/check-https',ca,check);
  assert.equal(verified.status,200);assert.equal(verified.headers['access-control-allow-origin'],base);assert.equal(verified.headers['set-cookie'],undefined);
  assert.deepEqual(JSON.parse(verified.body),{ok:true,origin:'https://127.0.0.1:'+tlsPort});
  assert.equal((await request('/setup/check-https',ca,check)).status,400);
  const download=await request('/setup/trust/windows',ca,{headers:{Cookie:newCookie}});assert.equal(download.status,200);
  assert.match(download.headers['content-disposition'],/party-console-trust.cmd/);
  const helper=Buffer.from(download.body.split('::PARTY_PAYLOAD::').at(-1),'base64').toString('utf16le');
  assert.ok(!helper.includes('PRIVATE KEY'));assert.match(helper,/CurrentUser/);assert.ok(!helper.includes('__CERT_'));assert.match(helper,/already installed/);
  if(process.platform==='win32'){
   const helperPath=path.join(temporary,'party console trust.cmd');
   await fs.writeFile(helperPath,download.body);
   const run=require('node:child_process').spawnSync(process.env.ComSpec||'cmd.exe',['/d','/c',`call "${helperPath}"`],{input:'NO\r\n\r\n',encoding:'utf8',timeout:15000,windowsHide:true,windowsVerbatimArguments:true});
   assert.equal(run.status,0,run.stdout+run.stderr);
   assert.match(run.stdout,/Cancelled\. No certificate was changed\./);
  }
  assert.ok(download.body.split('\r\n').filter(line=>!line.startsWith('::PARTY_PAYLOAD::')).every(line=>line.length<8191));
  const linux=await request('/setup/trust/linux',ca,{headers:{Cookie:newCookie}});assert.match(linux.body,/update-ca-trust/);assert.ok(!linux.body.includes('__CERT_'));
  assert.equal((await request('/setup/trust/windows',ca)).status,401);
  const loader=await request('/setup/steam',ca,{method:'POST',headers:{Cookie:newCookie,Origin:'https://127.0.0.1:'+tlsPort,'Content-Type':'application/json'},body:JSON.stringify({origin:'https://127.0.0.1:'+tlsPort})});
  assert.match(JSON.parse(loader.body).code,/https:\/\/127\.0\.0\.1:\d+\/bridge\/[a-f0-9]{64}\//);
  assert.equal((await request('/setup/continue',ca,{method:'POST',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket:transfer.ticket}).toString()})).status,400);
  tls.stop();await delay(1000);tls=new LocalTLS(path.resolve(__dirname,'../..'),temporary,port);options.tls=tls;await tls.start();await ready();assert.equal(await tls.certificate(),ca);
  await noSNI();
 }finally{tls.stop();for(const socket of sockets)socket.destroy();await close(server);await close(upstream);if(old===undefined)delete process.env.AL_HTTPS_PORT;else process.env.AL_HTTPS_PORT=old;await delay(1000);await fs.rm(temporary,{recursive:true,force:true})}
});
