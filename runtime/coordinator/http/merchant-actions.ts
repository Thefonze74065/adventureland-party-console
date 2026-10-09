import { createManualMarketOrderRoutes } from "./manual-market-orders.ts";
import { createMerchantControlRoutes } from "./merchant-control.ts";
import { createMerchantRequestRoutes } from "./merchant-requests.ts";
import type { MerchantWork } from "../merchant/work.ts";

type ActionState = Parameters<typeof createManualMarketOrderRoutes>[0] &
  Parameters<typeof createMerchantControlRoutes>[0] &
  Parameters<typeof createMerchantRequestRoutes>[0] & { nextCommandId: number };
type OrderPorts = Parameters<typeof createManualMarketOrderRoutes>[1];
interface ActionPorts<Block> {
  now: () => number;
  stamp: (job: MerchantWork) => MerchantWork;
  log: (message: string, level: string, details?: unknown) => void;
  persist: () => void;
  dispatch: () => void;
  plan: (...args: Parameters<OrderPorts["plan"]>) => ReturnType<OrderPorts["plan"]>;
  automations: Record<string, unknown>;
  resolveRealm: (realm: string) => unknown;
  block: (name: string) => Block;
  realmLabel: (realm: string) => string;
  stop: (block: Block) => Promise<unknown>;
  later: (callback: () => Promise<unknown>, milliseconds: number) => unknown;
}

/** Manual orders and controls share the coordinator's command sequence and dispatch pipeline. */
export function createCoordinatorMerchantActions<Block extends { realm?: string }>(
  state: ActionState,
  ports: ActionPorts<Block>,
) {
  const shared = {
    now: ports.now,
    nextCommand: () => state.nextCommandId++,
    stamp: ports.stamp,
    log: ports.log,
    persist: ports.persist,
    dispatch: ports.dispatch,
  };
  const orders = createManualMarketOrderRoutes(state, { ...shared, plan: ports.plan });
  const controls = createMerchantControlRoutes(state, {
    ...shared,
    automated: (reason) => reason in ports.automations,
    returnHome: (merchant, realm) => {
      const block = ports.block(merchant);
      block.realm = realm;
      (state.merchantRealmRequests ||= {})[merchant] = {realm, owner:'home', requestedAt:ports.now(), attempts:1};
      ports.log("Force stand returning " + merchant + " to " + ports.realmLabel(realm), "info");
      state.merchantHomeReturnAt = ports.now();
      ports.later(() => ports.stop(block), 100);
    },
  });
  const requests = createMerchantRequestRoutes(state, {
    ...shared,
    realmExists: (realm) => !!ports.resolveRealm(realm),
  });
  return { orders, controls, requests };
}
