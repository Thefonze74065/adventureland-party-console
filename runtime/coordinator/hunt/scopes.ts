import { defaultHuntSettings } from "./settings.ts";
import { initialCommandState } from "../navigation/initial-commands.ts";

/** Durable personal preferences and controller state. Never copy these when Follow changes. */
export type FarmingProfiles = Record<string, Record<string, unknown>>;
const fields = ["farmingPolicy", "monsterHunt", "huntSettings", "huntBlacklist", "huntFailures",
  "location", "monsterFocus", "activeConvoy", "farmAreaState", "partyFarmingMode",
  "scatterMonsterTypes", "scatterEpoch", "partyFarmingMonsterType", "scatterBreakTarget",
  "scatterPartySignature", "groupedCombat", "groupedCombatResetAt", "combatRecovery",
  "combatHuntBoundary", "eventReturn", "eventReturnLast", "eventSessions", "abtestingStrategy", "rareHuntState", "rareHuntReturn", "rareRetryEvidence", "rarePursuitProgress", "phoenixPatrolActive", "phoenixPatrolCheckpoint", "encounterRoutines",
  "encounterAutoDeathLimits", "encounterAutoDeaths", "encounterAutoDeathsAt"] as const;
const scopedFields = new Set<string>(fields);
interface State {
  leader: string | null;
  followers: Record<string, boolean>;
  merchantCharacter: string | null;
  farmingProfiles: FarmingProfiles;
  monsterFocusByCharacter?: Record<string, string[] | undefined>;
  characterLocations?: Record<string, unknown>;
  escape?: { participants: string[] } | null;
  townCycle?: { pending: string[] } | null;
  anniversary?: { eventCycle?: { participants?: string[] } | null };
}

function defaults(): Record<string, unknown> {
  return { farmingPolicy: "auto", monsterHunt: null, huntSettings: { ...defaultHuntSettings },
    huntBlacklist: {}, huntFailures: {}, location: null, monsterFocus: [], activeConvoy: null,
    farmAreaState: {}, partyFarmingMode: "default", scatterMonsterTypes: [], scatterEpoch: 0,
    partyFarmingMonsterType: null, scatterBreakTarget: null, scatterPartySignature: "",
    groupedCombat: null, groupedCombatResetAt: 0, combatRecovery: null, combatHuntBoundary: null,
    eventReturn: null, eventReturnLast: null, eventSessions: {}, abtestingStrategy: null,
    rareHuntState: null, rareHuntReturn: null, rareRetryEvidence: {}, rarePursuitProgress: {}, phoenixPatrolActive: false, phoenixPatrolCheckpoint: null,
    encounterRoutines: {}, encounterAutoDeathLimits: {}, encounterAutoDeaths: {}, encounterAutoDeathsAt: {} };
}

/** Stable views share observations/IDs, but have independent controller storage. No global-state swapping. */
export function createFarmingScopes<T extends State>(root: T, now: () => number = Date.now) {
  const legacy = Object.fromEntries(fields.filter(key => Reflect.get(root, key) !== undefined).map(key => [key, Reflect.get(root, key)]));
  const orphan = { ...defaults(), ...legacy };
  const views = new Map<string, T>();
  const existing = Object.keys(root.farmingProfiles);
  for (const name of existing) {
    const saved = root.farmingProfiles[name]!;
    root.farmingProfiles[name] = { ...defaults(), ...saved,
      activeConvoy: initialCommandState(saved, now).activeConvoy, groupedCombat: null };
  }
  function profile(name: string): Record<string, unknown> {
    return root.farmingProfiles[name] ||= { ...defaults(),
      monsterFocus: [...(root.monsterFocusByCharacter?.[name] || [])],
      location: root.characterLocations?.[name] || null };
  }
  if (root.leader && !existing.includes(root.leader)) root.farmingProfiles[root.leader] = orphan;
  function main() { return root.leader ? profile(root.leader) : orphan; }
  for (const key of fields) Object.defineProperty(root, key, {
    enumerable: true, configurable: true,
    get: () => main()[key], set: value => { main()[key] = value; },
  });
  function owner(name: string): string {
    return root.leader && name !== root.merchantCharacter && root.followers[name] ? root.leader : name;
  }
  function members(name: string): string[] {
    return name === root.leader
      ? [name, ...Object.keys(root.followers).filter(n => n !== name && n !== root.merchantCharacter && root.followers[n])]
      : [name];
  }
  function soloField(name: string, key: string | symbol, anniversary: Record<string, unknown>): unknown {
    if (key === "anniversary") return anniversary;
    if (key === "escape") return root.escape?.participants.includes(name) ? root.escape : null;
    if (key === "townCycle") return root.townCycle?.pending.includes(name) ? root.townCycle : null;
    return Reflect.get(root, key);
  }
  function view(name: string): T {
    if (views.has(name)) return views.get(name)!;
    profile(name);
    const anniversary = Object.create(root.anniversary || {}) as Record<string, unknown>;
    Object.defineProperty(anniversary, "eventCycle", {
      get: () => root.anniversary?.eventCycle?.participants?.includes(name) ? root.anniversary.eventCycle : null,
    });
    const state = new Proxy(root, {
      get(target, key) {
        if (key === "leader") return name;
        if (key === "followers") return name === root.leader ? root.followers : {};
        if (typeof key === "string" && scopedFields.has(key)) return profile(name)[key];
        return name === root.leader ? Reflect.get(target, key) : soloField(name, key, anniversary);
      },
      set(target, key, value) {
        if (typeof key === "string" && scopedFields.has(key)) { profile(name)[key] = value; return true; }
        return Reflect.set(target, key, value);
      },
    });
    views.set(name, state);
    return state;
  }
  return { owner, members, profile, view, effective: (name: string) => view(owner(name)) };
}
