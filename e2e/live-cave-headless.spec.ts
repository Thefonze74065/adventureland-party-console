import {test,expect} from './live-fixtures';
import type {Page} from '@playwright/test';
import {createRequire} from 'node:module';
const sharp: typeof import('../dashboard/node_modules/sharp') = createRequire(import.meta.url)('../dashboard/node_modules/sharp');

const W='E2EWarrior',P='E2EPriest',names=[W,P];
const caveFloor=/^zone_[a-f0-9]+_\d+$/;
test.use({liveHeadless:true,initialPosition:{map:'main',x:816,y:1180}});

async function headless(live:any,name:string){
  await live.post('/steam/action',{character:name,action:'logout'});
  await expect.poll(async()=>{const s=await live.state();return !s.activeSlots.some((slot:any)=>slot.character===name)&&(!s.steamSwitch||s.steamSwitch.phase==='complete');},{timeout:60_000}).toBe(true);
  await expect.poll(()=>live.admin(`output=!!get_player('${name}')`),{timeout:30_000}).toBe(false);
  const s=await live.state(),slot=s.activeSlots.find((entry:any)=>!entry.character&&entry.kind!=='steam');
  await live.post('/slots/'+(slot?.slot??slot?.index)+'/spawn',{character:name});
  await expect.poll(async()=>{const c=(await live.state()).characters[name];return c?.runtime==='headless'&&Date.now()-c.seenAt<3000;},{timeout:90_000}).toBe(true);
}
async function texturedPixels(page:Page,name:string){
  // A native choice can open between the caller's dialogue check and this
  // screenshot. Keep the locator attached; the caller rejects covered pixels.
  const card=page.getByRole('article',{includeHidden:true}).filter({has:page.getByRole('heading',{name,exact:true,includeHidden:true})});
  const shot=await card.locator('canvas').screenshot();
  const {data,info:size}=await sharp(shot).removeAlpha().raw().toBuffer({resolveWithObject:true});
  let floor=0,texture=0;
  for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++){
    const i=(y*size.width+x)*3,r=data[i],g=data[i+1],b=data[i+2];
    if(r>g*1.3&&g>b*1.3){floor++;if(x&&Math.abs(r-data[i-3])+Math.abs(g-data[i-2])+Math.abs(b-data[i-1])>20)texture++;}
  }
  return {floor,texture,shot};
}

test('a headless party sees the Cave floor through its leader and frees it when the visit ends',async({live,page},info)=>{
  test.setTimeout(900_000);
  await live.admin("Dev=true;Prod=false;G.events.dreams.disabled=false;G.events.dreams.encounters=G.events.dreams.encounters.filter(e=>['e11','e20','e31','e50'].includes(e.id));output=true");
  // The worker reads the leader at spawn, so the formation comes first.
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  await headless(live,P);
  await headless(live,W);
  const view=async()=>await (await page.request.get(live.url+'/party-api/daily-dungeons',{maxRetries:1})).json();
  const act=(body:Record<string,unknown>)=>live.post('/daily-dungeons',{operationId:crypto.randomUUID(),...body});
  async function reply(v:any){
    const c=v.members[0]?.observation?.cave;
    if(!c?.choice||c.choice.resolved)return false;
    const option=c.choice.options.find((o:any)=>!o.unavailable&&!o.cost&&!o.amber);
    await act({action:'vote',run:c.run,choice:c.choice.id,option:option.id});
    await expect.poll(async()=>{
      const current=await view();
      return current.members.length===2&&current.members.every((m:any)=>m.fresh&&m.observation?.alive&&
        m.observation.cave?.run===c.run&&m.observation.cave.floor===c.floor&&
        m.observation.cave.choice?.id===c.choice.id&&m.observation.cave.choice.resolved&&
        m.observation.cave.choice.votes?.[m.name]===option.id);
    },{timeout:30_000,message:'Both native replies must settle for this exact choice'}).toBe(true);
    return true;
  }
  await expect.poll(async()=>{
    const v=await view();
    return v.members.length===2&&v.members.every((m:any)=>m.fresh&&m.observation?.ready&&m.observation?.visit?.available&&m.observation.leader===W&&m.observation.members.length===2);
  },{timeout:120_000}).toBe(true);
  // The server keeps the handshake flag on the socket: only the leader asked for full floors.
  const handshake=await live.admin(`output=Object.fromEntries(['${W}','${P}'].map(n=>[n,get_player(n)?.socket?.generated_headless]))`);
  expect(handshake).toEqual({[W]:false,[P]:true});
  await act({action:'enter'});
  await expect.poll(async()=>(await view()).state.phase,{timeout:90_000}).toBe('active');
  await reply(await view());
  const cave=(await view()).members[0].observation.cave;
  const zone='zone_'+cave.run+'_'+cave.floor;
  await info.attach('headless-cave-entry',{body:JSON.stringify(await view()),contentType:'application/json'});
  const delivered=await live.admin(`output=(()=>{const out={};for(const n of ['${W}','${P}']){const p=get_player(n);out[n]={map:p.map,floor:p.socket.generated_floor};}return out;})()`);
  expect(delivered[W].map).toBe(zone);expect(delivered[P].map).toBe(zone);
  // Tile art is a static file of the disposable game server, reused across runs.
  const gameOrigin=new URL(live.clients[W].page.url()).origin,tileRequests:string[]=[];
  await page.route('https://adventure.land/images/**',async route=>{
    tileRequests.push(new URL(route.request().url()).pathname);
    const response=await page.request.get(gameOrigin+new URL(route.request().url()).pathname);
    await route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':'*'}});
  });
  await page.addInitScript(()=>{
    const native=window.EventSource,open=new Set<EventSource>();
    (window as any).__e2eMapStreams=open;
    (window as any).EventSource=class extends native{constructor(url:string|URL,init?:EventSourceInit){super(url,init);if(String(url).includes('/map-stream/'))open.add(this);}
      close(){open.delete(this);super.close();}};
  });
  await page.goto(live.url);
  // The follower's own worker never received floor art; its card still draws the floor.
  const followerCard=page.getByRole('article').filter({has:page.getByRole('heading',{name:P,exact:true})});
  await expect.poll(async()=>{
    await reply(await view());
    const expand=followerCard.getByRole('button',{name:'Expand live map'});
    if(await expand.isVisible())await expand.click({timeout:1000});
    return followerCard.locator('canvas').isVisible();
  },{timeout:30_000,message:'Open the follower map after any native entry dialogue'}).toBe(true);
  let definition:any;
  await expect.poll(async()=>{
    const response=await page.request.get(live.url+'/party-api/maps/'+zone);
    if(!response.ok())return 0;
    definition=await response.json();
    return definition.tiles.length&&(definition.placements.length+definition.groups.length);
  },{timeout:60_000,message:'The leader must supply the full floor definition'}).toBeGreaterThan(0);
  let pixels:any;
  const renderingObservations:unknown[]=[];
  try {
    await expect.poll(async()=>{
      const current=await view(),choice=current.members[0]?.observation?.cave?.choice;
      const replied=await reply(current);
      const dialogs=await page.getByRole('dialog').count();
      renderingObservations.push({at:Date.now(),choice:choice?.id,resolved:choice?.resolved,replied,dialogs});
      if(replied||dialogs)return false;
      pixels=await texturedPixels(page,P);
      const covered=await page.getByRole('dialog').count();
      renderingObservations.push({at:Date.now(),floor:pixels.floor,texture:pixels.texture,covered});
      return !covered&&pixels.floor>200&&pixels.texture>200;
    },{timeout:30_000,message:'The headless follower card must draw the textured Cave floor'}).toBe(true);
  } finally {
    await info.attach('headless-cave-rendering-observations',{body:JSON.stringify(renderingObservations),contentType:'application/json'});
    if(pixels)await info.attach('headless-cave-last-rendering',{body:pixels.shot,contentType:'image/png'});
  }
  await info.attach('headless-cave-follower-map',{body:pixels.shot,contentType:'image/png'});
  // One stream subscriber receives the floor once, not on every frame.
  const stream=await page.evaluate(async({api,name})=>{
    const frames:{bytes:number;definition:boolean}[]=[];
    const source=new EventSource(api+'/party-api/map-stream/'+encodeURIComponent(name));
    source.onmessage=event=>{const frame=JSON.parse(event.data);frames.push({bytes:event.data.length,definition:!!frame.definition});};
    await new Promise(resolve=>setTimeout(resolve,6000));source.close();return frames;
  },{api:live.url,name:P});
  const stripped=JSON.stringify({...definition,tiles:[],placements:[],groups:[]}).length;
  const efficiency={floorDefinitionBytes:JSON.stringify(definition).length,strippedDefinitionBytes:stripped,
    frames:stream.length,framesWithDefinition:stream.filter(f=>f.definition).length,
    tileImageRequests:tileRequests.length,uniqueTileImages:new Set(tileRequests).size,
    definitionFrameBytes:stream.find(f=>f.definition)?.bytes,otherFrameBytes:Math.round(stream.filter(f=>!f.definition).reduce((a,f)=>a+f.bytes,0)/Math.max(1,stream.filter(f=>!f.definition).length))};
  await info.attach('headless-cave-floor-bytes',{body:JSON.stringify(efficiency),contentType:'application/json'});
  expect(efficiency.frames).toBeGreaterThan(10);
  expect(efficiency.framesWithDefinition).toBe(1);
  // The full Cave map keeps its definition across frames and stops streaming in a hidden tab.
  const controls=page.getByRole('region',{name:'Cave of Many Dreams controls'});
  await reply(await view());
  await controls.getByRole('button',{name:'View full map'}).click();
  const fullMap=page.getByRole('dialog',{name:/Cave of Many Dreams/});
  await expect(fullMap.locator('canvas')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).__e2eMapStreams.size),{timeout:10_000}).toBeGreaterThanOrEqual(2);
  await info.attach('headless-cave-full-map',{body:await fullMap.screenshot(),contentType:'image/png'});
  const setHidden=(hidden:boolean)=>page.evaluate(hidden=>{
    Object.defineProperty(document,'hidden',{value:hidden,configurable:true});
    Object.defineProperty(document,'visibilityState',{value:hidden?'hidden':'visible',configurable:true});
    document.dispatchEvent(new Event('visibilitychange'));
  },hidden);
  await setHidden(true);
  await expect.poll(()=>page.evaluate(()=>(window as any).__e2eMapStreams.size),{timeout:10_000,message:'A hidden tab must close every map stream'}).toBe(0);
  await setHidden(false);
  await expect.poll(()=>page.evaluate(()=>(window as any).__e2eMapStreams.size),{timeout:10_000}).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Escape');
  // Leaving the Cave clears the floor and every field of the finished visit.
  await reply(await view());
  await act({action:'exit'});
  await expect.poll(async()=>(await view()).state.phase,{timeout:90_000}).toBe('held');
  await act({action:'release'});
  let idle:any;
  await expect.poll(async()=>(idle=await view()).state.phase,{timeout:30_000}).toBe('idle');
  for(const field of ['interruptedPhase','interruptedCommands','progress','travel','stairContinuation','pendingEvent'])
    expect(idle.state[field],field+' must not outlive the visit').toBeUndefined();
  await expect.poll(async()=>(await page.request.get(live.url+'/party-api/maps/'+zone)).status(),
    {timeout:30_000,message:'The coordinator must drop the floor once nobody is on it'}).toBe(404);
  await info.attach('headless-cave-released',{body:JSON.stringify(idle),contentType:'application/json'});
  for(const name of names)expect(caveFloor.test((await live.state()).characters[name].map)).toBe(false);
});
