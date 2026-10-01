import { collectsPartyItems, normalizePickupJob } from './pickup-jobs.ts';
import { scopeWork } from './command-scope.ts';
import { ownCommandType } from "./command-kind.ts";
import type {
  CharacterWork,
  CommandInputs,
  MerchantCommand,
  MerchantWork,
  ServiceStatus,
} from "./work.ts";

function goldTarget(work: CharacterWork, fallback: number | null): number | null {
  return Number.isSafeInteger(work.goldTarget) ? Number(work.goldTarget) : fallback;
}

function merchantSupplies(inputs: CommandInputs) {
  const work = inputs.work(inputs.merchant);
  return {
    merchantGoldTarget: goldTarget(work, 0),
    ...(inputs.craftProtection ? {craftProtection: inputs.craftProtection} : {}),
    merchantWithdrawals: work.withdrawals,
    merchantBankMarked: work.marked,
    npcSales: inputs.npcSales,
  };
}

function improvements(work: CharacterWork, _status: ServiceStatus, _own: boolean,
  _bankboiItems: CommandInputs["bankboiItems"] = []) {
  return {
    upgrades: work.upgrades,
    purchases: work.purchases,
    statScrolls: work.statScrolls,
    compounds: work.compounds,
    autoCompounds: work.autoCompounds,
  };
}

function purchaseDetails(job: MerchantWork, inputs: CommandInputs) {
  const buying = [
    "stand purchases",
    "stand bid purchases",
    "Ponty purchases",
    "ALData marketplace purchases",
  ].includes(job.reason);
  const bidding = [
    "stand bid purchases",
    "Ponty purchases",
    "ALData marketplace purchases",
  ].includes(job.reason);
  const standSync = job.reason === "stand maintenance" && job.inPlaceStandSync;
  return {
    listings: standSync ? inputs.standListings : buying ? job.listings : undefined,
    bidItemId: bidding ? job.bidItemId : undefined,
  };
}

function marketplaceDetails(job: MerchantWork, inputs: CommandInputs) {
  const travelling = [
    "ALData marketplace purchases",
    "ALData marketplace sales",
    "Ponty purchases",
  ].includes(job.reason);
  const resumable = ["ALData marketplace purchases", "Ponty purchases"].includes(job.reason);
  const selling = job.reason === "ALData marketplace sales";
  return {
    buyOrder: selling ? job.buyOrder : undefined,
    sellQuantity: selling ? job.sellQuantity : undefined,
    aldataKey: job.reason === "ALData authentication" ? inputs.aldataKey : undefined,
    aldataHomeRealm: travelling ? job.homeRealm || inputs.activeRealm : undefined,
    completedListingKeys: resumable ? job.completedListingKeys || [] : undefined,
  };
}

const reasonDetails: Readonly<
  Record<string, (job: MerchantWork, inputs: CommandInputs) => object>
> = {
  "deconstruction": (_job, inputs) => ({ deconstructionMarks: inputs.deconstructionMarks || [] }),
  "merchant donation": (job) => ({ amount: job.amount }),
  "stand search": (job) => ({ itemId: job.itemId }),
  restock: (job, inputs) => ({ restock: inputs.restock(job.target) }),
  exchange: (job) => ({
    exchanges: job.exchanges || [],
    exchangeRewards: job.exchangeRewards || [],
    exchangeResume: job.exchangeResume === true,
    autoExchangeKeys: job.autoExchangeKeys || [],
  }),
  "bank unlock": (job) => ({ pack: job.pack, floor: job.floor, gold: job.gold, key: job.key }),
  "join giveaway": (job) => ({
    seller: job.seller,
    slot: job.slot,
    rid: job.rid,
    realm: job.realm,
    location: job.location,
    expiresAt: job.expiresAt,
    expectedItem: job.expectedItem,
  }),
  "send mail": (job) => ({ mail: job.mail }),
  "collect mail": (job) => ({ mail: job.mail }),
};

/** Builds the existing self-service wire payload without owning inventory execution. */
export function ownMerchantCommand(
  id: number,
  job: MerchantWork,
  status: ServiceStatus,
  inputs: CommandInputs,
): MerchantCommand {
  if (job.reason === "upgrade preview") return {id,type:"merchant-upgrade-preview",jobId:job.id,upgradePreview:job.upgradePreview};
  const work = inputs.work(job.target);
  return scopeWork(job, {
    id,
    type: ownCommandType(job),
    jobId: job.id,
    ...(['auto upgrade', 'auto compound', 'auto npc sales'].includes(job.reason) ? {processingRoutine: job.reason} : {}),
    ...purchaseDetails(job, inputs),
    ...marketplaceDetails(job, inputs),
    ...merchantSupplies(inputs),
    ...reasonDetails[job.reason]?.(job, inputs),
    ...improvements(work, status, true, inputs.bankboiItems),
    ...sharedImprovements(job, inputs),
    goldTarget: job.reason === "native stand funding" ? Number(job.goldTarget) : goldTarget(work, 0),
    buyUpgradeBatchSize: inputs.buyUpgradeBatchSize ?? 1,
    order: job.order || null,
    resumeState: job.resumeState || null,
    ...commerceDetails(job),
    preloadStatScrolls: work.statScrolls,
    ...(job.capacityRecovery ? { capacityRecovery: true, merchantWithdrawals: [], withdrawals: [], npcSales: [] } : {}),
  });
}

function sharedImprovements(job: MerchantWork, inputs: CommandInputs) {
  return {
    ...(inputs.sharedAutoCompounds ? { autoCompounds: inputs.sharedAutoCompounds, sharedBankImprovements: true } : {}),
    ...(job.reason === "auto upgrade" && inputs.bankUpgradeRules?.length ? { bankUpgradeRules: inputs.bankUpgradeRules } : {}),
  };
}

function clusterOptions(job: MerchantWork) {
  return {
    cleanout: job.reason === "inventory cleanout",
    expandLeaderCluster: !!job.expandLeaderCluster,
    expandMarkedCluster: job.reason === "marked items" && !job.clusterExpanded,
    expandLuckCluster: job.reason === "merchant luck" && job.expandLuckCluster !== false,
    castMerchantLuck: job.reason === "merchant luck" && job.castMerchantLuck !== false,
    radius: Number(job.radius) || undefined,
  };
}

export function partyMerchantCommand(
  id: number,
  job: MerchantWork,
  status: ServiceStatus,
  inputs: CommandInputs,
): MerchantCommand {
  job = normalizePickupJob(job, inputs.merchant);
  const work = inputs.work(job.target);
  return scopeWork(job, {
    id,
    type: "merchant-service",
    ...(collectsPartyItems(job.reason) ? {collectionOnly: true} : {}),
    targetRealm: status.server,
    jobId: job.id,
    target: job.target,
    targetLocation: { map: status.map, x: status.x, y: status.y },
    marked: work.marked,
    ...improvements(work, status, false),
    ...merchantSupplies(inputs),
    ...clusterOptions(job),
    withdrawals: work.withdrawals,
    goldTarget: goldTarget(work, null),
    targetGold: status.gold,
    threshold: inputs.threshold,
    restock: inputs.restock(job.target),
    targetInventory: status.items || [],
    gatheringModes: inputs.gatheringModes,
    cargo: inputs.cargo,
    merchantDeliveries: work.deliveries,
    preloadStatScrolls: Object.entries(inputs.statScrolls).flatMap(([owner, marks]) =>
      (marks || []).map((mark) => ({ ...mark, owner })),
    ),
  });
}

export function luckMerchantCommand(
  id: number,
  job: MerchantWork,
  status: ServiceStatus,
  _npcSales: unknown[],
): MerchantCommand {
  return {
    id,
    type: "merchant-mluck",
    jobId: job.id,
    target: job.target,
    targetLocation: { map: status.map, x: status.x, y: status.y },
    radius: 200,
    npcSales: [],
  };
}

function commerceDetails(job: MerchantWork) {
  return job.commerceProgressVersion === 2 ? {commerceProgressVersion: 2, commerceOrderId: job.commerceOrderId} : {};
}
