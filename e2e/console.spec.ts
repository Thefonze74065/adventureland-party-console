import './character-sections.case';
import './npc-sale-reserve.case';
import './elixir-restock.case';
import './map-sprites.case';
import './drop-rewards.case';
import './release-ui.case';
import './market-preferences.case';
import { test, expect } from './fixtures';
import { fetchFullState } from './state-route';
import './gear-comparison.case';
import './steam-audio.case';
import './steam-pending-recovery.case';
import './steam-desktop-arrival.case';
import './tracktrix-drilldown.case';
import './item-card.case';
import './character-card.case';
import './comparison-card.case';
import './skill-card.case';
import './monster-card.case';
import './stat-colors.case';
import './catalog-comparison.case';
import './bestiary-events.case';
import './item-titles.case';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { transform, build } from 'esbuild';
import { LocalSteam, type DesktopPorts } from '../tools/steam/service';
import { SteamPreferenceStore } from '../tools/steam/preferences';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { gateway } from '../tools/hosting/gateway';
import { Access } from '../tools/hosting/access';
import { startupRealms } from '../tools/hosting/realms';
import { accountConfig, sessionValue } from '../tools/hosting/account';
import ts from 'typescript';

test('Steam merchant realm switch replaces its page and resumes saved progress', async ({ page }, info) => {
  // Failure modes: Steam waits forever; headless navigates; IV/V rejected;
  // rejected HTTP switches navigate; saved completed listings bought twice.
  // Desktop Steam, coordinator dispatch, and native purchases are external
  // boundaries here. Maintained functions execute in a real browser and use
  // HTTP switch/receipt boundaries and actual page replacement.
  const source=readFileSync('characters/shared.js','utf8');
  const tree=ts.createSourceFile('shared.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const pieces:string[]=[];
  let nativeSwitch='';
  function visit(node:ts.Node){
    if(ts.isFunctionDeclaration(node)&&node.name&&['realmPagePath','awaitRealmRestart','merchantPontyBuy','merchantJoinGiveaway','merchantALDataBuy','merchantALDataSell','merchantIdle'].includes(node.name.text))pieces.push(node.getText(tree));
    if(ts.isIfStatement(node)&&node.expression.getText(tree)==='command.type === "native-realm-switch"')nativeSwitch=node.getText(tree);
    ts.forEachChild(node,visit);
  }
  visit(tree);
  const packets:{url:string;body:any}[]=[];
  let reject=false;
  await page.route('http://merchant.test/**',async route=>{
    const request=route.request();
    if(request.method()==='POST'){
      packets.push({url:new URL(request.url()).pathname,body:request.postDataJSON()});
      await route.fulfill({status:reject?409:200,json:{ok:!reject}});
    }else await route.fulfill({contentType:'text/html',body:'<body>Merchant native page boundary</body>'});
  });
  async function install(headless=false){
    await page.addScriptTag({content:`var character={name:'Patinder',gold:1000,items:Array(42).fill(null)};
      parent.server_region='US';parent.server_identifier='III';parent.caracAL=${headless?'{}':'null'};
      var switchAccepted=false;
      async function request(url,args){var response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args.body)});if(!response.ok)throw Error('Rejected switch');var body=await response.json();if(url==='/merchant/realm-switch')switchAccepted=true;return body;}
      var root=window,lastCommand=0,merchantIdleActive=false,merchantHomeRealm='SR_USII';function game_log(){};
      async function refreshPontyListings(){};${pieces.join('\n')}
      async function nativeSwitch(command){${nativeSwitch}}`});
  }
  const listing={key:'listing-86',rid:'native-listing',item:{name:'coat',level:0},quantity:1,unitPrice:100,price:100,serverRegion:'US',serverIdentifier:'II'};
  await page.goto('http://merchant.test/character/Patinder/in/US/III/');await install();
  await page.evaluate(listing=>{void (window as any).merchantPontyBuy({jobId:'issue-86',listings:[listing]});},listing);
  await expect(page).toHaveURL('http://merchant.test/character/Patinder/in/US/II/');
  expect(packets[0].body.realm).toBe('SR_USII');
  await install();
  await page.evaluate(async listing=>{await (window as any).merchantPontyBuy({jobId:'issue-86',listings:[listing],completedListingKeys:[listing.key]});},listing);
  expect(packets.find(packet=>packet.url==='/merchant/complete')?.body.success).toBe(true);
  await page.goto('http://merchant.test/character/Patinder/in/US/III/');await install(true);
  await page.evaluate(listing=>{void (window as any).merchantPontyBuy({jobId:'headless-86',listings:[listing]});},listing);
  await expect.poll(()=>packets.some(packet=>packet.body.jobId==='headless-86')).toBe(true);
  await expect.poll(()=>page.evaluate(()=>(window as any).switchAccepted)).toBe(true);
  expect(page.url()).toBe('http://merchant.test/character/Patinder/in/US/III/');
  await install();reject=true;
  const rejection=await page.evaluate(async listing=>{try{await (window as any).merchantPontyBuy({jobId:'rejected-86',listings:[listing]});return null;}catch(error){return String(error);}},listing);
  expect(rejection).toContain('Rejected switch');expect(page.url()).toBe('http://merchant.test/character/Patinder/in/US/III/');reject=false;
  for(const [handler,command] of [
    ['merchantJoinGiveaway',{jobId:'giveaway-86',realm:'SR_USII'}],
    ['merchantALDataBuy',{jobId:'aldata-buy-86',listings:[listing]}],
    ['merchantALDataSell',{jobId:'aldata-sale-86',buyOrder:{item:{name:'coat'},buyer:'Buyer',serverRegion:'US',serverIdentifier:'II'}}],
    ['merchantIdle',{homeRealm:'SR_USII'}],
  ] as const){
    await page.goto('http://merchant.test/character/Patinder/in/US/III/');await install();
    await page.evaluate(({handler,command})=>{const host=window as any;host.character.items[0]={name:'coat'};void host[handler](command);},{handler,command});
    await expect(page).toHaveURL('http://merchant.test/character/Patinder/in/US/II/');
  }
  const destinations=[];
  for(const [realm,destination] of [['SR_USI','US/I'],['SR_USII','US/II'],['SR_USIII','US/III'],['SR_USIV','US/IV'],['SR_USV','US/V'],['SR_EUIV','EU/IV'],['SR_ASIAII','ASIA/II'],['SR_USPVP','US/PVP']]){
    await page.goto('http://merchant.test/start');await install();
    await page.evaluate(realm=>{void (window as any).nativeSwitch({type:'native-realm-switch',realm});},realm);
    await expect(page).toHaveURL(`http://merchant.test/character/Patinder/in/${destination}/`);
    destinations.push({realm,url:page.url()});
  }
  await install();expect(await page.evaluate(()=>(window as any).realmPagePath('SR_MOON'))).toBeNull();
  expect(await page.evaluate(async()=>{try{await (window as any).nativeSwitch({type:'native-realm-switch',realm:'SR_MOON'});return null;}catch(error){return String(error);}})).toContain('Invalid realm switch destination');
  await info.attach('steam-merchant-realm-ledger',{body:JSON.stringify({packets,destinations}),contentType:'application/json'});
  await info.attach('steam-merchant-realm-page',{body:await page.screenshot(),contentType:'image/png'});
});
const graceReference:{nativeSha256:string;results:{grade:number;choice:Record<string,unknown>;quantity:number;target:number;result:{attempts:number;budget:number;scrolls:number[]}}[]}=JSON.parse(readFileSync(new URL('./upgrade-grace-reference.json',import.meta.url),'utf8'));

test('merchant logistics shows capacity blocked collection in red and clears when space returns',async({page,app},info)=>{
  const initial=await app.state();
  let occupied=39;
  let cooldown=0;
  await page.route('**/party-api/dashboard-stream',route=>route.abort());
  // Declared status read boundary: exercise dashboard presentation, not native transfers.
  await page.route('**/party-api/state*',async route=>{
    const response=await fetchFullState(route),state=await response.json();
    await route.fulfill({response,json:{...state,merchantCharacter:'M',merchantCurrent:null,
      characters:{...initial.characters,...state.characters,M:{...initial.characters.M,...state.characters?.M,items:Array.from({length:42},(_,slot)=>slot<occupied?{slot,item:{name:'helmet'}}:null)}},
      gatheringModes:['fishing','mining'],gatheringCooldowns:{fishing:cooldown,mining:cooldown},
      merchantQueue:[{id:'capacity-collection',reason:'party collection',target:'GermanicHP',priority:82}]}});
  });
  await page.goto('/');
  await page.getByText(/Merchant logistics ·/).click();
  const row=page.locator('div').filter({has:page.locator('span[title="Item collection · GermanicHP"]')}).last();
  const status=row.getByText('blocked',{exact:true});
  await expect(status).toBeVisible();
  const color=await status.evaluate(element=>{
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d')!;
    context.fillStyle=getComputedStyle(element).color;context.fillRect(0,0,1,1);
    return Array.from(context.getImageData(0,0,1,1).data);
  });
  expect(color[0]).toBeGreaterThan(color[1]);expect(color[0]).toBeGreaterThan(color[2]);
  await expect(status).toHaveAttribute('title',/39\/42/);
  for(const mode of ['Fishing','Mining']){
    const gathering=page.locator(`span[title="${mode} · M"]`).locator('..');
    await expect(gathering.getByText('BLOCKED',{exact:true})).toBeVisible();
  }
  await info.attach('merchant-capacity-blocked',{body:await page.screenshot(),contentType:'image/png'});
  occupied=38;
  await expect(row.getByText('queued',{exact:true})).toBeVisible();
  await expect(page.getByText('BLOCKED',{exact:true})).toHaveCount(0);
  await info.attach('merchant-capacity-restored',{body:await page.screenshot(),contentType:'image/png'});
  cooldown=Date.now()+600000;
  await expect(page.locator('span[title="Fishing · M"]')).toHaveCount(0);
  await expect(page.locator('span[title="Mining · M"]')).toHaveCount(0);
});

test('uncertain merchant upgrade shows red diagnostics and authoritative UTC retry time',async({page,app},info)=>{
  const initial=await app.state();
  const enabled=Object.fromEntries(Object.keys(initial.merchantAutomations).map(name=>[name,false]));
  const configuration=await page.request.post('/party-api/merchant/routine-priorities',{headers:{Origin:app.url},data:{priorities:{},enabled}});
  expect(configuration.ok()).toBe(true);
  // The console worker has no native executor. Complete its already admitted
  // fixture luck visit through the real receipt boundary before the order.
  const automatic=(await app.state()).merchantCurrent;
  if(automatic) await app.deliverMerchantCompletion({jobId:automatic.id,commandId:automatic.commandId,success:true});
  const source=initial.merchantCatalog.allItems.find((item:any)=>item.id==='staff');
  const choice={id:'staff',name:source.name,cost:Number(source.meta.definition.g),seller:'basics',sprite:null,upgradeable:true,upgradeGrade:0,
    upgradeChances:[1,.9999999,.98,.95,.7,.6,.4,.25,.15,.07,.024,.14,.11],grades:[9,10,11,12],scrollCosts:[1000,40000,1600000,64000000]};
  await app.deliverStatus({...initial.characters.M,name:'M',ctype:'merchant',clientVersion:17175,merchantCatalog:{...initial.merchantCatalog,buyable:[choice]}});
  const response=await page.request.post('/party-api/merchant/order',{headers:{Origin:app.url},data:{buys:[{id:choice.id,quantity:1,level:1}]}});
  expect(response.ok()).toBe(true);
  await expect.poll(async()=>(await app.state()).merchantCurrent?.reason).toBe('merchant commerce');
  const current=(await app.state()).merchantCurrent;
  const error=`Upgrade outcome uncertain; ${choice.id} from +0 to +1 at inventory slot 7; inventory review required`;
  await app.deliverMerchantCompletion({jobId:current.id,commandId:current.commandId,success:false,failureKind:'commerce_recovery',error});
  await expect.poll(async()=>(await app.state()).merchantActivity.some((entry:any)=>entry.level==='error'&&JSON.stringify(entry.details).includes(error))).toBe(true);
  const state=await app.state(),retry=state.merchantQueue.find((job:any)=>job.resumedFrom===current.id);
  expect(retry.retryAt).toBeGreaterThan(Date.now());
  const timestamp=new Date(retry.retryAt).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' UTC');
  await page.goto('/');
  const merchant=page.locator('article').filter({has:page.getByRole('heading',{name:'M',exact:true})});
  await merchant.locator('summary').filter({hasText:/^Activity$/}).click();
  const line=page.locator('p').filter({hasText:`Retrying order at ${timestamp}`});
  await expect(line).toBeVisible();
  await expect(line).toContainText(error);
  const {color,channels}=await line.evaluate(element=>{
    const color=getComputedStyle(element).color,canvas=document.createElement('canvas');
    canvas.width=canvas.height=1;
    const context=canvas.getContext('2d')!;
    context.fillStyle=color;
    context.fillRect(0,0,1,1);
    return {color,channels:Array.from(context.getImageData(0,0,1,1).data)};
  });
  expect(channels[0]).toBeGreaterThan(channels[1]);
  expect(channels[0]).toBeGreaterThan(channels[2]);
  await info.attach('merchant-uncertain-retry-state',{body:JSON.stringify({state,retry,error,color}),contentType:'application/json'});
  await info.attach('merchant-uncertain-retry-console',{body:await page.screenshot(),contentType:'image/png'});
});

test('merchant grade estimates match the native grace reference in dashboard and queued orders',async({page,app},info)=>{
  // Failure modes: grade replaces igrace; dashboard/server disagree; a partial
  // simulation produces a false percentile. Fixed reference numbers were
  // calculated with the published server's grace expressions, zero unobservable
  // server/overall grace, and the existing deterministic seed (not this estimator).
  test.setTimeout(90_000);
  const initial=await app.state(),original=initial.merchantCatalog,observed:any[]=[];
  await page.goto('/');
  const merchant=page.locator('article').filter({has:page.getByRole('heading',{name:'M',exact:true})});
  await expect(merchant.getByRole('button',{name:'Buy',exact:true})).toBeVisible();
  for(const reference of graceReference.results){
    const choice={...reference.choice,name:`Native grace staff (grade ${reference.grade})`,seller:'basics',sprite:null};
    await app.deliverStatus({...initial.characters.M,name:'M',ctype:'merchant',clientVersion:17175,merchantCatalog:{...original,buyable:[choice]}});
    await merchant.getByRole('button',{name:'Buy',exact:true}).click();
    const shopping=page.getByRole('dialog',{name:'Merchant shopping'});
    await expect(shopping.getByText(choice.name,{exact:true})).toBeVisible();
    await shopping.getByRole('button',{name:'Add',exact:true}).click();
    await shopping.getByTitle('Desired upgrade level').fill(String(reference.target));
    await expect(shopping.getByText(`Gold (est): ${reference.result.budget.toLocaleString()}g`,{exact:true})).toBeVisible({timeout:30_000});
    await expect(shopping.getByText(new RegExp(`90% budget: ${reference.result.attempts} base items`))).toBeVisible();
    await info.attach(`native-grace-grade-${reference.grade}`,{body:await page.screenshot(),contentType:'image/png'});
    await shopping.getByRole('button',{name:'Buy all',exact:true}).click();
    await expect(shopping).not.toBeVisible();
    await expect.poll(async()=>{
      const state=await app.state();return [state.merchantCurrent,...state.merchantQueue].some((job:any)=>job?.order?.buys.some((line:any)=>line.budget===reference.result.budget&&line.attempts===reference.result.attempts&&JSON.stringify(line.scrolls)===JSON.stringify(reference.result.scrolls)));
    }).toBe(true);
    observed.push({reference,state:await app.state()});
  }
  await info.attach('native-grace-reference-and-queued-budgets',{body:JSON.stringify({reference:graceReference,observed}),contentType:'application/json'});
});

test('merchant estimates stay responsive and require capped confirmation when unavailable', async ({page,app},info)=>{
  // Failure inventory: impossible target hangs rendering; partial simulations
  // invent a price; cancellation submits; missing/invalid caps bypass consent;
  // coordinator trusts a supplied estimate; restart loses the spending cap.
  // The console fixture owns account/game reports, not native production.
  test.setTimeout(90_000);
  const state=await app.state();
  // Declare one actual gold-shop item's catalog metadata at the fixture's
  // external game boundary; the coordinator handles and persists real orders.
  const source=state.merchantCatalog.allItems.find((entry:any)=>entry.id==='staff');
  const choice={id:'staff',name:source.name,cost:Number(source.meta.definition.g),seller:'basics',sprite:null,upgradeable:true,upgradeGrade:0,
    upgradeChances:[1,.9999999,.98,.95,.7,.6,.4,.25,.15,.07,.024,.14,.11],grades:[9,10,11,12],scrollCosts:[1000,40000,1600000,64000000]};
  const report={...state.characters.M,name:'M',ctype:'merchant',clientVersion:17175,merchantCatalog:{...state.merchantCatalog,buyable:[choice]}};
  await app.deliverStatus(report);
  await page.goto('/');
  const card=page.locator('article').filter({has:page.getByRole('heading',{name:'M',exact:true})});
  await card.getByRole('button',{name:'Buy',exact:true}).click();
  const shopping=page.getByRole('dialog',{name:'Merchant shopping'});
  await shopping.getByPlaceholder('Search items…').fill(choice.name);
  await shopping.getByRole('button',{name:'Add',exact:true}).click();
  const target=shopping.getByTitle('Desired upgrade level');
  await target.fill('91');
  await expect(target).toHaveValue('+12');
  await shopping.getByPlaceholder('Search items…').fill('responsive');
  await expect(shopping.getByPlaceholder('Search items…')).toHaveValue('responsive');
  await expect(shopping.getByText('Unable to estimate',{exact:true})).toBeVisible({timeout:30_000});
  await shopping.getByRole('button',{name:'Buy all',exact:true}).click();
  const warning=page.getByRole('dialog',{name:'Unable to estimate this order'});
  await expect(warning).toContainText('Unable to estimate how many operations are required to fill this order. Are you sure?');
  await expect(warning.getByRole('button',{name:'Confirm order',exact:true})).toBeDisabled();
  await warning.getByRole('button',{name:'Cancel',exact:true}).click();
  const before=await app.state();
  const invalidPromise=page.request.post('/party-api/merchant/order',{headers:{Origin:app.url},data:{buys:[{id:'staff',quantity:1,level:12,goldCap:1000}]}});
  const responsiveAt=Date.now();
  await page.request.get('/party-api/state?section=core');
  expect(Date.now()-responsiveAt).toBeLessThan(2000);
  const invalid=await invalidPromise;
  expect(invalid.status()).toBe(400);
  const past=await page.request.post('/party-api/merchant/order',{headers:{Origin:app.url},data:{buys:[{id:'staff',quantity:1,level:13}]}});
  expect(past.status()).toBe(400);
  await shopping.getByRole('button',{name:'Buy all',exact:true}).click();
  await warning.getByLabel(`${choice.name} maximum gold`).fill('100000');
  await info.attach('unknown-estimate-confirmation',{body:await page.screenshot(),contentType:'image/png'});
  await warning.getByRole('button',{name:'Confirm order',exact:true}).click();
  await expect.poll(async()=> {const state=await app.state();return [state.merchantCurrent,...state.merchantQueue].some((job:any)=>job?.order?.buys.some((line:any)=>line.id==='staff'&&line.goldCap===100000&&line.estimateUnavailable===true));}).toBe(true);
  await app.restartCoordinator();
  await app.deliverStatus(report);
  const after=await app.state();
  expect([after.merchantCurrent,...after.merchantQueue].some((job:any)=>job?.order?.buys.some((line:any)=>line.goldCap===100000&&line.budget===100000&&!line.attempts))).toBe(true);
  await info.attach('unknown-estimate-persisted-order',{body:JSON.stringify({before,after,invalid:await invalid.json(),past:await past.json()}),contentType:'application/json'});
});

test('held escape shows its reason and resumes only through an explicit action', async ({page},info) => {
  // Failure inventory: hidden hold reason; no release control; active rescue
  // released prematurely; failed release hides the hold; released errors linger.
  // Declare the escape read boundary; the actual Resume POST reaches the
  // coordinator. This checks console recovery controls, not rescue skill outcomes.
  let stage='failed-hold', rejectResume=true;
  const requests: {path:string,status:number}[]=[];
  await page.route('**/party-api/escape', async route => {
    if (route.request().method()!=='GET') {await route.continue();return;}
    await route.fulfill({json:{escape:{id:'console-held-escape',stage,
      error:'Missing warrior, mage, or priest',progress:{W:{error:'cant_respawn'}}}}});
  });
  await page.route('**/party-api/escape/resume',async route=>{
    if(rejectResume){requests.push({path:'/escape/resume',status:409});await route.fulfill({status:409,json:{error:'Recovery is still held'}});return;}
    const response=await route.fetch();requests.push({path:'/escape/resume',status:response.status()});
    expect(response.ok()).toBe(true);stage='released';
    await route.fulfill({response,json:{escape:{id:'console-held-escape',stage,error:null,progress:{}}}});
  });
  await page.goto('/');
  const resume=page.getByRole('button',{name:'Resume automation',exact:true});
  await expect(page.getByText('Missing warrior, mage, or priest',{exact:true})).toBeVisible();
  await expect(resume).toBeVisible();
  await resume.scrollIntoViewIfNeeded();
  await info.attach('escape-held-reason',{body:await page.screenshot(),contentType:'image/png'});
  await resume.click();
  await expect(page.getByText('Recovery is still held',{exact:true})).toBeVisible();
  await expect(resume).toBeEnabled();
  rejectResume=false;await resume.click();
  await expect(resume).toHaveCount(0);
  await expect(page.getByText('Missing warrior, mage, or priest',{exact:true})).toHaveCount(0);
  stage='blink';await page.reload();
  await expect(page.getByRole('button',{name:/Escape - failed$/})).toBeDisabled();
  await expect(resume).toHaveCount(0);
  await info.attach('escape-resume-actions',{body:JSON.stringify(requests),contentType:'application/json'});
  await info.attach('escape-active-rescue',{body:await page.screenshot(),contentType:'image/png'});
});

test('Halloween events stay opt-in, show partial-feed timers, inherit and persist', async ({page,app},info) => {
  // Failure modes: a partial feed hides supported bosses; legacy all-events flags
  // silently opt characters in; follower/merchant policy leaks; saves disappear
  // after restart; raw catalog IDs replace friendly labels or spawn countdowns.
  const ids=['slenderman','mrgreen','mrpumpkin'];
  let legacy=true;
  let inherited=false;
  const next=Date.now()+600000;
  await page.route('**/party-api/state*',async route=>{
    const response=await fetchFullState(route),state=await response.json();
    await route.fulfill({response,json:{...state,
      ...(legacy ? {eventsByCharacter:{...state.eventsByCharacter,W:true},eventSelectionsByCharacter:{...state.eventSelectionsByCharacter,W:undefined}} : {}),
      // The console fixture does not launch native workers, so observe a
      // declared managed-party projection for follower inheritance.
      ...(inherited ? {leader:'W',followers:{...state.followers,P:true}} : {}),
      eventSchedules:[{id:'mrgreen',name:'mrgreen',next},{id:'mrpumpkin',name:'mrpumpkin',next},{id:'unsupported-fixture',name:'Other event',live:true}],
    }});
  });
  await page.goto('/');
  const card=(name:string)=>page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})});
  const open=async(name:string)=>{await card(name).getByRole('button',{name:/^Events \(/}).click();};
  const row=(name:string)=>page.locator('[data-slot="popover-content"]').locator('div').filter({has:page.getByText(new RegExp(`^${name} —`))}).filter({has:page.getByRole('checkbox')}).last();
  await open('W');
  for(const name of ['Slenderman','Mr. Green','Mr. Pumpkin']) await expect(row(name).getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByText(/^Mr\. Green —.*\(\d+m \d+s\)$/)).toBeVisible();
  await expect(page.getByText(/^Mr\. Pumpkin —.*\(\d+m \d+s\)$/)).toBeVisible();
  await expect(page.getByText('Other event — Unsupported',{exact:true})).toBeVisible();
  await info.attach('halloween-legacy-opt-in',{body:await page.screenshot(),contentType:'image/png'});
  legacy=false;
  for(const name of ['Slenderman','Mr. Green','Mr. Pumpkin']) {
    // This controlled checkbox reflects the acknowledged coordinator save.
    await row(name).getByRole('checkbox').click();
    await expect.poll(async()=>{const state=await app.state();return ids.filter(id=>state.eventSelectionsByCharacter.W?.includes(id)).length;}).toBe(['Slenderman','Mr. Green','Mr. Pumpkin'].indexOf(name)+1);
    await expect(row(name).getByRole('checkbox')).toBeChecked();
  }
  // Priority failure modes: reordering changes attendance, leaks to another
  // character, loses persistence, or allows an unsupported event into the order.
  await expect(row('Other event').getByLabel('Other event priority')).toHaveText('0');
  const priorityOrder = async () => (await app.state()).eventPrioritiesByCharacter?.W;
  // Drag must visibly follow the pointer and reorder before release.
  const source = await row('Mr. Green').getByRole('button',{name:'Move Mr. Green'}).boundingBox();
  const target = await row('Anniversary').boundingBox();
  await page.mouse.move(source!.x+source!.width/2,source!.y+source!.height/2);
  await page.mouse.down();
  await page.mouse.move(target!.x+20,target!.y+4,{steps:12});
  await expect(page.getByTestId('event-drag-preview')).toBeVisible();
  await expect(row('Mr. Green').getByLabel('Mr. Green priority')).toHaveText('14');
  await info.attach('event-priority-dragging',{body:await page.screenshot(),contentType:'image/png'});
  await page.mouse.up();
  await expect.poll(priorityOrder).toEqual(['mrgreen','anniversary','abtesting','goobrawl','crabxx','franky','icegolem','snowman','slenderman','mrpumpkin','horseman','graveyard','trickortreat','witchcipher']);
  await expect(row('Mr. Green').getByLabel('Mr. Green priority')).toHaveText('14');
  // Limit settings must keep blank as unlimited, reject invalid values, and
  // persist independently of another character, without losing event opt-ins.
  await row('Mr. Green').getByRole('button',{name:'Mr. Green settings'}).click();
  await expect(page.getByLabel('Death limit',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('Time limit (mins)',{exact:true})).toHaveValue('');
  await page.getByLabel('Death limit',{exact:true}).fill('0');
  await page.getByLabel('Time limit (mins)',{exact:true}).fill('2.5');
  await expect(page.locator('[data-slot="popover-content"] [data-event="mrgreen"]')).toBeVisible();
  await info.attach('event-limit-settings',{body:await page.screenshot(),contentType:'image/png'});
  await page.getByRole('button',{name:'Save event settings',exact:true}).click();
  await expect.poll(async()=>(await app.state()).eventLimitsByCharacter.W.mrgreen).toEqual({deathLimit:0,timeLimitMinutes:2.5});
  // Saving keeps the dropdown available for editing the next event.
  await row('Mr. Pumpkin').getByRole('button',{name:'Mr. Pumpkin settings'}).click();
  await page.getByLabel('Death limit',{exact:true}).fill('1');
  await page.getByRole('button',{name:'Save event settings',exact:true}).click();
  await expect.poll(async()=>(await app.state()).eventLimitsByCharacter.W.mrpumpkin).toEqual({deathLimit:1,timeLimitMinutes:null});
  await expect(row('Mr. Green').getByRole('button',{name:'Mr. Green settings'})).toBeVisible();
  await info.attach('event-settings-dropdown-retained',{body:await page.screenshot(),contentType:'image/png'});
  await page.keyboard.press('Escape');
  inherited=true;
  await page.reload();
  await open('P');
  await expect(page.getByText('Using W’s events',{exact:true})).toBeVisible();
  await row('Mr. Green').getByRole('button',{name:'Mr. Green settings'}).click();
  await expect(page.getByLabel('Death limit',{exact:true})).toHaveValue('0');
  await expect(page.getByLabel('Death limit',{exact:true})).toBeDisabled();
  await expect(page.getByLabel('Time limit (mins)',{exact:true})).toHaveValue('2.5');
  await page.getByRole('button',{name:'Close event settings',exact:true}).click();
  for(const name of ['Slenderman','Mr. Green','Mr. Pumpkin']) {await expect(row(name).getByRole('checkbox')).toBeChecked();await expect(row(name).getByRole('checkbox')).toBeDisabled();}
  await page.keyboard.press('Escape');
  await open('M');
  await expect(row('Anniversary').getByLabel('Anniversary priority')).toHaveText('14');
  await row('Mr. Green').getByRole('button',{name:'Mr. Green settings'}).click();
  await expect(page.getByLabel('Death limit',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('Time limit (mins)',{exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'Close event settings',exact:true}).click();
  for(const name of ['Slenderman','Mr. Green','Mr. Pumpkin']) {await expect(row(name).getByRole('checkbox')).not.toBeChecked();await expect(row(name).getByRole('checkbox')).toBeEnabled();}
  await page.keyboard.press('Escape');
  await app.restartCoordinator();await page.reload();await open('W');
  for(const name of ['Slenderman','Mr. Green','Mr. Pumpkin']) await expect(row(name).getByRole('checkbox')).toBeChecked();
  await expect(row('Mr. Green').getByLabel('Mr. Green priority')).toHaveText('14');
  await row('Mr. Green').getByRole('button',{name:'Mr. Green settings'}).click();
  await expect(page.getByLabel('Death limit',{exact:true})).toHaveValue('0');
  await expect(page.getByLabel('Time limit (mins)',{exact:true})).toHaveValue('2.5');
  await page.getByRole('button',{name:'Close event settings',exact:true}).click();
  await info.attach('halloween-persisted-selections' ,{body:JSON.stringify(await app.state()),contentType:'application/json'});
  await info.attach('halloween-events-after-restart',{body:await page.screenshot(),contentType:'image/png'});
});

test.describe('marked withdrawal scheduling', () => {
  test.use({ merchantDialogs: true });
  test('marked withdrawals default on and Merchant settings survive restart', async ({page,app},info) => {
    // Failure modes: legacy settings default off; UI does not persist the
    // checkbox; restart loses disabled or enabled values. Native round-trip
    // coverage verifies the resulting withdrawal scheduling and item receipts.
    await page.goto('/');
    await page.getByRole('button', {name:'Settings',exact:true}).click();
    const settings = page.getByRole('dialog', {name:'Merchant settings',exact:true});
    const toggle = settings.getByRole('checkbox', {name:'Marked withdrawals always create merchant jobs',exact:true});
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect.poll(async () => (await app.state()).merchantAutomations.withdrawals).toBe(false);
    await app.restartCoordinator();
    await page.reload();
    await page.getByRole('button', {name:'Settings',exact:true}).click();
    await expect(toggle).not.toBeChecked();
    expect((await app.state()).merchantAutomations.withdrawals).toBe(false);
    await page.keyboard.press('Escape');
    await page.getByRole('button', {name:'Routines',exact:true}).click();
    const routines = page.getByRole('dialog', {name:/Merchant routines/});
    await expect(routines.getByRole('textbox', {name:'Marked withdrawals priority',exact:true})).toBeDisabled();
    await routines.getByRole('button', {name:'Save routines',exact:true}).click();
    expect((await app.state()).merchantAutomations.withdrawals).toBe(false);
    await page.getByRole('button', {name:'Settings',exact:true}).click();
    await toggle.check();
    await expect.poll(async () => (await app.state()).merchantAutomations.withdrawals).toBe(true);
    await info.attach('marked-withdrawals-enabled', {body:await page.screenshot(),contentType:'image/png'});
    await toggle.uncheck();
    await expect.poll(async () => (await app.state()).merchantAutomations.withdrawals).toBe(false);
    await toggle.check();
    await expect.poll(async () => (await app.state()).merchantAutomations.withdrawals).toBe(true);
    await app.restartCoordinator();
    await page.reload();
    await page.getByRole('button', {name:'Settings',exact:true}).click();
    await expect(toggle).toBeChecked();
    expect((await app.state()).merchantAutomations.withdrawals).toBe(true);
    await page.keyboard.press('Escape');
    await page.getByRole('button', {name:'Routines',exact:true}).click();
    const priority = routines.getByRole('textbox', {name:'Marked withdrawals priority',exact:true});
    await expect(priority).toBeEnabled();
    await expect(priority).toHaveValue('90');
    await priority.fill('91');
    await routines.getByRole('button', {name:'Save routines',exact:true}).click();
    await expect.poll(async () => (await app.state()).merchantRoutinePriorities.withdrawals).toBe(91);
    expect((await app.state()).merchantAutomations.withdrawals).toBe(true);
    await info.attach('marked-withdrawals-persisted', {body:JSON.stringify(await app.state()),contentType:'application/json'});
  });
});

test('Hunt blacklist picker adds unseen monsters manually and survives restart', async ({page,app},info) => {
  // Failure modes: catalog excludes unseen monsters; search hides valid entries;
  // details cannot open; add targets the wrong character; manual reason displays
  // death counts; repeat clicks duplicate entries; restart loses the addition.
  await page.goto('/');
  const warrior=page.locator('article').filter({has:page.getByRole('heading',{name:'W',exact:true})});
  await warrior.getByRole('button',{name:'Farming settings',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'Farming settings · W',exact:true});
  await settings.getByRole('button',{name:'Add',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'Add to Hunt blacklist',exact:true});
  await picker.getByRole('textbox',{name:'Search blacklist monsters'}).fill('goo');
  await picker.getByRole('button',{name:'Inspect Goo',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Goo',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await picker.getByRole('button',{name:'Add Goo to blacklist',exact:true}).click();
  await expect(picker.getByRole('button',{name:'Goo is blacklisted',exact:true})).toBeDisabled();
  await info.attach('manual-blacklist-picker',{body:await page.screenshot(),contentType:'image/png'});
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(settings.getByText('manually added',{exact:false})).toBeVisible();
  const before=await app.state();
  expect(before.farmingProfiles.W.huntBlacklist.goo).toMatchObject({reason:'Manually blacklisted',deaths:0});
  await info.attach('manual-blacklist-section',{body:await page.screenshot(),contentType:'image/png'});
  await app.restartCoordinator();
  expect((await app.state()).farmingProfiles.W.huntBlacklist).toEqual(before.farmingProfiles.W.huntBlacklist);
  await info.attach('manual-blacklist-state',{body:JSON.stringify({before,after:await app.state()}),contentType:'application/json'});
  // A restarting coordinator can publish desired slots before its first
  // character reports. Keep the open dialog through these real core responses;
  // no gameplay, persistence, other status request or timing is substituted.
  let emptyCoreSnapshots=0,recoveredCore=false;
  const observeReconnect=async(route:import('@playwright/test').Route)=>{
    if(new URL(route.request().url()).searchParams.get('section')!=='core')return route.fallback();
    const response=await route.fetch();
    if(!response.ok())return route.fulfill({response});
    const state=await response.json();
    if(emptyCoreSnapshots<2){
      await route.fulfill({response,json:{...state,characters:{}}});
      emptyCoreSnapshots++;
    }else{
      await route.fulfill({response});
      // Blacklist configuration is checked through full state above; core
      // intentionally contains only live operational reports.
      recoveredCore=!!state.characters?.W;
    }
  };
  await page.route('**/party-api/state?**',observeReconnect);
  try{
    await expect.poll(()=>emptyCoreSnapshots===2&&recoveredCore,{timeout:15_000}).toBe(true);
    await expect(settings.getByText('manually added',{exact:false})).toBeVisible();
    await info.attach('blacklist-dialog-after-empty-reconnect-snapshots',{body:await page.screenshot(),contentType:'image/png'});
  }finally{
    // Finish intercepted core fetch/fulfill operations before removing their
    // page handler; the context's network guard must not handle the same route.
    await page.unrouteAll({behavior:'wait'});
  }
  await settings.getByRole('button',{name:'Clear all',exact:true}).click();
  const confirmation=page.getByRole('dialog',{name:'Clear Hunt blacklist?',exact:true});
  await expect(confirmation).toContainText('for W');
  expect((await app.state()).farmingProfiles.W.huntBlacklist).toEqual(before.farmingProfiles.W.huntBlacklist);
  await info.attach('hunt-blacklist-clear-confirmation',{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'});
  await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
  expect((await app.state()).farmingProfiles.W.huntBlacklist).toEqual(before.farmingProfiles.W.huntBlacklist);
  await settings.getByRole('button',{name:'Clear all',exact:true}).click();
  await confirmation.getByRole('button',{name:'Clear all',exact:true}).click();
  await expect(confirmation).not.toBeVisible();
  await expect.poll(async ()=>(await app.state()).farmingProfiles.W.huntBlacklist).toEqual({});
  await info.attach('hunt-blacklist-cleared-state',{body:JSON.stringify(await app.state()),contentType:'application/json'});

});

test('blacklists survive Hunt mode changes, restart and dashboard export import', async ({page,app},info) => {
  // Failure modes: Hunt reset deletes durable exclusions/counts; exports omit
  // solo profiles; import overwrites execution state or admits unknown owners;
  // merchant exclusions disappear; explicit clear fails or affects other owners.
  const post = async (route: string, data: unknown) => {
    const response = await page.request.post(app.url + '/party-api' + route, {data,headers:{Origin:app.url}});
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const restore = async (settings: unknown) => {
    const source=JSON.stringify({format:'party-console-settings',version:1,settings});
    const headers={'Content-Type':'text/plain',Origin:app.url};
    const preview=await page.request.post(app.url+'/party-api/dashboard-state/preview',{data:source,headers});
    expect(preview.ok(),await preview.text()).toBe(true);
    const summary=await preview.json();
    const imported=await page.request.post(app.url+'/party-api/dashboard-state/import',{data:source,headers:{...headers,'X-State-Preview':summary.digest}});
    expect(imported.ok(),await imported.text()).toBe(true);
    return summary;
  };
  const blacklist={goo:{monsterId:'goo',at:Date.now(),deaths:2,expirations:0,reason:'Hunt death threshold reached'}};
  const failures={goo:{deaths:2,expirations:0}};
  const seed=await restore({farmingProfiles:{W:{huntBlacklist:blacklist,huntFailures:failures},P:{huntBlacklist:blacklist,huntFailures:failures},Unknown:{huntBlacklist:blacklist}}});
  expect(seed.skippedCharacters.Unknown).toContain('farmingProfiles');
  await post('/merchant/blacklist',{seller:'ExcludedMerchant',minutes:-1});
  await page.goto('/');
  const warrior=page.locator('article').filter({has:page.getByRole('heading',{name:'W',exact:true})});
  await warrior.getByRole('button',{name:/^Farming settings .+/}).click();
  await warrior.getByRole('button',{name:'Hunt',exact:true}).click();
  const preparation=page.getByRole('dialog',{name:'Getting ready to hunt',exact:true});
  await preparation.getByRole('button',{name:'No monsters selected 0',exact:true}).click();
  await page.getByRole('checkbox',{name:/\bGoo · goo\b/}).check();
  await page.keyboard.press('Escape');
  await preparation.locator('button[aria-pressed]').first().click();
  await preparation.getByRole('button',{name:'Save backup and start Hunt',exact:true}).click();
  await expect(preparation).not.toBeVisible();
  await post('/farming-mode',{character:'W',mode:'default'});
  expect((await app.state()).farmingProfiles.W.huntBlacklist).toEqual(blacklist);
  await app.restartCoordinator();
  expect((await app.state()).farmingProfiles.W.huntFailures).toEqual(failures);
  const exported=await (await page.request.get(app.url+'/party-api/dashboard-state/export')).json();
  expect(exported.settings.farmingProfiles.P.huntBlacklist).toEqual(blacklist);
  expect(exported.settings.farmingProfiles.W).not.toHaveProperty('monsterHunt');
  await post('/hunt-blacklist',{character:'W',action:'clear'});
  expect((await app.state()).farmingProfiles.W.huntBlacklist).toEqual({});
  expect((await app.state()).farmingProfiles.P.huntBlacklist).toEqual(blacklist);
  await post('/merchant/blacklist',{action:'clear'});
  await restore(exported.settings);
  await app.restartCoordinator();
  const final=await app.state();
  expect(final.farmingProfiles.W.huntBlacklist).toEqual(blacklist);
  expect(final.farmingProfiles.P.huntBlacklist).toEqual(blacklist);
  expect(final.merchantBlacklist).toEqual(exported.settings.merchantBlacklist);
  await page.goto('/');
  await info.attach('blacklist-export-round-trip',{body:JSON.stringify({seed,exported,final}),contentType:'application/json'});
  await info.attach('blacklist-dashboard',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});

test('setup calculates startup realms and validates account availability', async ({ browser }, info) => {
  // Failure modes: static options omit new/PVP realms; Roman-numeral validation
  // rejects live keys; every page load refetches; unavailable account realms pass;
  // a subsequent startup retains the previous list instead of discovering anew.
  let keys = ['SR_USV', 'SR_EUPVP', 'SR_ASIAV'], discoveries = 0;
  const configuredRealms: string[] = [];
  const upstream = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/' ? 'text/html' : 'application/json');
    if (req.url === '/') { discoveries++; res.end(`<script>X.servers=${JSON.stringify(keys.map(key => ({ key })))};</script>`); }
    else res.end(JSON.stringify({ characters: [{ name: 'SetupMerchant', type: 'merchant' }], servers: keys.filter(key => key !== 'SR_ASIAV').map(key => ({ key })) }));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const directory = path.resolve('.build/e2e', `setup-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  const access = new Access(path.join(directory, 'access.json')); await access.load();
  let configured = false;
  const start = async () => {
    const server = gateway({ access, configured: () => configured, dashboardPort: 1,
      realms: startupRealms(upstreamUrl), configure: async (raw, realm) => {
        const config = await accountConfig(sessionValue(raw), realm, (_url, init) => fetch(upstreamUrl + '/account', init));
        configuredRealms.push(config.characters.SetupMerchant.realm); configured = true;
      } });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return server;
  };
  let server = await start();
  const page = await browser.newPage();
  try {
    const url = () => `http://127.0.0.1:${(server.address() as { port: number }).port}/setup`;
    await page.goto(url());
    const realm = page.getByLabel('Realm', { exact: true });
    await expect(realm).toContainText('SR_USV'); await expect(realm).toContainText('SR_EUPVP'); await expect(realm).toContainText('SR_ASIAV');
    keys = [...keys, 'SR_EUVII'];
    await page.reload();
    await expect(realm).toContainText('SR_USV');
    expect(discoveries).toBe(1);
    await page.getByLabel('Game session', { exact: true }).fill('US_E2E-token');
    await realm.selectOption('SR_ASIAV'); await page.getByRole('button', { name: 'Connect account', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'That realm is not available' })).toBeVisible();
    expect(configuredRealms).toEqual([]);
    await realm.selectOption('SR_USV'); await page.getByRole('button', { name: 'Connect account', exact: true }).click();
    await expect(page.getByText('Account connected. Choose how to run your characters below.')).toBeVisible();
    expect(configuredRealms).toEqual(['SR_USV']);
    await info.attach('startup-realm-account-connection', { body: await page.screenshot(), contentType: 'image/png' });
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    configured = false; server = await start();
    await page.goto(url()); await expect(realm).toContainText('SR_EUVII');
    expect(discoveries).toBe(2);
    await info.attach('startup-realm-discovery', { body: JSON.stringify({ keys, discoveries, configuredRealms, state: await (await fetch(url().replace('/setup', '/setup/state'))).json() }), contentType: 'application/json' });
  } finally {
    await page.close(); server.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => upstream.close(() => resolve()))]);
  }
});

test('setup reports failed startup realm discovery without offering stale realms', async ({ browser }, info) => {
  // Failure modes: startup outage crashes the gateway; stale fallback realms are
  // offered; connecting is enabled with no valid selection; the failure is hidden.
  const upstream = createServer((_req, res) => { res.writeHead(503); res.end('Unavailable'); });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const access = new Access(path.resolve('.build/e2e', `setup-access-${randomUUID()}.json`)); await access.load();
  const server = gateway({ access, configured: () => false, dashboardPort: 1,
    realms: startupRealms(`http://127.0.0.1:${(upstream.address() as { port: number }).port}`), configure: async () => { throw Error('No realm available'); } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/setup`);
    await expect(page.getByRole('status').filter({ hasText: 'Could not load game realms' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect account', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Realm', { exact: true })).toBeDisabled();
    await info.attach('startup-realm-discovery-unavailable', { body: await page.screenshot(), contentType: 'image/png' });
  } finally {
    await page.close(); server.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => upstream.close(() => resolve()))]);
  }
});

test('a paired browser shows an access code that pairs exactly one other browser', async ({ browser }, info) => {
  // Failure modes: the code or link points at an internal address instead of the
  // one the browser opened; a code pairs twice; the paired browser keeps showing a
  // used code; an unpaired browser has nowhere to type the code.
  const access = new Access(path.resolve('.build/e2e', `pairing-access-${randomUUID()}.json`)); await access.load();
  const owner = (await access.setRequired(true))!;
  // The public URL differs from the address the browsers open, as it does behind a proxy.
  const server = gateway({ access, configured: () => true, dashboardPort: 1, publicUrl: 'https://party.example' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const ownerContext = await browser.newContext(), guestContext = await browser.newContext(), lateContext = await browser.newContext();
  try {
    await ownerContext.addCookies([{ name: 'party', value: owner, url: base }]);
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(base + '/setup');
    await ownerPage.getByRole('button', { name: 'Pair another browser' }).click();
    await expect(ownerPage.locator('#accessCodeValue')).toHaveText(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    const code = (await ownerPage.locator('#accessCodeValue').textContent())!;
    await expect(ownerPage.locator('#pairAddress')).toHaveText(base + '/setup');
    await expect(ownerPage.locator('#accessCodeExpiry')).toHaveText(/expires in (10:00|9:[0-5]\d)/);
    await ownerPage.getByText('Use a pairing link instead').click();
    await expect(ownerPage.locator('#invitationLink')).toHaveText(new RegExp('^' + base.replace(/[.]/g, '\\.') + '/setup#[0-9a-f]{64}$'));
    await info.attach('pairing-code-shown', { body: await ownerPage.screenshot(), contentType: 'image/png' });

    const guestPage = await guestContext.newPage();
    await guestPage.goto(base + '/setup');
    await expect(guestPage.getByRole('heading', { name: 'Pair this browser' })).toBeVisible();
    await guestPage.getByLabel('Access code').fill(code.toLowerCase());
    await guestPage.getByRole('button', { name: 'Pair browser' }).click();
    await expect(guestPage.getByRole('heading', { name: 'Connection settings' })).toBeVisible();
    await expect(guestPage.getByRole('heading', { name: 'Pair this browser' })).toBeHidden();
    expect((await guestContext.cookies(base)).some(cookie => cookie.name === 'party' && access.valid('browsers', cookie.value))).toBe(true);
    await info.attach('pairing-guest-paired', { body: await guestPage.screenshot(), contentType: 'image/png' });

    await expect(ownerPage.getByRole('status').filter({ hasText: 'The access code was used or replaced' })).toBeVisible({ timeout: 10_000 });
    await expect(ownerPage.locator('#accessCodeValue')).toBeHidden();

    const latePage = await lateContext.newPage();
    await latePage.goto(base + '/setup');
    await latePage.getByLabel('Access code').fill(code);
    await latePage.getByRole('button', { name: 'Pair browser' }).click();
    await expect(latePage.getByRole('status').filter({ hasText: 'Access code is invalid or expired' })).toBeVisible();
    await expect(latePage.getByRole('heading', { name: 'Pair this browser' })).toBeVisible();
    await info.attach('pairing-code-reused', { body: await latePage.screenshot(), contentType: 'image/png' });
  } finally {
    await Promise.all([ownerContext.close(), guestContext.close(), lateContext.close()]);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

const pageErrors = new WeakMap<object, string[]>();

test('exchange reward tiles share merchant actions and replace previous rules', async ({ page, app }, info) => {
  // Failure modes: previews cannot mark absent stock; rules differ between preview
  // and inventory; changing actions leaves conflicts; nested boxes cannot exchange;
  // non-items expose actions; rules disappear after coordinator restart.
  const evidence: unknown[] = [];
  await page.goto('/');
  const merchant = page.locator('article').filter({ has: page.getByRole('heading', { name: 'M', exact: true }) });
  await merchant.getByText('gem0', { exact: true }).click();
  const coat = page.getByRole('button', { name: /Exchange reward: coat/ });
  await expect(page.getByRole('heading', { name: 'Exchange drops', exact: true })).toBeVisible();
  await coat.click();
  const levelPreview = page.getByRole('slider');
  await levelPreview.press('Home');
  await expect(levelPreview).toHaveValue('0');
  await levelPreview.press('ArrowRight');
  await expect(levelPreview).toHaveValue('1');
  await levelPreview.press('ArrowRight');
  await expect(levelPreview).toHaveValue('2');
  await expect(page.getByText('+2', { exact: true })).toBeVisible();
  const exchangeSources = page.getByRole('heading', { name: 'Exchange reward', exact: true }).locator('..');
  const source = exchangeSources.getByRole('button', { name: /Raw Emerald/ });
  await expect(source).toBeVisible();
  await expect(source).toContainText(/\d[\d,]*\/\d[\d,]*\s+\([\d.]+%\)/);
  await source.click();
  await expect(page.getByRole('heading', { name: 'Exchange drops', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Exchange reward: gold/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Exchange reward: empty/ })).toContainText('No reward');
  for (const asset of ['gold-coins', 'no-reward']) {
    expect(await page.evaluate(async path => {
      const image = new Image(); image.src = path;
      await image.decode(); return image.naturalWidth > 0;
    }, `/images/exchange/${asset}.png`)).toBe(true);
  }
  const fullName = page.getByRole('button', { name: /Exchange reward: strring/ }).getByText('Ring of Strength', { exact: true });
  await expect(fullName).toBeVisible();
  expect(await fullName.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(coat).toContainText('Auto bank (default)');
  await coat.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Auto exchange', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Auto compound', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Auto sell to NPC…', exact: true }).click();
  await page.getByRole('button', { name: 'Enable auto sale', exact: true }).click();
  await expect(coat).toContainText('Auto sell to NPC');
  evidence.push(await app.state());
  await coat.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Auto mark for bank', exact: true }).click();
  await expect(coat).toContainText('Auto bank');
  expect(Object.values((await app.state()).autoNpcSales || {}).some((rule: any) => rule.item.name === 'coat')).toBe(false);
  const box = page.getByRole('button', { name: /Exchange reward: armorbox/ });
  await box.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Auto exchange', exact: true }).click();
  await expect(box).toContainText('Auto exchange');
  await box.click();
  await expect(page.getByRole('button', { name: /Exchange reward: coat/ })).toContainText('Auto bank');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(merchant.getByText('Auto bank', { exact: true })).toBeVisible();
  await merchant.getByText('Auto bank', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Auto sell to NPC…', exact: true }).click();
  await page.getByRole('button', { name: 'Enable auto sale', exact: true }).click();
  await merchant.getByText('gem0', { exact: true }).click();
  await expect(coat).toContainText('Auto sell to NPC');
  await coat.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Auto mark for upgrade', exact: true }).hover();
  await page.getByRole('menuitem', { name: /^\+0 → \+1 / }).click();
  await expect(coat).toContainText('Auto upgrade → +1');
  expect(Object.values((await app.state()).autoNpcSales || {}).some((rule: any) => rule.item.name === 'coat')).toBe(false);
  await info.attach('exchange-reward-upgrade', { body: await page.screenshot(), contentType: 'image/png' });
  await coat.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Auto mark for stand…', exact: true }).click();
  await page.getByRole('button', { name: 'Save auto mark', exact: true }).click();
  await expect(coat).toContainText('Auto stand');
  expect((await app.state()).autoUpgradeMarks?.M?.['coat@+0']).toBeUndefined();
  await coat.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Auto mark for bank', exact: true }).click();
  await expect(coat).toContainText('Auto bank');
  expect(Object.values((await app.state()).autoStandMarks || {}).some((rule: any) => rule.item.name === 'coat')).toBe(false);
  const ring = page.getByRole('button', { name: /Exchange reward: strring/ });
  await ring.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Auto compound', exact: true }).hover();
  await page.getByRole('menuitem', { name: /^\+1 Price unavailable$/ }).click();
  await expect(ring).toContainText('Auto compound → +1');
  await info.attach('exchange-reward-tiles', { body: await page.screenshot(), contentType: 'image/png' });
  evidence.push(await app.state());
  await app.restartCoordinator();
  expect((await app.state()).autoExchanges['armorbox@0']).toMatchObject({ name: 'armorbox', level: 0 });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await merchant.getByRole('button', { name: 'Routines', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Manual exchange', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Enable Manual exchange', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Enable Automatic exchange', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await merchant.getByRole('button', { name: 'Exchange', exact: true }).click();
  const manual = page.getByRole('dialog', { name: 'Exchange', exact: true });
  await manual.getByRole('button', { name: /^Raw Emerald/ }).click();
  const details = page.getByRole('dialog', { name: 'Raw Emerald', exact: true });
  await expect(details.getByText('Sell to NPC', { exact: true })).toBeVisible();
  await details.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(details).toHaveCount(0);
  await manual.getByRole('button', { name: 'Exchange rules for Raw Emerald', exact: true }).click();
  const manualBox = manual.getByRole('button', { name: /Exchange reward: armorbox/ });
  await expect(manualBox).toContainText('Auto exchange');
  const rules = (state: any) => ({ bank: state.autoItemMarks, npc: state.autoNpcSales, stand: state.autoStandMarks, upgrade: state.autoUpgradeMarks, compound: state.autoCompounds });
  const beforeDraft = rules(await app.state());
  await expect(manual.getByRole('button', { name: 'Bank', exact: true })).toBeDisabled();
  const toggleBounds = await manual.getByRole('button', { name: 'Mark multiple', exact: true }).boundingBox();
  await manual.getByRole('button', { name: 'Mark multiple', exact: true }).click();
  expect(await manual.getByRole('button', { name: 'Done', exact: true }).boundingBox()).toEqual(toggleBounds);
  await manual.getByRole('button', { name: 'NPC', exact: true }).click();
  await manual.getByRole('button', { name: /Exchange reward: coat/ }).click();
  await manual.getByRole('button', { name: /Exchange reward: strring/ }).click();
  await expect(manual.getByRole('button', { name: /Exchange reward: coat/ })).toContainText('Pending');
  expect(rules(await app.state())).toEqual(beforeDraft);
  await manual.getByRole('button', { name: 'Close exchange details', exact: true }).click();
  await manual.getByRole('button', { name: 'Exchange rules for Raw Emerald', exact: true }).click();
  await expect(manual.getByRole('button', { name: /Exchange reward: coat/ })).toContainText('Auto bank');
  await expect(manual.getByRole('button', { name: /Exchange reward: strring/ })).toContainText('Auto compound');
  await expect(manual.getByText('Pending', { exact: true })).toHaveCount(0);
  expect(rules(await app.state())).toEqual(beforeDraft);
  await manual.getByRole('button', { name: 'Mark multiple', exact: true }).click();
  await manual.getByRole('button', { name: 'NPC', exact: true }).click();
  await manual.getByRole('button', { name: /Exchange reward: coat/ }).click();
  await page.keyboard.press('Escape');
  await expect(manual).toHaveCount(0);
  expect(rules(await app.state())).toEqual(beforeDraft);
  await merchant.getByRole('button', { name: 'Exchange', exact: true }).click();
  await manual.getByRole('button', { name: 'Exchange rules for Raw Emerald', exact: true }).click();
  await expect(manual.getByText('Pending', { exact: true })).toHaveCount(0);
  await manual.getByRole('button', { name: 'Mark multiple', exact: true }).click();
  await manual.getByRole('button', { name: 'NPC', exact: true }).click();
  const bulkCoat = manual.getByRole('button', { name: /Exchange reward: coat/ });
  const bulkRing = manual.getByRole('button', { name: /Exchange reward: strring/ });
  await bulkCoat.click(); await bulkRing.click();
  await expect(bulkCoat).toContainText('Auto sell to NPC');
  await expect(bulkRing).toContainText('Auto sell to NPC');
  await expect(manual.getByRole('button', { name: 'NPC', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await manual.getByRole('button', { name: 'Upgrade', exact: true }).click();
  await manual.getByLabel('Bulk upgrade target level').selectOption('2');
  await expect(bulkRing).toBeDisabled();
  await expect(manualBox).toBeDisabled();
  await bulkCoat.click();
  await expect(bulkCoat).toContainText('Auto upgrade → +2');
  await manual.getByRole('button', { name: 'Stand', exact: true }).click();
  await bulkCoat.click();
  await expect(bulkCoat).toContainText('Auto stand');
  await manual.getByRole('button', { name: 'Bank', exact: true }).click();
  await bulkCoat.click(); await bulkRing.click();
  await expect(bulkCoat).toContainText('Auto bank');
  await expect(bulkRing).toContainText('Auto bank');
  await bulkCoat.click();
  await expect(bulkCoat).toContainText('Auto bank');
  expect(rules(await app.state())).toEqual(beforeDraft);
  await info.attach('exchange-bulk-marking', { body: await page.screenshot(), contentType: 'image/png' });
  await manual.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(manual.getByRole('button', { name: 'NPC', exact: true })).toBeDisabled();
  await expect(manual.getByText('Pending', { exact: true })).toHaveCount(0);
  const committedBank = rules(await app.state());
  expect(committedBank.bank.M['strring@+0']).toBe('bank');
  expect(committedBank.compound.M?.some((rule: any) => rule.name === 'strring')).toBeFalsy();
  await manual.getByRole('button', { name: 'Mark multiple', exact: true }).click();
  await manual.getByRole('button', { name: 'NPC', exact: true }).click();
  await bulkCoat.click();
  expect(rules(await app.state())).toEqual(committedBank);
  await manual.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(bulkCoat.getByText('Pending', { exact: true })).toHaveCount(0);
  expect(Object.values((await app.state()).autoNpcSales).some((rule: any) => rule.item.name === 'coat')).toBe(true);
  await manual.getByRole('button', { name: 'Mark multiple', exact: true }).click();
  await manual.getByRole('button', { name: 'Bank', exact: true }).click();
  await bulkCoat.click();
  await manual.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(bulkCoat.getByText('Pending', { exact: true })).toHaveCount(0);
  evidence.push(await app.state());

  await manualBox.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Auto mark for bank', exact: true }).click();
  await expect(manualBox).toContainText('Auto bank');
  expect((await app.state()).autoExchanges['armorbox@0']).toBeUndefined();
  await manualBox.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Auto exchange', exact: true }).click();
  await manualBox.click();
  await expect(manual.getByRole('button', { name: /Exchange reward: coat/ })).toContainText('Auto bank');
  await info.attach('manual-exchange-nested-reward-tiles', { body: await page.screenshot(), contentType: 'image/png' });
  await info.attach('exchange-shared-rules', { body: JSON.stringify(evidence), contentType: 'application/json' });
  await info.attach('manual-and-automatic-exchange-routines', { body: await page.screenshot(), contentType: 'image/png' });
});
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', message => {
    if (message.type() === 'error' && message.text().includes('Party Console render failed')) errors.push(message.text());
  });
});
test.afterEach(async ({ page }, testInfo) => {
  const errors = pageErrors.get(page) || [];
  await testInfo.attach('browser-runtime-errors', { body: Buffer.from(JSON.stringify(errors, null, 2)), contentType: 'application/json' });
  expect(errors, 'The browser must not crash during the journey').toEqual([]);
});

test('active Bankboi uses its dedicated card instead of a pending character card', async ({ page }, info) => {
  // Read-boundary fixture: a Bankboi occupies a headless slot without a normal
  // character heartbeat. Both slot-derived and explicit connection entries must
  // leave the dedicated activity card visible, without a misleading placeholder.
  await page.route('**/party-api/state*', async route => {
    const response = await fetchFullState(route);
    const state = await response.json();
    await route.fulfill({ response, json: { ...state,
      bankbois: [{ name: 'bankboi0', state: 'working', items: [] }],
      bankboiTransaction: { bankboi: 'bankboi0', mode: 'store', phase: 'processing' },
      activeSlots: [...(state.activeSlots || []), { index: 4, kind: 'headless', character: 'bankboi0', state: 'online' }, { index: 5, kind: 'headless', character: 'WaitingFighter', state: 'loading' }],
      characterConnections: [...(state.characterConnections || []), { name: 'bankboi0', status: 'waiting', primary: false, delayed: false }],
    } });
  });
  await page.goto('/');
  await expect(page.getByText(/^Bankboi\s*Active$/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'bankboi0', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'WaitingFighter', exact: true })).toBeVisible();
  await info.attach('bankboi-dedicated-active-card', { body: await page.screenshot(), contentType: 'image/png' });
});

test('Live WTB counts bank stock after empty slots without withdrawing it', async ({ page }, info) => {
  // Failure modes: empty slot objects crash rendering; later stock is omitted;
  // multiple bank stacks are undercounted; merchant-only stock stops matching;
  // the market opens without loading the bank section, so bank stock reads as 0.
  // Inject the bank/market read boundary; the dashboard and its UI actions run normally.
  // Like the coordinator, only section=bank carries the bank and only section=market the orders.
  const bank = { gold: 0, packs: { items0: [null, {}, { slot: 2, item: { name: 'leather', q: 4 } }],
    items1: [{ slot: 0, item: { name: 'leather', q: 2 } }] } };
  const orders = [
    { key: 'bank-leather', buyer: 'E2EBankBuyer', item: { name: 'leather' }, quantity: 9 },
    { key: 'inventory-sword', buyer: 'E2EInventoryBuyer', item: { name: 'sword', level: 0 }, quantity: 5 },
    { key: 'unowned-computer', buyer: 'E2EComputerBuyer', item: { name: 'computer', level: 0 }, quantity: 1 },
    { key: 'unowned-sword-level', buyer: 'E2EUpgradedBuyer', item: { name: 'sword', level: 1 }, quantity: 1 },
  ].map(order => ({ ...order, source: 'aldata', slot: 'trade1', map: 'main', x: 0, y: 0,
    price: 1000, serverRegion: 'US', serverIdentifier: 'II', lastSeen: new Date().toISOString(), seenAt: Date.now() }));
  await page.route('**/party-api/state*', async route => {
    const response = await fetchFullState(route);
    const state = await response.json();
    const section = new URL(route.request().url()).searchParams.get('section');
    if (section === 'bank') return route.fulfill({ response, json: { ...state, bank } });
    if (section === 'market') return route.fulfill({ response, json: { ...state, aldata: { ...state.aldata, buyOrders: orders } } });
    await route.fulfill({ response, json: state });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'M', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Market', exact: true }).click();
  await page.getByRole('button', { name: /^Live WTB/ }).click();
  await expect(page.getByText(/2 offers match exact items currently held by M/)).toBeVisible();
  const bankRow = page.getByRole('button', { name: /E2EBankBuyer/ }).locator('..');
  await expect(bankRow).toContainText('You have 6');
  await expect(bankRow.getByRole('button', { name: 'Sell', exact: true })).toBeEnabled();
  await bankRow.getByRole('button', { name: 'All', exact: true }).click();
  await expect(bankRow.getByLabel('Quantity of leather to sell')).toHaveValue('6');
  const inventoryRow = page.getByRole('button', { name: /E2EInventoryBuyer/ }).locator('..');
  await expect(inventoryRow).toContainText('You have 1');
  await expect(inventoryRow.getByRole('button', { name: 'Sell', exact: true })).toBeEnabled();
  await expect(inventoryRow).toContainText('Sword +0');
  const computerRow = page.getByRole('button', { name: /E2EComputerBuyer/ });
  await expect(computerRow).not.toContainText('+0');
  const hideUnowned = page.getByRole('checkbox', { name: 'Hide unowned', exact: true });
  await hideUnowned.check();
  await expect(computerRow).toHaveCount(0);
  await expect(page.getByRole('button', { name: /E2EUpgradedBuyer/ })).toHaveCount(0);
  await expect(bankRow).toBeVisible();
  await expect(inventoryRow).toBeVisible();
  await info.attach('live-wtb-hide-unowned', { body: await page.screenshot(), contentType: 'image/png' });
  await hideUnowned.uncheck();
  await expect(computerRow).toBeVisible();
  await info.attach('bank-wtb-inputs', { body: JSON.stringify({ bank, orders }), contentType: 'application/json' });
  await info.attach('bank-wtb-available-without-withdrawal', { body: await page.screenshot(), contentType: 'image/png' });
});

test('account preference rejects invalid drafts and survives reload and coordinator restart', async ({ page, app }, testInfo) => {
  const evidence: Record<string, unknown> = { before: await app.state(), exchanges: [] };
  const exchanges = evidence.exchanges as unknown[];
  await page.goto('/');
  const openSettings = async () => {
    // Live cards require the browser's coordinator subscription to be mounted.
    await expect(page.getByRole('heading', { name: 'W', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Interface settings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Interface settings' })).toBeVisible();
  };
  await openSettings();
  const input = page.getByLabel('Default name for bankboi', { exact: true });
  const initial = await input.inputValue();
  const save = async (value: string, status: number) => {
    await input.fill(value);
    const received = page.waitForResponse(response =>
      new URL(response.url()).pathname.endsWith('/dashboard-preferences') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save name', exact: true }).click();
    const response = await received;
    // The settings UI consumes only rejected bodies; success is verified against real state.
    const body = response.ok() ? undefined : await response.json();
    exchanges.push({ request: response.request().postDataJSON(), status: response.status(), response: body });
    expect(response.status()).toBe(status);
    return body;
  };
  const rejected = await save('x', 400);
  await expect(page.getByRole('alert').filter({ hasText: rejected.error })).toBeVisible();
  await expect(input).toHaveValue('x');
  expect((await app.state()).bankboiPrefix || '').toBe(initial);
  await save('E2EBank', 200);
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: rejected.error })).toHaveCount(0);
  expect((await app.state()).bankboiPrefix).toBe('E2EBank');
  await save('!', 400);
  await expect(input).toHaveValue('!');
  expect((await app.state()).bankboiPrefix).toBe('E2EBank');
  await page.reload();
  await openSettings();
  await expect(input).toHaveValue('E2EBank');
  evidence.afterReload = await app.state();
  await app.restartCoordinator();
  await page.reload();
  await openSettings();
  await expect(input).toHaveValue('E2EBank');
  evidence.afterRestart = await app.state();
  expect((evidence.afterRestart as { bankboiPrefix?: string }).bankboiPrefix).toBe('E2EBank');
  await input.scrollIntoViewIfNeeded();
  await testInfo.attach('persisted-account-setting', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await testInfo.attach('account-setting-http-and-state', { body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: 'application/json' });
});

test.describe('player mark menu', () => {
test.use({ playerInventory: true });
test('player context marks keep bank and upgrade pairs before merchant delivery marks', async ({ page }, info) => {
  await page.goto('/');
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'W', exact: true }) });
  await card.getByText('sword', { exact: true }).click({ button: 'right' });
  const menu = page.locator('[data-slot="context-menu-content"]');
  const names = (await menu.getByRole('menuitem').allTextContents()).map(text => text.trim());
  const expected = ['Mark for bank', 'Auto mark for bank', 'Mark for upgrade', 'Auto mark for upgrade', 'Mark for merchant', 'Auto mark for merchant'];
  expect(names.filter(name => expected.includes(name))).toEqual(expected);
  await expect(menu.getByRole('menuitem', { name: 'Mark for stand', exact: true })).toHaveCount(0);
  await info.attach('player-paired-mark-order', { body: await page.screenshot(), contentType: 'image/png' });
});
});

test('bank context marks pair automatic actions and retain a source-specific upgrade across restart', async ({ page, app }, info) => {
  const requests: unknown[] = [];
  page.on('request', request => { if (request.method() === 'POST') requests.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() }); });
  const initial = await app.state();
  const sword = initial.characters.M.items.find((entry: any) => entry?.item?.name === 'sword');
  const ring = initial.merchantCatalog.allItems.find((entry: any) => entry.id === 'strring');
  const bank = { gold: 100000, packs: { items0: [{ ...sword, slot: 0, item: { ...sword.item, level: 0 } }, { slot: 1, item: { name: 'strring', level: 1 }, meta: ring.meta }] } };
  const checkpoint = await page.request.post(`${app.url}/party-api/bankboi/checkpoint`, { headers: { Origin: app.url }, data: { character: 'M', bank } });
  expect(checkpoint.ok()).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'M', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bank', exact: true }).click();
  const pane = page.getByRole('dialog', { name: 'Bank', exact: true });
  const item = pane.getByLabel(sword.meta.definition.name || 'sword', { exact: true });
  await item.click({ button: 'right' });
  const menu = page.locator('[data-slot="context-menu-content"]');
  await expect(menu.getByRole('menuitem', { name: 'Auto mark for stand…', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Auto sell to NPC…', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Auto mark for upgrade', exact: true })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Mark for upgrade', exact: true }).hover();
  const submenu = page.locator('[data-slot="context-menu-sub-content"]');
  await expect(submenu).toBeVisible();
  await info.attach('bank-upgrade-tier-menu', { body: await page.screenshot(), contentType: 'image/png' });
  const submitted = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/command') && response.request().method() === 'POST');
  await submenu.getByRole('menuitem', { name: /^\+0 → \+1 / }).click();
  const response = await submitted;
  await info.attach('bank-mark-http-response', { body: JSON.stringify({ status: response.status(), body: await response.json() }), contentType: 'application/json' });
  expect(response.ok()).toBe(true);
  await info.attach('bank-mark-http-requests', { body: JSON.stringify(requests), contentType: 'application/json' });
  await expect.poll(async () => (await app.state()).upgrades.M.some((mark: any) => mark.storage?.pack === 'items0' && mark.storage.slot === 0 && mark.tiers === 1)).toBe(true);
  await app.restartCoordinator();
  const state = await app.state();
  expect(state.upgrades.M.some((mark: any) => mark.storage?.pack === 'items0' && mark.storage.slot === 0 && mark.tiers === 1)).toBe(true);
  expect(state.withdrawals.M.some((request: any) => request.pack === 'items0' && request.slot === 0)).toBe(true);
  await info.attach('bank-upgrade-source-and-withdrawal', { body: JSON.stringify({ bank, upgrades: state.upgrades, withdrawals: state.withdrawals }), contentType: 'application/json' });
  await item.click({ button: 'right' });
  await info.attach('bank-paired-mark-actions', { body: await page.screenshot(), contentType: 'image/png' });
  await menu.getByRole('menuitem', { name: 'Clear all marks', exact: true }).click();
  await expect.poll(async () => (await app.state()).upgrades.M.some((mark: any) => mark.storage?.pack === 'items0')).toBe(false);
  await expect.poll(async () => (await app.state()).withdrawals.M.some((request: any) => request.pack === 'items0' && request.slot === 0)).toBe(false);
  await app.restartCoordinator();
  expect((await app.state()).withdrawals.M.some((request: any) => request.pack === 'items0' && request.slot === 0)).toBe(false);
  await pane.getByLabel(ring.meta.definition.name, { exact: true }).click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Mark for deconstruction', exact: true })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Auto mark for deconstruction', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Enable auto deconstruction?', exact: true });
  await expect(confirmation).toContainText('Possible rewards per item');
  await confirmation.getByRole('button', { name: 'Enable auto deconstruction', exact: true }).click();
  await expect.poll(async () => (await app.state()).deconstructionMarks.some((mark: any) => mark.auto && mark.storage?.pack === 'items0' && mark.storage.slot === 1)).toBe(true);
  await info.attach('bank-auto-deconstruction-intents', { body: JSON.stringify((await app.state()).deconstructionMarks), contentType: 'application/json' });
});

test('inventory context menu and upgrade preview stay readable without queueing an upgrade', async ({ page, app }, testInfo) => {
  const previews: unknown[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.endsWith('/upgrade-preview') && request.method() === 'POST') previews.push(request.postDataJSON());
  });
  await page.goto('/');
  const merchant = page.locator('article').filter({ has: page.getByRole('heading', { name: 'M', exact: true }) });
  const sword = merchant.getByText('sword', { exact: true });
  await expect(sword).toBeVisible();
  let before = await app.state();
  const initialReads:unknown[]=[];
  try{await expect.poll(async()=>{
    before=await app.state();
    const observed={upgrades:before.upgrades,merchantQueue:before.merchantQueue,merchantCurrent:before.merchantCurrent};
    if(initialReads.length>=32)initialReads.splice(8,1);
    initialReads.push({at:Date.now(),...observed});
    return observed.upgrades;
  },{message:'Merchant initialization must publish its exact empty upgrade projection before preview comparison'})
    .toEqual({M:[]});}
  finally{await testInfo.attach('preview-initial-readiness',{body:JSON.stringify(initialReads),contentType:'application/json'});}
  await sword.click({ button: 'right' });
  const rootMenu = page.locator('[data-slot="context-menu-content"]');
  await expect(rootMenu).toBeVisible();
  const markOrder = await rootMenu.getByRole('menuitem').allTextContents();
  const bankIndex = markOrder.findIndex(text => text.trim() === 'Mark for bank');
  expect(markOrder[bankIndex + 1]).toMatch(/Auto mark for bank/);
  const standIndex = markOrder.findIndex(text => text.trim() === 'Mark for stand');
  expect(markOrder[standIndex + 1]).toMatch(/Auto mark for stand/);
  const upgradeIndex = markOrder.findIndex(text => text.trim() === 'Mark for upgrade');
  expect(markOrder[upgradeIndex + 1]).toMatch(/Auto mark for upgrade/);
  expect(bankIndex).toBeLessThan(standIndex);
  expect(standIndex).toBeLessThan(upgradeIndex);
  expect(markOrder.findIndex(text => /Auto sell to NPC/.test(text))).toBeGreaterThan(upgradeIndex);
  await expect(rootMenu).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(rootMenu).toHaveCSS('color', 'rgb(0, 0, 0)');
  const equip = rootMenu.getByRole('menuitem', { name: 'Equip', exact: true });
  await expect(equip).toHaveCSS('color', 'rgb(0, 0, 0)');
  await equip.hover();
  await expect(equip).toHaveAttribute('data-highlighted', '');
  const hover = await equip.evaluate(element => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const background = getComputedStyle(element).backgroundColor;
    context.fillStyle = background;
    context.fillRect(0, 0, 1, 1);
    return { background, rgba: [...context.getImageData(0, 0, 1, 1).data] };
  });
  expect(hover.rgba[3]).toBe(255);
  for (const channel of hover.rgba.slice(0, 3)) {
    expect(channel).toBeGreaterThanOrEqual(230);
    expect(channel).toBeLessThan(255);
  }
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/upgrade-preview') && response.request().method() === 'POST');
  await rootMenu.getByRole('menuitem', { name: 'Mark for upgrade', exact: true }).hover();
  const preview = page.getByRole('region', { name: 'Upgrade chances' });
  await expect(preview).toBeVisible();
  const submenu = page.locator('[data-slot="context-menu-sub-content"]').filter({ has: preview });
  await expect(submenu).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(submenu).toHaveCSS('color', 'rgb(0, 0, 0)');
  await expect(preview).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(preview).toHaveCSS('color', 'rgb(0, 0, 0)');
  await expect(preview.getByText('Next attempt: +0 → +1', { exact: true })).toBeVisible();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const previewResult = await response.json();
  expect(previewResult.status).not.toMatch(/queued|running/);
  await expect(preview.getByRole('status')).not.toContainText('Refreshing');
  expect(previews.length).toBeGreaterThan(0);
  for (const body of previews) expect(body).toMatchObject({ character: 'M', refresh: false });
  const after = await app.state();
  for (const field of ['upgrades', 'merchantQueue', 'merchantCurrent']) {
    expect(before, `The real state must expose ${field}`).toHaveProperty(field);
    expect(after[field], `Opening a preview must not change ${field}`).toEqual(before[field]);
  }
  await testInfo.attach('context-menu-upgrade-preview', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await testInfo.attach('preview-read-evidence', { body: Buffer.from(JSON.stringify({ hover, requests: previews, response: previewResult, before, after }, null, 2)), contentType: 'application/json' });
  await page.keyboard.press('Escape');
  await expect(preview).not.toBeVisible();
  await page.keyboard.press('Escape');
  await expect(rootMenu).not.toBeVisible();
});


test.describe('configured merchant dialog names', () => {
  test.use({merchantDialogs:true});
  test('market, bank and donation confirmations name the configured merchant without submitting work', async ({page,app}, info) => {
    const submitted: string[] = [];
    page.on('request', request => { if(request.method()==='POST') submitted.push(new URL(request.url()).pathname); });
    await page.goto('/');
    const card=page.locator('article').filter({has:page.getByRole('heading',{name:'M',exact:true})});
    await card.getByRole('button',{name:'Donate gold',exact:true}).click();
    const donation=page.getByRole('dialog',{name:'Donate gold for merchant XP'});
    await expect(donation).toContainText('M will withdraw any shortage');
    await donation.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.getByRole('button',{name:'Market',exact:true}).click();
    await page.getByRole('button',{name:/^Live WTB/}).click();
    await expect(page.getByText(/match exact items currently held by M or recorded/)).toBeVisible();
    await page.getByRole('button',{name:/^Ponty \(/}).click();
    await page.getByRole('button',{name:'Buy',exact:true}).click();
    const purchase=page.getByRole('dialog',{name:'Confirm Ponty purchase'});
    await expect(purchase).toContainText('M will travel as needed');
    await info.attach('configured-merchant-ponty',{body:await page.screenshot(),contentType:'image/png'});
    await purchase.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Bank',exact:true}).click();
    const bank=page.getByRole('dialog',{name:'Bank',exact:true});
    await bank.getByRole('button',{name:/^Unlock items1/}).click();
    const vault=page.getByRole('dialog',{name:'Unlock bank vault?'});
    await expect(vault).toContainText('M will spend 10,000 gold');
    await vault.getByRole('button',{name:'Cancel',exact:true}).click();
    await bank.getByRole('button',{name:/^Unlock with The Bank Key/}).click();
    const floor=page.getByRole('dialog',{name:'Unlock bank floor?'});
    await expect(floor).toContainText('M will retrieve and consume The Bank Key');
    await info.attach('configured-merchant-bank',{body:await page.screenshot(),contentType:'image/png'});
    await floor.getByRole('button',{name:'Cancel',exact:true}).click();
    expect(submitted.filter(path=>/\/(donate|ponty-order|bank-unlock)$/.test(path))).toEqual([]);
    await info.attach('merchant-dialog-http-state',{body:JSON.stringify({submitted,state:await app.state()}),contentType:'application/json'});
  });
});

test.describe('unassigned merchant dialog names', () => {
  test.use({merchantConnected:false});
  test('market uses a generic merchant label before any merchant connects', async ({page,app}, info) => {
    expect((await app.state()).merchantCharacter).toBeNull();
    await page.goto('/');
    await expect(page.getByRole('heading', {name:'W',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Market',exact:true}).click();
    await page.getByRole('button',{name:/^Live WTB/}).click();
    await expect(page.getByText(/match exact items currently held by the merchant or recorded/)).toBeVisible();
    await info.attach('unassigned-merchant-market',{body:await page.screenshot(),contentType:'image/png'});
  });
});


test('market affordability uses core bank gold and active WTB prices open the full editor', async ({page,app},info) => {
  // Failure modes: opening only market omits bank gold; affordability hides every
  // listing; price opens a bare input; editing resets quantity or preferences.
  await page.route('**/party-api/state*', async route => {
    const response = await fetchFullState(route), state = await response.json();
    await route.fulfill({response,json:{...state,bank:undefined,bankGold:5000,
      standBids:{leather:{price:1200,quantity:7,minimumQuality:0,useStandSlot:false,acceptHigherLevels:false}},
      aldata:{...state.aldata,listings:[{key:'affordable-leather',seller:'AffordableSeller',item:{name:'leather'},price:4000,quantity:1,
        slot:'trade1',serverRegion:'US',serverIdentifier:'II',seenAt:Date.now(),lastSeen:new Date().toISOString()}]}}});
  });
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'M',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Market',exact:true}).click();
  await expect(page.getByRole('button',{name:'New WTB order',exact:true})).toBeVisible();
  const active=page.getByRole('button',{name:/^Active WTB orders/});
  if(await active.getAttribute('aria-expanded') !== 'true') await active.click();
  await page.getByRole('button',{name:'Edit price for Leather',exact:true}).click();
  const editor=page.getByRole('dialog',{name:/Add to WTB/});
  await expect(editor.getByLabel('Maximum price')).toHaveValue('1200');
  await expect(editor.getByLabel('Quantity',{exact:true})).toHaveValue('7');
  await expect(editor.getByRole('button',{name:/Farm price/}).first()).toBeVisible();
  const farm=editor.getByRole('button',{name:/^Farm price/});
  const npc=editor.getByRole('button',{name:/^NPC sale/});
  await editor.evaluate(async element => {
    await Promise.all(element.getAnimations({subtree:true}).map(animation => animation.finished.catch(() => {})));
  });
  const handles = await Promise.all([farm.elementHandle(), npc.elementHandle(),
    editor.getByRole('button',{name:'Information: Farm price',exact:true}).elementHandle()]);
  // Collect geometry in one frame so the entry animation cannot skew widths
  // sampled at different points in time.
  const [farmBox,npcBox,infoBox] = await page.evaluate(elements => elements.map(element => {
    if (!element) return null;
    const {x,y,width,height} = element.getBoundingClientRect();
    return {x,y,width,height};
  }), handles);
  await Promise.all(handles.map(handle => handle?.dispose()));
  expect(farmBox).toBeTruthy(); expect(npcBox).toBeTruthy(); expect(infoBox).toBeTruthy();
  expect(Math.abs(farmBox!.width-npcBox!.width)).toBeLessThan(1);
  expect(infoBox!.x).toBeGreaterThan(farmBox!.x+farmBox!.width/2);
  expect(infoBox!.x+infoBox!.width).toBeLessThanOrEqual(farmBox!.x+farmBox!.width);
  expect(infoBox!.y).toBeGreaterThanOrEqual(farmBox!.y);
  expect(infoBox!.y+infoBox!.height).toBeLessThan(farmBox!.y+farmBox!.height/2);
  await editor.getByRole('button',{name:'Information: Farm price',exact:true}).click();
  await expect(editor.getByLabel('Maximum price')).toHaveValue('1200');
  await expect(page.getByText(/Estimated gold you would earn while farming/)).toBeVisible();
  await page.keyboard.press('Escape');
  await editor.getByLabel('Maximum price').fill('1500');
  await editor.getByLabel('Quantity',{exact:true}).fill('9');
  await info.attach('prefilled-wtb-price-options',{body:await page.screenshot(),contentType:'image/png'});
  const saved=page.waitForRequest(request=>request.url().includes('/merchant/bid') && request.method()==='POST');
  await editor.getByRole('button',{name:'Place WTB',exact:true}).click();
  expect((await saved).postDataJSON()).toMatchObject({price:1500,quantity:9,useStandSlot:false,acceptHigherLevels:false});
  await expect.poll(async ()=>(await app.state()).standBids.leather).toMatchObject({price:1500,quantity:9,useStandSlot:false,acceptHigherLevels:false});
  await page.getByRole('button',{name:/^Live WTS/}).click();
  await page.getByText('Hide unaffordable',{exact:true}).click();
  await expect(page.getByRole('button',{name:/AffordableSeller/}).first()).toBeVisible();
  await info.attach('market-core-bank-gold-affordability',{body:await page.screenshot(),contentType:'image/png'});
});

test.describe('declared map capture observations',()=>{
  test.use({mapCapture:true});
test('expanded character and Cave maps capture real canvas pixels with map and camera-center footers',async({page,app},info)=>{
  // Declared map/read fixture only: real browser image loading, canvas drawing,
  // CORS, popup creation and PNG serialization remain the production path.
  const tile=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;
    const context=canvas.getContext('2d')!;context.fillStyle='#d923a7';context.fillRect(0,0,16,16);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  let imageRequests=0;
  const images=createServer((_request,response)=>{
    imageRequests++;response.writeHead(200,{'Content-Type':'image/png','Access-Control-Allow-Origin':'*'});response.end(Buffer.from(tile,'base64'));
  });
  await new Promise<void>(resolve=>images.listen(0,'127.0.0.1',resolve));
  try {
    const address=images.address();if(!address||typeof address==='string')throw Error('Image fixture did not listen');
    const map='zone_abc123_0',name='W',x=31,y=47;
    const definition={name:map,min_x:-100,min_y:-200,max_x:500,max_y:400,default:0,
      tiles:[['capture',0,0,16,16]],placements:[],groups:[],tilesets:{capture:{file:`http://127.0.0.1:${address.port}/tile.png`}}};
    await expect.poll(async()=>{const state=await app.state();return {map:state.characters.W.map,x:state.characters.W.x,y:state.characters.W.y};}).toEqual({map,x,y});
    await page.route('**/party-api/map-stream/*',route=>route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({name,map,x,y,at:Date.now(),entities:[],definition})+'\n\n'}));
    await page.route('**/party-api/daily-dungeons',route=>route.fulfill({json:{state:{phase:'active',run:'abc123',participants:[name],protectFromEvents:true,commands:{},operations:[],progress:{enabled:false,serial:0}},members:[{name,fresh:true,observation:{protocol:1,at:Date.now(),supported:true,alive:true,ready:true,members:[name],cave:{run:'abc123',floor:0,expires:Date.now()+600000,remainingMs:600000,paused:false,gold:0,amber:0,points:[]}}}]}}));
    await page.goto('/');
    await page.locator('div').filter({has:page.locator('span').filter({hasText:'Cave of Many Dreams [31, 47]'})}).filter({has:page.getByRole('button',{name:'Expand live map',exact:true})}).last().getByRole('button',{name:'Expand live map',exact:true}).click();
    await page.getByRole('button',{name:'Open native-size map',exact:true}).click();
    const captures=[];
    for(const mode of ['character','full-floor','native-floor']) {
      if(mode==='full-floor') {
        await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
        await page.getByRole('button',{name:'View full map',exact:true}).click();
      }
      const dialog=page.getByRole('dialog');
      if(mode==='native-floor')await dialog.getByRole('button',{name:'Native-size view',exact:true}).click();
      const canvas=dialog.locator('canvas');
      await expect.poll(()=>canvas.evaluate(element=>{
        const c=element as HTMLCanvasElement,p=c.getContext('2d')!.getImageData(2,2,1,1).data;
        return [...p];
      })).toEqual([217,35,167,255]);
      // Observe exactly the canvas that the production click handler captures.
      // Native-size toggles can still redraw between a separate read and click.
      await dialog.evaluate(element=>{
        element.addEventListener('click',event=>{
          if(!(event.target instanceof Element)||!event.target.closest('button[aria-label="Capture map screenshot"]'))return;
          const c=element.querySelector('canvas')!;
          (globalThis as typeof globalThis & {mapCaptureObserved?:unknown}).mapCaptureObserved={width:c.width,height:c.height,ratio:Math.max(1,c.width/c.clientWidth),png:c.toDataURL('image/png')};
        },{capture:true,once:true});
      });
      const popupPromise=page.waitForEvent('popup');
      await dialog.getByRole('button',{name:'Capture map screenshot',exact:true}).click();
      const original=await page.evaluate(()=>(globalThis as typeof globalThis & {mapCaptureObserved:{width:number;height:number;ratio:number;png:string}}).mapCaptureObserved);
      const popup=await popupPromise;
      const center=mode==='full-floor'?'200.00, 100.00':'31.00, 47.00';
      await expect(popup.locator('img')).toHaveAttribute('alt',`Map: ${map}. Center: ${center}`);
      await expect(popup).toHaveTitle(`Map screenshot — ${map} — Center: ${center}`);
      const result=await popup.locator('img').evaluate(async(element,source)=>{
        const image=element as HTMLImageElement;await image.decode();
        const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;
        const context=c.getContext('2d')!;context.drawImage(image,0,0);
        // Keep exact whole-image equality while transporting a compact,
        // lossless reference instead of millions of CDP numeric arguments.
        const reference=new Image();reference.src=source.png;await reference.decode();
        const referenceCanvas=document.createElement('canvas');referenceCanvas.width=source.width;referenceCanvas.height=source.height;
        const referenceContext=referenceCanvas.getContext('2d')!;referenceContext.drawImage(reference,0,0);
        const expectedPixels=referenceContext.getImageData(0,0,source.width,source.height).data;
        const pixels=context.getImageData(0,0,source.width,source.height).data;
        const footer=context.getImageData(0,source.height,c.width,c.height-source.height).data;
        let textPixels=0;for(let i=0;i<footer.length;i+=4)if(footer[i]===236&&footer[i+1]===253&&footer[i+2]===245)textPixels++;
        return {width:c.width,height:c.height,identical:expectedPixels.every((value,index)=>value===pixels[index]),textPixels,png:image.src};
      },original);
      await info.attach(`map-capture-${mode}`,{body:Buffer.from(result.png.split(',')[1],'base64'),contentType:'image/png'});
      expect(result.width).toBe(original.width);expect(result.height).toBe(original.height+Math.ceil(64*original.ratio));
      expect(result.identical).toBe(true);expect(result.textPixels).toBeGreaterThan(20);
      captures.push({mode,center,width:result.width,height:result.height,identical:result.identical,textPixels:result.textPixels});
      await popup.close();
    }
    expect(imageRequests).toBeGreaterThan(0);
    await info.attach('map-capture-ledger',{body:JSON.stringify({map,imageRequests,captures}),contentType:'application/json'});
  } finally {
    if(!page.isClosed())await page.unrouteAll({behavior:'wait'});
    images.closeAllConnections();
    await new Promise<void>((resolve,reject)=>images.close(error=>error?reject(error):resolve()));
  }
});

});

test('fixed-origin map image proxy returns native Dreams tiles and rejects external origins',async({page},info)=>{
    // Actual dashboard server boundary: fetch the verified native Dreams
    // tileset through the maintained fixed-origin proxy, without intercepting it.
    const nativeUrl='https://adventure.land/images/tiles/map/dreams-v3.png?v=3';
    const proxied=await page.request.get('/api/map-image?url='+encodeURIComponent(nativeUrl));
    expect(proxied.status()).toBe(200);
    expect(proxied.headers()['content-type']).toContain('image/png');
    expect(proxied.headers()['x-content-type-options']).toBe('nosniff');
    expect(proxied.headers()['cache-control']).toContain('max-age=86400');
    const nativeBytes=await proxied.body();
    expect([...nativeBytes.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
    expect(nativeBytes.length).toBeGreaterThan(100);
    const rejected=await page.request.get('/api/map-image?url='+encodeURIComponent('https://example.com/images/map.png'));
    expect(rejected.status()).toBe(400);
    await info.attach('native-dreams-proxy-image',{body:nativeBytes,contentType:'image/png'});
    await info.attach('map-image-proxy-ledger',{body:JSON.stringify({nativeUrl,status:proxied.status(),headers:proxied.headers(),bytes:nativeBytes.length,rejectedExternalStatus:rejected.status()}),contentType:'application/json'});
});

test('Cave map survives stale reports without allowing stale waypoint actions',async({page},info)=>{
  // Declared read-boundary fixture: no native receipts, combat, or ownership is forged.
  let run='read-fixture-a',floor=0,fresh=true,operations=0;
  const name='M';
  const view=()=>({state:{phase:'active',run,participants:[name],protectFromEvents:true,commands:{},operations:[],progress:{enabled:false,serial:0}},members:[{name,fresh,observation:{protocol:1,at:Date.now(),supported:true,alive:true,ready:true,members:[name],cave:{run,floor,expires:Date.now()+600000,remainingMs:600000,paused:false,gold:0,amber:0,points:[]}}}]});
  await page.route('**/party-api/daily-dungeons',route=>{
    if(route.request().method()==='POST')operations++;
    return route.fulfill({json:view()});
  });
  await page.route('**/party-api/map-stream/*',route=>{
    const map='zone_'+run+'_'+floor;
    return route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({name,map,at:Date.now(),x:100,y:100,entities:[],definition:{name:map,min_x:0,min_y:0,max_x:200,max_y:200,tiles:[],placements:[],groups:[],tilesets:{}}})+'\n\n'});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'View full map',exact:true}).click();
  const map=page.getByRole('dialog',{name:'Cave of Many Dreams — Floor 1',exact:true});
  await map.getByRole('button',{name:'Add waypoint',exact:true}).click();
  await map.locator('canvas').click({position:{x:100,y:100}});
  const set=map.getByRole('button',{name:'Set waypoint',exact:true});
  await expect(set).toBeEnabled();
  const freshCanvas=await map.locator('canvas').boundingBox();
  fresh=false;
  await expect(set).toBeDisabled();
  await expect(map.getByRole('status')).toHaveText('Waiting for fresh participant reports.');
  await expect(map.getByRole('button',{name:'Add waypoint',exact:true})).toBeEnabled();
  await map.getByRole('button',{name:'Add waypoint',exact:true}).click();
  await expect(map.getByText('Click the map to place your waypoint.',{exact:true})).toBeVisible();
  await map.locator('canvas').click({position:{x:120,y:100}});
  await expect(set).toBeDisabled();
  expect(operations,'Local placement must not dispatch a stale native operation').toBe(0);
  await expect.poll(async()=>{
    const box=await map.locator('canvas').boundingBox();
    return box && freshCanvas && Math.abs(box.y-freshCanvas.y)+Math.abs(box.height-freshCanvas.height);
  },{message:'Heartbeat waiting text must not move the selectable map'}).toBeLessThan(1);
  await expect(map).toBeVisible();
  await info.attach('stale-cave-map-readonly',{body:await map.screenshot(),contentType:'image/png'});
  fresh=true;
  await expect(set).toBeEnabled();
  await expect(map.getByRole('status')).toHaveCount(0);
  const recoveredCanvas=await map.locator('canvas').boundingBox();
  expect(recoveredCanvas?.y).toBe(freshCanvas?.y);
  await expect(map).toBeVisible();
  floor=1;
  await expect(map).not.toBeVisible();
  await page.getByRole('button',{name:'View full map',exact:true}).click();
  const next=page.getByRole('dialog',{name:'Cave of Many Dreams — Floor 2',exact:true});
  await expect(next.getByRole('button',{name:'Set waypoint',exact:true})).toBeDisabled();
  run='read-fixture-b';
  await expect(next).not.toBeVisible();
  await info.attach('cave-map-read-fixture-ledger',{body:JSON.stringify({transitions:['fresh','stale local placement without dispatch','fresh','floor 2','new run'],run,floor,fresh,operations}),contentType:'application/json'});
});


test('Steam handoff preserves saved setup when browser choices are incomplete', async ({ browser }, info) => {
  // Failure modes: an empty/invalid browser draft overrides valid persisted setup;
  // setup reload erases those saved choices; a valid remote choice is ignored;
  // launching remotely stops headless ownership before a bridge is connected.
  // Desktop launch/inspector are declared external boundaries, not live Steam.
  const directory = path.resolve('.build/e2e', `steam-setup-${randomUUID()}`);
  const preferences = new SteamPreferenceStore(directory);
  await preferences.save({ placement: 'same', client: 'windows-steam' });
  let launched = 0, connected = false, forwarded = 0, attachments = 0;
  const ports: DesktopPorts = {
    platform: 'win32', targets: async () => launched ? [{url:'http://game',socket:'ws://fixture'}] : [],
    executable: async () => 'declared-steam-executable', running: async () => false,
    launch: async () => { launched++; }, connect: async () => ({ evaluate: async () => { attachments++; connected=true; return true; }, close: () => {} }),
    bridgeReady: async () => connected, server: async () => 'http://console', source: async () => '', now: Date.now, sleep: async () => {},
  };
  let steam = new LocalSteam(preferences, ports);
  const upstream = createServer((req,res) => {
    res.setHeader('Content-Type','application/json');
    if(req.method==='POST') { forwarded++; res.end(JSON.stringify({ok:true})); }
    else res.end(JSON.stringify({roster:[{name:'W'}]}));
  });
  await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const access = new Access(path.join(directory,'access.json')); await access.load();
  const options={access,steam,configured:()=>true,dashboardPort:1,apiPort:(upstream.address() as {port:number}).port};
  const server = gateway(options);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const page = await browser.newPage();
  const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try {
    await page.goto(origin+'/setup');
    await page.evaluate(()=>localStorage.setItem('party-connection-setup',JSON.stringify({placement:'',client:''})));
    // Execute the maintained dashboard request adapter in a real browser, then
    // observe the actual HTTP gateway, persisted preference and desktop boundary.
    const helper = await transform(readFileSync('dashboard/features/party/steam-client-setup.ts','utf8'),{loader:'ts',format:'iife',globalName:'SteamSetup'});
    await page.addScriptTag({content:helper.code});
    await page.evaluate(()=>{
      const button=document.createElement('button'); button.textContent='Request Steam primary';
      button.onclick=async()=>{
        const adapter=(window as unknown as {SteamSetup:{steamClientSetup(body:unknown,storage:Storage):unknown}}).SteamSetup;
        const response=await fetch('/party-api/steam/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(adapter.steamClientSetup({action:'primary',character:'W'},localStorage))});
        const output=document.createElement('output'); output.textContent=JSON.stringify({status:response.status,body:await response.json()}); document.body.append(output);
      }; document.body.append(button);
    });
    await page.getByRole('button',{name:'Request Steam primary'}).click();
    await expect(page.locator('output').last()).toContainText('"status":200');
    expect(launched).toBe(1); expect(forwarded).toBe(1);
    expect(await preferences.read()).toEqual({placement:'same',client:'windows-steam'});
    await page.reload();
    await expect(page.locator('#placement')).toHaveValue('same');
    await expect(page.locator('#client')).toHaveValue('windows-steam');
    expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('party-connection-setup')||'null'))).toMatchObject({placement:'same',client:'windows-steam'});
    await info.attach('steam-saved-setup-restored',{body:await page.screenshot(),contentType:'image/png'});
    // A hosting restart has no maintenance timer; an already ready local bridge
    // must be inspected/refreshed before forwarding, without launching again.
    steam.stop(); steam=new LocalSteam(preferences,ports); options.steam=steam;
    const beforeRefresh=attachments;
    const refreshed=await page.request.post(origin+'/party-api/steam/action',{headers:{Origin:origin},data:{action:'primary',character:'W'}});
    expect(refreshed.ok()).toBe(true); expect(attachments).toBe(beforeRefresh+1);
    expect(launched).toBe(1); expect(forwarded).toBe(2);
    connected=false;
    const remote=await page.request.post(origin+'/party-api/steam/action',{headers:{Origin:origin},data:{action:'primary',character:'W',clientSetup:{placement:'remote',client:'windows-steam'}}});
    expect(remote.ok()).toBe(false); expect(await remote.text()).toContain('Unable to start Steam client from a different PC');
    expect(launched).toBe(1); expect(forwarded).toBe(2);
    connected=true;
    const beforeRemote=attachments;
    const attached=await page.request.post(origin+'/party-api/steam/action',{headers:{Origin:origin},data:{action:'primary',character:'W'}});
    expect(attached.ok()).toBe(true); expect(forwarded).toBe(3); expect(attachments).toBe(beforeRemote);
    await info.attach('steam-launch-boundary-ledger',{body:JSON.stringify({launched,forwarded,attachments,preferences:await preferences.read(),remoteStatus:remote.status(),attachedStatus:attached.status()}),contentType:'application/json'});
  } finally {
    steam.stop(); await page.close(); server.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise<void>(resolve=>server.close(()=>resolve())),new Promise<void>(resolve=>upstream.close(()=>resolve()))]);
  }
});


test('Steam bridge reports native save rejection without losing its reason', async ({ browser }, info) => {
  // Failure modes: api_call rejects a native object rather than Error; diagnostics
  // become [object Object]; private response fields leak; failed save disconnects
  // the primary or persists a false release receipt. The native API is a declared
  // rejection boundary, with actual bridge execution and HTTP heartbeat replies.
  const packets: Record<string,unknown>[]=[];
  const upstream=createServer(async(req,res)=>{
    if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<body></body>');return;}
    let raw='';for await(const chunk of req)raw+=chunk;
    const packet=JSON.parse(raw);packets.push(packet);
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({operation:{id:'save-failure',from:'P',target:'W',phase:packet.error?'failed':'release'},realm:'SR_USII',members:[]}));
  });
  await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${(upstream.address() as {port:number}).port}`;
  const page=await browser.newPage();
  try {
    await page.goto(origin);
    const bundle=await build({entryPoints:['runtime/steam/bridge.ts'],bundle:true,write:false,format:'iife',globalName:'NativeBridge',platform:'browser'});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(origin=>{
      const host=window as unknown as Record<string,unknown>;
      host.__partyServer=origin;host.character={name:'P'};host.socket={connected:true,disconnect(){throw Error('Save failure must not disconnect');}};
      host.X={characters:[{name:'W',id:'owned-w'}],codes:{}};host.storage_get=()=>null;host.storage_set=()=>{};
      host.stop_runner=()=>{throw Error('Save failure must not stop CODE');};
      host.api_call=async()=>{throw {failed:true,reason:'invalid_slot',error:'Use a supported CODE slot',session:'PRIVATE-SENTINEL'};};
      (host.NativeBridge as {installSteamBridge(host:unknown):void}).installSteamBridge(window);
    },origin);
    await expect.poll(()=>packets.find(packet=>packet.error)?.error).toBe('invalid_slot: Use a supported CODE slot');
    const failure=packets.find(packet=>packet.error)!;
    expect(failure.released).toBeUndefined();expect(JSON.stringify(failure)).not.toContain('PRIVATE-SENTINEL');
    await info.attach('steam-native-save-rejection',{body:JSON.stringify(packets),contentType:'application/json'});
  } finally {
    await page.close();upstream.closeAllConnections();await new Promise<void>(resolve=>upstream.close(()=>resolve()));
  }
});


test('Steam bridge reserves a free native CODE slot without overwriting saved code', async ({ browser }, info) => {
  // Failure modes: UUID slot rejected as no_slot; occupied/user/default CODE is
  // overwritten; an absent inventory is assumed empty; full slots disconnect the
  // client; original cache is lost. Native save is a declared protocol boundary.
  const packets: Record<string,unknown>[]=[];
  const server=createServer(async(req,res)=>{
    if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<body></body>');return;}
    let raw='';for await(const chunk of req)raw+=chunk;packets.push(JSON.parse(raw));
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({operation:{id:'native-slot',from:'P',target:'W',phase:'release'},realm:'SR_USII',members:[]}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const page=await browser.newPage();
  try {
    await page.goto(origin);
    const bundle=await build({entryPoints:['runtime/steam/bridge.ts'],bundle:true,write:false,format:'iife',globalName:'NativeBridge',platform:'browser'});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(origin=>{
      const host=window as unknown as Record<string,unknown>;
      host.__partyServer=origin;host.character={name:'P'};const socket={connected:true,disconnect(){socket.connected=false;}};host.socket=socket;
      host.X={characters:[{name:'W',id:'owned-w'}],codes:{'1':['User code',1],'100':['Other saved code',1]}};
      const cache=new Map([['code_cache',JSON.stringify({slot_owned_w:'1',code_owned_w:'User code'})]]);
      host.storage_get=(key:string)=>cache.get(key)||null;host.storage_set=(key:string,value:string)=>cache.set(key,value);
      host.stop_runner=()=>{};host.saved=[];
      host.api_call=async(method:string,payload:{slot:string})=>{
        if(!/^(?:[1-9]|[1-9][0-9]|100)$/.test(String(payload.slot)))throw {failed:true,reason:'no_slot'};
        if(['1','100'].includes(String(payload.slot)))throw Error('Occupied CODE must not be overwritten');
        (host.saved as unknown[]).push({method,payload});return {success:true};
      };
      host.cache=cache;
      (host.NativeBridge as {installSteamBridge(host:unknown):void}).installSteamBridge(window);
    },origin);
    await expect.poll(()=>packets.some(packet=>packet.released===true)).toBe(true);
    const result=await page.evaluate(()=>{
      const host=window as unknown as {saved:{payload:{slot:string}}[];cache:Map<string,string>};
      return {saved:host.saved,cache:JSON.parse(host.cache.get('code_cache')||'{}'),original:localStorage.getItem('party-console-bootstrap-slot-v1:'+location.origin+':original-cache')};
    });
    expect(String(result.saved[0].payload.slot)).toBe('99');expect(result.cache.slot_owned_w).toBe('1');
    expect(JSON.parse(result.original||'null')).toEqual({slot_owned_w:'1',code_owned_w:'User code'});
    await info.attach('steam-native-free-slot',{body:JSON.stringify({packets,result}),contentType:'application/json'});
    for(const inventory of ['full','unknown']) {
      // A request from the preceding bridge can already be on the wire when
      // dispose aborts it. Attribute receipts to the new bridge's actual client
      // identity instead of treating a cleared server array as a network fence.
      const clientId=await page.evaluate(inventory=>{
        const host=window as unknown as {__partySteamBridge:{dispose():void};socket:{connected:boolean};X:{codes?:Record<string,unknown>};NativeBridge:{installSteamBridge(host:unknown):void}};
        host.__partySteamBridge.dispose();localStorage.clear();sessionStorage.clear();host.socket.connected=true;
        host.X.codes=inventory==='full'?Object.fromEntries(Array.from({length:100},(_,i)=>[String(i+1),['User code',1]])):undefined;
        host.NativeBridge.installSteamBridge(window);
        return sessionStorage.getItem('party-steam-client');
      },inventory);
      expect(clientId).toBeTruthy();
      const currentPackets=()=>packets.filter(packet=>packet.clientId===clientId);
      await expect.poll(()=>currentPackets().find(packet=>packet.error)?.error).toContain(inventory==='full'?'No free Adventure Land CODE slot':'Cannot inspect saved CODE slots');
      expect(currentPackets().some(packet=>packet.released===true)).toBe(false);
      expect(await page.evaluate(()=>((window as unknown as {saved:unknown[]}).saved).length)).toBe(1);
      expect(await page.evaluate(()=>((window as unknown as {socket:{connected:boolean}}).socket).connected)).toBe(true);
      await info.attach('steam-native-slot-'+inventory,{body:JSON.stringify({clientId,packets:currentPackets(),allPackets:packets}),contentType:'application/json'});
    }

  } finally {await page.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('log character pills default to all and independently filter live updates across tabs',async({page},info)=>{
  // Declared log transport boundary; exercise the real sidebar and query cache.
  let newer=false;
  await page.route('**/party-api/state?**',async route=>{
    const url=new URL(route.request().url());
    if(url.searchParams.get('section')!=='logs')return route.continue();
    const event=(name:string,seq=1)=>({session:'pill-probe',seq,at:Date.now(),message:`Log probe ${name} ${seq}`,color:''});
    await route.fulfill({json:{gameLogs:{W:[event('W'),...(newer?[event('W',2)]:[])],P:[event('P')],M:[event('M')],...(newer?{Retained:[event('Retained')]}:{})},combatLogs:{W:[{at:Date.now(),message:'Combat probe W',type:'info'}],P:[{at:Date.now(),message:'Combat probe P',type:'info'}]},merchantActivity:[]}});
  });
  await page.goto('/');
  // A shared development server may finish initial module discovery and reload.
  await page.waitForTimeout(2000);
  await page.getByRole('button',{name:'Show logs'}).click();
  const sidebar=page.getByRole('complementary',{name:'Live logs'}),pills=sidebar.getByRole('group',{name:'Log characters'});
  await expect(sidebar.getByRole('combobox',{name:'Log character',exact:true})).toHaveCount(0);
  for(const name of ['W','P','M']){
    await expect(pills.getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(sidebar.getByText(`Log probe ${name} 1`,{exact:true})).toBeVisible();
  }
  await pills.getByRole('button',{name:'W',exact:true}).click();
  await pills.getByRole('button',{name:'M',exact:true}).click();
  await expect(sidebar.getByText('Log probe W 1',{exact:true})).toHaveCount(0);
  await expect(sidebar.getByText('Log probe M 1',{exact:true})).toHaveCount(0);
  await expect(sidebar.getByText('Log probe P 1',{exact:true})).toBeVisible();
  newer=true;
  await expect(pills.getByRole('button',{name:'Retained',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(sidebar.getByText('Log probe Retained 1',{exact:true})).toBeVisible();
  await expect(sidebar.getByText('Log probe W 2',{exact:true})).toHaveCount(0);
  await sidebar.getByRole('tab',{name:'Dashboard logs'}).click();
  await expect(sidebar.getByText('Combat probe W',{exact:true})).toHaveCount(0);
  await expect(sidebar.getByText('Combat probe P',{exact:true})).toBeVisible();
  await pills.getByRole('button',{name:'W',exact:true}).click();
  await expect(sidebar.getByText('Combat probe W',{exact:true})).toBeVisible();
  await sidebar.getByRole('tab',{name:'Game logs'}).click();
  await expect(sidebar.getByText('Log probe W 2',{exact:true})).toBeVisible();
  for(const pill of await pills.getByRole('button').all())if(await pill.getAttribute('aria-pressed')==='true')await pill.click();
  await expect(sidebar.getByText('No matching logs yet.',{exact:true})).toBeVisible();
  await pills.getByRole('button',{name:'P',exact:true}).click();
  await page.setViewportSize({width:1000,height:800});
  await info.attach('log-character-pills',{body:await page.screenshot(),contentType:'image/png'});
});

test.describe('stand buy order item levels',()=>{
  test.use({merchantDialogs:true,standBuyOrders:true});
 test('stand buy orders show levels only for items with levels', async ({page,app},info) => {
  // Failure inventory: level-less orders show +0; leveled equipment loses +0;
  // compoundable items lose their requested tier; native rows differ from bids.
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'M',exact:true})).toBeVisible();
  await page.getByRole('button',{name:/^Stand ·/}).click();
  await expect(page.getByRole('button',{name:'Spider Silk',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'The Bank Key',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Helmet +0',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Amulet of Strength +2',exact:true})).toBeVisible();
  await info.attach('stand-buy-order-levels',{body:await page.screenshot(),contentType:'image/png'});
});

});

import './metrics-history.case';

import './mailbox-enhancements.case';
