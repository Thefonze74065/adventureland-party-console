import type { MerchantCommand, ServiceStatus } from "./work.ts";
import { gatheringCastActive } from "./gathering.ts";
import type { MerchantAnniversaryControl } from "./anniversary-control.ts";
import { legacyStandLocation, type MerchantStandLocation } from './stand-location.ts';

interface IdleStatus extends ServiceStatus {
  gatheringActive?: boolean;
  gatheringCooldowns?: Record<string, number>;
  banking?: boolean;
  standOpen?: boolean;
  lastCommandId?: number;
  navigationState?: string;
  moving?: boolean;
  smartNavigation?: { moving?: boolean; searching?: boolean } | null;
}
interface StandListing {
  state?: string;
  tradeSlot?: string;
  [field: string]: unknown;
}
interface IdlePorts {
  standLocation?(): MerchantStandLocation | null;
  eventReserved?(): boolean;
  storagePending(): boolean;
  merchant(): string | null;
  status(name: string | null): IdleStatus | undefined;
  anniversary(): MerchantAnniversaryControl;
  currentJob(): boolean;
  ensureHome(reason: string): boolean;
  forcedStand(): boolean;
  readyQueuedWork(): boolean;
  modes(): string[];
  cooldown(mode: string): number | undefined;
  now(): number;
  listings(): StandListing[];
  inventoryMerge(status: IdleStatus): unknown;
  command(name: string | null): MerchantCommand | undefined;
  issue(name: string, command: MerchantCommand): void;
  nextCommand(): number;
  realm(): string;
}

/** Returns to the stand only when no active work owns merchant movement. */
export function createMerchantIdle(ports: IdlePorts) {
  const travelCommands = new Set(["character-travel", "travel", "force-travel", "return-leader",
    "party-monster-travel", "event-resume-travel"]);
  let manualTravel: { id: number; until: number; observedMoving: boolean } | null = null;

  function navigating(status: IdleStatus): boolean {
    return status.navigationState === "departing" || !!status.moving ||
      !!status.smartNavigation?.moving || !!status.smartNavigation?.searching;
  }

  function manualTravelPending(): boolean {
    const command = ports.command(ports.merchant());
    if (!command || !travelCommands.has(command.type)) return false;
    if (manualTravel?.id !== command.id)
      manualTravel = { id: command.id, until: ports.now() + 10_000, observedMoving: false };
    return true;
  }

  function navigationOwnsMovement(status: IdleStatus | undefined): boolean {
    // A heartbeat can consume a one-shot command before its next report shows
    // movement. Other party heartbeats must not replace it with stand return.
    if (manualTravelPending()) return true;
    if (!status || status.seenAt < ports.now() - 10_000) return false;
    if (navigating(status)) {
      if (manualTravel && status.lastCommandId === manualTravel.id) manualTravel.observedMoving = true;
      return true;
    }
    return admissionPending(status);
  }

  function admissionPending(status: IdleStatus): boolean {
    if (!manualTravel) return false;
    const superseded = (status.lastCommandId || 0) > manualTravel.id;
    if (!superseded && !manualTravel.observedMoving && ports.now() < manualTravel.until) return true;
    manualTravel = null;
    return false;
  }

  function gatheringReady(status: IdleStatus | undefined): boolean {
    return ports
      .modes()
      .some(
        (mode) =>
          Math.max(
            Number(ports.cooldown(mode)) || 0,
            Number(status?.gatheringCooldowns?.[mode]) || 0,
          ) <= ports.now(),
      );
  }

  function workOwnsMovement(
    anniversary: MerchantAnniversaryControl,
    status: IdleStatus | undefined,
  ): boolean {
    if (finishingCast(status, anniversary)) return true;
    if ([ports.currentJob(), anniversary.busy, anniversary.kissDue].some(Boolean)) return true;
    if (anniversary.reserved || anniversary.featured || ports.forcedStand()) return false;
    return ports.readyQueuedWork() || !!status?.gatheringActive || gatheringReady(status);
  }

  function atMarket(status: IdleStatus): boolean {
    const location = ports.standLocation?.() || legacyStandLocation;
    return (
      status.map === location.map &&
      Math.hypot((Number(status.x) || 0) - location.x, (Number(status.y) || 0) - location.y) <= 35
    );
  }

  function needsCommand(status: IdleStatus, merge: unknown): boolean {
    const sync = ports.listings().some((listing) => listing.state !== "live" || !listing.tradeSlot);
    if (status.standOpen && atMarket(status) && !sync && !merge) return false;
    const current = ports.command(ports.merchant());
    return (
      current?.type !== "merchant-idle" ||
      (ports.standLocation && JSON.stringify(current.standLocation) !== JSON.stringify(ports.standLocation())) ||
      JSON.stringify(current.listings) !== JSON.stringify(ports.listings())
    );
  }

  function homeReady(merchant: string | null, status: IdleStatus | undefined): boolean {
    return (
      !merchant ||
      !status ||
      ports.currentJob() ||
      ports.ensureHome("stand or anniversary attendance")
    );
  }

  function available(status: IdleStatus | undefined): status is IdleStatus {
    return !!status && !status.banking && !(status.seenAt < ports.now() - 10_000);
  }

  function inventoryMerge(status: IdleStatus, anniversary: MerchantAnniversaryControl): unknown {
    return !anniversary.reserved && !anniversary.featured ? ports.inventoryMerge(status) : null;
  }

  function finishingCast(status: IdleStatus | undefined, anniversary: MerchantAnniversaryControl): boolean {
    return gatheringCastActive(status, ports.now()) && !anniversary.busy && !anniversary.kissDue &&
      !anniversary.reserved && !ports.forcedStand();
  }

  function reserved(): boolean {
    return !!ports.eventReserved?.() || ports.storagePending() ||
      navigationOwnsMovement(ports.status(ports.merchant()));
  }
  function locationCommand() {
    return ports.standLocation ? {standLocation:ports.standLocation()} : {};
  }
  function idle(): void {
    if (reserved()) return;
    const merchant = ports.merchant(),
      status = ports.status(merchant);
    if (["equip", "unequip", "use-item"].includes(ports.command(merchant)?.type || "")) return;
    const anniversary = ports.anniversary();
    if (!merchant || workOwnsMovement(anniversary, status)) return;
    if (!homeReady(merchant, status)) return;
    if (!available(status)) return;
    const merge = inventoryMerge(status, anniversary);
    if (!needsCommand(status, merge)) return;
    ports.issue(merchant, {
      id: ports.nextCommand(),
      type: "merchant-idle",
      ...locationCommand(),
      listings: ports.listings(),
      homeRealm: ports.realm(),
      inventoryMerge: merge,
    });
  }

  return { idle };
}
