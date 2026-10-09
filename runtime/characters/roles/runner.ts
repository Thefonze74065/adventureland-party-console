import {passiveStopRequired} from '../../combat/passive-travel.ts';
import {installCombatTrace} from "../../combat/trace.ts";
import {createEntityRefresh} from "../../combat/entity-refresh.ts";
import { installPorcupineEquipment } from "./porcupine-equipment-runtime.ts";
import { installKillLuckSwap } from "./kill-luck-swap-runtime.ts";
import { merchantAnniversaryControl } from "../../coordinator/merchant/anniversary-control.ts";
import { createAttackController } from "./attack-controller.ts";
import { installSkillRuntime } from '../skills/runtime.ts';
import {installQueueClient} from '../../combat/client.ts';
import {installQueueMarkers} from '../../combat/markers.ts';
import {installLootClient} from '../../combat/departure-loot.ts';
import { createDeathRecovery } from "./death-recovery.ts";
import { defaultRole } from "./default.ts";
import { targetRejection, eligibleSelection } from "./target-state.ts";
import { errorReason, type Role, type CombatRoot, type Target } from "./types.ts";

export function installRoleRunner(
  classRole: Partial<Role>,
  root = globalThis as unknown as CombatRoot,
) {
  (root as any).partyPassiveStopRequired = passiveStopRequired;
  (root as any).partyMerchantAnniversaryControl = merchantAnniversaryControl;
  root.partyRoleRunner?.stop();
  let equipment: ReturnType<typeof installPorcupineEquipment> | null = null;
  let luckSwap: ReturnType<typeof installKillLuckSwap> | null = null;
  function resolvedRole(): Role {
    return { ...defaultRole, ...classRole };
  }
  let timer: ReturnType<typeof setInterval> | null = null,
    respawnTimer: ReturnType<typeof setInterval> | null = null,
    movementTimer: ReturnType<typeof setInterval> | null = null,
    targetTimer: ReturnType<typeof setInterval> | null = null;
  let lootTimer: ReturnType<typeof setInterval> | undefined;
  let looting = false;
  let working = false,
    selecting = false,
    active = true,
    generation = 0;
  let selectedTarget: string | null = null;
  let invalidated = true, missingSince = 0;
  const entityRefresh = createEntityRefresh({
    now: () => Date.now(),
    request: () => {
      const host = parent as unknown as { socket?: { connected: boolean; emit(event: string, data: object): void } };
      if (!host.socket?.connected) return false;
      host.socket.emit('send_updates', {});
      return true;
    },
    report: diagnostic => { root.partyCombatState.entityRefresh = diagnostic; },
  });
  const queueClient=typeof sharedRoutine!=='undefined' && (sharedRoutine as any).queueReport ? installQueueClient(root,sharedRoutine) : null;
  const queueMarkers=typeof sharedRoutine!=='undefined' && (sharedRoutine as any).queueMarkers ? installQueueMarkers(root,sharedRoutine) : null;
  const trace=typeof sharedRoutine!=='undefined' && (sharedRoutine as any).combatTraceSnapshot?installCombatTrace(root,sharedRoutine):null;
  const lootClient=typeof sharedRoutine!=='undefined' ? installLootClient(root,sharedRoutine) : null;
  const killed = new Map<string, number>();
  let skills: ReturnType<typeof installSkillRuntime> | null = null;
  const attacks = createAttackController({
    target: attackTarget, selected: () => attackTarget()?.id || null, epoch: () => generation,
    active: () => active, allowed: () => combatAllowed() || !!passingTarget(),
    passing: target => target.id !== currentTarget()?.id && target.id === passingTarget()?.id,
    preparePassing: target => queueClient?.preparePassing(target) ?? false, state: () => root.partyCombatState,
    equipmentBusy: () => !!equipment?.busy() || !!luckSwap?.busy(),
    skillAttack: target => skills?.attack(target) ?? null,
    skillBusy: () => skills?.busy() ?? false,
    report: reportError,
  });
  const recoverFromDeath = createDeathRecovery({
    isDead: () => !!character.rip,
    blocked: () => !!sharedRoutine.dungeonOwned?.() || !!sharedRoutine.escapeOwnsRevival?.(),
    respawn: () => sharedRoutine.dungeonOwned?.() || sharedRoutine.escapeOwnsRevival?.()
      ? Promise.reject(Error('Recovery owns revival')) : Promise.resolve(respawn()),
    releaseCombat: () => {
      working = false;
    },
    publish: (state) => {
      Object.assign(root.partyCombatState, state);
    },
    rejoinEvent: async () =>
      typeof sharedRoutine.rejoinActiveEventAfterRespawn === "function"
        ? await sharedRoutine.rejoinActiveEventAfterRespawn() : { status: "not-applicable" },
    rejoinFarm: () => sharedRoutine.beginFarmReunion?.(),
    log: (message) => game_log(message, "red"),
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (timer) => globalThis.clearTimeout(timer),
  });
  function combatAllowed() {
    return (
      active &&
      !character.rip &&
      resolvedRole().combat &&
      (character.ctype !== "merchant" || !!sharedRoutine.merchantEventCombatActive?.()) &&
      !sharedRoutine.isOccupied() &&
      ["pending", "feed"].indexOf(sharedRoutine.getAbtestingMode()) < 0
    );
  }
  function passingTarget(): Target | null {
    if (sharedRoutine.dungeonOwned?.()) return null;
    if (character.ctype === "merchant" || !active || character.rip || !resolvedRole().combat || ["pending","feed"].includes(sharedRoutine.getAbtestingMode())) return null;
    // Boss attendance permits only the boss; passing attacks would pull adds or the map.
    if (sharedRoutine.bossCombatActive?.()) return null;
    return (sharedRoutine as any).getPassingTarget?.() || null;
  }
  function attackTarget(): Target | null {
    const current = currentTarget(), passing = passingTarget();
    if (!current) return passing;
    if (!passing) return current;
    const priority = sharedRoutine.monsterPriority;
    return priority && priority(passing) > priority(current) ? passing : current;
  }
  function currentTarget() {
    if(sharedRoutine.returnCombatActive?.())return combatAllowed() ? sharedRoutine.returnDefenseTarget?.() || null : null;
    let reason: string | null = null;
    const target = selectedTarget ? get_entity(selectedTarget) : null;
    if (!combatAllowed()) reason = "combat paused by movement or activity owner";
    else if (!selectedTarget) reason = "no selected target";
    else reason = killed.has(selectedTarget) ? "confirmed dead" : targetRejection(target);
    if (root.partyCombatState) {
      root.partyCombatState.targetRejection = reason;
      root.partyCombatState.selectedTarget = selectedTarget || null;
    }
    return reason ? null : target || null;
  }
  function reportError(error: unknown) {
    const reason = errorReason(error);
    if (reason !== "cooldown") {
      root.partyCombatState.error = String(reason);
      root.partyCombatState.errorAt = Date.now();
    }
  }
  function currentEpoch(epoch: number): boolean { return active && epoch === generation; }
  function supportAllowed(epoch: number): boolean {
    return currentEpoch(epoch) && !character.rip && !sharedRoutine.isOccupied();
  }
  function chooseTarget() {
    if (sharedRoutine.dungeonOwned?.()) return sharedRoutine.getDungeonTarget?.() || null;
    if(sharedRoutine.returnCombatActive?.())return sharedRoutine.returnDefenseTarget?.() || null;
    if (sharedRoutine.bossCombatActive?.()) return sharedRoutine.getEventTarget();
    if (character.ctype === "merchant") return resolvedRole().chooseTarget();
    if (sharedRoutine.usesLeaderTarget?.()) return sharedRoutine.getGroupedTarget();
    const rare = sharedRoutine.getRareTarget?.();
    if (rare) return rare;
    return resolvedRole().chooseTarget();
  }
  function exclusiveCombat(): boolean {
    return !!sharedRoutine.dungeonOwned?.() || !!sharedRoutine.returnCombatActive?.() || !!sharedRoutine.bossCombatActive?.();
  }
  async function publishSelection(target: Target | null): Promise<void> {
    selectedTarget = target?.id || (!exclusiveCombat() && sharedRoutine.sharedTargetId?.()) || null;
    sharedRoutine.setCombatTarget(target);
    if (!target && !exclusiveCombat() && sharedRoutine.getFarmingMode() !== "scatter" && !sharedRoutine.usesGroupedCombat?.())
      await sharedRoutine.followLeaderIfFar(150);
  }
  async function selectTarget() {
    if (selecting || !active) return;
    if (!combatAllowed()) {
      selectedTarget = null;
      sharedRoutine.setCombatTarget(null);
      if (sharedRoutine.clearCombatSelection) sharedRoutine.clearCombatSelection();
      return;
    }
    const current = currentTarget();
    const closer = !exclusiveCombat() && current && !attacks.hasStarted(current.id) && sharedRoutine.getCloserHuntTarget?.(current);
    if (closer) {
      root.sharedRoutine?.resetCombatMovement?.();
      await publishSelection(closer);
      attacks.wake();
      return;
    }
    if (!sharedRoutine.returnCombatActive?.() && !invalidated && current) {
      const rare = sharedRoutine.dungeonOwned?.() ? null : sharedRoutine.getRareTarget?.();
      const nominated = sharedRoutine.dungeonOwned?.() ? sharedRoutine.getDungeonTarget?.() : sharedRoutine.usesLeaderTarget?.() ? sharedRoutine.getGroupedTarget() : null;
      if ((!rare || rare.id === selectedTarget) && (!(sharedRoutine.dungeonOwned?.() || sharedRoutine.usesLeaderTarget?.()) || nominated?.id === selectedTarget)) return;
    }
    invalidated = false;
    selecting = true;
    const epoch = generation;
    try {
      const selected = chooseTarget();
      if (!currentEpoch(epoch) || !combatAllowed()) return;
      const target = selected && !killed.has(selected.id) ? eligibleSelection(selected) : null;
      await publishSelection(target);
      attacks.wake();
    } catch (error) {
      reportError(error);
    } finally {
      if (epoch === generation) { selecting = false; if (invalidated && active) void selectTarget(); }
    }
  }
  function idleMovement(): void {
    if (combatAllowed() && sharedRoutine.defensiveFormationMove?.()) return;
    root.sharedRoutine?.resetCombatMovement?.();
  }
  function equipmentTick() {
    const actor = character as typeof character & { damage_type?: string };
    const target = sharedRoutine.equipmentTarget ? sharedRoutine.equipmentTarget() : currentTarget();
    equipment?.tick(target, actor.damage_type, Number(character.range), combatAllowed());
    luckSwap?.tick(combatAllowed() ? currentTarget() : null);
  }
  function bossMovement(): boolean {
    if (!sharedRoutine.bossCombatActive?.()) return false;
    if (selectedTarget && !currentTarget()) { invalidated = true; void selectTarget(); }
    if (combatAllowed()) sharedRoutine.bossMovementTick?.(currentTarget());
    attacks.wake();
    return true;
  }
  function movementTick() {
    const dungeon = !!sharedRoutine.dungeonOwned?.();
    if (dungeon && !combatAllowed()) { root.sharedRoutine?.resetCombatMovement?.(); return; }
    try {
      equipmentTick();
      if (!dungeon) {
        if(sharedRoutine.returnCombatActive?.()) {
          sharedRoutine.returnMovementTick?.();
          attacks.wake();
          return;
        }
        if (bossMovement()) return;
        if (sharedRoutine.pollRareHunting?.()) return;
        if (sharedRoutine.pollFarmingCombatHandoff) sharedRoutine.pollFarmingCombatHandoff();
        if (sharedRoutine.pollFarmingSpawnRecovery) sharedRoutine.pollFarmingSpawnRecovery();
      }
      if (selectedTarget && !currentTarget()) { invalidated = true; void selectTarget(); }
      const target = currentTarget();
      entityRefresh.tick({ enabled: combatAllowed(), context: JSON.stringify([character.map, character.in]),
        target: selectedTarget, accepted: root.partyCombatState.attackTiming?.accepted || 0 });
      if (target) missingSince = 0;
      else if (!missingSince) missingSince = Date.now();
      attacks.wake();
      if (!dungeon && sharedRoutine.groupedMovement?.()) return;
      if (!dungeon && (target || Date.now() - missingSince >= 750) && sharedRoutine.recoverFarmApproach && sharedRoutine.recoverFarmApproach(target)) return;
      if (dungeon && sharedRoutine.caveRecoveryMove?.()) return;
      if (!target) {
        if (dungeon) root.sharedRoutine?.resetCombatMovement?.();
        else idleMovement();
        return;
      }
      if (sharedRoutine.formationMove && sharedRoutine.formationMove(target)) return;
      // These helpers emit collision-checked moves without awaiting arrival.
      // Combat attacks and support continue while the destination is updated.
      Promise.resolve(sharedRoutine.kiteIfNeeded(target))
        .then(function (kiting) {
          if (!kiting && currentTarget() === target)
            return sharedRoutine.approachCombatTarget(target);
        })
        .catch(reportError);
    } catch (error) {
      reportError(error);
    }
  }
  async function supportTick(role: Role, epoch: number): Promise<void> {
    if (!supportAllowed(epoch)) return;
    if (!(await role.usePotion())) await sharedRoutine.regenerateHpOrMp();
    if (!supportAllowed(epoch)) return;
    if (await role.beforeTarget()) return;
    if (!supportAllowed(epoch)) return;
    if (sharedRoutine.caveRecoveryReserved?.() && attacks.pending()) return;
    if (await sharedRoutine.caveRecoveryTick?.()) return;
    if (sharedRoutine.caveRecoveryReserved?.()) return;
    if (!supportAllowed(epoch)) return;
    const target = currentTarget();
    if (target && (!sharedRoutine.groupedAttackAllowed || sharedRoutine.groupedAttackAllowed(target)) &&
        (target.mtype !== "tinyp" || sharedRoutine.rareAttackAllowed?.(target, "support")))
      await role.beforeAttack(target);
  }
  async function lootTick(): Promise<void> {
    if (looting || !active || character.rip || ["pending", "feed"].includes(sharedRoutine.getAbtestingMode())) return;
    looting = true;
    try {
      // Nearby chest collection must keep running while movement owns the character.
      // smartLoot only opens reachable chests; it never changes the destination.
      await sharedRoutine.smartLoot();
    } catch (error) {
      reportError(error);
    } finally {
      looting = false;
    }
  }
  async function tick() {
    if (working || !active) return;
    working = true;
    const epoch = generation;
    try {
      const role = resolvedRole();
      if (character.rip || sharedRoutine.isOccupied()) return;
      const mode = sharedRoutine.getAbtestingMode();
      if (mode === "pending") return;
      if (mode === "feed") {
        await sharedRoutine.runAbtestingSabotage();
        return;
      }
      await supportTick(role, epoch);
    } catch (error) {
      reportError(error);
    } finally {
      if (epoch === generation) working = false;
    }
  }
  return (root.partyRoleRunner = {
    isKnownDead(id: string) { return killed.has(id); },
    invalidateTarget(id?: string) {
      if (id) killed.set(id, Date.now());
      if (!id || id === selectedTarget) {
        invalidated = true;
        void selectTarget();
      }
      attacks.wake();
    },
    wake() { void selectTarget(); attacks.wake(); },
    advanceTarget() {generation++;selectedTarget=null;invalidated=true;selecting=false;working=false;},
    resetTargeting() {generation++;selectedTarget=null;invalidated=true;selecting=false;working=false;attacks.reset();skills?.reset();queueClient?.reset();},
    role: function () {
      return resolvedRole();
    },
    start: function () {
      if (!root.sharedRoutine || typeof root.sharedRoutine.isOccupied !== "function")
        throw new Error("Shared party code is not ready; refusing to start combat timers");
      if (timer) return;
      skills = installSkillRuntime(root);
      equipment = installPorcupineEquipment(root);
      luckSwap = installKillLuckSwap(root, {
        lethalBasicAttack: target => skills?.lethalBasicAttack(target) ?? false,
        endangeredSelf: () => skills?.endangeredSelf() ?? false,
      }, equipment);
      game_log(character.name + " loaded generic " + resolvedRole().name + " behavior", "#51D2E1");
      active = true;
      root.partyCombatState = { at: Date.now(), stage: "start", error: null };
      timer = setInterval(tick, 250);
      lootTimer = setInterval(() => { void lootTick(); }, 250);
      targetTimer = setInterval(() => {
        for (const [id, at] of killed) if (Date.now() - at > 10000) killed.delete(id);
        void selectTarget();
      }, 1000);
      attacks.start();
      movementTimer = setInterval(movementTick, 100);
      void selectTarget();
      respawnTimer = setInterval(function () {
        if (character.rip) {
          generation += 1;
          selectedTarget = null;
          attacks.reset();
          skills?.reset();
          working = false;
          selecting = false;
        }
        void recoverFromDeath();
      }, 250);
      void recoverFromDeath();
    },
    stop: function () {
      skills?.stop();
      equipment?.stop();
      queueClient?.stop();queueMarkers?.stop();
      lootClient?.stop();trace?.stop();
      active = false;
      generation += 1;
      selectedTarget = null;
      attacks.reset();
      attacks.stop();
      if (movementTimer) clearInterval(movementTimer);
      if (targetTimer) clearInterval(targetTimer);
      if (root.sharedRoutine && root.sharedRoutine.resetCombatMovement)
        root.sharedRoutine.resetCombatMovement();
      if (timer) clearInterval(timer);
      clearInterval(lootTimer);
      lootTimer = undefined;
      if (respawnTimer) clearInterval(respawnTimer);
      timer = null;
      respawnTimer = null;
      working = false;
    },
  });
}
