import type { Entity } from "typed-adventureland";
import type { RangeDiagnostic, RangeSample } from "./crab-range.ts";
export type Target = Entity;
type TargetGetter = () => Target | null;
export interface Role {
  name: string;
  combat: boolean;
  chooseTarget: TargetGetter;
  beforeTarget(): Promise<boolean>;
  beforeAttack(target: Target): Promise<boolean>;
  usePotion(): Promise<boolean>;
}
export interface SharedCombat {
  dungeonOwned?(): boolean;
  caveRecoveryReserved?(): boolean;
  caveRecoveryTick?(): Promise<boolean>;
  caveRecoveryMove?(): boolean;
  getDungeonTarget?: TargetGetter;
  noteCombatHandoff?(stage: string, target: string, details: Record<string, unknown>): void;
  merchantEventCombatActive?(): boolean;
  combatContext?(): import('../skills/types.ts').CombatContext;
  merchantVisibilityActive?(): boolean;
  skillTargetAllowed?(target: Target, skill?: import('../skills/types.ts').SkillId): boolean;
  skillSupport?(): Promise<boolean>;
  /** Who holds aggro now: the designated tank, or the off tank during a handoff. */
  aggroTank?(): string | null;
  skillOffense?(target: Target): Promise<boolean>;
  absorbLeaderAggro?(): Promise<boolean>;
  fanOfKnivesFarming?(): boolean;
  fanOfKnivesVerdict?(): import("./fan-farm-gear.ts").FanVerdict;
  fanOfKnivesStand?(target: Target): { x: number; y: number } | null;
  combatSkillReady?(id: import('../skills/types.ts').SkillId, target: Target, category: import('../skills/types.ts').Spending): boolean;
  castCombatSkill?(id: import('../skills/types.ts').SkillId, target: Target, category: import('../skills/types.ts').Spending): Promise<boolean>;
  isLeader?(): boolean;
  hasDesignatedTank?(): boolean;
  isTank?(): boolean;
  queueEvidence?(target: Target, state: 'pending' | 'engaged' | 'rejected', action?: string): string | null;
  equipmentTarget?(): { id: string; mtype?: string } | null;
  getRareTarget?: TargetGetter;
  getPriorityEventTarget?: TargetGetter;
  rareAttackAllowed?(target: Target, skill: string): boolean;
  pollRareHunting?(): boolean;
  describeAttackRange?(target: Target): RangeSample | null;
  correctedCombatDistance?(target: Target): number | null;
  start(): void;
  stop(): void;
  getScatterBreakTarget: TargetGetter;
  getEngagedTarget: TargetGetter;
  getEventTarget: TargetGetter;
  escapeOwnsRevival?(): boolean;
  sharedTargetId?(): string | null;
  frankyCombatActive?(): boolean;
  frankyMovementTick?(target: Target | null): boolean;
  /** Boss-only attendance (Franky): no passing attacks, adds or area skills. */
  bossCombatActive?(): boolean;
  bossTargetAllowed?(target: Target): boolean;
  bossMovementTick?(target: Target | null): boolean;
  getScatterTarget: TargetGetter;
  getLeaderTarget: TargetGetter;
  getPreferredTarget: TargetGetter;
  getNearestPartyAttacker: TargetGetter;
  getNearestPartyTarget: TargetGetter;
  getGroupedTarget: TargetGetter;
  hasScatterBreakTarget(): boolean;
  getFarmingMode(): string;
  shouldFollowLeader(): boolean;
  energizeLowestMana(ratio: number): Promise<boolean>;
  useRecoveryPotion(options: {
    hpBelow?: number;
    mpBelow?: number;
    priority?: "hp" | "mp";
    force?: "hp" | "mp";
  }): Promise<boolean>;
  absorbSinsBelow(ratio: number): Promise<boolean>;
  healPartyBelow(ratio: number): Promise<boolean>;
  frankySpamPartyHeal?(): Promise<boolean>;
  isPartyHealthy(ratio: number): boolean;
  monsterPriority?(this: void, target: Target): number;
  isCurrentPartyTarget(target: Target): boolean;
  allowsTarget(target: Target): boolean;
  allowsPassingTarget(target: Target): boolean;
  emergencyWarriorStomp(): Promise<boolean>;
  graveyardAreaAttackAllowed?(range: number): boolean;
  dashToward(target: Target): Promise<boolean>;
  isAttackingPartyMember(target: Target): boolean;
  rejoinActiveEventAfterRespawn(): Promise<import("./death-recovery.ts").EventRejoinOutcome>;
  eventRejoinRequired?(): boolean;
  beginFarmReunion(): unknown;
  isOccupied(): boolean;
  getConsoleDrainTarget?(): Target | null;
  getAbtestingMode(): string;
  targetRejectionReason(target: Target): string | null;
  setCombatTarget(target: Target | null): void;
  clearCombatSelection(): void;
  usesLeaderTarget(): boolean;
  usesGroupedCombat?(): boolean;
  getCloserHuntTarget?(current: Target): Target | null;
  returnCombatActive?(): boolean;
  getWalkingPassiveTarget?(): Target | null;
  getPassingTarget?(): Target | null;
  returnDefenseTarget?(): Target | null;
  returnAttacker?(target: Target): boolean;
  returnMovementTick?(): void;
  groupedMovement?(): boolean;
  independentPullActive?(target: Target): boolean;
  groupedAttackAllowed?(target: Target): boolean;
  followLeaderIfFar(distance: number): Promise<unknown>;
  basicAttackReserved(): boolean;
  combatTargetRevision(): string | null;
  noteAttack(target: Target): void;
  pollFarmingCombatHandoff(): void;
  pollFarmingSpawnRecovery(): void;
  recoverFarmApproach(target: Target | null): boolean;
  defensiveFormationMove(): boolean;
  resetCombatMovement(): void;
  formationMove(target: Target): boolean;
  kiteIfNeeded(target: Target): Promise<boolean>;
  approachCombatTarget(target: Target): Promise<unknown>;
  runAbtestingSabotage(): Promise<unknown>;
  regenerateHpOrMp(): Promise<unknown>;
  smartLoot(): Promise<unknown>;
}
export interface CombatState {
  skill?: import('../skills/types.ts').SkillDiagnostic;
  entityRefresh?: import('../../combat/entity-refresh.ts').EntityRefreshDiagnostic;
  recovery?: { phase: string; attempt: number; lastError: string | null; errorAt: number | null; status: string; at: number; recoveredAt: number | null };
  attackTiming?: { bursts: number; attempts: number; accepted: number; cooldownRejections: number; timeouts: number; lastOffsets: number[] };
  rangeRecovery?: RangeDiagnostic | null;
  at: number;
  stage: string;
  error: string | null;
  errorAt?: number;
  lastHealAt?: number;
  lastHealTarget?: string;
  targetRejection?: string | null;
  selectedTarget?: string | null;
  skippedAttack?: string | null;
}
export interface RoleRunner {
  hasStartedTarget(id:string):boolean;
  engagedTargetId():string|null;
  advanceTarget(): void;
  resetTargeting():void;
  isKnownDead(id: string): boolean;
  invalidateTarget(id?: string): void;
  wake(): void;
  role(): Role;
  start(): void;
  stop(): void;
}
export interface CombatRoot {
  __partyConsoleMaintenance?: {id: string; expires: number; mode?: 'draining'} | null;
  partyPorcupineEquipment?: ReturnType<typeof import("./porcupine-equipment.ts").createPorcupineEquipment>;
  partyKillLuckSwap?: ReturnType<typeof import("./kill-luck-swap.ts").createKillLuckSwap>;
  /** Saved gear sets per character, from the coordinator status response. */
  partyGearSets?: Record<string, Partial<Record<"luck" | "tank" | "gold" | "fan", { slots: Record<string, unknown> }>> | undefined>;
  partyFanFarmGear?: ReturnType<typeof import("./fan-farm-gear.ts").createFanFarmGear>;
  /** Pull-mode choices for characters/shared.js (runtime/combat/pulling.ts). */
  partyPulling?: typeof import("../../combat/pulling.ts");
  sharedRoutine: SharedCombat;
  partyRoleRunner?: RoleRunner;
  partyCombatState: CombatState;
}
declare global {
  var sharedRoutine: SharedCombat;
}
export function errorReason(error: unknown): string {
  if (error && typeof error === "object") {
    if ("reason" in error && typeof error.reason === "string") return error.reason;
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  return String(error);
}
