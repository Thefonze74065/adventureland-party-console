"use client";
import { RosterControls } from "./roster-controls";
import { Button } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/radio-group";
import { MapPin } from "lucide-react";
import { DungeonPanel } from './dungeon-panel';
import { EscapeControl } from "./escape-control";
import { ConnectedFarmingAreaPicker as FarmingAreaPicker } from "./connected-farming-area-picker";
import { MonsterFocusPicker } from "./monster-focus-picker";
import type { PartyConsoleModel } from "./use-party-console";
import { PartyItemDetails } from "./party-item-details";
import { PartyEquipmentCatalogDialog } from "./party-equipment-catalog-dialog";
import { PartyWTBOrderDialog } from "./party-wtborder-dialog";
import { PartyConditionDetails } from "./party-condition-details";
import { PartyCharacterTravelDialog } from "./party-character-travel-dialog";
import { PartyRosterPicker } from "./party-roster-picker";
import { PartyCreateCharacter } from "./party-create-character";
import { PartyMerchantCommerceDialog } from "./party-merchant-commerce-dialog";
import { PartySendMailDialog } from "./party-send-mail-dialog";

import { ConnectedCharacterCard } from "./connected-character-card";
import { useCharacterCardModels } from './character-card-model';
import { PendingCharacterCards, pendingCharacters } from './pending-character-cards';

export function PartyWorkspace({ model }: { model: PartyConsoleModel }) {
  const cardModels = useCharacterCardModels(model);
  const { state, chars, formation, setPickerSlot, monsters, post, townParty, setMonsterNavigateTarget, huntSetup, huntSetupCharacter, monsterNavigateBusy, setHuntSetup, setMonsterNavigateBusy, monsterNavigateTarget, farmAreaRequest, setFarmAreaRequest, startFarmingArea, wtbItem } = model;
  const pending = pendingCharacters(model);
  return (
    <>
      <section className="px-5 py-7 md:px-10">
        <div className="mx-auto max-w-[1500px]">
        <DungeonPanel model={model} />
        {!chars.length && !pending.length && <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><RosterControls
          slots={state.activeSlots || []}
          operation={state.steamSwitch}
          onChoose={setPickerSlot}
        /></div>}
        {!chars.length && !pending.length ? (
          <div className="grid min-h-64 place-items-center border border-dashed border-emerald-900 bg-[#071315] text-emerald-100">
            {model.coordinatorLoading ? 'Party Console is loading…' : model.coordinatorUnavailable ? 'Reconnecting to Party Console…' : <p>No characters connected yet. Load a character or <button type="button" className="rounded border border-cyan-700 bg-[#071315] px-2 text-cyan-200 hover:bg-cyan-950 hover:text-cyan-100" onClick={() => window.location.assign('/setup')}>open setup</button> to link Steam.</p>}
          </div>
        ) : (
          <RadioGroup
            value={state.leader || ""}
            onValueChange={(value) => formation({ leader: value })}
            className="grid items-start gap-4 @3xl:grid-cols-2 @7xl:grid-cols-4"
          >
            {chars.filter(char => !pending.some(entry => entry.name === char.name)).map(char => <ConnectedCharacterCard key={char.name} name={char.name} model={cardModels.card} inventoryModel={cardModels.inventory} />)}
            <PendingCharacterCards model={model} />
            <RosterControls slots={state.activeSlots || []} operation={state.steamSwitch} onChoose={setPickerSlot} />
            {state.bankboiTransaction ? (
              <article className="grid min-h-[34rem] place-items-center self-stretch border-2 border-dashed border-cyan-500/80 bg-[#071315] px-8 text-center shadow-[inset_0_0_40px_rgba(34,211,238,0.06)]">
                <div>
                  <p className="font-mono text-4xl font-black uppercase leading-tight tracking-[0.14em] text-cyan-200">
                    Bankboi
                    <br />
                    Active
                  </p>
                  <p className="mt-5 font-mono text-sm uppercase tracking-widest text-cyan-400">
                    {state.bankboiTransaction.bankboi}
                  </p>
                  <p className="mt-2 font-mono text-xs uppercase text-slate-400">
                    {state.bankboiTransaction.mode} · {state.bankboiTransaction.phase}
                  </p>
                </div>
              </article>
            ) : null}
            <Button
              onClick={townParty}
              className="h-14 w-full bg-cyan-400 text-base font-semibold text-cyan-950 hover:bg-cyan-300 @3xl:col-span-2 @7xl:col-span-4"
            >
              <MapPin className="mr-2 h-5 w-5" />
              Send party to town
            </Button>
            <EscapeControl />
          </RadioGroup>
        )}
        <PartyItemDetails model={model} />
        {huntSetup !== null && (
          <FarmingAreaPicker
            catalog={monsters}
            ids={huntSetup}
            character={state.characters[huntSetupCharacter || state.leader || ""]}
            radius={state.monsterSearchRadiusByCharacter?.[huntSetupCharacter || state.leader || ""] || 400}
            override={false}
            busy={monsterNavigateBusy}
            onClose={() => setHuntSetup(null)}
            preparation={
              <MonsterFocusPicker
                monsters={monsters}
                selected={huntSetup}
                priorities={{}}
                onPriorityChange={() => {}}
                onChange={(ids) => setHuntSetup(ids.filter((id) => id !== "all"))}
              />
            }
            onStart={async (area) => {
              setMonsterNavigateBusy(true);
              try {
                await post("/farming-mode", {
                  mode: "hunt",
                  character: huntSetupCharacter,
                  backup: {
                    monsterFocus: huntSetup,
                    location: { map: area.map, x: area.x, y: area.y },
                  },
                });
                setHuntSetup(null);
              } finally {
                setMonsterNavigateBusy(false);
              }
            }}
          />
        )}
        {(monsterNavigateTarget || farmAreaRequest) && (
          <FarmingAreaPicker
            phoenixRouteOrder={state.phoenixRouteOrder}
            catalog={monsters}
            ids={monsterNavigateTarget ? [monsterNavigateTarget.id] : farmAreaRequest!.ids}
            character={
              state.characters[
                monsterNavigateTarget ? state.leader || "" : farmAreaRequest!.character
              ]
            }
            waypoint={
              state.characterLocations?.[
                monsterNavigateTarget ? state.leader || "" : farmAreaRequest!.character
              ] || state.partyLocation
            }
            radius={
              state.monsterSearchRadiusByCharacter?.[
                state.leader || farmAreaRequest?.character || ""
              ] || 400
            }
            override={!!monsterNavigateTarget}
            busy={monsterNavigateBusy}
            onClose={() => {
              setMonsterNavigateTarget(null);
              setFarmAreaRequest(null);
            }}
            onStart={startFarmingArea}
          />
        )}
        <PartyEquipmentCatalogDialog model={model} />
        {wtbItem && <PartyWTBOrderDialog model={model} />}
        <PartyConditionDetails model={model} />
        <PartyCharacterTravelDialog model={model} />
        <PartyRosterPicker model={model} />
        <PartyCreateCharacter model={model} />
        <PartyMerchantCommerceDialog model={model} />
        <PartySendMailDialog model={model} />
        </div>
      </section>
    </>
  );
}
