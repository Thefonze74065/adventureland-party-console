import { createAutomaticSaleRoutes } from "./automatic-sales.ts";
import { createNpcSaleRoute } from "./npc-sale.ts";
import { createStandMarkRoute } from "./stand-marks.ts";
import { createMerchantHandoffRoutes } from "./merchant-handoff.ts";
import { createInventoryReceiptRoutes } from "./inventory-receipts.ts";
import { createMerchantIdleRoute } from "./merchant-idle.ts";
import { createMerchantBidRoute } from "./merchant-bid.ts";
import { createStackMergeRoute } from "./stack-merge.ts";
import type { ObservedCharacterStatus } from "../status/observed-status.ts";
import { replaceAutomaticAction, type AutomaticActionState } from '../inventory/automatic-action.ts';

type InventoryState = AutomaticActionState & Parameters<typeof createAutomaticSaleRoutes>[0] &
  Parameters<typeof createNpcSaleRoute>[0] &
  Parameters<typeof createStandMarkRoute>[0] &
  Parameters<typeof createMerchantHandoffRoutes>[0] &
  Parameters<typeof createInventoryReceiptRoutes>[0] &
  Parameters<typeof createMerchantIdleRoute>[0] &
  Parameters<typeof createMerchantBidRoute>[0] &
  Parameters<typeof createStackMergeRoute>[0] & {
    nextCommandId: number;
    statuses: Record<string, ObservedCharacterStatus | undefined>;
  };
type MergePorts = Parameters<typeof createStackMergeRoute>[1];
type InventoryPorts = Omit<Parameters<typeof createAutomaticSaleRoutes>[1], "reconcile"> &
  Omit<Parameters<typeof createNpcSaleRoute>[1], "nextCommand"> &
  Omit<Parameters<typeof createStandMarkRoute>[1], "nextCommand"> &
  Omit<Parameters<typeof createMerchantHandoffRoutes>[1], "nextCommand"> &
  Parameters<typeof createInventoryReceiptRoutes>[1] &
  Parameters<typeof createMerchantIdleRoute>[1] &
  Parameters<typeof createMerchantBidRoute>[1] &
  Omit<MergePorts, "plan"> & {
    reconcile: (status: InventoryState["statuses"][string]) => void;
    plan: (
      state: InventoryState,
      status: InventoryState["statuses"][string],
    ) => ReturnType<MergePorts["plan"]>;
  };

/** Inventory requests and receipts share command allocation and always inspect the current merchant report. */
export function createCoordinatorInventoryActions(state: InventoryState, ports: InventoryPorts) {
  const shared = { ...ports, nextCommand: () => state.nextCommandId++ };
  const automatic = createAutomaticSaleRoutes(state, {
    selectAction: (item, name, action) => replaceAutomaticAction(state, name, item, action),
    ...shared,
    reconcile: () => { for (const status of Object.values(state.statuses)) ports.reconcile(status); },
  });
  const npc = createNpcSaleRoute(state, shared);
  const stand = createStandMarkRoute(state, shared);
  const handoff = createMerchantHandoffRoutes(state, shared);
  const receipts = createInventoryReceiptRoutes(state, shared);
  const idle = createMerchantIdleRoute(state, shared);
  const bid = createMerchantBidRoute(state, shared);
  const merge = createStackMergeRoute(state, {
    ...shared,
    plan: () => ports.plan(state, state.statuses[String(state.merchantCharacter)]),
  });
  return { automatic, npc, stand, handoff, receipts, idle, bid, merge };
}
