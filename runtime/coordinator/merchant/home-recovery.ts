import { realmRequestArrived, type RealmRequest } from '../characters/realm-request.ts';
interface Worker {
  realm?: string;
  pendingRealm?: RealmRequest;
}
interface Sale {
  reason?: string;
  startedAt?: unknown;
  buyOrder?: { buyer?: string; item?: { name?: string } };
}
interface HomeState {
  merchantCharacter: string | null;
  activeRealm: string;
  merchantHomeReturnAt?: number;
  merchantRealmRequests?: Record<string, RealmRequest | undefined>;
  statuses: Record<string, { server?: string; seenAt?: number } | undefined>;
  commands: Record<string, unknown>;
  merchantCurrent?: Sale | null;
}
interface HomePorts<T extends Worker> {
  now(): number;
  block(name: string): T;
  realmLabel(realm: string): string;
  log(message: string, level: string, details?: unknown): void;
  persist(): void;
  restart(block: T, delay: number): void;
}

export function merchantRoutineNeedsHome(reason: string): boolean {
  return ![
    "ALData marketplace purchases",
    "ALData marketplace sales",
    "join giveaway",
    "Ponty purchases",
    "stand maintenance",
  ].includes(reason);
}

/** Realm recovery waits for both the worker assignment and the character's reported arrival. */
export function createMerchantHomeRecovery<T extends Worker>(
  state: HomeState,
  ports: HomePorts<T>,
) {
  function homeArrived(merchant: string, block: T, request: RealmRequest | undefined): boolean {
    const status = state.statuses[merchant];
    if (block.realm !== state.activeRealm) return false;
    if (request) return realmRequestArrived(status, {...request, realm:state.activeRealm}, ports.now());
    return Number(status?.seenAt) >= ports.now() - 3000 &&
      'SR_' + String(status?.server || '').replace(/^SR_/, '') === state.activeRealm;
  }
  function clearReturn(merchant: string, block: T, request: RealmRequest | undefined): void {
    state.merchantHomeReturnAt = 0;
    if (!request) return;
    delete state.merchantRealmRequests![merchant];
    delete block.pendingRealm;
    ports.persist();
  }
  function returnRequest(merchant: string, request: RealmRequest | undefined): RealmRequest {
    if (request?.owner === 'home' && request.realm === state.activeRealm) return request;
    state.merchantHomeReturnAt = 0;
    return (state.merchantRealmRequests ||= {})[merchant] = {
      realm: state.activeRealm, owner: 'home', requestedAt: ports.now(), attempts: 0,
    };
  }
  function attemptReturn(merchant: string, block: T, request: RealmRequest, reason: string): void {
    if (request.exhausted) { state.merchantHomeReturnAt = 0; return; }
    const arrivalWindow = request.attempts > 0 ? 60_000 : 15_000;
    if (request.attempts !== 0 && ports.now() - request.requestedAt < arrivalWindow) return;
    if (request.attempts >= 3) {
      request.exhausted = true;
      state.merchantHomeReturnAt = 0;
      ports.log('Merchant realm return failed after 3 attempts; retry a queued job to resume', 'error', {merchant, realm:state.activeRealm});
      ports.persist();
      return;
    }
    request.attempts++;
    request.requestedAt = ports.now();
    block.pendingRealm = request;
    state.merchantHomeReturnAt = ports.now();
    block.realm = state.activeRealm;
    delete state.commands[merchant];
    ports.log('Returning ' + merchant + ' to ' + ports.realmLabel(state.activeRealm) + ' before ' + reason, 'info');
    ports.persist();
    ports.restart(block, 150);
  }
  function ensureHome(reason: string): boolean {
    const merchant = state.merchantCharacter;
    if (!merchant) return false;
    const block = ports.block(merchant);
    const request = state.merchantRealmRequests?.[merchant];
    if (homeArrived(merchant, block, request)) {
      clearReturn(merchant, block, request);
      return true;
    }
    if (request?.owner === 'job' && state.merchantCurrent && ports.now() - request.requestedAt < 60_000) return false;
    attemptReturn(merchant, block, returnRequest(merchant, request), reason);
    return false;
  }

  function stalledSale(job: Sale | null | undefined): job is Sale {
    return !!job && job.reason === 'ALData marketplace sales' &&
      ports.now() - Number(job.startedAt || ports.now()) >= 180000;
  }
  function stalledBuyer(job: Sale): string { return job.buyOrder?.buyer || 'unknown buyer'; }

  /** Never retry an ambiguous WTB sale: the server may already have fulfilled it. */
  function recoverStalledSale(): boolean {
    const job = state.merchantCurrent;
    const merchant = state.merchantCharacter;
    if (
      !merchant ||
      !stalledSale(job)
    )
      return false;
    state.merchantCurrent = null;
    delete state.commands[String(state.merchantCharacter)];
    const block = ports.block(merchant);
    block.realm = state.activeRealm;
    block.pendingRealm = (state.merchantRealmRequests ||= {})[merchant] = {
      realm: state.activeRealm, owner: 'home', requestedAt: ports.now(), attempts: 1,
    };
    state.merchantHomeReturnAt = ports.now();
    ports.log(
      "Stopped stalled WTB fill for " +
        stalledBuyer(job) +
        " after 3 minutes; returning home without retrying the sale",
      "error",
      { item: job.buyOrder?.item?.name },
    );
    ports.persist();
    ports.restart(block, 100);
    return true;
  }
  return { ensureHome, recoverStalledSale };
}
