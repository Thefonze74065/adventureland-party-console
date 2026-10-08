"use client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useMemo, useState } from "react";
import { sanitizeDollHtml } from './sanitize-doll-html';
import { Char } from "./char";
import { comparisonSlotsFor } from "./comparison-slots-for";
import { EquippedEntry } from "./equipped-entry";
import { InventoryEntry } from "./inventory-entry";
import { itemMaximumLevel } from "./item-maximum-level";
import { ItemSetInfo } from "./item-set-info";
import { propertiesAtLevel } from "./properties-at-level";
import { statBadgeClass } from "./stat-badge-class";
import { STAT_SCROLLS } from "./stat-scrolls";

export function GearComparisonDialog({
  comparison,
  currentCharacter,
  onOpenChange,
}: {
  comparison: { character: Char; entry: InventoryEntry; slot?: string } | null;
  currentCharacter?: Char | null;
  onOpenChange: (open: boolean) => void;
}) {
  const dollHtml = currentCharacter?.characterDollHtml || comparison?.character.characterDollHtml;
  const dollMarkup = useMemo(() => ({__html:sanitizeDollHtml(dollHtml)}), [dollHtml]);
  const [leftLevel, setLeftLevel] = useState(0);
  const [rightLevel, setRightLevel] = useState(0);
  const [leftStatType, setLeftStatType] = useState("none");
  const [rightStatType, setRightStatType] = useState("none");
  const comparisonKey = comparison
    ? `${comparison.character.name}:${comparison.slot || ""}:${comparison.entry.slot}:${comparison.entry.item.name}`
    : "";
  const draftIdentity1 = [comparisonKey, comparison];
  const [previousDraftIdentity1, setDraftIdentity1] = useState<readonly unknown[] | null>(null);
  if (
    !previousDraftIdentity1 ||
    draftIdentity1.some((value, index) => !Object.is(value, previousDraftIdentity1[index]))
  ) {
    setDraftIdentity1(draftIdentity1);
    (() => {
      if (!comparison) return;
      const candidates = comparisonSlotsFor(comparison.entry.meta, comparison.character);
      if (!candidates.length) candidates.push(String(comparison.entry.meta?.definition.type || ""));
      const slot =
        comparison.slot ||
        candidates.find(
          (candidate) =>
            comparison.character.slots[candidate]?.item.name === comparison.entry.item.name,
        ) ||
        candidates.find((candidate) => !comparison.character.slots[candidate]) ||
        candidates[0];
      setLeftLevel(Math.max(0, Number(comparison.character.slots[slot]?.item.level) || 0));
      setRightLevel(Math.max(0, Number(comparison.entry.item.level) || 0));
      setLeftStatType(comparison.character.slots[slot]?.item.stat_type || "none");
      setRightStatType(comparison.entry.item.stat_type || "none");
    })();
  }
  if (!comparison) return null;
  const { entry } = comparison;
  const character = currentCharacter || comparison.character;
  const candidates = comparisonSlotsFor(entry.meta, character);
  if (!candidates.length) candidates.push(String(entry.meta?.definition.type || ""));
  const replacementSlot =
    comparison.slot ||
    candidates.find((slot) => character.slots[slot]?.item.name === entry.item.name) ||
    candidates.find((slot) => !character.slots[slot]) ||
    candidates[0];
  const equipped = character.slots[replacementSlot];
  const actualOldProps = equipped?.meta?.properties || {};
  const oldProps = equipped
    ? propertiesAtLevel(
        equipped.meta || undefined,
        equipped.item,
        leftLevel,
        leftStatType === "none" ? null : leftStatType,
      )
    : {};
  const newProps = propertiesAtLevel(
    entry.meta || undefined,
    entry.item,
    rightLevel,
    rightStatType === "none" ? null : rightStatType,
  );
  const prop = (source: Record<string, string | number | boolean>, key: string) =>
    Number(source[key] || 0);
  const actualEquipment = Object.entries(character.slots).filter(
    ([slot, value]) => !slot.startsWith("trade") && !!value,
  ) as [string, EquippedEntry][];
  const currentEquipment = actualEquipment.map(([slot, value]) =>
    slot === replacementSlot
      ? ([
          slot,
          {
            ...value,
            item: { ...value.item, level: leftLevel },
            meta: { ...value.meta!, properties: oldProps },
          },
        ] as [string, EquippedEntry])
      : ([slot, value] as [string, EquippedEntry]),
  );
  const proposedEquipment = actualEquipment
    .filter(([slot]) => slot !== replacementSlot)
    .concat([
      [
        replacementSlot,
        {
          item: { ...entry.item, level: rightLevel },
          meta: { ...entry.meta!, properties: newProps },
        },
      ],
    ]);
  const setDefinitions = new Map<string, ItemSetInfo>();
  [...currentEquipment.map(([, value]) => value), { item: entry.item, meta: entry.meta }].forEach(
    (value) => {
      const set = value.meta?.world?.set;
      if (set) setDefinitions.set(set.id, set);
    },
  );
  const setState = (equipment: [string, EquippedEntry][]) => {
    const totals: Record<string, number> = {},
      counts: Record<string, number> = {};
    setDefinitions.forEach((set, setId) => {
      const allowed = new Set(set.items.map((item) => item.id));
      const count = equipment.filter(([, value]) => allowed.has(value.item.name)).length;
      counts[setId] = count;
      set.bonuses
        .filter((bonus) => count >= bonus.pieces)
        .forEach((bonus) =>
          Object.entries(bonus.stats).forEach(([key, value]) => {
            if (typeof value === "number") totals[key] = (totals[key] || 0) + value;
          }),
        );
    });
    return { totals, counts };
  };
  const currentSets = setState(currentEquipment),
    proposedSets = setState(proposedEquipment);
  const strArmor = (value: number) => Math.min(value, 160) + Math.max(0, value - 160) * 0.25;
  const intRes = (value: number) => Math.min(value, 180) + Math.max(0, value - 180) * 0.25;
  const statSpeed = (str: number, dex: number) => Math.min(str, 256) / 64 + Math.min(dex, 256) / 32;
  const statFrequency = (intelligence: number, dexterity: number) =>
    intelligence / 1575 + Math.min(160, dexterity) / 640 + Math.max(0, dexterity - 160) / 925;
  const oldWeaponAttack = actualEquipment
    .filter(([slot]) => slot === "mainhand" || slot === "offhand")
    .reduce((sum, [, value]) => sum + Number(value?.meta?.properties?.attack || 0), 0);
  const primary = String(character.primaryStat || "").toLowerCase();
  const divisor = character.ctype === "paladin" && primary === "int" ? 40 : 20;
  const oldPrimary = Number((character as unknown as Record<string, unknown>)[primary] || 0);
  const project = (
    replacement: Record<string, string | number | boolean>,
    setTotals: Record<string, number>,
  ) => {
    const delta = (key: string) =>
      prop(replacement, key) -
      prop(actualOldProps, key) +
      Number(setTotals[key] || 0) -
      Number(currentSets.totals[key] || 0);
    const result = { ...character };
    result.str = Number(character.str || 0) + delta("str");
    result.int = Number(character.int || 0) + delta("int");
    result.dex = Number(character.dex || 0) + delta("dex");
    result.vit = Number(character.vit || 0) + delta("vit");
    result.luck = Number(character.luck || 0) + delta("luck");
    result.fortitude = Number(character.fortitude || 0) + delta("for");
    result.goldBonus = Number(character.goldBonus || 0) + delta("gold");
    result.xpBonus = Number(character.xpBonus || 0) + delta("xp");
    result.max_hp =
      Number(character.max_hp) +
      delta("hp") +
      delta("str") * 21 +
      delta("vit") * (48 + character.level / 3);
    result.max_mp = Number(character.max_mp) + delta("mp") + delta("int") * 15;
    result.armor =
      Number(character.armor || 0) +
      delta("armor") +
      strArmor(result.str) -
      strArmor(Number(character.str || 0));
    result.resistance =
      Number(character.resistance || 0) +
      delta("resistance") +
      intRes(result.int) -
      intRes(Number(character.int || 0));
    result.speed =
      (character.ctype === "merchant" ? character.unrestrictedSpeed ?? (character.standOpen ? NaN : Number(character.speed || 0)) : Number(character.speed || 0)) +
      delta("speed") +
      statSpeed(result.str, result.dex) -
      statSpeed(Number(character.str || 0), Number(character.dex || 0));
    // Equipment and set frequency use hundredths of an attack per second.
    result.frequency =
      Number(character.frequency || 0) +
      delta("frequency") / 100 +
      statFrequency(result.int, result.dex) -
      statFrequency(Number(character.int || 0), Number(character.dex || 0));
    result.range = Number(character.range || 0) + delta("range");
    const weaponAttack = Math.max(0, oldWeaponAttack + delta("attack"));
    const newPrimary = Number((result as unknown as Record<string, unknown>)[primary] || 0);
    result.attack =
      Number(character.attack || 0) +
      weaponAttack * (1 + newPrimary / divisor) -
      oldWeaponAttack * (1 + oldPrimary / divisor);
    const combat = character.combatStats || {};
    const projectedRecord = result as unknown as Record<string, number>;
    projectedRecord.evasion = Number(combat.evasion || 0) + delta("evasion");
    projectedRecord.reflection = Number(combat.reflection || 0) + delta("reflection");
    projectedRecord.lifesteal = Number(combat.lifesteal || 0) + delta("lifesteal");
    projectedRecord.manasteal = Number(combat.manasteal || 0) + delta("manasteal");
    projectedRecord.rpiercing = Number(combat.resistancePiercing || 0) + delta("rpiercing");
    projectedRecord.apiercing = Number(combat.armorPiercing || 0) + delta("apiercing");
    projectedRecord.crit = Number(combat.crit || 0) + delta("crit");
    projectedRecord.dreturn = Number(combat.damageReturn || 0) + delta("dreturn");
    projectedRecord.mp_cost = Number(combat.mpCost || 0) + delta("mp_cost");
    projectedRecord.output = Number(combat.output || 0) + delta("output");
    return result;
  };
  const currentPreview = project(oldProps, currentSets.totals);
  const projected = project(newProps, proposedSets.totals);
  const rows: [string, string, (value: number) => string][] = [
    ["HP", "max_hp", (v) => Math.round(v).toLocaleString()],
    ["MP", "max_mp", (v) => Math.round(v).toLocaleString()],
    ["Attack", "attack", (v) => v.toFixed(1)],
    ["Attack speed", "frequency", (v) => v.toFixed(3)],
    ["Range", "range", (v) => v.toFixed(1)],
    ["Run speed", "speed", (v) => Number.isFinite(v) ? v.toFixed(2) : "Unavailable"],
    ["Armor", "armor", (v) => v.toFixed(1)],
    ["Resistance", "resistance", (v) => v.toFixed(1)],
    ["STR", "str", (v) => v.toFixed(0)],
    ["INT", "int", (v) => v.toFixed(0)],
    ["DEX", "dex", (v) => v.toFixed(0)],
    ["VIT", "vit", (v) => v.toFixed(0)],
    ["Fortitude", "fortitude", (v) => v.toFixed(1)],
    ["Luck", "luck", (v) => `${v.toFixed(1)}%`],
    ["Gold", "goldBonus", (v) => `${v.toFixed(2)}%`],
    ["XP", "xpBonus", (v) => `${v.toFixed(2)}%`],
    ["Evasion", "evasion", (v) => `${v.toFixed(3)}%`],
    ["Reflection", "reflection", (v) => `${v.toFixed(3)}%`],
    ["Lifesteal", "lifesteal", (v) => `${v.toFixed(3)}%`],
    ["Manasteal", "manasteal", (v) => `${v.toFixed(3)}%`],
    ["Armor piercing", "apiercing", (v) => v.toFixed(2)],
    ["Resistance piercing", "rpiercing", (v) => v.toFixed(2)],
    ["Critical hit", "crit", (v) => `${v.toFixed(3)}%`],
    ["Damage return", "dreturn", (v) => `${v.toFixed(2)}%`],
    ["MP cost reduction", "mp_cost", (v) => `${v.toFixed(2)}%`],
    ["Output", "output", (v) => `${v.toFixed(3)}%`],
  ];
  const changedSets = Array.from(setDefinitions.values()).filter(
    (set) => currentSets.counts[set.id] !== proposedSets.counts[set.id],
  );
  const name = String(entry.meta?.definition.name || entry.item.name) + ` +${rightLevel}`;
  const statButtons = (proposed: boolean) => {
    const meta = proposed ? entry.meta : equipped?.meta;
    if (!meta?.definition.stat) return null;
    const selected = proposed ? rightStatType : leftStatType;
    const select = proposed ? setRightStatType : setLeftStatType;
    const primary = ["str", "int", "dex", "vit"];
    const exoticSelected = selected !== "none" && !primary.includes(selected) ? selected : "none";
    return (
      <div
        className="ml-auto flex max-w-sm flex-wrap justify-end gap-1"
        aria-label="Preview with stat scroll"
      >
        {["none", ...primary].map((statType) => (
          <Button
            key={statType}
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={selected === statType}
            onClick={() => select(statType)}
            className={`h-8 min-w-10 border px-2 font-mono text-[9px] uppercase ${
              selected === statType
                ? statType === "none"
                  ? "border-slate-400 bg-slate-800 text-white"
                  : statBadgeClass(statType)
                : "border-slate-700 bg-black text-slate-300 hover:bg-slate-900 hover:text-white"
            }`}
          >
            {statType === "none" ? "No stat" : statType}
          </Button>
        ))}
        <Select
          value={exoticSelected}
          onValueChange={(value) => {
            if (!value) return;
            if (value !== "none") select(value);
            else if (exoticSelected !== "none") select("none");
          }}
        >
          <SelectTrigger
            aria-label="Preview with exotic stat scroll"
            className="h-8 w-44 border-violet-700 bg-black text-violet-100 hover:bg-violet-950 hover:text-white"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-80 border-violet-700 bg-[#07100f] text-violet-100">
            <SelectItem value="none">Exotic stat…</SelectItem>
            {STAT_SCROLLS.filter((choice) => !choice.purchasable).map((choice) => (
              <SelectItem key={choice.stat} value={choice.stat}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };
  const panel = (candidate: Char, proposed: boolean) => (
    <div
      className={`rounded-lg border p-4 ${proposed ? "border-cyan-800 bg-cyan-950/10" : "border-emerald-900 bg-black/20"}`}
    >
      <div className="mb-3 flex items-center gap-3">
        <div
          className="h-20 w-16 shrink-0 overflow-hidden"
          dangerouslySetInnerHTML={
            character.characterDollHtml ? dollMarkup : undefined
          }
        />
        <div className="min-w-0">
          <p className="font-semibold">
            {proposed
              ? name
              : equipped
                ? `${String(equipped.meta?.definition.name || equipped.item.name)} +${leftLevel}`
                : "Empty slot"}
          </p>
          <p className="font-mono text-[10px] text-emerald-100/45">
            {proposed
              ? `Replaces ${replacementSlot}${equipped ? ` · ${String(equipped.meta?.definition.name || equipped.item.name)}` : " · empty slot"}`
              : character.name}
          </p>
        </div>
        {statButtons(proposed)}
      </div>
      {(
        proposed
          ? entry.meta?.upgradeable || entry.meta?.compoundable
          : equipped?.meta?.upgradeable || equipped?.meta?.compoundable
      ) ? (
        <div className="mb-4 rounded border border-violet-900/70 bg-black/25 p-3">
          <div className="mb-2 flex justify-between font-mono text-[10px] uppercase text-violet-300">
            <span>Preview level</span>
            <span>+{proposed ? rightLevel : leftLevel}</span>
          </div>
          <Slider
            min={0}
            max={itemMaximumLevel(proposed ? entry.meta : equipped?.meta)}
            step={1}
            value={proposed ? rightLevel : leftLevel}
            onValueChange={(value) =>
              (proposed ? setRightLevel : setLeftLevel)(
                typeof value === "number" ? value : value[0] || 0,
              )
            }
          />
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        {rows.map(([label, key, format]) => {
          const value = Number((candidate as unknown as Record<string, unknown>)[key] || 0);
          const original = Number((currentPreview as unknown as Record<string, unknown>)[key] || 0);
          const change = value - original;
          const changed = proposed && Math.abs(change) > 0.0001;
          const percentChange = original === 0 ? null : (change / Math.abs(original)) * 100;
          return (
            <div key={label} className="rounded border border-emerald-950 bg-black/25 p-2">
              <div className="font-mono text-[9px] uppercase text-emerald-100/40">{label}</div>
              <div
                className={`font-mono font-semibold ${changed && change > 0 ? "font-bold text-lime-300" : changed && change < 0 ? "text-rose-400" : "text-emerald-100"}`}
              >
                {format(value)}
                {changed ? (
                  <span className="ml-1 whitespace-nowrap text-[10px]">
                    ({change > 0 ? "+" : "-"}
                    {format(Math.abs(change))} ·{" "}
                    {percentChange === null
                      ? "new"
                      : `${percentChange > 0 ? "+" : ""}${percentChange.toFixed(1)}%`}
                    )
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-cyan-800 bg-[#0b1916] text-emerald-50 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Equipment comparison</DialogTitle>
          <DialogDescription>
            Move either slider independently. Green improves the left preview; red reduces it.
            Nothing in inventory is changed.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          {panel(currentPreview, false)}
          {panel(projected, true)}
        </div>
        {changedSets.length ? (
          <section className="rounded border border-violet-800 bg-violet-950/15 p-3">
            <h3 className="font-mono text-xs uppercase tracking-wider text-violet-300">
              Set changes
            </h3>
            <div className="mt-2 space-y-2">
              {changedSets.map((set) => {
                const before = currentSets.counts[set.id] || 0,
                  after = proposedSets.counts[set.id] || 0;
                return (
                  <div key={set.id} className="rounded border border-violet-950 bg-black/25 p-2">
                    <p className="text-sm font-semibold">
                      {set.name}: {before}/{set.items.length} →{" "}
                      <span className={after > before ? "text-emerald-300" : "text-rose-400"}>
                        {after}/{set.items.length}
                      </span>
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-emerald-100/55">
                      {set.bonuses
                        .map((bonus) => {
                          const was = before >= bonus.pieces,
                            becomes = after >= bonus.pieces;
                          const stats = Object.entries(bonus.stats)
                            .map(([key, value]) => `${key.toUpperCase()} +${value}`)
                            .join(", ");
                          return `${bonus.pieces} pieces: ${stats}${!was && becomes ? " · GAINED" : was && !becomes ? " · LOST" : ""}`;
                        })
                        .join(" · ")}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
