import { test, expect } from "./fixtures";
import type { Locator } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

// Failure inventory: docs/skill-card.md. Skill definitions are declared from the live
// game data (17665); the maintained SkillsDialog and ItemDetails run in Chromium.
const color = (locator: Locator) => locator.evaluate((node) => getComputedStyle(node).color);
const rgb = (hex: string) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
};
const skill = (id: string, definition: Record<string, unknown>) => ({ id, name: String(definition.name), sprite: null, definition });
const SKILLS = [
  { id: "ranger", name: "Ranger", skills: [
    skill("supershot", { type: "skill", skin: "skill_supershot", class: ["ranger"], name: "Supershot",
      explanation: "Deals 1.5X instant damage from an incredible distance.", wtype: ["bow", "crossbow"], damage_multiplier: 1.5,
      cooldown: 30000, range_multiplier: 3, range_bonus: 20, mp: 400, target: true, hostile: true, pierces_immunity: true,
      damage_type: "physical", procs: true, use_range: true }),
    skill("3shot", { type: "skill", skin: "skill_3shot", class: ["ranger"], name: "3-Shot", explanation: "Hits 3 targets at once!",
      wtype: ["bow", "crossbow"], damage_multiplier: 0.7, level: 60, mp: 200, cooldown_multiplier: 1, multi: true, share: "attack",
      hostile: true, pierces_immunity: true, damage_type: "physical", procs: true, use_range: true }),
  ] },
  { id: "priest", name: "Priest", skills: [
    skill("partyheal", { type: "skill", skin: "skill_pheal", class: ["priest"], name: "Party Heal", explanation: "Heals all the party members.",
      output: 400, action: "heal", levels: [[0, 400], [60, 600], [72, 720], [80, 800]], mp: 400, cooldown: 200, party: true,
      projectile: "partyheal", damage_type: "magical", heal: true, multi: true }),
  ] },
  { id: "shared", name: "Shared / system", skills: [
    skill("attack", { type: "skill", name: "Attack", explanation: "Attack a target.", target: true, hostile: true }),
    skill("zapperzap", { type: "skill", skin: "trigger", slot: [["ring1", "zapper"], ["ring2", "zapper"]], name: "Zap",
      explanation: "Zap your target for 200 damage", damage: 200, damage_type: "magical", mp: 140, cooldown: 200, range: 420,
      projectile: "gburst", target: true, hostile: true }),
  ] },
];

test("skills show the game's skill card beside an extras box in both dialogs", async ({ page, app }, info) => {
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
    import {SkillsDialog} from './features/party/skills-dialog';
    import {ItemDetails} from './features/party/item-details';
    const root=createRoot(document.getElementById('root'));
    window.mountSkills=(classes)=>root.render(<SkillsDialog open classes={classes} onOpenChange={()=>root.render(null)}/>);
    window.mountItem=(selected,skills)=>root.render(<ItemDetails selected={selected} catalog={[]} exchanges={[]} skills={skills}
      monsters={[]} characters={[]} achievements={{}} standFull={false} onNavigate={()=>{}} onAddWTB={()=>{}} onAddStand={()=>{}}
      onCompare={()=>{}} onCompareCatalog={()=>{}} onOpenChange={()=>root.render(null)}/>);
    window.unmount=()=>root.render(null);
  `,
    },
  });
  await page.goto(app.url);
  await expect(page.locator("body")).toContainText("Party");
  const styles = await page
    .locator('style, link[rel="stylesheet"]')
    .evaluateAll((nodes) => nodes.map((node) => node.outerHTML).join("\n"));
  await page.route("**/skill-card-harness", (route) =>
    route.fulfill({ contentType: "text/html", body: `<!doctype html><head>${styles}</head><body><div id="root"></div></body>` }),
  );
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(app.url + "/skill-card-harness");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate((classes) => (window as any).mountSkills(classes), SKILLS);
  const dialog = page.getByRole("dialog", { name: "Class skills and conditions", exact: true });
  const lines = (box: Locator) => box.locator("[data-line]").evaluateAll((nodes) => nodes.map((node) => node.textContent));
  const open = async (name: RegExp) => {
    await dialog.getByRole("button", { name }).click();
    return { card: dialog.getByRole("region", { name: "Skill card", exact: true }), extras: dialog.getByRole("region", { name: "Skill extras", exact: true }) };
  };

  // 1: Supershot, line for line, with the game's colors.
  const supershot = await open(/^Supershot/);
  expect(await lines(supershot.card)).toEqual(["MP: 400", "Cooldown: 30 seconds", "Range: Character Range", "Range: 3X + 20",
    "Weapon Requirement: \"Bow\", \"Crossbow\"", "Damage Type: Physical"]);
  expect(await color(supershot.card.locator('[data-line="mp"] [data-label]'))).toBe(rgb("#3A62CE"));
  expect(await color(supershot.card.locator('[data-line="damage_type"] [data-label]'))).toBe(rgb("#93AB98"));
  // 7: meaning colors instead of the game's gray.
  expect(await color(supershot.card.locator('[data-line="cooldown"] [data-label]'))).toBe(rgb("#4EB7DE"));
  expect(await color(supershot.card.locator('[data-line="use_range"] [data-label]'))).toBe(rgb("#93A6A2"));
  expect(await color(supershot.card.locator('[data-line="wtype"] [data-label]'))).toBe(rgb("#56A244"));
  expect(await color(supershot.extras.locator('[data-line="hostile"] [data-label]'))).toBe(rgb("#E13758"));
  expect(await color(supershot.extras.locator('[data-line="type"] [data-label]'))).toBe(rgb("#C3C3C3"));
  // 4: every other field, readable, in the extras box.
  expect(await lines(supershot.extras)).toEqual(["Class: ranger", "Damage Multiplier: 1.5", "Hostile: Yes", "Pierces Immunity: Yes",
    "Procs: Yes", "Target: Yes", "Type: skill"]);
  await expect(dialog).toContainText("G.skills.supershot");
  await info.attach("skill-card-supershot", { body: await dialog.screenshot(), contentType: "image/png" });

  // 2: one Output line per level.
  const partyheal = await open(/^Party Heal/);
  expect(await lines(partyheal.card)).toEqual(["MP: 400", "Cooldown: 0.2 seconds", "Damage Type: Magical", "Output: 400",
    "Output: 600 (Lv. 60)", "Output: 720 (Lv. 72)", "Output: 800 (Lv. 80)"]);

  // 3: a shared cooldown names the shared skill.
  const threeshot = await open(/^3-Shot/);
  expect(await lines(threeshot.card)).toContain("Cooldown: 1× Attack");
  expect(await lines(threeshot.card)).toContain("Level Requirement: 60");

  // 6: side by side when the panel has room, stacked when it doesn't.
  const zap = await open(/^Zap/);
  const fromSkills = { card: await lines(zap.card), extras: await lines(zap.extras) };
  const wideCard = (await zap.card.boundingBox())!, wideExtras = (await zap.extras.boundingBox())!;
  expect(wideExtras.x).toBeGreaterThanOrEqual(wideCard.x + wideCard.width - 1);
  await page.setViewportSize({ width: 700, height: 1000 });
  // The details panel animates its width; poll until the extras box settles below the card.
  await expect.poll(async () => {
    const card = (await zap.card.boundingBox())!, extras = (await zap.extras.boundingBox())!;
    return extras.y >= card.y + card.height - 1;
  }, { timeout: 5_000 }).toBe(true);
  expect(await zap.card.evaluate((node) => node.parentElement!.scrollWidth <= node.parentElement!.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1600, height: 1000 });

  // 5: the Zapper's skill link renders the same card and extras.
  await page.evaluate(() => (window as any).unmount());
  await page.evaluate((classes) => (window as any).mountItem({
    character: "W",
    entry: { slot: 6, item: { name: "zapper", level: 0 }, meta: { definition: { name: "The Zapper", type: "ring", ability: "zapperzap" },
      properties: { int: 10 }, usage: { classes: [], hands: [] }, sprite: null } },
  }, classes), SKILLS);
  await page.getByRole("dialog", { name: "The Zapper", exact: true }).getByRole("button", { name: "Zap", exact: true }).click();
  const linked = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Zap", exact: true }) });
  expect(await lines(linked.getByRole("region", { name: "Skill card", exact: true }))).toEqual(fromSkills.card);
  expect(await lines(linked.getByRole("region", { name: "Skill extras", exact: true }))).toEqual(fromSkills.extras);
  expect(fromSkills.card).toEqual(["MP: 140", "Cooldown: 0.2 seconds", "Range: 420", "Damage Type: Magical"]);
  await info.attach("skill-card-item-link", { body: await linked.screenshot(), contentType: "image/png" });
});
