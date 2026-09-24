'use client';
import { CharacterSessionControls } from './character-session-controls';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroupItem } from '@/components/ui/radio-group';
import { EventSelectionControl } from './event-selection-control';
import { Coins } from 'lucide-react';
import { abbreviatedGold } from './abbreviated-gold';
import { ActiveStatuses } from './active-statuses';
import { CharacterMapSection } from './character-map-section';
import { MonsterDetailsDialog } from './monster-details-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { FarmingModeControl } from './farming-mode-control';
import { farmingContext } from './farming-context';
import { GoldTargetControl } from './gold-target-control';
import { MerchantCardControls } from './merchant-card-controls';
import { Meter } from './meter';
import { MonsterFocusPicker } from './monster-focus-picker';
import { RestockControls } from './restock-controls';
import { CharacterStatsTrigger } from './character-stats-trigger';
import type { CharacterCardModel, InventoryModel } from './character-card-model';
import { XpMeter } from './xp-meter';
import { MonsterRouteButton } from './monster-route-button';

import { memo, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { committedLiveRecord } from './live-metrics';
import { useCharacterData } from './dashboard-live';
import { ConnectedInventory } from './connected-inventory';
import { ConnectedCombatLog } from './connected-combat-log';
import { emptyArray, emptyRecord } from './empty-values';
import type { Char } from './char';
import type { PassivePatch } from './passive-hunting-menu';
import type { PartyState } from './party-state';
import type { FarmingPolicy } from './farming-policy';
import type { MerchantCatalogItem } from './merchant-catalog-item';

export const ConnectedCharacterCard = memo(function ConnectedCharacterCard({
  name,
  model,
  inventoryModel,
}: {
  name: string;
  model: CharacterCardModel;
  inventoryModel: InventoryModel;
}) {
  const diagnostics = useCharacterData(name, 'diagnostics');
  const vitals = useCharacterData(name, 'vitals');
  useEffect(() => {
    committedLiveRecord(name);
  }, [name, vitals]);
  const char = {
    ...model.state.characters[name],
    ...diagnostics,
    ...vitals,
  } as Char;
  const presence = useCharacterData(name, 'presence');
  const {
    state,
    formation,
    logout,
    monsters,
    post,
    setFarmingPolicy,
    setSelectedCondition,
    command,
    bankParty,
    clearMerchantWork,
    setForceStand,
    cancelMerchantJob,
    setRoutinesOpen,
    gather,
    refresh,
    setCommerceMode,
    setDonationOpen,
    setGiveawayRealm,
    setGiveawayMerchant,
    setGiveawayOpen,
    findMonsterFor,
    selectedFocus,
    setFocus,
    saveRestock,
    setAnniversaryOpen,
    setSelectedBestiaryMonster,
    setActionError,
    setMonsterNavigateTarget,
    setSelected,
    monsterAchievements,
    thresholdError,
    itemCollectionThresholdError,
    clearCollectionErrors,
    threshold,
    editThreshold,
    save,
    itemCollectionThreshold,
    editItemCollectionThreshold,
    saveItemCollectionThreshold,
  } = model;
  // MonsterFocusPicker is memoized, but formation={state} would hand it the
  // whole (frequently-changing) state object even though routing only needs
  // leader/followers; narrowing it lets unrelated state churn skip a re-render.
  const routingFormation = useMemo(
    () => ({ leader: state.leader, followers: state.followers }),
    [state.leader, state.followers],
  );
  const monsterFocusSelected = state.monsterFocusByCharacter?.[name] || selectedFocus;
  const monsterFocusPriorities = state.monsterPrioritiesByCharacter?.[name] || emptyRecord<number>();
  const renderMonsterRouteButton = useCallback(
    (focus: string[]) => (
      <MonsterRouteButton formation={routingFormation} character={name} onRoute={() => findMonsterFor(name, focus)} />
    ),
    [routingFormation, name, findMonsterFor],
  );
  const onMonsterFocusChange = useCallback((focus: string[]) => setFocus(name, focus), [setFocus, name]);
  const onMonsterPriorityChange = useCallback(
    (priorities: Record<string, number>) => setFocus(name, monsterFocusSelected, priorities),
    [setFocus, name, monsterFocusSelected],
  );
  const onSelectCondition = useCallback(
    (condition: import('./condition').Condition) => setSelectedCondition({ character: name, condition }),
    [setSelectedCondition, name],
  );
  const onAnniversary = useCallback(() => setAnniversaryOpen(true), [setAnniversaryOpen]);
  const onEventSelectionChange = useCallback(
    (eventSelections: string[]) => formation({ character: name, eventSelections }),
    [formation, name],
  );
  const onFollowChange = useCallback(
    (checked: boolean) => formation({ character: name, follow: !!checked }),
    [formation, name],
  );
  const onGoldTargetSave = useCallback(
    (amount: number) => command(name, 'gold-target', undefined, { amount }),
    [command, name],
  );
  const onGoldTargetBank = useCallback(async () => { await command(name, 'bank'); }, [command, name]);
  const eventState = useMemo(
    () => ({
      leader: state.leader,
      merchantCharacter: state.merchantCharacter,
      followers: state.followers,
      eventsByCharacter: state.eventsByCharacter,
      eventSelectionsByCharacter: state.eventSelectionsByCharacter,
      eventSchedules: state.eventSchedules,
    }),
    [state.leader, state.merchantCharacter, state.followers, state.eventsByCharacter,
      state.eventSelectionsByCharacter, state.eventSchedules],
  );
  const onRadiusSave = useCallback(
    (radius: number) => setFocus(name, monsterFocusSelected, monsterFocusPriorities, radius),
    [setFocus, name, monsterFocusSelected, monsterFocusPriorities],
  );
  const onRareChange = useCallback(
    async (settings: PassivePatch) => { await post('/rare-hunting', settings); },
    [post],
  );
  const onHuntSettingsSave = useCallback(
    async (patch: Partial<NonNullable<PartyState["huntSettings"]>>) => {
      await post("/hunt-settings", { ...patch, character: name });
    },
    [post, name],
  );
  const merchantCatalogAllItems = useMemo(
    () => state.merchantCatalog?.allItems || emptyArray<MerchantCatalogItem>(),
    [state.merchantCatalog],
  );
  const renderMonsterDetails = useCallback(
    (id: string, close: () => void): ReactNode => {
      const monster = state.bestiaryCatalog?.find(entry => entry.id === id);
      if (!monster) return <Dialog open onOpenChange={open => { if (!open) close(); }}>
        <DialogContent className="border-emerald-700 bg-[#081713] text-emerald-50">
          <DialogHeader><DialogTitle>Monster details</DialogTitle><DialogDescription className="text-emerald-100">Details are not available for {id} yet.</DialogDescription></DialogHeader>
        </DialogContent>
      </Dialog>;
      return <MonsterDetailsDialog monster={monster} catalog={merchantCatalogAllItems}
        achievement={monsterAchievements[id] || null}
        onOpenChange={open => { if (!open) close(); }}
        onNavigate={setMonsterNavigateTarget}
        onInspectDrop={(itemId, monsterName) => {
          const item = state.merchantCatalog?.allItems?.find(entry => entry.id === itemId);
          if (item) { close(); setSelected({ character: `Dropped by ${monsterName}`, entry: { slot: -1, item: { name: itemId }, meta: item.meta } }); }
        }} />;
    },
    [state.bestiaryCatalog, merchantCatalogAllItems, monsterAchievements, setMonsterNavigateTarget,
      state.merchantCatalog, setSelected],
  );
  const onInspectMonster = useCallback(
    (id: string) => {
      const monster = state.bestiaryCatalog?.find(entry => entry.id === id);
      if (monster) setSelectedBestiaryMonster(monster);
      else setActionError(`Monster details are not available for ${id} yet.`);
    },
    [state.bestiaryCatalog, setSelectedBestiaryMonster, setActionError],
  );
  const onClearBlacklist = useCallback(
    async (monsterId?: string) => {
      await post(
        '/hunt-blacklist',
        monsterId
          ? { action: 'remove', monsterId, character: name }
          : { action: 'clear', character: name },
      );
    },
    [post, name],
  );
  const onSelectFarmingPolicy = useCallback(
    (mode: FarmingPolicy) => void setFarmingPolicy(mode, name),
    [setFarmingPolicy, name],
  );
  const collectionSettings = useMemo(
    () => ({
      thresholdError, itemCollectionThresholdError, onClearErrors: clearCollectionErrors,
      threshold, onThresholdChange: editThreshold, onThresholdSave: save,
      itemCollectionThreshold, onItemCollectionThresholdChange: editItemCollectionThreshold,
      onItemCollectionThresholdSave: saveItemCollectionThreshold,
    }),
    [thresholdError, itemCollectionThresholdError, clearCollectionErrors, threshold, editThreshold,
      save, itemCollectionThreshold, editItemCollectionThreshold, saveItemCollectionThreshold],
  );
  const onRoutines = useCallback(() => setRoutinesOpen(true), [setRoutinesOpen]);
  const onBuy = useCallback(() => { void refresh(true); setCommerceMode('buy'); }, [refresh, setCommerceMode]);
  const onCraft = useCallback(() => { void refresh(true); setCommerceMode('craft'); }, [refresh, setCommerceMode]);
  const onExchange = useCallback(() => { void refresh(true); setCommerceMode('exchange'); }, [refresh, setCommerceMode]);
  const onDonate = useCallback(() => setDonationOpen(true), [setDonationOpen]);
  const onGiveaway = useCallback(() => {
    const current = state.merchantCharacter && state.characters[state.merchantCharacter]?.server;
    setGiveawayRealm(current ? `SR_${current}` : state.giveawayRealms?.[0]?.key || '');
    setGiveawayMerchant('');
    setGiveawayOpen(true);
  }, [state.merchantCharacter, state.characters, state.giveawayRealms, setGiveawayRealm, setGiveawayMerchant, setGiveawayOpen]);
  if (!vitals || !diagnostics)
    return (
      <article className="rounded border border-emerald-800 bg-[#0b1916] p-5 text-emerald-100">
        {name}: awaiting status
      </article>
    );
  const farming = farmingContext(state, name);
  const online = !!presence?.seenAt;
  const slot = state.activeSlots?.find((entry) => entry.character === name);
  return (
    <article
      key={char.name}
      className="relative isolate min-w-0 self-start overflow-hidden rounded-lg border border-emerald-900/80 bg-[#0b1916] shadow-2xl shadow-black/20"
    >
      <div className="border-b border-emerald-900/70 p-5">
        <div className="flex items-start">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <CharacterStatsTrigger character={char} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${online ? 'bg-emerald-400' : 'bg-zinc-600'}`}
                />
                <h2
                  className="min-w-0 flex-1 truncate text-xl font-semibold"
                  title={char.name}
                >
                  {char.name}
                </h2>
                <CharacterSessionControls
                  name={char.name}
                  slot={slot}
                  pending={
                    !!state.steamSwitch?.phase &&
                    state.steamSwitch.phase !== 'complete'
                  }
                  onLogout={logout}
                  onHeadless={model.moveSteamToHeadless}
                  onSteam={model.joinOrPromoteSteam}
                  primaryCharacter={state.activeSlots?.find(entry => entry.primary)?.character || null}
                />
              </div>
              <p className="mt-1 font-mono text-xs uppercase text-emerald-200/55">
                Lv {char.level} {char.ctype} {char.primaryStat || ''} ·{' '}
                {char.server || 'realm unknown'}
                <span className="normal-case">
                  {' '}
                  ·{' '}
                  {online &&
                  typeof char.ping === 'number' &&
                  Number.isFinite(char.ping) &&
                  char.ping >= 0
                    ? `${Math.round(char.ping)}ms`
                    : '—ms'}
                </span>
              </p>
              <XpMeter value={char.xp || 0} max={char.max_xp || 0} />
              {char.banking ? (
                <span className="rounded bg-amber-300/10 px-2 py-1 font-mono text-xs text-amber-300">
                  BANKING
                </span>
              ) : char.bankQueued ? (
                <span className="rounded bg-cyan-300/10 px-2 py-1 font-mono text-xs text-cyan-300">
                  BANK QUEUED
                </span>
              ) : char.stocking ? (
                <span className="rounded bg-violet-300/10 px-2 py-1 font-mono text-xs text-violet-300">
                  STOCKING UP
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <CharacterMapSection char={char} />
        <div className="mt-4 flex gap-5 rounded border border-emerald-900/70 bg-black/20 p-3 text-sm">
          <label
            htmlFor={`leader-${char.name}`}
            className="flex items-center gap-2"
          >
            <RadioGroupItem id={`leader-${char.name}`} value={char.name} />
            <span>Leader</span>
          </label>
          <label
            htmlFor={`follow-${char.name}`}
            className="flex items-center gap-2"
          >
            <Checkbox
              id={`follow-${char.name}`}
              checked={!!state.followers?.[char.name]}
              onCheckedChange={onFollowChange}
            />
            <span>Follow</span>
          </label>
          <EventSelectionControl onAnniversary={onAnniversary}
            state={eventState}
            name={char.name}
            merchant={char.ctype === 'merchant'}
            onChange={onEventSelectionChange}
          />
        </div>
        <div className="mt-5 grid gap-3">
          <Meter
            label="HP"
            value={char.hp}
            max={char.max_hp}
            color="bg-rose-400"
          />
          <Meter
            label="MP"
            value={char.mp}
            max={char.max_mp}
            color="bg-cyan-400"
          />
        </div>
        <ActiveStatuses
          key={char.name}
          conditions={char.conditions || emptyArray()}
          onSelect={onSelectCondition}
        />
        <ConnectedCombatLog character={char.name} />
        {char.ctype !== 'merchant' ? (
          <FarmingModeControl
            farmArea={farming.farmArea}
            radius={state.monsterSearchRadiusByCharacter?.[char.name] || 400}
            radiusContext={
              state.followers?.[char.name] &&
              state.leader &&
              state.leader !== char.name
                ? `Following ${state.leader}: effective radius ${state.monsterSearchRadiusByCharacter?.[state.leader] || 400}. This input saves ${char.name}'s own radius.`
                : "Radius for Leader"
            }
            recovery={
              state.combatRecovery?.names.includes(char.name)
                ? state.combatRecovery
                : null
            }
            onRadiusSave={onRadiusSave}
            passiveRareHunts={state.passiveRareHunts}
            passiveHunting={state.passiveHunting}
            onRareChange={onRareChange}
            policy={farming.savedMode}
            followingLeader={farming.followingLeader}
            effectivePolicy={farming.effectiveMode}
            settingsOwner={farming.owner}
            blacklist={farming.blacklist}
            huntSettings={farming.settings}
            onHuntSettingsSave={onHuntSettingsSave}
            catalog={monsters}
            renderMonsterDetails={renderMonsterDetails}
            onInspectMonster={onInspectMonster}
            onClearBlacklist={onClearBlacklist}
            effectiveMode={
              char.farmingMode || state.partyFarmingMode || 'default'
            }
            hunt={farming.hunt}
            characterHunt={char.monsterHunt}
            onSelect={onSelectFarmingPolicy}
          />
        ) : null}
        {char.name === state.merchantCharacter ? (
          <GoldTargetControl
            character={char.name}
            gold={char.gold}
            target={state.goldTargets?.[char.name] ?? 0}
            onSave={onGoldTargetSave}
            onBank={onGoldTargetBank}
          />
        ) : (
          <div
            className="mt-4 flex items-center gap-1.5 font-mono text-sm text-amber-300"
            title={`${char.gold.toLocaleString()} gold`}
          >
            <Coins className="h-4 w-4" />
            {abbreviatedGold(char.gold)}
          </div>
        )}
      </div>
      {char.name === state.merchantCharacter ? (
        <MerchantCardControls
          collectionSettings={collectionSettings}
          state={state}
          onBank={bankParty}
          onClear={clearMerchantWork}
          onForceStand={setForceStand}
          onCancelJob={cancelMerchantJob}
          onRoutines={onRoutines}
          onGather={gather}
          onBuy={onBuy}
          onCraft={onCraft}
          onExchange={onExchange}
          onDonate={onDonate}
          onGiveaway={onGiveaway}
        />
      ) : (
        <div className="border-b border-emerald-900/70 p-4">
          <p className="mb-2 font-mono text-[10px] uppercase text-emerald-100/45">
            Monster focus -{' '}
            {state.monsterSearchRadiusByCharacter?.[
              state.leader || char.name
            ] || 400}
          </p>
          <div className="flex items-center gap-2">
            <MonsterFocusPicker
              renderRouteButton={renderMonsterRouteButton}
              monsters={monsters}
              selected={monsterFocusSelected}
              onChange={onMonsterFocusChange}
              priorities={monsterFocusPriorities}
              onPriorityChange={onMonsterPriorityChange}
            />
          </div>
        </div>
      )}
      <RestockControls
        character={char.name}
        value={state.restockPolicies?.[char.name]}
        onSave={saveRestock}
      />
      <ConnectedInventory name={char.name} model={inventoryModel} />
    </article>
  );
});
