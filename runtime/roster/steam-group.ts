import { RosterConflict, type Handoff, type HandoffPorts, type RosterOwnership } from "./handoff.ts";

export type SteamAction = "primary" | "login" | "headless" | "logout";
const RELEASE_TIMEOUT = "Steam operation timed out; assignments remain reserved until recovery";
/** One operation owns the entire affected set until releases and CODE arrivals agree. */
export class SteamGroup {
  private advancing = false;
  readonly state: RosterOwnership;
  private ports: HandoffPorts;
  constructor(state: RosterOwnership, ports: HandoffPorts) {
    this.state = state; this.ports = ports;
    state.steam ??= state.native ? [state.native] : [];
  }
  async allHeadless() {
    if (this.state.handoff && (this.state.handoff.phase !== "complete" || this.state.handoff.bulkRemaining?.length))
      throw new RosterConflict("Resolve the pending Steam operation first");
    const names = [...(this.state.steam || [])].sort((a, b) => Number(a === this.state.native) - Number(b === this.state.native));
    if (!names.length) throw new RosterConflict("No Steam characters to move");
    if (this.state.slots.filter(name => !name).length < names.length) throw new RosterConflict("Not enough headless slots");
    this.ports.validateParticipants([...names, ...this.state.slots.filter((name): name is string => !!name)]);
    return this.begin("headless", names[0], names.slice(1));
  }
  private phase(value: Handoff["phase"], error: string | null = null) {
    const op = this.state.handoff!;
    op.phase = value; op.phaseAt = this.ports.now(); op.error = error; this.ports.save();
    return op;
  }
  async begin(action: SteamAction, name: string, bulkRemaining?: string[]): Promise<Handoff> {
    if (bulkRemaining === undefined && this.state.handoff?.bulkRemaining?.length)
      throw new RosterConflict("Wait for the bulk Steam handoff to finish");
    if (this.state.handoff && this.state.handoff.phase !== "complete") throw new RosterConflict("Resolve the pending Steam operation first");
    if (!this.ports.bridgeReady()) throw new RosterConflict("Run the Steam bridge before changing session ownership");
    if (!this.ports.owned(name)) throw new RosterConflict("Unknown character");
    const before = [...this.state.steam!], from = this.state.native;
    const targetSlot = this.state.slots.indexOf(name);
    const entering = action === "primary" || action === "login";
    if (action === "login" && (before.includes(name) || targetSlot >= 0)) throw new RosterConflict("Character is already assigned");
    if (action === "headless" && !before.includes(name)) throw new RosterConflict("Character is not in Steam");
    if (action === "logout" && !before.includes(name) && targetSlot < 0) throw new RosterConflict("Character is not assigned");
    const desired = entering ? Array.from(new Set([...before, name])) : before.filter(n => n !== name);
    const primary = action === "primary" ? name : from === name && !entering ? desired[0] || null : from || desired[0] || null;
    const participants = Array.from(new Set([...desired, ...this.state.slots.filter((n): n is string => !!n && (n !== name || action !== "logout")), ...(action === "headless" ? [name] : [])]));
    if (participants.length > 4) throw new RosterConflict("maximum characters logged in");
    const context = this.ports.realmContext?.();
    const addsCharacter = entering && (!!from && (name !== from || desired.length > 1));
    const awaitingChoice = addsCharacter && context && (!context.current || !context.home || context.current !== context.home);
    // Restoring the existing Steam group does not touch headless sessions.
    // Capacity was checked above; their inventory work must not block reconnects.
    const restoring = action === "primary" && name === from;
    if (!awaitingChoice) this.ports.validateParticipants(restoring ? before : participants);
    const returnSlot = action === "headless" ? this.state.slots.indexOf(null) : -1;
    if (action === "headless" && returnSlot < 0) throw new RosterConflict("No headless slot is available");
    const release = primary !== from ? before : action === "primary" && name === from ? before.filter(n => n !== from) : before.includes(name) && !entering ? [name] : [];
    const op: Handoff = { bulkRemaining, id: this.ports.id(), steamSessionId: this.ports.steamSessionId?.(), from, target: primary, returnToHeadless: action === "headless",
      returnSlot: returnSlot < 0 ? null : returnSlot, targetSlot: targetSlot < 0 ? null : targetSlot,
      startedAt: this.ports.now(), phase: "preparing", error: null,
      multi: { action, subject: name, before, desired, primary, release, arrived: [] } };
    this.state.handoff = op; this.ports.save();
    if (awaitingChoice) {
      op.realmChoice = context;
      return this.phase("awaiting-realm-choice");
    }
    op.destinationRealm = context?.current || context?.home || undefined;
    return this.startPrepared(op);
  }
  async chooseRealm(id: string, choice: string): Promise<Handoff | null> {
    const op = this.state.handoff;
    if (!op?.multi || op.id !== id || op.phase !== "awaiting-realm-choice") throw new RosterConflict("Realm choice is no longer pending");
    if (choice === "cancel") { this.state.handoff = null; this.ports.save(); return null; }
    if (!["switch", "stay"].includes(choice)) throw new RosterConflict("Choose Switch or Stay on this realm");
    const context = this.ports.realmContext?.();
    if (!context?.current || !context.home) throw new RosterConflict("Waiting for current and home realm observations");
    if (JSON.stringify(context) !== JSON.stringify(op.realmChoice)) {
      op.realmChoice = context; this.ports.save(); return op;
    }
    op.destinationRealm = choice === "switch" ? context.home : context.current;
    if (choice === "switch") op.multi.release = op.multi.before.slice();
    op.startedAt = this.ports.now();
    this.phase("preparing");
    return this.startPrepared(op);
  }
  async refreshRealmChoice(): Promise<void> {
    const op = this.state.handoff;
    if (op?.phase !== "awaiting-realm-choice") return;
    const context = this.ports.realmContext?.();
    if (JSON.stringify(context) !== JSON.stringify(op.realmChoice)) {
      op.realmChoice = context; this.ports.save();
    }
    if (context?.current && context.current === context.home) {
      op.destinationRealm = context.current;
      op.startedAt = this.ports.now();
      this.phase("preparing");
      await this.startPrepared(op);
    }
  }
  private async startPrepared(op: Handoff): Promise<Handoff> {
    const { action, subject: name } = op.multi!;
    const entering = action === "primary" || action === "login";
    const targetSlot = op.targetSlot ?? -1;
    try {
      if (entering && op.realmChoice) {
        await this.ports.prepareSteam?.(name);
        this.ports.validateParticipants([...new Set([...op.multi!.desired, ...this.state.slots.filter((n): n is string => !!n)])]);
      }
      if (targetSlot >= 0 && (entering || action === "logout")) {
        await this.ports.stopHeadless(name);
      }
      if (this.state.handoff !== op || op.phase !== "preparing") return op;
      op.multi!.stoppedHeadless = true; this.ports.save();
      await this.prepare(); return op;
    } catch (error) { return this.phase("failed", String(error)); }
  }
  async prepare() {
    const op = this.state.handoff;
    if (!op?.multi?.stoppedHeadless || op.phase !== "preparing" || this.advancing) return;
    this.advancing = true;
    try {
      if (!op.multi.before.includes(op.multi.subject) && !await this.ports.confirmOffline(op.multi.subject)) return;
      if (this.state.handoff !== op || op.phase !== "preparing") return;
      op.multi.releaseIssued = true; this.phase("release");
    } catch (error) { this.phase("failed", String(error)); }
    finally { this.advancing = false; }
  }
  private lostHeadlessRelease(op: Handoff) {
    return op.phase === "failed" && (op.error === RELEASE_TIMEOUT ||
      op.error === "Coordinator restarted during handoff; confirm offline ownership before recovery") &&
      op.multi?.action === "headless" && op.multi.releaseIssued && !op.releasedAt;
  }
  async released(id: string, accountPoll = false) {
    const op = this.state.handoff;
    if (!op?.multi || op.id !== id || this.advancing) return;
    const recovering = this.lostHeadlessRelease(op);
    if (!["release", "confirm-release"].includes(op.phase) && !recovering) return;
    this.advancing = true;
    if (!recovering && !accountPoll) this.phase("confirm-release");
    try {
      for (const name of op.multi.release) if (!await this.ports.confirmOffline(name)) return;
      if (this.state.handoff !== op) return;
      if (accountPoll && op.phase === "release") this.phase("confirm-release");
      if (recovering && this.lostHeadlessRelease(op)) this.phase("confirm-release");
      if (op.phase !== "confirm-release") return;
      const { subject, action, desired, primary, release } = op.multi;
      if (op.targetSlot !== null) this.state.slots[op.targetSlot] = null;
      this.state.steam = desired.slice();
      if (release.includes(this.state.native || "")) this.state.native = null;
      op.releasedAt = this.ports.now();
      if (action === "headless" && op.returnSlot !== null) {
        this.state.slots[op.returnSlot] = subject; op.multi.headlessStarted = true;
        this.ports.save(); this.ports.startHeadless(subject, op.returnSlot);
      }
      if (op.bulkRemaining !== undefined && this.ports.headlessReady && !this.ports.headlessReady(subject)) {
        this.phase("headless-starting"); return;
      }
      this.phase(primary ? "navigate" : "complete");
    } catch (error) { this.phase("failed", String(error)); }
    finally { this.advancing = false; }
  }
  observe(primary: string | null, running: string[]) {
    const op = this.state.handoff;
    if (!op?.multi || !op.releasedAt || !["navigate", "failed"].includes(op.phase)) return;
    op.multi.arrived = op.multi.desired.filter(n => running.includes(n) &&
      (!op.destinationRealm || this.ports.observedRealm?.(n, op.releasedAt) === op.destinationRealm));
    if (primary === op.multi.primary && op.multi.desired.every(n => op.multi!.arrived!.includes(n))) {
      this.state.native = primary; this.phase("complete");
    }
  }
  fail(id: string, error: string) {
    if (this.state.handoff?.id === id && this.state.handoff.phase !== "complete") this.phase("failed", error);
  }
  expire() {
    const op = this.state.handoff;
    if (op?.phase === "headless-starting" && op.multi && (!this.ports.headlessReady || this.ports.headlessReady(op.multi.subject)))
      this.phase(op.multi.primary ? "navigate" : "complete");
    if (op?.phase === "complete" && op.bulkRemaining?.length && !this.advancing) {
      const remaining = op.bulkRemaining.slice();
      // begin installs the next persisted operation before its first await.
      void this.begin("headless", remaining[0], remaining.slice(1))
        .catch(error => { op.phase = "failed"; op.error = String(error); this.ports.save(); });
      return;
    }
    if (op?.multi && !["complete", "failed", "awaiting-realm-choice"].includes(op.phase) && this.ports.now()-op.startedAt >= 180000) {
      this.phase("failed", RELEASE_TIMEOUT);
      return;
    }
    // Disconnecting the last primary can destroy its bridge before the final
    // release reply. Account-confirmed offline state is sufficient proof,
    // including a persisted timeout; stale telemetry never releases ownership.
    if (op && !this.advancing && (op.phase === "confirm-release" ||
      (op.phase === "release" && op.multi?.action === "headless" && op.multi.releaseIssued) ||
      this.lostHeadlessRelease(op))) void this.released(op.id, true);
    if (op?.multi && op.phase === "preparing") void this.prepare();
  }
  async recover() {
    const op = this.state.handoff;
    if (!op?.multi || op.phase !== "failed" || this.advancing) throw new RosterConflict("No failed Steam operation to recover");
    if (op.bulkRemaining !== undefined) {
      if (!this.ports.bridgeReady()) throw new RosterConflict("Reconnect the Steam bridge before resuming this group handoff");
      if (op.multi.headlessStarted) {
        op.phase = "headless-starting";
        op.error = null; op.startedAt = this.ports.now(); this.ports.save(); return;
      }
      // Keep all assignments and the remaining queue; repeat release safely.
      // Already-offline subjects still pass the authoritative release check.
      op.error = null; op.startedAt = this.ports.now();
      op.phase = "release"; this.ports.save(); return;
    }
    const affected = Array.from(new Set([...(op.multi.releaseIssued || op.releasedAt ? op.multi.release : []), op.multi.subject,
      ...op.multi.desired.filter(n => !op.multi!.before.includes(n))]));
    // Never stop unaffected sessions, including the successfully transferred headless character.
    for (const name of affected) {
      if (op.multi.headlessStarted && name === op.multi.subject) continue;
      if (!await this.ports.confirmOffline(name)) throw new RosterConflict(`${name} is still online; ownership remains reserved`);
    }
    this.state.steam = this.state.steam!.filter(n => !affected.includes(n));
    this.state.slots = this.state.slots.map(n => n && affected.includes(n) && !(op.multi!.headlessStarted && n === op.multi!.subject) ? null : n);
    if (affected.includes(this.state.native || "")) this.state.native = null;
    this.state.handoff = null; this.ports.save();
  }
}
