import { test, expect } from "./fixtures";
import { build } from "esbuild";
import path from "node:path";
// Failure inventory: offline snapshots accidentally permit commands or imply online;
// donation previews use the wrong XP curve/rate or disagree in opposite directions;
// item selection loses modifier ranges or applies unsupported batch actions.
test("merchant donation previews target level and progress in both directions", async ({
  page,
  app,
}, info) => {
  const bundle = await build({
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    tsconfig: path.resolve("dashboard/tsconfig.json"),
    stdin: {
      resolveDir: path.resolve("dashboard"),
      loader: "tsx",
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{DonationPreview}from'./features/party/donation-preview';function App(){const[a,s]=React.useState('');return <DonationPreview amount={a} onAmountChange={s} character={{level:2,xp:25,donationXpPerGold:4,donationLevelXp:[0,100,200,400,800]}}/>}createRoot(document.getElementById('root')).render(<App/>);`,
    },
  });
  await page.goto(app.url);
  const styles = await page
    .locator('style,link[rel="stylesheet"]')
    .evaluateAll((nodes) => nodes.map((n) => n.outerHTML).join(""));
  await page.route("**/donation-preview-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<head>${styles}</head><body><div id="root"></div></body>`,
    }),
  );
  await page.goto(app.url + "/donation-preview-harness");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole("spinbutton", { name: "Merchant level after donation" }).fill("3");
  await expect(page.getByRole("textbox", { name: "Donation amount" })).toHaveValue("44");
  await expect(page.getByText(/Level 3 .*0.25%/)).toBeVisible();
  await page.getByRole("textbox", { name: "Donation amount" }).fill("100");
  await expect(page.getByRole("spinbutton", { name: "Merchant level after donation" })).toHaveValue(
    "3",
  );
  await expect(page.getByText(/Level 3 .*56.25%/)).toBeVisible();
  await info.attach("donation-preview", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("offline account inspection exposes saved inventory and comparison without item actions", async ({
  page,
  app,
}, info) => {
  const character = {
    name: "OfflineMage",
    ctype: "mage",
    level: 42,
    xp: 0,
    max_xp: 100,
    hp: 100,
    max_hp: 100,
    mp: 200,
    max_mp: 200,
    gold: 123,
    map: "main",
    x: 0,
    y: 0,
    rip: false,
    banking: false,
    seenAt: 1,
    updatedAt: 1,
    items: [
      {
        slot: 0,
        item: { name: "coat", level: 2 },
        meta: { definition: { name: "Coat", type: "chest" }, properties: { armor: 10 } },
      },
    ],
    slots: {
      chest: {
        item: { name: "coat" },
        meta: { definition: { name: "Coat", type: "chest" }, properties: { armor: 5 } },
      },
    },
  };
  const bundle = await build({
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    tsconfig: path.resolve("dashboard/tsconfig.json"),
    stdin: {
      resolveDir: path.resolve("dashboard"),
      loader: "tsx",
      contents: `import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{AccountSettings}from'./features/party/account-settings';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><AccountSettings state={window.fixture}/></QueryClientProvider>);`,
    },
  });
  await page.goto(app.url);
  const styles = await page
    .locator('style,link[rel="stylesheet"]')
    .evaluateAll((nodes) => nodes.map((n) => n.outerHTML).join(""));
  await page.route("**/offline-inspection-harness", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<head>${styles}</head><body><div id="root"></div></body>`,
    }),
  );
  await page.goto(app.url + "/offline-inspection-harness");
  await page.evaluate((c) => {
    (window as any).fixture = {
      characters: {},
      roster: [{ name: c.name, ctype: c.ctype, level: c.level }],
      characterSnapshots: { [c.name]: c },
    };
  }, character);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole("button", { name: "Inspect OfflineMage", exact: true }).click();
  await expect(page.getByText("Offline · saved observation")).toBeVisible();
  await expect(page.getByRole("button", { name: "Inspect Coat +2", exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Inspect Coat +2", exact: true })
    .click({ button: "right" });
  await expect(page.getByRole("menuitem")).toHaveCount(0);
  await page.getByRole("button", { name: "Compare Coat +2", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Equipment comparison", exact: true }),
  ).toBeVisible();
  await info.attach("offline-character-comparison", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("item batches support control and range selection and hide incompatible common actions", async ({
  page,
  app,
}, info) => {
  const bundle = await build({
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    tsconfig: path.resolve("dashboard/tsconfig.json"),
    stdin: {
      resolveDir: path.resolve("dashboard"),
      loader: "tsx",
      contents: `import React from'react';import{createRoot}from'react-dom/client';import{ContextMenu,ContextMenuTrigger,ContextMenuContent}from'./components/ui/context-menu';import{useItemSelection,BatchItemActions}from'./features/party/item-selection';const entries=[{slot:0,item:{name:'coat',level:1},meta:{upgradeable:true,maxLevel:9,definition:{}}},{slot:1,item:{name:'coat',level:3},meta:{upgradeable:true,maxLevel:9,definition:{}}},{slot:2,item:{name:'hpot0'},meta:{definition:{}}}];window.commands=[];function App(){const selection=useItemSelection(entries,e=>String(e.slot));return <>{entries.map(e=><ContextMenu key={e.slot}><ContextMenuTrigger render={<button type="button"/>} aria-label={'Slot '+e.slot} aria-pressed={selection.has(e)} onClick={event=>selection.click(event,e)} onContextMenu={()=>selection.context(e)}>Slot {e.slot}</ContextMenuTrigger><ContextMenuContent><BatchItemActions entries={selection.forEntry(e)} merchant onCommand={(type,entry,extra)=>window.commands.push({type,item:entry.item,...extra})}/></ContextMenuContent></ContextMenu>)}</>}createRoot(document.getElementById('root')).render(<App/>);`,
    },
  });
  await page.goto(app.url);
  const styles = await page
    .locator('style,link[rel="stylesheet"]')
    .evaluateAll((nodes) => nodes.map((n) => n.outerHTML).join(""));
  await page.route("**/batch-harness", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<head>${styles}</head><body><div id="root"></div></body>`,
    }),
  );
  await page.goto(app.url + "/batch-harness");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole("button", { name: "Slot 0" }).click({ modifiers: ["Control"] });
  await page.getByRole("button", { name: "Slot 1" }).click({ modifiers: ["Control"] });
  await page.getByRole("button", { name: "Slot 0" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Upgrade each by one level", exact:true }).click();
  expect(await page.evaluate(() => (window as any).commands)).toEqual([
    { type: "upgrade-mark", item: { name: "coat", level: 1 }, slot: 0, tiers: 1 },
    { type: "upgrade-mark", item: { name: "coat", level: 3 }, slot: 1, tiers: 1 },
  ]);
  await page.getByRole("button", { name: "Slot 2" }).click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Slot 0" }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Upgrade each by one level", exact:true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Auto mark for bank" }).click();
  expect((await page.evaluate(() => (window as any).commands)).slice(2)).toHaveLength(3);
  await info.attach("multi-item-actions", {
    body: JSON.stringify(await page.evaluate(() => (window as any).commands)),
    contentType: "application/json",
  });
});

test("bank selections preserve physical sources and offer exchange and compound controls", async ({
  page,
  app,
}, info) => {
  const bundle = await build({
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    tsconfig: path.resolve("dashboard/tsconfig.json"),
    stdin: {
      resolveDir: path.resolve("dashboard"),
      loader: "tsx",
      contents: `import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{BankSheet}from'./features/party/bank-sheet';const coat=(slot,level)=>({slot,item:{name:'coat',level},meta:{upgradeable:true,maxLevel:9,definition:{name:'Coat '+level,type:'chest'}}});const gem={slot:2,item:{name:'gem',level:0},meta:{compoundable:true,maxLevel:7,definition:{name:'Gem',e:1}}};window.actions=[];const props={open:true,onOpenChange:()=>{},bank:{gold:0,seenAt:1,character:'Merchant',packs:{items0:[coat(0,1),coat(1,3),gem]}},bankbois:[],bankboiQueue:[],merchant:'Merchant',vaults:[],withdrawals:{},onSelect:()=>{},onWithdraw:()=>{},onWithdrawAll:()=>{},onCreateBankboi:async()=>'',onDeleteBankboi:async()=>{},buyable:[],catalog:[],priceHistory:{},standListings:[],onStand:()=>{},onUnstand:()=>{},onNpcSale:()=>{},onDeconstruction:()=>{},onUpgrade:()=>{},onClearMarks:()=>{},onAutoStand:()=>{},onAutoNpcSale:()=>{},deconstructionCatalog:{},npcSaleMarks:[],onUnlock:async()=>{},exchangeCatalog:[{id:'gem',level:0}],onExchange:(pack,entry,auto)=>window.actions.push({type:'exchange',pack,slot:entry.slot,auto}),onCompound:(pack,entry,tier,auto)=>window.actions.push({type:'compound',pack,slot:entry.slot,tier,auto}),onBatchError:message=>window.actions.push({error:message}),onBatchCommand:async(type,pack,entry,extra)=>window.actions.push({type,pack,slot:entry.slot,...extra})};createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><BankSheet {...props}/></QueryClientProvider>);`,
    },
  });
  await page.goto(app.url);
  const styles = await page
    .locator('style,link[rel="stylesheet"]')
    .evaluateAll((nodes) => nodes.map((n) => n.outerHTML).join(""));
  await page.route("**/bank-selection-harness", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<head>${styles}</head><body><div id="root"></div></body>`,
    }),
  );
  await page.goto(app.url + "/bank-selection-harness");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole("button", { name: "Coat 1", exact: true }).click({ modifiers: ["Control"] });
  await page.getByRole("button", { name: "Coat 3", exact: true }).click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Coat 1", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Upgrade each by one level", exact: true }).click();
  expect(await page.evaluate(() => (window as any).actions)).toEqual([
    { type: "withdraw", pack: "items0", slot: 0, markAll: false, upgradeTiers: 1 },
    { type: "withdraw", pack: "items0", slot: 1, markAll: false, upgradeTiers: 1 },
  ]);
  await page.getByRole("button", { name: "Gem", exact: true }).click({ button: "right" });
  expect(await page.getByRole('menu').evaluate(menu=>({background:getComputedStyle(menu).backgroundColor,opacity:getComputedStyle(menu).opacity}))).toEqual({background:'rgb(255, 255, 255)',opacity:'1'});
  await info.attach('opaque-bank-context-menu',{body:await page.screenshot(),contentType:'image/png'});
  await page.getByRole("menuitem", { name: "Auto exchange", exact: true }).click();
  await page.getByRole("button", { name: "Gem", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Compound one level", exact: true }).click();
  expect((await page.evaluate(() => (window as any).actions)).slice(2)).toEqual([
    { type: "exchange", pack: "items0", slot: 2, auto: true },
    { type: "compound", pack: "items0", slot: 2, tier: 1, auto: false },
  ]);
  await info.attach("bank-batch-actions", {
    body: JSON.stringify(await page.evaluate(() => (window as any).actions)),
    contentType: "application/json",
  });
});
test("exchange reward selections apply common automatic actions across mixed upgrade levels", async ({
  page,
  app,
}, info) => {
  const bundle = await build({
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    tsconfig: path.resolve("dashboard/tsconfig.json"),
    stdin: {
      resolveDir: path.resolve("dashboard"),
      loader: "tsx",
      contents: `import React from'react';import{createRoot}from'react-dom/client';import{ExchangeItemSelection}from'./features/party/exchange-item-selection';import{ExchangeRewardTile}from'./features/party/exchange-reward-tile';window.actions=[];const model={state:{merchantCharacter:'Merchant',merchantCatalog:{allItems:[{id:'coat',meta:{upgradeable:true,maxLevel:9,definition:{name:'Coat'}}},{id:'hpot0',meta:{definition:{name:'Potion',e:1}}}],buyable:[],exchangeable:[]}},post:async(path,body)=>window.actions.push(body),command:async()=>{},setActionError:message=>window.actions.push({error:message}),setAutoNpcSaleItem:()=>{},setStandItem:()=>{}};const rewards=[{id:'coat',level:1,name:'Coat',detail:'1/10'},{id:'coat',level:3,name:'Coat',detail:'1/20'},{id:'hpot0',level:0,name:'Potion',detail:'1/2'}];createRoot(document.getElementById('root')).render(<ExchangeItemSelection>{rewards.map(reward=><ExchangeRewardTile key={reward.detail} reward={{...reward,quantity:1,onInspect:()=>{throw Error('Modifier click must not inspect')}}} model={model}/>)}</ExchangeItemSelection>);`,
    },
  });
  await page.goto(app.url);
  const styles = await page
    .locator('style,link[rel="stylesheet"]')
    .evaluateAll((nodes) => nodes.map((n) => n.outerHTML).join(""));
  await page.route("**/exchange-selection-harness", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<head>${styles}</head><body><div id="root"></div></body>`,
    }),
  );
  await page.goto(app.url + "/exchange-selection-harness");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const first = page.getByRole("button", { name: "Exchange reward: coat +1", exact: true }),
    second = page.getByRole("button", { name: "Exchange reward: coat +3", exact: true });
  await first.click({ modifiers: ["Control"] });
  await second.click({ modifiers: ["Control"] });
  await first.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Auto upgrade each by one level", exact: true }).click();
  expect(await page.evaluate(() => (window as any).actions)).toEqual([
    {
      character: "Merchant",
      type: "auto-upgrade-mark",
      item: { name: "coat", level: 1 },
      slot: -1,
      tiers: 1,
    },
    {
      character: "Merchant",
      type: "auto-upgrade-mark",
      item: { name: "coat", level: 3 },
      slot: -1,
      tiers: 1,
    },
  ]);
  await page
    .getByRole("button", { name: "Exchange reward: hpot0 +0", exact: true })
    .click({ modifiers: ["Shift"] });
  await first.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Auto upgrade each by one level", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Auto mark for bank", exact: true }).click();
  expect((await page.evaluate(() => (window as any).actions)).slice(2)).toHaveLength(3);
  await info.attach("exchange-batch-actions", {
    body: JSON.stringify(await page.evaluate(() => (window as any).actions)),
    contentType: "application/json",
  });
});

test("player and merchant inventory batches preserve owner and mixed upgrade levels", async ({
  page,
  app,
}, info) => {
  const bundle = await build({
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    tsconfig: path.resolve("dashboard/tsconfig.json"),
    stdin: {
      resolveDir: path.resolve("dashboard"),
      loader: "tsx",
      contents: `import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{InventoryPanel}from'./features/party/inventory-panel';const root=createRoot(document.getElementById('root'));window.actions=[];const entries=[{slot:0,item:{name:'coat',level:1},meta:{upgradeable:true,maxLevel:9,definition:{name:'Coat one',type:'chest'}}},{slot:1,item:{name:'coat',level:3},meta:{upgradeable:true,maxLevel:9,definition:{name:'Coat three',type:'chest'}}},{slot:2,item:{name:'hpot0'},meta:{definition:{name:'Potion',e:1}}}];window.mountInventory=name=>{const character={name,ctype:name==='Merchant'?'merchant':'warrior',level:50,xp:0,max_xp:100,hp:100,max_hp:100,mp:100,max_mp:100,gold:0,map:'main',x:0,y:0,seenAt:1,rip:false,banking:false,items:entries,slots:{}};const command=async(character,type,item,extra)=>window.actions.push({character,type,item,...extra});const props={character,characters:[character],merchant:'Merchant',marked:[],merchantMarked:[],autoItemMarks:{},autoUpgradeMarks:{},allAutoUpgradeMarks:{},merchantDeliveries:{},standListings:[],autoNpcSales:{},autoStandMarks:{},buyable:[],catalog:[],priceHistory:{},upgradeMarks:[],statScrollMarks:[],statScrollInventory:{},compoundGroups:[],autoCompoundMarks:[],allAutoCompoundMarks:{},autoExchanges:{},onSelect:()=>{},onCompare:()=>{},onCommand:command,onBatchCommand:command,onBatchError:message=>window.actions.push({error:message}),onTravel:()=>{},onStand:()=>{},onNpcSale:()=>{},onAutoNpcSale:()=>{},onAutoStand:()=>{},onClearAutomaticSales:()=>{},onRemoveAutomaticSale:()=>{}};root.render(<QueryClientProvider client={new QueryClient()}><InventoryPanel key={name} {...props}/></QueryClientProvider>);};`,
    },
  });
  await page.goto(app.url);
  const styles = await page
    .locator('style,link[rel="stylesheet"]')
    .evaluateAll((nodes) => nodes.map((n) => n.outerHTML).join(""));
  await page.route("**/inventory-selection-harness", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<head>${styles}</head><body><div id="root"></div></body>`,
    }),
  );
  await page.goto(app.url + "/inventory-selection-harness");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  for (const name of ["Fighter", "Merchant"]) {
    await page.evaluate((name) => (window as any).mountInventory(name), name);
    const first = page.getByRole("button", { name: "Coat one", exact: true }),
      second = page.getByRole("button", { name: "Coat three", exact: true });
    await first.click({ modifiers: ["Control"] });
    await second.click({ modifiers: ["Shift"] });
    await first.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Upgrade each by one level", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).actions.length))
      .toBe(name === "Fighter" ? 2 : 4);
  }
  expect(await page.evaluate(() => (window as any).actions)).toEqual(
    ["Fighter", "Merchant"].flatMap((character) => [
      { character, type: "upgrade-mark", item: { name: "coat", level: 1 }, slot: 0, tiers: 1 },
      { character, type: "upgrade-mark", item: { name: "coat", level: 3 }, slot: 1, tiers: 1 },
    ]),
  );
  await info.attach("inventory-batch-owner-ledger", {
    body: JSON.stringify(await page.evaluate(() => (window as any).actions)),
    contentType: "application/json",
  });
  const potion=page.getByRole('button',{name:'Potion',exact:true});
  await potion.click();await potion.click({button:'right'});
  const exchange=page.getByRole('menuitem',{name:'Exchange',exact:true});
  await expect(exchange.locator('svg')).toBeVisible();
  const colors=await exchange.evaluate(e=>({text:getComputedStyle(e).color,icon:getComputedStyle(e.querySelector('svg')!).color}));
  expect(colors.icon).toBe(colors.text);
  await info.attach('single-exchange-icon',{body:await page.screenshot(),contentType:'image/png'});
  await exchange.click();
  expect((await page.evaluate(()=>(window as any).actions)).at(-1)).toMatchObject({character:'Merchant',type:'exchange',slot:2});
});

test.describe("offline observation persistence", () => {
  test.use({ merchantConnected: false });
  test("offline character inventory and native stats survive coordinator restart without catalog duplication", async ({
    page,
    app,
  }, info) => {
    const initial = await app.state();
    const item = { name: "coat", level: 2 };
    const sprite={url:'/settings-character-sprite.png',tileSize:1,columns:1,rows:1,x:0,y:0};
    await page.route('**/settings-character-sprite.png',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64')}));
    const meta = {
      definition: { name: "Saved coat", type: "chest" },
      properties: { armor: 14 },
      upgradeable: true,
      maxLevel: 13,
      sprite,
      world: { sentinel: "must-not-persist", catalog: "x".repeat(200000) },
    };
    await app.deliverStatus({
      ...initial.characters.W,
      name: "M",
      ctype: "merchant",
      level: 42,
      attack: 137,
      hp: 321,
      max_hp: 456,
      gold: 123,
      clientVersion: 17175,
      characterDollHtml:'<img src="/settings-character-sprite.png" width="54" height="76">',
      items: [{ slot: 0, item, meta }],
      slots: {
        chest: {
          item: { name: "coat", level: 0 },
          meta: { definition: { name: "Coat", type: "chest" }, properties: { armor: 5 }, sprite },
        },
      },
    });
    const before = (await app.state()).characterSnapshots.M;
    expect(before.items[0].item).toEqual(item);
    expect(before.attack).toBe(137);
    await page.goto(app.url);
    await page.getByRole('button',{name:'Interface settings',exact:true}).click();
    await page.getByRole('button',{name:'Inspect M',exact:true}).click();
    const portrait=page.getByRole('button',{name:'View M stats',exact:true});
    await expect.poll(()=>portrait.locator('img').evaluateAll(images=>images.some(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0))).toBe(true);
    const equipped=page.getByRole('button',{name:'Inspect Coat +0',exact:true});
    await expect(equipped.getByRole('img',{name:'Coat +0 sprite',exact:true})).toBeVisible();
    await equipped.click();
    const inspectedItem=page.getByRole('dialog',{name:'Coat +0',exact:true});
    await expect(inspectedItem.getByRole('img',{name:'Inspected item sprite',exact:true})).toBeVisible();
    await inspectedItem.getByRole('button',{name:'Compare',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Equipment comparison',exact:true})).toBeVisible();
    await info.attach('settings-equipped-item-comparison',{body:await page.screenshot({animations:'disabled'}),contentType:'image/png'});
    await page.getByRole('dialog',{name:'Equipment comparison',exact:true}).getByRole('button',{name:'Close',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Equipment comparison',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Inspect Coat +0',exact:true})).toBeVisible();
    expect(JSON.stringify(before)).not.toContain("must-not-persist");
    expect(Buffer.byteLength(JSON.stringify(before))).toBeLessThan(50000);
    await app.restartCoordinator();
    const after = await app.state();
    expect(after.characters.M).toBeUndefined();
    expect(after.characterSnapshots.M).toEqual(before);
    await page.goto(app.url);
    await page.getByRole("button", { name: "Interface settings", exact: true }).click();
    await page.getByRole("button", { name: "Inspect M", exact: true }).click();
    await expect(page.getByText("Offline · saved observation", { exact: false })).toBeVisible();
    await expect.poll(()=>page.getByRole('button',{name:'View M stats',exact:true}).locator('img').evaluateAll(images=>images.some(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0))).toBe(true);
    await expect(page.getByRole('button',{name:'Inspect Coat +0',exact:true}).getByRole('img',{name:'Coat +0 sprite',exact:true})).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Inspect Saved coat +2", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "View M stats", exact: true }).click();
    const stats = page.getByRole("region", { name: "Character card", exact: true });
    await expect(stats).toContainText("137");
    await expect(stats).toContainText("321/456");
    await expect(stats).toContainText("Offline snapshot");
    await info.attach("offline-persisted-observation", {
      body: JSON.stringify({ before, after: after.characterSnapshots.M }),
      contentType: "application/json",
    });
    await info.attach("offline-native-stat-card", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
});

test.describe('never-loaded account character inspection',()=>{
 test.use({merchantConnected:false});
 test('owned offline profiles load lazily without starting a character or exposing private account data',async({page,app},info)=>{
  const before=await app.state();expect(before.characters.M).toBeUndefined();expect(before.characterSnapshots?.M).toBeUndefined();
  await page.goto(app.url);const foreign=await page.request.get(app.url+'/party-api/characters/Unowned/inspection');expect(foreign.status()).toBe(404);
  await page.getByRole('button',{name:'Interface settings',exact:true}).click();await page.getByRole('button',{name:'Inspect M',exact:true}).click();await expect(page.getByRole('button',{name:'Inspect Coat +2',exact:true})).toBeVisible();await page.getByRole('button',{name:'View M stats',exact:true}).click();await expect(page.getByText('Derived stats unavailable for this saved profile.',{exact:true})).toBeVisible();await expect(page.getByText('HP: 321',{exact:true})).toBeVisible();
  const first=await(await page.request.get(app.url+'/party-api/characters/M/inspection')).json(),second=await(await page.request.get(app.url+'/party-api/characters/M/inspection')).json();expect(second).toEqual(first);expect(first.character.gold).toBe(124);expect(first.character.inspection.calculated).toBe(false);expect(JSON.stringify(first)).not.toMatch(/shells|session|billing|auth=/i);
  const after=await app.state();expect(after.characters.M).toBeUndefined();expect(after.activeSlots).toEqual(before.activeSlots);await info.attach('owned-offline-profile',{body:JSON.stringify({first,second,beforeSlots:before.activeSlots,afterSlots:after.activeSlots}),contentType:'application/json'});await info.attach('offline-profile-basic-stats',{body:await page.screenshot(),contentType:'image/png'});
 });
});

test.describe('offline comparison picker',()=>{
 test.use({merchantConnected:false});
 test('item comparison can select a never-loaded owned character from the roster',async({page,app},info)=>{
  const initial=await app.state(),coat=initial.merchantCatalog.allItems.find((entry:any)=>entry.id==='coat');
  const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',tsconfig:path.resolve('dashboard/tsconfig.json'),stdin:{resolveDir:path.resolve('dashboard'),loader:'tsx',contents:`import React from'react';import{createRoot}from'react-dom/client';import{ItemDetails}from'./features/party/item-details';import{GearComparisonDialog}from'./features/party/gear-comparison-dialog';import{loadCharacterInspection}from'./features/party/load-character-inspection';function App(){const[c,s]=React.useState(null);return c?<GearComparisonDialog comparison={c} currentCharacter={c.character} onOpenChange={()=>s(null)}/>:<ItemDetails selected={{character:'Catalog',entry:{slot:-1,item:{name:'coat',level:2},meta:window.coat.meta}}} catalog={[window.coat]} monsters={[]} characters={[]} offlineCharacters={[{name:'M',ctype:'merchant'}]} onLoadCharacter={loadCharacterInspection} achievements={{}} standFull={false} onNavigate={()=>{}} onAddWTB={()=>{}} onAddStand={()=>{}} onCompare={(character,entry,slot)=>{window.selectedComparison={name:character.name,items:character.items,slot};s({character,entry,slot});}} onCompareCatalog={()=>{}} onOpenChange={()=>{}}/>;}createRoot(document.getElementById('root')).render(<App/>);`}});
  await page.goto(app.url);const styles=await page.locator('style,link[rel="stylesheet"]').evaluateAll(nodes=>nodes.map(n=>n.outerHTML).join(''));await page.route('**/offline-comparison-harness',r=>r.fulfill({contentType:'text/html',body:`<head>${styles}</head><body><div id="root"></div></body>`}));await page.goto(app.url+'/offline-comparison-harness');await page.evaluate(coat=>(window as any).coat=coat,coat);await page.addScriptTag({content:bundle.outputFiles[0].text});await page.getByRole('button',{name:'Compare',exact:true}).click();await page.getByRole('button',{name:/M.*merchant.*offline/}).click();await expect(page.getByRole('dialog',{name:'Equipment comparison',exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).selectedComparison.name)).toBe('M');expect((await app.state()).characters.M).toBeUndefined();await expect(page.getByText('Derived stats unavailable for this saved profile.',{exact:true})).toHaveCount(3);await info.attach('never-loaded-character-comparison',{body:await page.screenshot(),contentType:'image/png'});
 });
});
