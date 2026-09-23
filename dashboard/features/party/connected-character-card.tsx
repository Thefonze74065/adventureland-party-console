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

import { memo, useCallback, useEffect, useMemo } from 'react';
import { committedLiveRecord } from './live-metrics';
import { useCharacterData } from './dashboard-live';
import { ConnectedInventory } from './connected-inventory';
import { ConnectedCombatLog } from './connected-combat-log';
import { emptyRecord } from './empty-values';
import type { Char } from './char';

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
              onCheckedChange={(checked) =>
                formation({
                  character: char.name,
                  follow: !!checked,
                })
              }
            />
            <span>Follow</span>
          </label>
          <EventSelectionControl onAnniversary={() => model.setAnniversaryOpen(true)}
            state={state}
            name={char.name}
            merchant={char.ctype === 'merchant'}
            onChange={(eventSelections) =>
              formation({ character: char.name, eventSelections })
            }
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
          conditions={char.conditions || []}
          onSelect={(condition) =>
            setSelectedCondition({
              character: char.name,
              condition,
            })
          }
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
            onRadiusSave={(radius) =>
              setFocus(
                char.name,
                state.monsterFocusByCharacter?.[char.name] || selectedFocus,
                state.monsterPrioritiesByCharacter?.[char.name] || {},
                radius,
              )
            }
            passiveRareHunts={state.passiveRareHunts}
            passiveHunting={state.passiveHunting}
            onRareChange={async (settings) => {
              await post('/rare-hunting', settings);
            }}
            policy={farming.savedMode}
            followingLeader={farming.followingLeader}
            effectivePolicy={farming.effectiveMode}
            settingsOwner={farming.owner}
            blacklist={farming.blacklist}
            huntSettings={farming.settings}
            onHuntSettingsSave={async (patch) => { await post("/hunt-settings", { ...patch, character: char.name }); }}
            catalog={monsters}
            renderMonsterDetails={(id, close) => {
              const monster = state.bestiaryCatalog?.find(entry => entry.id === id);
              if (!monster) return <Dialog open onOpenChange={open => { if (!open) close(); }}>
                <DialogContent className="border-emerald-700 bg-[#081713] text-emerald-50">
                  <DialogHeader><DialogTitle>Monster details</DialogTitle><DialogDescription className="text-emerald-100">Details are not available for {id} yet.</DialogDescription></DialogHeader>
                </DialogContent>
              </Dialog>;
              return <MonsterDetailsDialog monster={monster} catalog={state.merchantCatalog?.allItems || []}
                achievement={model.monsterAchievements[id] || null}
                onOpenChange={open => { if (!open) close(); }}
                onNavigate={model.setMonsterNavigateTarget}
                onInspectDrop={(itemId, monsterName) => {
                  const item = state.merchantCatalog?.allItems?.find(entry => entry.id === itemId);
                  if (item) { close(); model.setSelected({ character: `Dropped by ${monsterName}`, entry: { slot: -1, item: { name: itemId }, meta: item.meta } }); }
                }} />;
            }}
            onInspectMonster={id => {
              const monster = state.bestiaryCatalog?.find(entry => entry.id === id);
              if (monster) model.setSelectedBestiaryMonster(monster);
              else model.setActionError(`Monster details are not available for ${id} yet.`);
            }}
            onClearBlacklist={async (monsterId) => {
              await post(
                '/hunt-blacklist',
                monsterId
                  ? { action: 'remove', monsterId, character: char.name }
                  : { action: 'clear', character: char.name },
              );
            }}
            effectiveMode={
              char.farmingMode || state.partyFarmingMode || 'default'
            }
            hunt={farming.hunt}
            characterHunt={char.monsterHunt}
            onSelect={(mode) => void setFarmingPolicy(mode, char.name)}
          />
        ) : null}
        {char.name === state.merchantCharacter ? (
          <GoldTargetControl
            character={char.name}
            gold={char.gold}
            target={state.goldTargets?.[char.name] ?? 0}
            onSave={(amount) =>
              command(char.name, 'gold-target', undefined, {
                amount,
              })
            }
            onBank={async () => {
              await command(char.name, 'bank');
            }}
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
          collectionSettings={{thresholdError: model.thresholdError, itemCollectionThresholdError: model.itemCollectionThresholdError, onClearErrors: model.clearCollectionErrors, threshold: model.threshold, onThresholdChange: model.editThreshold, onThresholdSave: model.save, itemCollectionThreshold: model.itemCollectionThreshold, onItemCollectionThresholdChange: model.editItemCollectionThreshold, onItemCollectionThresholdSave: model.saveItemCollectionThreshold}}
          state={state}
          onBank={bankParty}
          onClear={clearMerchantWork}
          onForceStand={setForceStand}
          onCancelJob={cancelMerchantJob}
          onRoutines={() => setRoutinesOpen(true)}
          onGather={gather}
          onBuy={() => {
            void refresh(true);
            setCommerceMode('buy');
          }}
          onCraft={() => {
            void refresh(true);
            setCommerceMode('craft');
          }}
          onExchange={() => {
            void refresh(true);
            setCommerceMode('exchange');
          }}
          onDonate={() => setDonationOpen(true)}
          onGiveaway={() => {
            const current =
              state.merchantCharacter &&
              state.characters[state.merchantCharacter]?.server;
            setGiveawayRealm(
              current ? `SR_${current}` : state.giveawayRealms?.[0]?.key || '',
            );
            setGiveawayMerchant('');
            setGiveawayOpen(true);
          }}
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
