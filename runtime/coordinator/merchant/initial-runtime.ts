import type { MerchantWork } from "./work.ts";
import type { RealmRequest } from '../characters/realm-request.ts';
import type { LuckySlotHistory } from '../../lucky-slot-tracking.ts';
import type { recoverMerchantQueue } from "./restart-queue.ts";
import type { createMerchantItemCommands } from "../inventory/merchant-item-commands.ts";

import { initialBankSort, type BankSortState } from "./bank-sort.ts";
import { validStandLocation, type MerchantStandLocation } from './stand-location.ts';

interface SavedMerchant extends Partial<BankSortState> {
  luckyUpgradeSlots?: Record<string, number | null>;
  luckySlotTracking?: LuckySlotHistory;
  luckySlotCharacterIds?: Record<string, string>;
  luckySlotLocks?: Record<string, number | null>;
  luckySlotResume?: Record<string, {slot: number; rolls: number}>;
  merchantCharacter?: string | null;
  merchantRealmRequests?: Record<string, RealmRequest | undefined>;
  merchantForceStand?: unknown;
  merchantStandLocation?: MerchantStandLocation;
  merchantWeapon?: Parameters<typeof createMerchantItemCommands>[0]["merchantWeapon"];
  merchantQueue?: MerchantWork[] | null;
  merchantCurrent?: MerchantWork | null;
  merchantCargo?: Parameters<typeof recoverMerchantQueue>[0]["merchantCargo"] | null;
}

/** Restore pending merchant work before the restart recovery service reconciles it. */
function homeReturnTimestamp(saved: SavedMerchant, merchant: string | null): number {
  const request = saved.merchantRealmRequests?.[String(merchant)];
  return request?.owner === 'home' && !request.exhausted ? request.requestedAt : 0;
}
export function initialMerchantRuntime<DefaultMerchant extends string | null = string>(
  saved: SavedMerchant,
  defaultMerchant?: DefaultMerchant,
) {
  const merchantCharacter: string | DefaultMerchant =
    saved.merchantCharacter || (defaultMerchant === undefined ? "GoldMajesty" : defaultMerchant);
  const luckyUpgradeSlots = {...saved.luckyUpgradeSlots};
  // Older builds persisted this hardcoded default without verification.
  // Retire it so that installing discovery actually enables the slot search.
  if (luckyUpgradeSlots.GoldMajesty === 7) delete luckyUpgradeSlots.GoldMajesty;
  return {
    ...initialBankSort(saved),
    merchantCharacter,
    merchantRealmRequests: {...saved.merchantRealmRequests},
    luckyUpgradeSlots,
    luckySlotLocks: {...saved.luckySlotLocks},
    luckySlotResume: {...saved.luckySlotResume},
    luckySlotTracking: saved.luckySlotTracking || {},
    luckySlotCharacterIds: {...saved.luckySlotCharacterIds},
    merchantForceStand: saved.merchantForceStand === true,
    merchantStandLocation: validStandLocation(saved.merchantStandLocation) ? {...saved.merchantStandLocation} : null,
    merchantWeapon: saved.merchantWeapon || null,
    merchantQueue: Array.isArray(saved.merchantQueue) ? saved.merchantQueue : [],
    merchantCurrent: saved.merchantCurrent || null,
    merchantHomeReturnAt: homeReturnTimestamp(saved, merchantCharacter),
    merchantCargo: saved.merchantCargo || { bank: [], gold: 0 },
  };
}
