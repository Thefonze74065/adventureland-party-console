"use client";
import { Button } from "@/components/ui/button";
import { PassiveHuntingMenu, type PassivePatch } from "./passive-hunting-menu";
import { migratePassiveSettings } from "../../../runtime/coordinator/navigation/passive-settings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronDown, ChevronRight, Settings } from "lucide-react";
import { memo, useId, useState, type ComponentProps } from "react";
import { durationLabel } from "./duration-label";
import { FarmingPolicy } from "./farming-policy";
import { ItemSprite } from "./item-sprite";
import { MonsterChoice } from "./monster-choice";
import { MonsterHuntState } from "./monster-hunt-state";
import { MonsterHuntStatus } from "./monster-hunt-status";
import { PartyState } from "./party-state";
import { MonsterRadiusControl } from './monster-radius-control';
import {HuntSettingsControl} from "./hunt-settings-control";
import { huntBlacklistLabel } from './hunt-blacklist-label';

export const FarmingModeControl = memo(function FarmingModeControl({
  policy, followingLeader, effectivePolicy = policy, settingsOwner,
  effectiveMode,
  hunt,
  characterHunt,
  onSelect,
  blacklist,
  catalog,
  onClearBlacklist, onInspectMonster, renderMonsterDetails,
  huntSettings, onHuntSettingsSave,
  passiveRareHunts, passiveHunting,
  onRareChange,
  radius, onRadiusSave, radiusContext, farmArea,
}: {
  farmArea?: PartyState["farmAreaState"];
  followingLeader?: string; effectivePolicy?: FarmingPolicy; settingsOwner?: string;
  huntSettings?: PartyState["huntSettings"];
  onHuntSettingsSave?: (patch: Partial<NonNullable<PartyState["huntSettings"]>>) => Promise<void>;
  radius?:number;onRadiusSave?:(radius:number)=>Promise<void>;radiusContext?:string;
  recovery?:{phase:string;reason?:string}|null;
  passiveHunting?: PartyState["passiveHunting"];
  passiveRareHunts?: PartyState["passiveRareHunts"];
  onRareChange?: (settings: PassivePatch) => Promise<void>;
  blacklist: NonNullable<PartyState["huntBlacklist"]>;
  catalog: MonsterChoice[];
  onInspectMonster?: (id: string) => void;
  renderMonsterDetails?: ComponentProps<typeof PassiveHuntingMenu>["renderMonsterDetails"];
  onClearBlacklist: (monsterId?: string) => Promise<void>;
  policy: FarmingPolicy;
  effectiveMode: string;
  hunt?: MonsterHuntState | null;
  characterHunt?: MonsterHuntStatus | null;
  onSelect: (mode: FarmingPolicy) => void;
}) {
  const followDescription = useId();
  const inherited = !!followingLeader;
  const [open, setOpen] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false);
  const [blacklistBusy, setBlacklistBusy] = useState(false),
    [blacklistError, setBlacklistError] = useState<string | null>(null);
  async function clearBlacklist(monsterId?: string) {
    setBlacklistBusy(true);
    setBlacklistError(null);
    try {
      await onClearBlacklist(monsterId);
    } catch (error) {
      setBlacklistError(error instanceof Error ? error.message : "Could not update Hunt blacklist");
    } finally {
      setBlacklistBusy(false);
    }
  }
  const modes: {
    id: FarmingPolicy;
    label: string;
    description: string;
    color: string;
  }[] = [
    {
      id: "auto",
      label: "Auto",
      description: "Default, switching to scatter when learned conditions allow it",
      color: "border-cyan-600 bg-cyan-950 text-cyan-100 hover:bg-cyan-900",
    },
    {
      id: "default",
      label: "Default",
      description: "Force the normal party formation",
      color: "border-emerald-600 bg-emerald-950 text-emerald-100 hover:bg-emerald-900",
    },
    {
      id: "scatter",
      label: "Scatter",
      description: "Force one-shot scatter farming",
      color: "border-violet-600 bg-violet-950 text-violet-100 hover:bg-violet-900",
    },
    {
      id: "hunt",
      label: "Hunt",
      description: "One quest at a time: leader first, then the next member if its monster is blacklisted",
      color: "border-amber-600 bg-amber-950 text-amber-100 hover:bg-amber-900",
    },
  ];
  return (
    <section className="mt-4 border-t border-emerald-900/70 pt-3">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex h-9 min-w-0 flex-1 items-center justify-between rounded border border-transparent bg-[#07110f] px-1 py-1 text-left text-emerald-100 hover:border-emerald-800 hover:bg-emerald-950"
        >
          <span className="flex items-center gap-2 font-mono text-xs uppercase text-emerald-100/65">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{" "}
            Farming settings
          </span>
          <span className="rounded border border-cyan-700 bg-cyan-950 px-2 py-1 font-mono text-[10px] uppercase text-cyan-100">
            {followingLeader ? "Copy leader" : policy}
            {!inherited && (policy === "auto" || policy === "hunt") ? ` · ${effectiveMode}` : ""}
          </span>
        </button>
        <Button
          type="button"
          size="icon"
          aria-label="Farming settings"
          title="Farming settings"
          onClick={() => setSettingsOpen(true)}
          className="h-9 w-9 shrink-0 border border-emerald-700 bg-[#07110f] text-emerald-100 hover:border-cyan-300 hover:bg-emerald-950"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>
      {inherited && <p id={followDescription} className="sr-only">Settings inherited from the leader</p>}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="border-emerald-700 bg-[#081713] text-emerald-50 sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Farming settings{settingsOwner ? ` · ${settingsOwner}` : ""}</DialogTitle>
            <DialogDescription className="text-emerald-100/80">
              Configure Hunt relocation and automatic blacklisting. Blacklisted quests are skipped until you clear the entry. Normal farming selections are unaffected.
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={inherited} aria-describedby={inherited ? followDescription : undefined}>
          <HuntSettingsControl value={huntSettings} onSave={inherited ? undefined : onHuntSettingsSave}/>
          </fieldset>
          {onRadiusSave && <MonsterRadiusControl radius={radius||400} onSave={onRadiusSave} context={radiusContext}/>}
          <PassiveHuntingMenu settings={migratePassiveSettings(passiveHunting,passiveRareHunts)} catalog={catalog} disabled={inherited} onSave={onRareChange} renderMonsterDetails={renderMonsterDetails}/>
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-emerald-50">Hunt blacklist</h3>
            <Button
              type="button"
              size="sm"
              disabled={inherited || blacklistBusy || !Object.keys(blacklist).length} aria-describedby={inherited ? followDescription : undefined}
              onClick={() => void clearBlacklist()}
              className="border border-rose-700 bg-[#301219] text-rose-100 hover:bg-rose-950 hover:text-white"
            >
              Clear all
            </Button>
          </div>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {Object.entries(blacklist).length === 0 && (
              <p className="text-sm text-emerald-100">No monsters blacklisted.</p>
            )}
            {Object.entries(blacklist)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([id, entry]) => {
                const monster = catalog.find((m) => m.id === id);
                return (
                  <div
                    key={id}
                    className="flex items-center gap-3 rounded border border-emerald-800 bg-[#07110f] p-3"
                  >
                    <button type="button" aria-label={`Inspect ${monster?.name || id}`}
                      onClick={() => {setSettingsOpen(false);onInspectMonster?.(id);}}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded border border-transparent bg-[#07110f] text-left text-emerald-50 hover:border-cyan-600 hover:bg-emerald-950 hover:text-white">
                    <span className="relative h-10 w-10 shrink-0">
                      {monster?.sprite && <ItemSprite sprite={monster.sprite} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-emerald-50">{monster?.name || id}</p>
                      <p className="text-xs text-emerald-200">
                        {huntBlacklistLabel(entry) ? `${huntBlacklistLabel(entry)} · ` : ""}
                        {new Date(entry.at).toLocaleString()}
                      </p>
                    </div>
                    </button>
                    <Button
                      type="button"
                      disabled={inherited || blacklistBusy} aria-describedby={inherited ? followDescription : undefined}
                      onClick={() => void clearBlacklist(id)}
                      className="border border-cyan-700 bg-black text-cyan-100 hover:bg-cyan-950"
                    >
                      Clear
                    </Button>
                  </div>
                );
              })}
          </div>
          {blacklistError && (
            <p role="alert" className="text-rose-200">
              {blacklistError}
            </p>
          )}
        </DialogContent>
      </Dialog>
      {open ? (
        <div className="mt-2 rounded border border-emerald-900 bg-[#050b0a] p-2">
          {inherited && <p className="mb-2 text-xs text-cyan-100">Used when Follow is off.</p>}
          <div className="flex flex-wrap gap-2">
            {modes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                title={mode.description}
                aria-pressed={policy === mode.id}
                onClick={() => onSelect(mode.id)}
                className={`rounded border px-2.5 py-1 font-mono text-[10px] uppercase transition-colors ${mode.color} ${policy === mode.id ? "ring-2 ring-white/70" : "opacity-80"}`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          {!inherited && farmArea?.active && <div className="mt-3 rounded border border-cyan-800 bg-[#07110f] p-2 text-xs text-cyan-100">
            <p>Active farming zone: {farmArea.active.map} ({Math.round(farmArea.active.x)}, {Math.round(farmArea.active.y)})</p>
            {farmArea.message && !/farming resumed/i.test(farmArea.message) && <p className="mt-1 text-amber-100">{farmArea.message}</p>}
          </div>}
          {effectivePolicy === "hunt" || hunt || characterHunt ? (
            <div className="mt-2 border-t border-amber-900/70 pt-2 font-mono text-[10px] text-amber-100/80">
              <p className="font-semibold text-amber-100">
                {effectivePolicy === "hunt" ? "Hunt status" : "Last Hunt status"}
                {hunt?.stage ? ` · ${hunt.stage}` : ""}
              </p>
              <p>{hunt?.message || (effectivePolicy === "hunt" ? "Preparing Monster Hunt cycle" : "Hunt mode is not active")}</p>
              {effectivePolicy !== "hunt" ? <p>Current farming mode: {effectivePolicy}. Selecting Hunt rechecks eligible quests; blacklisted quests remain skipped.</p> : null}
              {hunt?.backup ? <div className="mt-1 text-amber-200">
                <p>Next batch after every blacklisted quest expires · {durationLabel(Math.max(0,...Object.values(hunt.backup.members).map(m=>m.remainingMs)))}</p>
                {Object.entries(hunt.backup.members).map(([name,m])=><p key={name}>{name}: {!m.fresh ? 'waiting for fresh status' : m.ready ? 'ready' : `${m.target} · ${durationLabel(m.remainingMs)}`}</p>)}
              </div> : <p className="mt-1 text-amber-200">Quest owner{hunt?.owner ? `: ${hunt.owner}` : ""} · when complete or expired</p>}
              {hunt?.turnIn && hunt.turnIn.phase !== "complete" ? <p className="mt-1 text-amber-200">Events wait until Daisy reward claims finish.</p> : null}
              {hunt?.target ? <p className="mt-1 text-amber-300">Target: {hunt.target}</p> : null}
              {characterHunt ? (
                <p className="mt-1 text-emerald-200">
                  My quest: {characterHunt.id} · {characterHunt.count} left ·{" "}
                  {durationLabel(characterHunt.remainingMs)}
                  {characterHunt.id && blacklist[characterHunt.id] ? " · Blacklisted — skipped for Hunt" : ""}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});
