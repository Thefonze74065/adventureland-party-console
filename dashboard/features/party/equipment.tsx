"use client";
import { AutoUpgradeMarks } from "./auto-upgrade-marks";
import { Char } from "./char";
import { EquipSlot } from "./equip-slot";
import { equipmentSlots } from "./equipment-slots";
import { InventoryEntry } from "./inventory-entry";
import { Item } from "./item";
import { same } from "./same";
import { StatScrollMark } from "./stat-scroll-mark";
import { UpgradeMark } from "./upgrade-mark";
import { memo } from "react";

export const Equipment = memo(function Equipment({
  character,
  upgradeMarks,
  autoUpgradeMarks,
  statScrollMarks,
  statScrollInventory,
  onSelect,
  onUnequip,
  onUpgrade,
  onAutoUpgrade,
  onClearMarks,
  hasAutomaticMarks,
  onStatScroll,
  onBuy,
}: {
  character: Char;
  upgradeMarks: UpgradeMark[];
  onClearMarks: (slot: string, item: Item) => void;
  hasAutomaticMarks?: (item: Item) => boolean;
  autoUpgradeMarks: AutoUpgradeMarks;
  statScrollMarks: StatScrollMark[];
  statScrollInventory: Record<string, number>;
  onSelect: (entry: InventoryEntry) => void;
  onUnequip: (slot: string, item: Item) => void;
  onUpgrade: (slot: string, item: Item, tiers?: number, remove?: boolean) => void;
  onAutoUpgrade: (slot: string, item: Item, tiers?: number, remove?: boolean) => void;
  onStatScroll: (slot: string, item: Item, remove?: boolean) => void;
  onBuy: (item: Item) => void;
}) {
  const known = new Set<string>(equipmentSlots),
    slots = [
      ...equipmentSlots.map((slot) => [slot, character.slots[slot] || null] as const),
      ...Object.entries(character.slots).filter(
        ([slot]) => !known.has(slot) && !slot.startsWith("trade"),
      ),
    ];
  const equippedSetCounts = Object.entries(character.slots).reduce<Record<string, number>>(
    (counts, [slot, entry]) => {
      if (slot.startsWith("trade")) return counts;
      const setId = entry?.meta?.world?.set?.id;
      if (setId) counts[setId] = (counts[setId] || 0) + 1;
      return counts;
    },
    {},
  );
  return (
    <section>
      <h3 className="mb-3 font-mono text-xs uppercase text-emerald-100/55">Equipped</h3>
      <div className="grid grid-cols-2 items-start gap-3">
        <div className="grid gap-2">
          {slots
            .filter((_, i) => i % 2 === 0)
            .map(([slot, e]) => (
              <EquipSlot
                key={slot}
                slot={slot}
                equipped={e}
                mark={
                  e
                    ? upgradeMarks.find(
                        (mark) => mark.equipped && mark.slot === slot && same(mark.item, e.item),
                      )
                    : undefined
                }
                statScrollMark={
                  e
                    ? statScrollMarks.find(
                        (entry) => entry.slot === slot && same(entry.item, e.item),
                      )
                    : undefined
                }
                statScrollInventory={statScrollInventory}
                setProgress={
                  e?.meta?.world?.set
                    ? {
                        current: equippedSetCounts[e.meta.world.set.id] || 0,
                        total: e.meta.world.set.items.reduce(
                          (sum, item) => sum + (item.quantity || 1),
                          0,
                        ),
                      }
                    : undefined
                }
                onSelect={onSelect}
                onUnequip={onUnequip}
                onUpgrade={onUpgrade}
                onAutoUpgrade={onAutoUpgrade}
                onClearMarks={onClearMarks}
                hasAutomaticMarks={hasAutomaticMarks}
                autoUpgradeMarks={autoUpgradeMarks}
                isMerchant={character.ctype === "merchant"}
                onStatScroll={onStatScroll}
                onBuy={onBuy}
              />
            ))}
        </div>
        <div className="grid gap-2">
          {slots
            .filter((_, i) => i % 2 === 1)
            .map(([slot, e]) => (
              <EquipSlot
                key={slot}
                slot={slot}
                equipped={e}
                mark={
                  e
                    ? upgradeMarks.find(
                        (mark) => mark.equipped && mark.slot === slot && same(mark.item, e.item),
                      )
                    : undefined
                }
                statScrollMark={
                  e
                    ? statScrollMarks.find(
                        (entry) => entry.slot === slot && same(entry.item, e.item),
                      )
                    : undefined
                }
                statScrollInventory={statScrollInventory}
                setProgress={
                  e?.meta?.world?.set
                    ? {
                        current: equippedSetCounts[e.meta.world.set.id] || 0,
                        total: e.meta.world.set.items.reduce(
                          (sum, item) => sum + (item.quantity || 1),
                          0,
                        ),
                      }
                    : undefined
                }
                onSelect={onSelect}
                onUnequip={onUnequip}
                onUpgrade={onUpgrade}
                onAutoUpgrade={onAutoUpgrade}
                onClearMarks={onClearMarks}
                hasAutomaticMarks={hasAutomaticMarks}
                autoUpgradeMarks={autoUpgradeMarks}
                isMerchant={character.ctype === "merchant"}
                onStatScroll={onStatScroll}
                onBuy={onBuy}
              />
            ))}
        </div>
      </div>
    </section>
  );
});
