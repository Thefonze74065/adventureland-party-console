import { test, expect } from "./fixtures";
import type { Locator } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

// Failure inventory: docs/item-card.md. Game metadata is a declared boundary;
// the maintained ItemDetails dialog runs in Chromium with the console styles.
const color = (locator: Locator) => locator.evaluate((node) => getComputedStyle(node).color);
const rgb = (hex: string) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
};
const line = (box: Locator, key: string) => box.locator(`[data-line="${key}"]`);
const label = (box: Locator, key: string) => color(box.locator(`[data-line="${key}"] [data-label]`));

test("item details show stats as the game card beside a matching extras box", async ({ page, app }, info) => {
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
      contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ItemDetails} from './features/party/item-details';
    const root=createRoot(document.getElementById('root'));
    window.mountItem=(selected,skills)=>root.render(<ItemDetails selected={selected} catalog={[]} exchanges={[]} skills={skills||[]}
      monsters={[]} characters={[{name:'W',ctype:'mage',level:80,slots:{}}]} achievements={{}} standFull={false}
      onNavigate={()=>{}} onAddWTB={()=>{}} onAddStand={()=>{}} onCompare={()=>{}} onCompareCatalog={()=>{}}
      onOpenChange={()=>root.render(null)}/>);
  `,
    },
  });
  await page.goto(app.url);
  await expect(page.locator("body")).toContainText("Party");
  const styles = await page
    .locator('style, link[rel="stylesheet"]')
    .evaluateAll((nodes) => nodes.map((node) => node.outerHTML).join("\n"));
  await page.route("**/item-card-harness", (route) =>
    route.fulfill({ contentType: "text/html", body: `<!doctype html><head>${styles}</head><body><div id="root"></div></body>` }),
  );
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(app.url + "/item-card-harness");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const mount = async (selected: unknown, skills?: unknown) => {
    await page.evaluate(() => (window as any).mountItem(null));
    await page.evaluate(([value, catalog]) => (window as any).mountItem(value, catalog), [selected, skills] as const);
  };

  // The Mothstep Boots as reported: a Cave of Darkness map bonus and grid fields with no card line.
  await mount({
    character: "Icelocked",
    entry: {
      slot: 6,
      item: { name: "cave_mothsteps", level: 0 },
      meta: {
        definition: { name: "Mothstep Boots", type: "shoes", tier: 2, scroll: true, stat: 2, armor: 8, resistance: 13, evasion: 4,
          speed: 8, exclusive: true, extra_stat: 1, explanation: "Cave of Darkness: +35% Evasion and +20 Speed.", g: 90000,
          upgrade: { armor: 1, stat: 1 } },
        upgradeable: true,
        properties: { stat: 2, armor: 8, resistance: 13, evasion: 4, speed: 8 },
        scaling: { armor: 1, stat: 1 },
        maxLevel: 13,
        bonuses: [{ kind: "map", id: "cave", name: "Cave of Darkness", stats: { evasion: 35, speed: 20 } }],
        usage: { classes: [{ id: "warrior", name: "Warrior", hands: null }, { id: "mage", name: "Mage", hands: null }], hands: [] },
        world: { recipe: { cost: 12000, quest: null, materials: [{ id: "shoes", name: "Shoes", quantity: 1, level: 0, sprite: null, drops: [] }] } },
        sprite: null,
      },
    },
  });
  const boots = page.getByRole("dialog", { name: "Mothstep Boots", exact: true });
  const bootsCard = boots.getByRole("region", { name: "Item card", exact: true });
  const bootsExtras = boots.getByRole("region", { name: "Item extras", exact: true });
  // 1, 5: game lines and the map bonus with its stats.
  await expect(line(bootsCard, "evasion")).toHaveText("Evasion: 4%");
  expect(await label(bootsCard, "evasion")).toBe(rgb("#7AC0F5"));
  await expect(line(bootsCard, "armor")).toHaveText("Armor: 8");
  await expect(line(bootsCard, "resistance")).toHaveText("Resistance: 13");
  await expect(line(bootsCard, "speed")).toHaveText("Speed: +8");
  await expect(line(bootsCard, "stat")).toHaveText("Stat: 2");
  await expect(line(bootsCard, "bonus_cave")).toHaveText("Bonus: Cave of Darkness [Only] Evasion +35% · Speed +20");
  // 7, 12: grid fields without a card line, readable and color coded.
  await expect(line(bootsExtras, "equip_slot")).toHaveText("Equip Slot: Shoes");
  await expect(line(bootsExtras, "stackable")).toHaveText("Stackable: No");
  await expect(line(bootsExtras, "tier")).toHaveText("Tier: 2");
  await expect(line(bootsExtras, "scroll")).toHaveText("Scroll: Yes");
  await expect(line(bootsExtras, "exclusive")).toHaveText("Exclusive: Yes");
  await expect(line(bootsExtras, "extra_stat")).toHaveText("Extra Stat: 1");
  expect(await label(bootsExtras, "tier")).toBe(rgb("#56A244"));
  for (const key of ["armor", "resistance", "evasion", "speed", "stat"]) await expect(line(bootsExtras, key)).toHaveCount(0);
  // 8: the rest of the dialog renders as before.
  for (const text of ["Icelocked · slot 6", "Cave of Darkness: +35% Evasion and +20 Speed.", "Buy from NPC", "Sell to NPC",
    "Eligible classes", "Level stat preview", "Craftable"])
    await expect(boots.getByText(text, { exact: false }).first()).toBeVisible();
  await expect(bootsCard).not.toContainText("Cave of Darkness: +35%");
  // 9: side by side on a wide dialog.
  const cardBox = (await bootsCard.boundingBox())!, extrasBox = (await bootsExtras.boundingBox())!;
  expect(extrasBox.x).toBeGreaterThanOrEqual(cardBox.x + cardBox.width - 1);
  expect(Math.abs(extrasBox.y - cardBox.y)).toBeLessThan(2);
  await info.attach("item-card-mothstep-boots", { body: await boots.screenshot(), contentType: "image/png" });
  // 9: stacked on a narrow viewport, without sideways scrolling.
  await page.setViewportSize({ width: 420, height: 1000 });
  const narrowCard = (await bootsCard.boundingBox())!, narrowExtras = (await bootsExtras.boundingBox())!;
  expect(narrowExtras.y).toBeGreaterThanOrEqual(narrowCard.y + narrowCard.height - 1);
  expect(await boots.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await info.attach("item-card-narrow", { body: await boots.screenshot(), contentType: "image/png" });
  await page.setViewportSize({ width: 1400, height: 1000 });

  // 1, 2, 7: the vampire set from the live game data. The gloves use the values from a
  // live Vampiric Gloves; their lifesteal-free stats and Extra Stat must all stay visible.
  await mount({
    character: "Icelocked",
    entry: {
      slot: 4,
      item: { name: "vgloves", level: 8, stat_type: "str" },
      meta: {
        definition: { name: "Vampiric Gloves", type: "gloves", set: "vampires", int: 3, str: 3, fzresistance: 4, tier: 3, scroll: true,
          upgrade: { stat: 1, resistance: 5.5, armor: 5.5 }, g: 340000, grades: [0, 0, 9, 10], stat: 3, extra_stat: 2, armor: 28, resistance: 14 },
        upgradeable: true,
        properties: { stat: 3, str: 14, int: 3, armor: 68, resistance: 54, fzresistance: 4 },
        scaling: { stat: 1, resistance: 5.5, armor: 5.5 },
        maxLevel: 12,
        usage: { classes: [{ id: "warrior", name: "Warrior", hands: null }], hands: [] },
        sprite: null,
      },
    },
  });
  const gloves = page.getByRole("dialog", { name: "Vampiric Gloves +8", exact: true });
  const glovesCard = gloves.getByRole("region", { name: "Item card", exact: true });
  const glovesExtras = gloves.getByRole("region", { name: "Item extras", exact: true });
  // A strength scroll folds the base Stat 3 into Strength 14, so no Stat line shows (failure mode 13).
  await expect(line(glovesCard, "stat")).toHaveCount(0);
  for (const [key, text] of [["str", "Strength: 14"], ["int", "Intelligence: 3"], ["armor", "Armor: 68"],
    ["resistance", "Resistance: 54"], ["fzresistance", "Freeze Res.: 4"]] as const)
    await expect(line(glovesCard, key)).toHaveText(text);
  await expect(line(glovesCard, "stat_type")).toHaveCount(0);
  await expect(line(glovesExtras, "stat_type")).toHaveText("Stat Scroll: Strength");
  expect(await label(glovesCard, "str")).toBe(rgb("#F07F2F"));
  await expect(line(glovesExtras, "extra_stat")).toHaveText("Extra Stat: 2");
  await expect(line(glovesExtras, "equip_slot")).toHaveText("Equip Slot: Gloves");
  await info.attach("item-card-vampiric-gloves", { body: await gloves.screenshot(), contentType: "image/png" });
  await mount({
    character: "Icelocked",
    entry: {
      slot: 2,
      item: { name: "vattire", level: 7 },
      meta: {
        definition: { name: "Spike's Attire", type: "chest", set: "vampires", tier: 3, scroll: true, hp: 1600, lifesteal: 2,
          upgrade: { lifesteal: 0.2, hp: 300, stat: 1, resistance: 5.5, armor: 5.5 }, g: 4800000, grades: [0, 0, 9, 10], stat: 3,
          extra_stat: 2, armor: 42, resistance: 28 },
        upgradeable: true,
        properties: { hp: 3700, lifesteal: 3.4, stat: 10, armor: 81, resistance: 67 },
        scaling: { lifesteal: 0.2, hp: 300, stat: 1, resistance: 5.5, armor: 5.5 },
        maxLevel: 12,
        usage: { classes: [{ id: "warrior", name: "Warrior", hands: null }], hands: [] },
        sprite: null,
      },
    },
  });
  const attire = page.getByRole("dialog", { name: "Spike's Attire +7", exact: true });
  const attireCard = attire.getByRole("region", { name: "Item card", exact: true });
  await expect(line(attireCard, "lifesteal")).toHaveText("Lifesteal: 3.4%");
  expect(await label(attireCard, "lifesteal")).toBe(rgb("#C8323E"));
  await expect(line(attireCard, "hp")).toHaveText("HP: 3700");
  await info.attach("item-card-spikes-attire", { body: await attire.screenshot(), contentType: "image/png" });

  // 1, 6, 13: Winged Boots +7 in two live copies, as the game shows them: the scrolled
  // stat replaces Stat, with Grade, A.Speed, Speed and Set from the game's card.
  for (const [owner, statType, statLine] of [["Icelocked", "int", "Intelligence: 9"], ["Patinder", "dex", "Dexterity: 9"]] as const) {
    await mount({
      character: owner,
      entry: {
        slot: -1,
        item: { name: "wingedboots", level: 7, stat_type: statType },
        meta: {
          definition: { name: "Winged Boots", set: "swift", tier: 1.5, type: "shoes", frequency: 3, speed: 8, resistance: 20, scroll: true,
            upgrade: { frequency: 0.625, speed: 1, stat: 1, resistance: 1.5, armor: 1.5 }, g: 150000, credit: "Pluet",
            grades: [4, 8, 10, 12], stat: 1, armor: 6 },
          upgradeable: true,
          properties: { [statType]: 9, armor: 17, resistance: 31, speed: 15, level: 7, frequency: 8, set: "swift" },
          scaling: { frequency: 0.625, speed: 1, stat: 1, resistance: 1.5, armor: 1.5 },
          maxLevel: 13,
          world: { set: { name: "Swift Judgement", explanation: "", items: [{ id: "wingedboots", name: "Winged Boots", quantity: 1, sprite: null }],
            bonuses: [{ pieces: 2, stats: { dex: 1 } }] } },
          usage: { classes: [{ id: "mage", name: "Mage", hands: null }], hands: [] },
          sprite: null,
        },
      },
    });
    const winged = page.getByRole("dialog", { name: "Winged Boots +7", exact: true });
    const wingedCard = winged.getByRole("region", { name: "Item card", exact: true });
    await expect.poll(() => wingedCard.locator("[data-line]").evaluateAll((nodes) => nodes.map((node) => node.textContent)))
      .toEqual([statLine, "Armor: 17", "Resistance: 31", "Speed: +15", "A.Speed: 8", "Grade: High",
      "Set: Swift Judgement", "[i]: Upgradeable"]);
    const wingedExtras = winged.getByRole("region", { name: "Item extras", exact: true });
    await expect(wingedExtras.locator('[data-line="credit"]')).toHaveText("Credit: Pluet");
    await expect(wingedExtras.locator('[data-line="stat_type"]')).toHaveText("Stat Scroll: " + (statType === "int" ? "Intelligence" : "Dexterity"));
    await info.attach(`item-card-winged-boots-${owner}`, { body: await winged.screenshot(), contentType: "image/png" });
  }

  // 1, 2, 3, 6, 10: a weapon with lifesteal, a resistance, Burn and grades.
  await mount({
    character: "W",
    entry: {
      slot: 3,
      item: { name: "firestaff", level: 9 },
      meta: {
        definition: { name: "Fire Staff", type: "weapon", wtype: "staff", tier: 2, damage_type: "magical", g: 50000,
          grades: [6, 8, 10, 12], upgrade: { attack: 4, int: 1 }, ability: "burn", attack: 20, int: 3 },
        upgradeable: true,
        properties: { attack: 61, int: 14, crit: 1.2, critdamage: 5, speed: 4, attr0: 3, lifesteal: 2, fzresistance: 4 },
        scaling: { attack: 4, int: 1 },
        maxLevel: 12,
        usage: { classes: [{ id: "mage", name: "Mage", hands: 2 }], hands: [2] },
        sprite: null,
      },
    },
  });
  const staff = page.getByRole("dialog", { name: "Fire Staff +9", exact: true });
  const card = staff.getByRole("region", { name: "Item card", exact: true });
  await expect(line(card, "attack")).toHaveText("Damage: 61");
  const order = await card.locator("[data-line]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-line")));
  expect(order.indexOf("lifesteal")).toBeLessThan(order.indexOf("crit"));
  expect(order.indexOf("crit")).toBeLessThan(order.indexOf("critdamage"));
  expect(order.indexOf("critdamage")).toBeLessThan(order.indexOf("attack"));
  expect(order.indexOf("attack")).toBeLessThan(order.indexOf("int"));
  expect(await label(card, "attack")).toBe(rgb("#DB2900"));
  await expect(line(card, "critdamage")).toHaveText("Crit Damage: +5%");
  expect(await label(card, "critdamage")).toBe(rgb("#C2366A"));
  await expect(line(card, "lifesteal")).toHaveText("Lifesteal: 2%");
  expect(await label(card, "lifesteal")).toBe(rgb("#C8323E"));
  await expect(line(card, "fzresistance")).toHaveText("Freeze Res.: 4");
  expect(await label(card, "fzresistance")).toBe(rgb("#69B1B6"));
  await expect(line(card, "damage_type")).toHaveText("Type: Magical");
  await expect(line(card, "speed")).toHaveText("Run Speed: +4");
  await expect(line(card, "grade")).toHaveText("Grade: Rare");
  await expect(line(card, "ability")).toHaveText("Ability: Burn");
  await expect(card).toContainText("Burns the opponent with a 3% chance. Deals damage over time.");
  await expect(line(card, "weapon_type")).toHaveText("Type: T2 Staff");
  expect(await label(card, "weapon_type")).toBe(rgb("#808080"));
  await staff.getByRole("slider").focus();
  await page.keyboard.press("ArrowRight");
  await expect(line(card, "grade")).toHaveText("Grade: Legendary");
  await expect(line(card, "attack")).not.toHaveText("Damage: 61");
  await expect(line(card, "lifesteal")).toHaveText("Lifesteal: 2%");

  // 2, 3: the Lolipop Mace's Explosion and Sugar Rush read as game lines, not raw keys.
  await mount({
    character: "W",
    entry: {
      slot: 5,
      item: { name: "glolipop", level: 7 },
      meta: {
        definition: { name: "Lolipop Mace", type: "weapon", wtype: "mace", tier: 0, dex: 24, explosion: 20, ability: "sugarrush",
          attr0: 0.25, damage_type: "physical", upgrade: { explosion: 2, range: 1, attack: 2.9 }, g: 16000, grades: [8, 9, 10, 12],
          range: 4, attack: 14 },
        upgradeable: true,
        properties: { attack: 34, dex: 24, explosion: 34, range: 11, attr0: 0.25 },
        scaling: { explosion: 2, range: 1, attack: 2.9 },
        maxLevel: 12,
        usage: { classes: [{ id: "warrior", name: "Warrior", hands: 1 }], hands: [1] },
        sprite: null,
      },
    },
  });
  const mace = page.getByRole("dialog", { name: "Lolipop Mace +7", exact: true });
  const maceCard = mace.getByRole("region", { name: "Item card", exact: true });
  await expect(line(maceCard, "explosion")).toHaveText("Explosion: 34%");
  expect(await label(maceCard, "explosion")).toBe(rgb("#782D33"));
  await expect(line(maceCard, "ability")).toHaveText("Ability: Sugar Rush");
  expect(await label(maceCard, "ability")).toBe(rgb("#D64770"));
  await expect(maceCard).toContainText("Trigger a Sugar Rush on attack with 0.25% chance. Gain 240 Attack Speed for 10 seconds!");
  for (const raw of ["attr0", "sugarrush"]) await expect(mace).not.toContainText(raw);
  await info.attach("item-card-lolipop-mace", { body: await mace.screenshot(), contentType: "image/png" });

  // 4, 5: a granted skill links to its details; a class-only bonus keeps its stats.
  await mount({
    character: "W",
    entry: {
      slot: 6,
      item: { name: "zapper", level: 0 },
      meta: {
        definition: { name: "The Zapper", type: "ring", ability: "zapperzap", int: 10, str: 5, rpiercing: 10, resistance: 30,
          compound: { int: 3, rpiercing: 4 }, grades: [0, 0, 1, 3] },
        compoundable: true,
        properties: { int: 10, str: 5, rpiercing: 10, resistance: 30 },
        bonuses: [{ kind: "class", id: "warrior", name: "Warrior", stats: { str: 10, apiercing: 40 } }],
        usage: { classes: [], hands: [] },
        sprite: null,
      },
    },
  }, [{ id: "shared", name: "Shared / system", skills: [{ id: "zapperzap", name: "Zap", sprite: null,
    definition: { name: "Zap", explanation: "Zap your target for 200 damage", mp: 140, cooldown: 200, range: 420, damage: 200 } }] }]);
  const zapperCard = page.getByRole("dialog", { name: "The Zapper", exact: true }).getByRole("region", { name: "Item card", exact: true });
  await expect(line(zapperCard, "ability")).toHaveText("Ability: Zap");
  await expect(zapperCard).not.toContainText("zapperzap");
  const zap = zapperCard.getByRole("button", { name: "Zap", exact: true });
  await expect(zap).toHaveAttribute("title", "Zap your target for 200 damage");
  await expect(line(zapperCard, "bonus_warrior")).toHaveText("Bonus: Warrior [Only] Strength +10 · A.Piercing +40");
  await zap.click();
  const skill = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Zap", exact: true }) });
  await expect(skill).toContainText("G.skills.zapperzap");
  await expect(skill).toContainText("Zap your target for 200 damage");
  await info.attach("item-card-skill-link", { body: await skill.screenshot(), contentType: "image/png" });
  await skill.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "The Zapper", exact: true })).toBeVisible();

  // 14: non-equipment from the live game data shows only the game's lines.
  const nonEquipment: [string, Record<string, unknown>, Record<string, unknown> | undefined, string[]][] = [
    ["Tracktrix", { name: "Tracktrix", type: "tracker", special: true, g: 12, explanation: "A tool that tracks all your experiences." },
      undefined, ["[i]: Information"]],
    ["Spider Silk", { name: "Spider Silk", type: "material", explanation: "A durable yet sticky material", s: 9999, g: 300 },
      { usedIn: [{ id: "wbook1", name: "Wanderer's Book", quantity: 3, level: 0, cost: 0, quest: null, sprite: null }] }, ["[i]: Usable"]],
    ["Rat Tail", { name: "Rat Tail", type: "material", s: 9999, g: 50 },
      { usedIn: [{ id: "wcap", name: "Cap", quantity: 3, level: 0, cost: 0, quest: "mcollector", sprite: null }] },
      ["An unknown material, as in, you have no idea what to do with it!", "[i]: Collectable"]],
    ["HP Potion", { name: "HP Potion", type: "pot", gives: [["hp", 400]], cooldown: 2000, s: 9999, g: 100 }, undefined,
      ["HP: +400", "[i]: Information"]],
    ["Liquid Luck", { name: "Liquid Luck", type: "elixir", luck: 16, duration: 12, s: 9999, g: 240000 }, undefined,
      ["Luck: +16%", "Hours: 12", "[i]: Information"]],
    ["XP Booster", { name: "XP Booster", type: "booster", gain: "xp", xp: 20, compound: { xp: 1 }, grades: [0, 10, 6, 7], days: 30, g: 79840000 },
      undefined, ["XP: +20%", "[i]: Compoundable"]],
    ["Candy", { name: "Candy", type: "gem", e: 1, s: 9999, g: 24000 }, undefined, ["[i]: Exchangeable"]],
  ];
  for (const [name, definition, world, expected] of nonEquipment) {
    await mount({
      character: "Bank · items0",
      entry: { slot: 2, item: { name: String(definition.name).toLowerCase(), q: 5 },
        meta: { definition, compoundable: !!definition.compound, usage: { classes: [], hands: [] }, world, sprite: null } },
    });
    const dialog = page.getByRole("dialog", { name, exact: true });
    // root.render schedules a commit; evaluateAll alone can snapshot zero nodes
    // before the new dialog exists. Poll the complete, exact ordered line list.
    await expect.poll(() => dialog.getByRole("region", { name: "Item card", exact: true }).locator("[data-line]")
      .evaluateAll((nodes) => nodes.map((node) => node.textContent))).toEqual(expected);
    await expect(dialog.getByRole("region", { name: "Item extras", exact: true }).locator('[data-line="quantity"]')).toHaveText("Quantity: 5");
    await page.keyboard.press('i');
    const json=page.getByRole('dialog',{name:'Item information',exact:true});
    await expect(json.getByRole('region',{name:'Item JSON',exact:true})).toContainText(JSON.stringify(name.toLowerCase()));
    if(name==='Tracktrix')await info.attach('item-information-json',{body:await json.screenshot(),contentType:'image/png'});
    await page.keyboard.press('Escape');
    await expect(json).not.toBeVisible();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button',{name:'Item information (I)',exact:true}).click();
    await expect(json).toBeVisible();
    await json.getByRole('button',{name:'Close information',exact:true}).click();
    await expect(json).not.toBeVisible();
    await expect(dialog).toBeVisible();
    if (name === "Tracktrix" || name === "HP Potion")
      await info.attach(`item-card-${name.replace(/\W+/g, "-").toLowerCase()}`, { body: await dialog.screenshot(), contentType: "image/png" });
  }

  for(const contents of ['ikissyou','sinisterlaugh',undefined]){
    await mount({character:'Bank',entry:{slot:25,item:{name:'cxjar',q:3,...(contents?{data:contents}:{})},meta:{definition:{name:'CX Jar',type:'jar',s:9999},properties:{},sprite:null}}});
    const jar=page.getByRole('dialog',{name:'CX Jar',exact:true});
    await expect(jar.locator('[data-line="filled_with"]')).toHaveText(`Filled with: ${contents||'nothing'}`);
    await info.attach(`cxjar-${contents||'empty'}`,{body:await jar.screenshot(),contentType:'image/png'});
  }

  // 11: item state on a scrolled, locked, bound ring.
  await mount({
    character: "Equipment catalog",
    entry: {
      slot: -1,
      item: { name: "dexring", level: 5, stat_type: "dex", l: "l", acl: 1, q: 2, expires: "2099-01-01T00:00:00.000Z" },
      meta: {
        definition: { name: "Ring of Dexterity", type: "ring", compound: { dex: 1 }, dex: 1 },
        compoundable: true,
        properties: { dex: 6 },
        scaling: { dex: 1 },
        maxLevel: 7,
        usage: { classes: [], hands: [] },
        sprite: null,
      },
    },
  });
  const ringDialog = page.getByRole("dialog", { name: "Ring of Dexterity +5", exact: true });
  const ringCard = ringDialog.getByRole("region", { name: "Item card", exact: true });
  const ringExtras = ringDialog.getByRole("region", { name: "Item extras", exact: true });
  for (const text of ["Locked", "Account Bound", "Expires"]) await expect(ringCard).toContainText(text);
  expect(await color(ringCard.locator('[data-line="lock"]'))).toBe(rgb("#8C8C8C"));
  for (const text of ["Quantity", "Stat scroll"]) await expect(ringCard).not.toContainText(text);
  await expect(line(ringExtras, "quantity")).toHaveText("Quantity: 2");
  await expect(line(ringExtras, "stat_type")).toHaveText("Stat Scroll: Dexterity");
  await info.attach("item-card-ring", { body: await ringCard.screenshot(), contentType: "image/png" });
});
