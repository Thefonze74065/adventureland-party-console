import { test, expect } from "./fixtures";
import type { Locator } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

// Failure inventory: docs/character-card.md. Character telemetry is a declared
// boundary; the maintained CharacterStatsDialog runs in Chromium with the console styles.
const color = (locator: Locator) => locator.evaluate((node) => getComputedStyle(node).color);
const rgb = (hex: string) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
};

const patinder = {
  name: "Patinder", ctype: "merchant", primaryStat: "int", level: 61, hp: 4760, max_hp: 4760, mp: 2120, max_mp: 2700,
  attack: 33.4, frequency: 0.73, range: 82, speed: 10, unrestrictedSpeed: 82.1, standOpen: true, armor: 277, resistance: 500,
  str: 23, int: 110, dex: 99, vit: 50, fortitude: 15, luck: 100, xp: 0, max_xp: 1, gold: 0, map: "main", x: 0, y: 0, rip: false,
  banking: false, seenAt: 0, items: [], conditions: [], goldBonus: 123.45,
  slots: { mainhand: { item: { name: "dartgun" }, meta: { definition: {}, properties: { attack: 48 }, sprite: null } } },
  combatStats: { crit: 1.5, critDamage: 20, lifesteal: 2, evasion: 3, armorPiercing: 10, fireResistance: 4 },
};

test("character stats show the game's panel beside collapsible extras", async ({ page, app }, info) => {
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
    import {CharacterStatsDialog} from './features/party/character-stats-dialog';
    const root=createRoot(document.getElementById('root'));
    window.mountCharacter=(character)=>root.render(character ? <CharacterStatsDialog character={character} onOpenChange={()=>root.render(null)}/> : null);
  `,
    },
  });
  await page.goto(app.url);
  await expect(page.locator("body")).toContainText("Party");
  const styles = await page
    .locator('style, link[rel="stylesheet"]')
    .evaluateAll((nodes) => nodes.map((node) => node.outerHTML).join("\n"));
  await page.route("**/character-card-harness", (route) =>
    route.fulfill({ contentType: "text/html", body: `<!doctype html><head>${styles}</head><body><div id="root"></div></body>` }),
  );
  const open = async () => {
    await page.goto(app.url + "/character-card-harness");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
  };
  const mount = async (character: unknown) => {
    await page.evaluate(() => (window as any).mountCharacter(null));
    await page.evaluate((value) => (window as any).mountCharacter(value), character);
  };
  await page.setViewportSize({ width: 1400, height: 1000 });
  await open();
  await mount(patinder);
  const dialog = page.getByRole("dialog", { name: "Patinder", exact: true });
  const card = dialog.getByRole("region", { name: "Character card", exact: true });
  const extras = dialog.getByRole("region", { name: "Character extras", exact: true });
  await expect(extras.locator('[data-line="gold"]')).toHaveText('Gold: +123.45%');
  expect(await color(extras.locator('[data-line="gold"] [data-label]'))).toBe(rgb('#FFD700'));

  // 1: the game's panel, line for line, with RUNSPD as the live stand-limited speed.
  const lines = await card.locator("[data-line]").evaluateAll((nodes) => nodes.map((node) => node.textContent));
  expect(lines).toEqual(["NAME: Patinder", "LEVEL: 61", "HP: 4760/4760", "MP: 2120/2700", "ATT: 33", "ATTSPD: 73", "RANGE: 82",
    "RUNSPD: 10", "ARMOR: 277", "RESIST.: 500", "CODE: Active"]);
  const label = (box: Locator, key: string) => color(box.locator(`[data-line="${key}"] [data-label]`).first());
  expect(await label(card, "level")).toBe("rgb(255, 165, 0)");
  expect(await label(card, "hp")).toBe(rgb("#FF2E46"));
  expect(await label(card, "mp")).toBe(rgb("#3A62CE"));
  expect(await label(card, "attack")).toBe(rgb("#DB2900"));
  expect(await label(card, "code")).toBe("rgb(255, 215, 0)");

  // 4, 5: every entry and effect of the old grid, each effect named and colored by its stat.
  const strength = extras.locator('[data-line="str"]');
  await expect(strength.getByRole("button", { name: /Strength: 23/ })).toHaveAttribute("aria-expanded", "true");
  await expect(strength.locator('[data-effect="max_hp"]')).toHaveText("+483 Max HP +21 per point");
  expect(await color(strength.locator('[data-effect="max_hp"] [data-value]'))).toBe(rgb("#FF2E46"));
  await expect(strength.locator('[data-effect="armor"]')).toHaveText("+23 Armor +1 per next point");
  expect(await color(strength.locator('[data-effect="armor"] [data-value]'))).toBe(rgb("#A3A9B0"));
  await expect(strength.locator('[data-effect="run_speed"]')).toHaveText("+0.36 Run Speed +0.0156 per next point");
  const intelligence = extras.locator('[data-line="int"]');
  await expect(intelligence.getByRole("button", { name: /Intelligence: 110 Primary/ })).toBeVisible();
  await expect(intelligence.locator('[data-effect="attack"]')).toHaveText("+264.0 Attack +2.40 per point");
  await expect(intelligence.locator('[data-effect="max_mp"]')).toHaveText("+1,650 Max MP +15 per point");
  await expect(intelligence.locator('[data-effect="resistance"]')).toHaveText("+110 Resistance +1 per next point");
  await expect(intelligence.locator('[data-effect="attack_speed"]')).toHaveText("+0.070 Attacks/sec +0.000635 per point");
  await expect(extras.locator('[data-line="dex"] [data-effect="run_speed"]')).toHaveText("+3.09 Run Speed +0.0313 per next point");
  await expect(extras.locator('[data-line="vit"] [data-effect="max_hp"]')).toHaveText("+3,417 Max HP 68.33 HP per VIT at level 61");
  await expect(extras.locator('[data-line="for"] [data-effect="pvp"]')).toHaveText("7.50% less incoming PvP damage no PvE reduction");
  await expect(extras.locator('[data-line="armor"] [data-effect="reduction"]')).toHaveText("27.32% physical damage reduction a 100-damage physical hit becomes 72.7");
  await expect(extras.locator('[data-line="resistance"] [data-effect="reduction"]')).toHaveText("46.70% magical damage reduction a 100-damage magical hit becomes 53.3");
  await expect(extras.locator('[data-line="run_speed"]')).toHaveText("Run Speed: 82.10 before movement restrictions");
  for (const [key, text] of [["luck", "Luck: 100%"], ["crit", "Crit: 1.5%"], ["critdamage", "Crit Damage: 220%"], ["lifesteal", "Lifesteal: 2%"],
    ["evasion", "Evasion: 3%"], ["apiercing", "A.Piercing: 10"], ["firesistance", "Fire Res.: 4"], ["miss", "Miss: 0%"], ["manasteal", "Manasteal: 0%"],
    ["rpiercing", "R.Piercing: 0"], ["pnresistance", "Poison Res.: 0"], ["fzresistance", "Freeze Res.: 0"], ["phresistance", "Physical Res.: 0"],
    ["stresistance", "Status Res.: 0"], ["blastresistance", "Blast Res.: 0"], ["dreturn", "D.Return: 0%"], ["reflection", "Reflection: 0%"],
    ["mp_cost", "MP Cost: 0"], ["heal", "Heal: 0"], ["output", "Output: 0%"]] as const)
    await expect(extras.locator(`[data-line="${key}"]`)).toHaveText(text);
  expect(await label(extras, "lifesteal")).toBe(rgb("#C8323E"));

  // 7: side by side on a wide dialog.
  const cardBox = (await card.boundingBox())!, extrasBox = (await extras.boundingBox())!;
  expect(extrasBox.x).toBeGreaterThanOrEqual(cardBox.x + cardBox.width - 1);
  expect(Math.abs(extrasBox.y - cardBox.y)).toBeLessThan(2);
  await info.attach("character-card-wide", { body: await dialog.screenshot(), contentType: "image/png" });

  // 6: a collapse persists across characters and reloads.
  await strength.getByRole("button", { name: /Strength: 23/ }).click();
  await expect(strength.getByRole("button", { name: /Strength: 23/ })).toHaveAttribute("aria-expanded", "false");
  await expect(strength.locator("[data-effect]")).toHaveCount(0);
  await expect(intelligence.locator("[data-effect]")).toHaveCount(4);
  await info.attach("character-card-strength-collapsed", { body: await dialog.screenshot(), contentType: "image/png" });

  // 2, 3: a cursed, poisoned priest shows HEAL and the game's tags; Strength stays collapsed.
  await mount({ ...patinder, name: "Recharged", ctype: "priest", primaryStat: "int", speed: 55, unrestrictedSpeed: null, standOpen: false,
    combatStats: { heal: 320 }, conditions: [{ id: "cursed", name: "Cursed", definition: {}, live: {} }, { id: "poisoned", name: "Poisoned", definition: {}, live: {} }] });
  const priest = page.getByRole("dialog", { name: "Recharged", exact: true });
  const priestCard = priest.getByRole("region", { name: "Character card", exact: true });
  const priestLines = await priestCard.locator("[data-line]").evaluateAll((nodes) => nodes.map((node) => node.textContent));
  expect(priestLines.slice(3, 7)).toEqual(["MP: 2120/2700", "HEAL: 320", "ATT: 33 [C]", "ATTSPD: 73 [P]"]);
  expect(await label(priestCard, "heal")).toBe(rgb("#CB83AC"));
  const priestStrength = priest.getByRole("region", { name: "Character extras", exact: true }).locator('[data-line="str"]');
  await expect(priestStrength.getByRole("button", { name: /Strength: 23/ })).toHaveAttribute("aria-expanded", "false");
  await expect(priestStrength.locator("[data-effect]")).toHaveCount(0);

  // 6: the choice survives a reload, and expanding is remembered the same way.
  await open();
  await mount(patinder);
  const reloaded = page.getByRole("dialog", { name: "Patinder", exact: true }).getByRole("region", { name: "Character extras", exact: true });
  const reloadedStrength = reloaded.getByRole("button", { name: /Strength: 23/ });
  await expect(reloadedStrength).toHaveAttribute("aria-expanded", "false");
  await reloadedStrength.click();
  await open();
  await mount(patinder);
  await expect(page.getByRole("dialog", { name: "Patinder", exact: true }).getByRole("region", { name: "Character extras", exact: true })
    .getByRole("button", { name: /Strength: 23/ })).toHaveAttribute("aria-expanded", "true");

  // 8: a merchant with an open stand and no unrestricted speed still says so.
  await mount({ ...patinder, unrestrictedSpeed: null });
  await expect(page.getByRole("dialog", { name: "Patinder", exact: true }).getByRole("region", { name: "Character extras", exact: true })
    .locator('[data-line="run_speed"]')).toHaveText("Run Speed: Waiting for speed data");

  // 7: stacked on a narrow viewport, without sideways scrolling.
  await page.setViewportSize({ width: 420, height: 1000 });
  const narrow = page.getByRole("dialog", { name: "Patinder", exact: true });
  const narrowCard = (await narrow.getByRole("region", { name: "Character card", exact: true }).boundingBox())!;
  const narrowExtras = (await narrow.getByRole("region", { name: "Character extras", exact: true }).boundingBox())!;
  expect(narrowExtras.y).toBeGreaterThanOrEqual(narrowCard.y + narrowCard.height - 1);
  expect(await narrow.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await info.attach("character-card-narrow", { body: await narrow.screenshot(), contentType: "image/png" });
});
