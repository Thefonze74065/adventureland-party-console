'use client';
import { useMemo } from 'react';
import type { PartyConsoleModel } from './use-party-console';
import { useForwardingActions } from './use-forwarding-actions';

const inventoryActions = ['command', 'post', 'setActionError', 'setStandItem', 'setNpcSaleItem',
  'setAutoNpcSaleItem', 'clearAutomaticSales', 'removeAutomaticSale', 'setSelected',
  'setGearComparison', 'sendCharacter'] as const;
const cardActions = ['formation', 'logout', 'post', 'setFarmingPolicy', 'setSelectedCondition',
  'command', 'bankParty', 'clearMerchantWork', 'setForceStand', 'cancelMerchantJob',
  'setRoutinesOpen', 'gather', 'refresh', 'setCommerceMode', 'setDonationOpen', 'setGiveawayRealm',
  'setGiveawayMerchant', 'setGiveawayOpen', 'findMonsterFor', 'setFocus', 'saveRestock',
  'moveSteamToHeadless', 'joinOrPromoteSteam', 'setAnniversaryOpen', 'setMonsterNavigateTarget',
  'setSelected', 'setSelectedBestiaryMonster', 'setActionError', 'clearCollectionErrors',
  'editThreshold', 'save', 'editItemCollectionThreshold', 'saveItemCollectionThreshold'] as const;
type ActionKey = (typeof inventoryActions)[number] | (typeof cardActions)[number];
const allActions = [...new Set<ActionKey>([...inventoryActions, ...cardActions])];
export type InventoryModel = Pick<PartyConsoleModel, (typeof inventoryActions)[number] | 'state' | 'chars' | 'detailMeta'>;
export type CharacterCardModel = Pick<PartyConsoleModel, (typeof cardActions)[number] |
  'state' | 'monsters' | 'monsterAchievements' | 'selectedFocus' | 'threshold' |
  'itemCollectionThreshold' | 'thresholdError' | 'itemCollectionThresholdError'>;

export function useCharacterCardModels(model: PartyConsoleModel) {
  const actions = useForwardingActions(model, allActions);
  const { state, chars, detailMeta, monsters, monsterAchievements, selectedFocus, threshold,
    itemCollectionThreshold, thresholdError, itemCollectionThresholdError } = model;
  const inventory: InventoryModel = useMemo(() => ({ ...actions, state, chars, detailMeta }),
    [actions, state, chars, detailMeta]);
  const card: CharacterCardModel = useMemo(() => ({ ...actions, state, monsters, monsterAchievements,
    selectedFocus, threshold, itemCollectionThreshold, thresholdError, itemCollectionThresholdError }),
    [actions, state, monsters, monsterAchievements, selectedFocus, threshold,
      itemCollectionThreshold, thresholdError, itemCollectionThresholdError]);
  return { card, inventory };
}
