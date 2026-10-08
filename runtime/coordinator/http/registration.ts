/** Minimal router contract keeps registration independent of Express and its server lifecycle. */
export interface CoordinatorRouteRegistrar<Handler> {
  get: (path: string, handler: Handler) => unknown;
  post: (path: string, handler: Handler) => unknown;
}

export interface AnniversaryAndCommerceHandlers<Handler> {
  anniversaryVisitRoutes: {
    claim: Handler;
    attempt: Handler;
    failure: Handler;
    handoff: Handler;
  };
  anniversaryNavigationRoutes: { ready: Handler; preempt: Handler; staging: Handler };
  anniversaryCommerceRoutes: {
    advertise: Handler;
    chat: Handler;
    chatComplete: Handler;
    trade: Handler;
    tradeComplete: Handler;
    cakeComplete: Handler;
  };
  anniversarySuppliesRoute: Handler;
  mailPostageRoute: Handler;
  aldataRoutes: {
    key: Handler;
    market: Handler;
    generateKey: Handler;
    auth: Handler;
    sendAuth: Handler;
    refresh: Handler;
  };
}

export function installAnniversaryAndCommerceRoutes<Handler>(
  router: CoordinatorRouteRegistrar<Handler>,
  handlers: AnniversaryAndCommerceHandlers<Handler>,
): void {
  router.post("/party-api/anniversary/claim", handlers.anniversaryVisitRoutes.claim);
  router.post("/party-api/anniversary/attempt", handlers.anniversaryVisitRoutes.attempt);
  router.post("/party-api/anniversary/failure", handlers.anniversaryVisitRoutes.failure);
  router.post("/party-api/anniversary/handoff", handlers.anniversaryVisitRoutes.handoff);
  router.post("/party-api/anniversary/return-ready", handlers.anniversaryNavigationRoutes.ready);
  router.post(
    "/party-api/anniversary/navigation-preempt",
    handlers.anniversaryNavigationRoutes.preempt,
  );
  router.post("/party-api/anniversary/staging", handlers.anniversaryNavigationRoutes.staging);
  router.post("/party-api/anniversary/advertise", handlers.anniversaryCommerceRoutes.advertise);
  router.post("/party-api/anniversary/chat-advertise", handlers.anniversaryCommerceRoutes.chat);
  router.post(
    "/party-api/anniversary/chat-advertise-complete",
    handlers.anniversaryCommerceRoutes.chatComplete,
  );
  router.post("/party-api/anniversary/trade", handlers.anniversaryCommerceRoutes.trade);
  router.post(
    "/party-api/anniversary/trade-complete",
    handlers.anniversaryCommerceRoutes.tradeComplete,
  );
  router.post("/party-api/anniversary/cake-supplies", handlers.anniversarySuppliesRoute);
  router.post(
    "/party-api/anniversary/cake-complete",
    handlers.anniversaryCommerceRoutes.cakeComplete,
  );
  router.get("/party-api/mail/postage", handlers.mailPostageRoute);
  router.get("/party-api/aldata/key", handlers.aldataRoutes.key);
  router.get("/party-api/aldata/market", handlers.aldataRoutes.market);
  router.post("/party-api/aldata/key", handlers.aldataRoutes.generateKey);
  router.get("/party-api/aldata/auth", handlers.aldataRoutes.auth);
  router.post("/party-api/aldata/send-auth", handlers.aldataRoutes.sendAuth);
  router.post("/party-api/aldata/refresh", handlers.aldataRoutes.refresh);
}

export interface FarmingAndTravelHandlers<Handler> {
  monsterSelectionRoutes: { navigate: Handler; passive: Handler };
  focusRoute: Handler;
  formationRoute: Handler;
  huntBlacklistRoute: Handler;
  huntSettingsRoute: Handler;
  huntModeRoute: Handler;
  encounterModeRoute: Handler;
  huntControlRoutes: { permission: Handler; retryReturn: Handler; interactionComplete: Handler };
  eventRecoveryRoutes: { disabled: Handler; ended: Handler };
  eventAcknowledgementRoutes: {
    progress: Handler;
    townComplete: Handler;
    returnComplete: Handler;
    resumeComplete: Handler;
  };
  convoyEngagementRoutes: { engage: Handler; approach: Handler };
  farmingReturnRoute: Handler;
  convoyAcknowledgementRoutes: { complete: Handler; failed: Handler };
  partyActionRoutes: { travel: Handler; checkpoint: Handler; bank: Handler; escapeState: Handler };
}

export function installFarmingAndTravelRoutes<Handler>(
  router: CoordinatorRouteRegistrar<Handler>,
  handlers: FarmingAndTravelHandlers<Handler>,
): void {
  router.post("/party-api/navigate-to-monster", handlers.monsterSelectionRoutes.navigate);
  router.post("/party-api/rare-hunting", handlers.monsterSelectionRoutes.passive);
  router.post("/party-api/focus", handlers.focusRoute);
  router.post("/party-api/formation", handlers.formationRoute);
  router.post("/party-api/hunt-blacklist", handlers.huntBlacklistRoute);
  router.post("/party-api/hunt-settings", handlers.huntSettingsRoute);
  router.post("/party-api/farming-mode", handlers.huntModeRoute);
  router.post("/party-api/encounter-mode", handlers.encounterModeRoute);
  router.post("/party-api/hunt-event-permission", handlers.huntControlRoutes.permission);
  router.post("/party-api/monster-hunt/retry-return", handlers.huntControlRoutes.retryReturn);
  router.post(
    "/party-api/monster-hunt-interact-complete",
    handlers.huntControlRoutes.interactionComplete,
  );
  router.post("/party-api/event-disabled", handlers.eventRecoveryRoutes.disabled);
  router.post("/party-api/event-ended", handlers.eventRecoveryRoutes.ended);
  router.post("/party-api/town-complete", handlers.eventAcknowledgementRoutes.townComplete);
  router.post("/party-api/return-progress", handlers.eventAcknowledgementRoutes.progress);
  router.post(
    "/party-api/event-return-complete",
    handlers.eventAcknowledgementRoutes.returnComplete,
  );
  router.post(
    "/party-api/event-resume-complete",
    handlers.eventAcknowledgementRoutes.resumeComplete,
  );
  router.post("/party-api/convoy-engage", handlers.convoyEngagementRoutes.engage);
  router.post("/party-api/grouped-approach", handlers.convoyEngagementRoutes.approach);
  router.post("/party-api/farming-return", handlers.farmingReturnRoute);
  router.post("/party-api/convoy-complete", handlers.convoyAcknowledgementRoutes.complete);
  router.post("/party-api/convoy-failed", handlers.convoyAcknowledgementRoutes.failed);
  router.post("/party-api/travel", handlers.partyActionRoutes.travel);
  router.post("/party-api/checkpoint", handlers.partyActionRoutes.checkpoint);
  router.post("/party-api/bank-party", handlers.partyActionRoutes.bank);
  router.get("/party-api/escape", handlers.partyActionRoutes.escapeState);
}

export interface MerchantControlsHandlers<Handler> {
  partyActionRoutes: { resume: Handler; town: Handler; upgrades: Handler };
  merchantSettingsRoutes: {
    bankSort?: { configure: Handler; checkpoint: Handler };
    configure: Handler;
    gather: Handler;
    gatherStatus: Handler;
    activity: Handler;
    clearActivity: Handler;
  };
  staleOrderRoute: Handler;
  standMarkRoute: Handler;
  npcSaleRoute: Handler;
  deconstructionRoutes?: { mark: Handler; automatic: Handler; step: Handler };
  automaticSaleRoutes: { npc: Handler; stand: Handler };
  routinePriorityRoute: Handler;
  merchantBlacklistRoute: Handler;
  merchantControlRoutes: { cancel: Handler; retry?: Handler };
  merchantBidRoute: Handler;
  stackMergeRoute: Handler;
  merchantIdleRoute: Handler;
  merchantRequestRoutes: { donate: Handler };
}

export function installMerchantControlsRoutes<Handler>(
  router: CoordinatorRouteRegistrar<Handler>,
  handlers: MerchantControlsHandlers<Handler>,
): void {
  router.post("/party-api/escape/resume", handlers.partyActionRoutes.resume);
  router.post("/party-api/town-party", handlers.partyActionRoutes.town);
  router.post("/party-api/upgrade-party", handlers.partyActionRoutes.upgrades);
  if (handlers.merchantSettingsRoutes.bankSort) {
    router.post("/party-api/merchant/bank-sort", handlers.merchantSettingsRoutes.bankSort.configure);
    router.post("/party-api/merchant/bank-sort/checkpoint", handlers.merchantSettingsRoutes.bankSort.checkpoint);
  }
  router.post("/party-api/merchant/config", handlers.merchantSettingsRoutes.configure);
  router.post("/party-api/merchant/gather", handlers.merchantSettingsRoutes.gather);
  router.post("/party-api/merchant/gather-status", handlers.merchantSettingsRoutes.gatherStatus);
  router.post("/party-api/merchant/activity", handlers.merchantSettingsRoutes.activity);
  router.post("/party-api/merchant/activity/clear", handlers.merchantSettingsRoutes.clearActivity);
  router.post("/party-api/merchant/stale-orders/clear", handlers.staleOrderRoute);
  router.post("/party-api/merchant/stand", handlers.standMarkRoute);
  router.post("/party-api/merchant/npc-sale", handlers.npcSaleRoute);
  if (handlers.deconstructionRoutes) {
    router.post("/party-api/deconstruction/mark", handlers.deconstructionRoutes.mark);
    router.post("/party-api/deconstruction/auto", handlers.deconstructionRoutes.automatic);
    router.post("/party-api/deconstruction/step", handlers.deconstructionRoutes.step);
  }
  router.post("/party-api/merchant/auto-npc-sale", handlers.automaticSaleRoutes.npc);
  router.post("/party-api/merchant/auto-stand", handlers.automaticSaleRoutes.stand);
  router.post("/party-api/merchant/routine-priorities", handlers.routinePriorityRoute);
  router.post("/party-api/merchant/blacklist", handlers.merchantBlacklistRoute);
  router.post("/party-api/merchant/job/cancel", handlers.merchantControlRoutes.cancel);
  if (handlers.merchantControlRoutes.retry)
    router.post("/party-api/merchant/job/retry", handlers.merchantControlRoutes.retry);
  router.post("/party-api/merchant/bid", handlers.merchantBidRoute);
  router.post("/party-api/merchant/stack-merge-permission", handlers.stackMergeRoute);
  router.post("/party-api/merchant/idle-status", handlers.merchantIdleRoute);
  router.post("/party-api/merchant/donate", handlers.merchantRequestRoutes.donate);
}

export interface MerchantTransactionsHandlers<Handler> {
  sendMailRoute: Handler;
  merchantRequestRoutes: { giveaway: Handler; search: Handler };
  manualMarketOrderRoutes: { stand: Handler; purchase: Handler; ponty: Handler; sale: Handler };
  merchantOrderRoute: { handle: Handler };
  merchantExchangeRoutes: { progress: Handler; supply: Handler; order: Handler };
  merchantControlRoutes: { clear: Handler; force: Handler; visitBank: Handler };
  merchantHandoffRoutes: {
    handoff: Handler;
    complete: Handler;
    cleanout: Handler;
    order: Handler;
    orderComplete: Handler;
  };
  merchantProgressRoutes: { job: Handler; heartbeat: Handler; checkpoint: Handler };
  marketplaceProgressRoutes: { ponty: Handler; aldata: Handler };
  merchantRealmRoutes: { switchRealm: Handler; ensureHome: Handler };
  marketplaceLocationRoute: Handler;
  merchantClusterRoutes: { leader: Handler; marked: Handler; luck: Handler };
  bankUnlockRoute: Handler;
  merchantCompletionRoute: Handler;
  inventoryReceiptRoutes: { statScrolls: Handler; equipment: Handler; bank: Handler };
  restockRoute: Handler;
  thresholdRoute: Handler;
  characterCommandRoute: Handler;
}

export function installMerchantTransactionsRoutes<Handler>(
  router: CoordinatorRouteRegistrar<Handler>,
  handlers: MerchantTransactionsHandlers<Handler>,
): void {
  router.post("/party-api/merchant/send-mail", handlers.sendMailRoute);
  router.post("/party-api/merchant/join-giveaway", handlers.merchantRequestRoutes.giveaway);
  router.post("/party-api/merchant/stand-search", handlers.merchantRequestRoutes.search);
  router.post("/party-api/merchant/stand-order", handlers.manualMarketOrderRoutes.stand);
  router.post("/party-api/merchant/aldata-order", handlers.manualMarketOrderRoutes.purchase);
  router.post("/party-api/merchant/ponty-order", handlers.manualMarketOrderRoutes.ponty);
  router.post("/party-api/merchant/aldata-sale", handlers.manualMarketOrderRoutes.sale);
  router.post("/party-api/merchant/order", handlers.merchantOrderRoute.handle);
  router.post("/party-api/merchant/exchange-progress", handlers.merchantExchangeRoutes.progress);
  router.post("/party-api/merchant/exchange-supply", handlers.merchantExchangeRoutes.supply);
  router.post("/party-api/merchant/exchange-order", handlers.merchantExchangeRoutes.order);
  router.post("/party-api/merchant/clear", handlers.merchantControlRoutes.clear);
  router.post("/party-api/merchant/force-stand", handlers.merchantControlRoutes.force);
  router.post("/party-api/merchant/bank-visit", handlers.merchantControlRoutes.visitBank);
  router.post("/party-api/merchant/handoff", handlers.merchantHandoffRoutes.handoff);
  router.post("/party-api/merchant/handoff-complete", handlers.merchantHandoffRoutes.complete);
  router.post("/party-api/merchant/cleanout", handlers.merchantHandoffRoutes.cleanout);
  router.post("/party-api/merchant/order-handoff", handlers.merchantHandoffRoutes.order);
  router.post(
    "/party-api/merchant/order-handoff-complete",
    handlers.merchantHandoffRoutes.orderComplete,
  );
  router.get("/party-api/merchant/job/:id", handlers.merchantProgressRoutes.job);
  router.post("/party-api/merchant/heartbeat", handlers.merchantProgressRoutes.heartbeat);
  router.post("/party-api/merchant/ponty-progress", handlers.marketplaceProgressRoutes.ponty);
  router.post("/party-api/merchant/aldata-progress", handlers.marketplaceProgressRoutes.aldata);
  router.post("/party-api/merchant/realm-switch", handlers.merchantRealmRoutes.switchRealm);
  router.post("/party-api/merchant/refresh-location", handlers.marketplaceLocationRoute);
  router.post("/party-api/merchant/ensure-home-realm", handlers.merchantRealmRoutes.ensureHome);
  router.post("/party-api/merchant/checkpoint", handlers.merchantProgressRoutes.checkpoint);
  router.post("/party-api/merchant/leader-cluster", handlers.merchantClusterRoutes.leader);
  router.post("/party-api/merchant/marked-cluster", handlers.merchantClusterRoutes.marked);
  router.post("/party-api/merchant/luck-cluster", handlers.merchantClusterRoutes.luck);
  router.post("/party-api/bank/unlock", handlers.bankUnlockRoute);
  router.post("/party-api/merchant/complete", handlers.merchantCompletionRoute);
  router.post("/party-api/merchant/delivery-receipt", handlers.merchantCompletionRoute);
  router.post("/party-api/stat-scroll-complete", handlers.inventoryReceiptRoutes.statScrolls);
  router.post("/party-api/equip-delivery-complete", handlers.inventoryReceiptRoutes.equipment);
  router.post("/party-api/restock", handlers.restockRoute);
  router.post("/party-api/bank-complete", handlers.inventoryReceiptRoutes.bank);
  router.post("/party-api/config", handlers.thresholdRoute);
  router.post("/party-api/command", handlers.characterCommandRoute);
}
