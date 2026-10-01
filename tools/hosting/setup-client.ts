export const setupClient = String.raw`
const el=id=>document.getElementById(id);
let state={},serverAddress=location.origin,loaderOrigin='',secureOrigin='',forceHttps=false;
let returnTimer,pollTimer,linkGeneration=0,connectionRequest=null,linkReady=false,countingDown=false;
function stopLinking(){linkGeneration++;clearTimeout(pollTimer);clearInterval(returnTimer);connectionRequest?.abort();connectionRequest=null;linkReady=false;countingDown=false;el('linkStatus').style.color=''}
function sessionVisible(visible){el('session').type=visible?'text':'password';const label=visible?'Hide game session':'Show game session';el('toggleSession').setAttribute('aria-label',label);el('toggleSession').setAttribute('aria-pressed',String(visible));el('toggleSession').title=label;el('sessionSlash').style.display=visible?'':'none'}
el('toggleSession').onclick=()=>sessionVisible(el('session').type==='password');
async function call(path,body){const r=await fetch('/setup/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error||'Setup request failed');return data}
const action=(id,fn)=>el(id).onclick=async()=>{el(id).disabled=true;el('error').textContent='';try{await fn()}catch(e){el('error').textContent=e.message}finally{el(id).disabled=false}};
function preferences(){return {placement:el('placement').value,client:el('client').value,https:forceHttps}}
function savePreferences(){try{localStorage.setItem('party-connection-setup',JSON.stringify(preferences()))}catch{}}
function restorePreferences(){
 let p={};try{p=JSON.parse(localStorage.getItem('party-connection-setup')||'{}')}catch{}
 const q=new URLSearchParams(location.search);if(q.has('placement'))p={placement:q.get('placement'),client:q.get('client'),https:q.get('https')==='1'};
 el('placement').value=p.placement||'';el('client').value=p.client||'';forceHttps=p.https===true;
}
function selection(){
 stopLinking();savePreferences();loaderOrigin='';secureOrigin='';el('code').value='';el('copy').disabled=true;
 el('success').hidden=true;el('linkStatus').textContent='';el('instructions').hidden=true;el('tlsSteps').hidden=true;el('loaderArea').hidden=true;
 el('httpsStatus').textContent='';
 const p=preferences();if(!p.placement||!p.client)return;
 void call('client',p).catch(e=>{el('error').textContent=e.message});
 const https=forceHttps||p.placement==='remote'||p.client==='linux-steam';
 el('instructions').hidden=false;el('fallback').hidden=https;
 if(https){
  el('tlsSteps').hidden=false;el('helper').href='/setup/trust/'+(p.client.startsWith('linux')?'linux':'windows');
  el('helperCommand').textContent=p.client.startsWith('linux')?'bash ~/Downloads/party-console-trust.sh':'Double-click party-console-trust.cmd in Downloads. No terminal command is needed.';
  el('tlsState').textContent=state.tls?.error||'Prepare HTTPS, then install this console’s certificate on the computer running Adventure Land.';
  el('trustDownloads').hidden=true;el('prepare').disabled=!state.tls?.ready;
  if(state.secure){secureOrigin=location.origin;loaderOrigin=secureOrigin;el('tlsState').textContent='HTTPS works in this browser. Use the code below.';el('loaderArea').hidden=false}
 }else{
  loaderOrigin='http://127.0.0.1:'+(state.httpPort||new URL(serverAddress).port||3010);el('loaderArea').hidden=false;
 }
 el('address').textContent=loaderOrigin||serverAddress;
 if(loaderOrigin)void generateLoader().catch(e=>{el('error').textContent=e.message});
}
el('placement').onchange=()=>{forceHttps=false;selection()};el('client').onchange=()=>{forceHttps=false;selection()};
el('fallback').onclick=()=>{forceHttps=true;selection()};
function returnToDashboard(){
 if(countingDown)return;countingDown=true;clearTimeout(pollTimer);clearInterval(returnTimer);let seconds=5;el('success').hidden=true;el('error').textContent='';el('linkStatus').style.color='#86efac';
 const update=()=>el('linkStatus').textContent='Client connected. Taking you to the dashboard in '+seconds+'…';update();
 returnTimer=setInterval(()=>{seconds--;if(seconds===0){clearInterval(returnTimer);location.assign(state.secure?location.origin+'/':'/');return}update()},1000);
}
async function watchConnection(generation){
 if(generation!==linkGeneration||!linkReady||countingDown||connectionRequest)return;
 clearTimeout(pollTimer);const controller=new AbortController();connectionRequest=controller;const timeout=setTimeout(()=>controller.abort(),8000);
 try{const r=await fetch('/party-api/steam/connection',{cache:'no-store',signal:controller.signal});if(!r.ok)throw Error('unavailable');const s=await r.json();if(generation!==linkGeneration)return;
  if(s.connected===true){el('linkStatus').textContent='Client connected.';returnToDashboard();return}el('linkStatus').textContent='Waiting for your client to connect…';
 }catch{if(generation!==linkGeneration)return;el('linkStatus').textContent='Waiting for the console. Connection check will retry…'}
 finally{clearTimeout(timeout);if(connectionRequest===controller)connectionRequest=null}
 if(generation===linkGeneration&&!countingDown)pollTimer=setTimeout(()=>watchConnection(generation),2000);
}
async function generateLoader(){
 if(!loaderOrigin)throw Error('Choose your setup and check HTTPS first');stopLinking();const generation=linkGeneration;
 el('linkStatus').textContent='Preparing your client code…';
 let r;try{r=await call('steam',{origin:loaderOrigin,...preferences()})}catch(e){if(generation!==linkGeneration)return;el('linkStatus').textContent='Could not prepare client code. Choose your setup again to retry.';throw e}if(generation!==linkGeneration)return;
 el('code').value=r.code;el('copy').disabled=false;linkReady=true;el('linkStatus').textContent='Waiting for your client to connect…';void watchConnection(generation);
}
async function refresh(){
 state=await call('state');serverAddress=state.serverAddress||location.origin;el('address').textContent=serverAddress;
 el('pair').hidden=true;el('settings').hidden=false;el('account').hidden=!state.canConfigureAccount||state.configured;el('paths').hidden=!state.configured;el('invite').hidden=!state.requirePairing;
 const selected=el('realm').value,realms=state.realms||[];
 el('realm').replaceChildren(...realms.map(realm=>new Option(realm,realm)));
 if(realms.includes(selected))el('realm').value=selected;
 el('realm').disabled=realms.length===0;el('connect').disabled=realms.length===0;
 el('realmState').textContent=state.realmError||'';
 el('loaderHelp').textContent=state.requirePairing?'Keep this code private: it grants control of this console.':'';
 el('error').textContent='';selection();
}
action('prepare',async()=>{
 stopLinking();const generation=linkGeneration;
 const origin=el('override').value.trim()||(el('placement').value==='same'?'http://127.0.0.1:'+(state.httpPort||3010):serverAddress);
 const result=await call('https',{origin});if(generation!==linkGeneration)return;
 secureOrigin=result.origin;el('trustDownloads').hidden=false;el('fingerprint').textContent=result.fingerprint;
 el('tlsState').textContent='HTTPS prepared at '+secureOrigin+'. Install the certificate, then check the connection.';
});
action('checkHttps',async()=>{
 if(!secureOrigin)throw Error('Prepare HTTPS first');savePreferences();stopLinking();const generation=linkGeneration;
 loaderOrigin='';el('code').value='';el('copy').disabled=true;el('loaderArea').hidden=true;
 const status=el('httpsStatus');status.style.color='#f4f4f5';status.textContent='Checking HTTPS…';
 try{
  const result=await call('transfer',{origin:secureOrigin,...preferences()});if(generation!==linkGeneration)return;
  const response=await fetch(result.action,{method:'POST',mode:'cors',credentials:'omit',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket:result.ticket}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('HTTPS check rejected');const checked=await response.json();if(!checked.ok)throw Error('HTTPS check rejected');if(generation!==linkGeneration)return;
  loaderOrigin=checked.origin;el('address').textContent=loaderOrigin;el('loaderArea').hidden=false;
  status.style.color='#86efac';status.textContent='HTTPS connection verified. This browser trusts Party Console. Paste the code below into your game client.';
 }catch(e){if(generation!==linkGeneration)return;status.style.color='#fca5a5';status.textContent='Could not verify HTTPS. If you already installed the certificate, try restarting your browser and the Adventure Land client. Open '+secureOrigin+'/setup in a new tab to see any certificate error, then retry this check.';return}
 await generateLoader();
});
action('pairButton',async()=>{await call('pair',{token:location.hash.slice(1)});history.replaceState(null,'','/setup');await refresh()});
action('connect',async()=>{await call('session',{session:el('session').value,realm:el('realm').value});el('session').value='';sessionVisible(false);await refresh();el('success').hidden=false;el('success').textContent='Account connected. Choose how to run your characters below.'});
action('copy',async()=>{try{await navigator.clipboard.writeText(el('code').value);if(!countingDown)el('linkStatus').textContent='Copied. Paste into CODE and click Engage.'}catch{el('code').focus();el('code').select();if(!countingDown)el('linkStatus').textContent='Code selected. Copy it and paste into CODE.'}});
action('revoke',async()=>{if(confirm('Revoke private client tokens? Direct tokenless loaders are unaffected.')){await call('revoke',{});stopLinking();el('success').hidden=true;el('code').value='';el('copy').disabled=true;el('linkStatus').textContent='Client tokens revoked. Choose your setup again to create a new loader.'}});
action('invite',async()=>{const r=await call('invite',{});el('invitation').textContent=location.origin+'/setup#'+r.token});
function resumeConnection(){if(document.visibilityState!=='hidden')void watchConnection(linkGeneration)}
addEventListener('focus',resumeConnection);document.addEventListener('visibilitychange',resumeConnection);
el('continue').onclick=stopLinking;addEventListener('pagehide',stopLinking);restorePreferences();
refresh().catch(e=>{el('pair').hidden=false;el('error').textContent=e.message});
`;
