import type { HttpHandler, HttpRouter } from "./http/contracts.ts";
import { consoleMaintenance } from './lifecycle/console-maintenance.ts';
import { createUpgradePreviews } from './merchant/upgrade-preview.ts';
import { merchantVisibility } from './merchant/visibility.ts';
import { loadCoordinatorDependencies } from "./infrastructure/dependencies.ts";
import * as coordinatorPolicies from "./index.ts";
import type { CatalogDefinitions } from './status/catalog-validation.ts';
import type { WebMiddleware, WebRouter, WebMonitor } from "./infrastructure/web-platform.ts";
import type { CoordinatorApplicationPlatform } from "./infrastructure/application-platform.ts";
import { installProductionRoutes } from "./inventory/production.ts";
import { migrateSharedRules, installSharedRuleRoutes, sharedMember } from "./inventory/shared-rules.ts";
import { loadPlannerGeometry } from './navigation/planner-geometry.ts';
import { createRareRouteDistance } from './navigation/rare-route-distance.ts';
export function startCoordinatorApplication(
  platform: CoordinatorApplicationPlatform,
): Promise<void> {
  const consoleUpdate = consoleMaintenance(process.env.AL_DATA_DIR);
  const require = platform.require,
    __dirname = platform.directory;
  const {
    huntPolicy,
    watchGenerations,
    classScript,
    evaluateGroup,
    installRosterRoutes,
    publicHandoff,
    requestReload,
    eventPolicy,
    selectedEvents,
    eventEnabled,
    supportedEvents,
    child_process,
    account_info,
    game_files,
    bwi,
    monitoring_util,
    express,
    fs_regular,
    crypto,
    vm,
    pontyMarket,
    huntSafety,
    farmZones,
    farmAreaControl,
    rareHunting,
    createFarmingNavigation,
    convoyNavigation,
    merchantInventoryStacks,
    bankStackRouting,
    createMailInbox,
    validFarmingLocation,
    farmingAreas,
    createEscape,
    convoyDefense,
    createDisengagement,
    LOCALSTORAGE_PATH,
    LOCALSTORAGE_ROTA_PATH,
    STAT_BEAT_INTERVAL,
    log,
    console,
    ctype_to_clid,
    FileStoredKeyValues,
  } = loadCoordinatorDependencies(require);

  //TODO check for invalid session
  //TODO improve termination
  //MAYBE improve linux service
  //MAYBE exclude used versions

  return (async () => {
    const {
      localStorage,
      sessionStorage,
      version: initialVersion,
      configuration: cfg,
      session: sess,
      account: my_acc,
      workers: character_manage,
      configuredRealm,
    } = await coordinatorPolicies.initializeCoordinatorEnvironment({
      createStorage: () => new FileStoredKeyValues(LOCALSTORAGE_PATH, LOCALSTORAGE_ROTA_PATH),
      migration: {
        read: (path) => fs_regular.readFileSync(path, "utf8"),
        remove: (path) => fs_regular.unlinkSync(path),
        info: (details, message) => log.info(details, message),
      },
      ensureLatest: () => game_files.ensure_latest(),
      configuration:
        (): import("./infrastructure/platform-contracts.ts").CoordinatorConfiguration =>
          require("../config"),
      cullVersions: (versions) => game_files.cull_versions(versions),
      environmentSession: () => process.env.AL_SESSION,
      account: (session) => account_info(session),
    });
    let version = initialVersion;
    let clientRevision = await game_files.get_revision?.(version) || String(version);
    const movementPlanner = coordinatorPolicies.createPlannerService(__dirname + '/../../.build/runtime/movement-planner.cjs');
    const movementFingerprints = new Map<number, string>();
    async function prepareMovement(gameVersion: number) {
      try {
        const directory = './game_files/' + gameVersion + '/';
        const game = loadPlannerGeometry(
          fs_regular.readFileSync(directory + 'data.js', 'utf8'),
          fs_regular.readFileSync(directory + 'old_common_functions.js', 'utf8'),
        );
        const prepared = movementPlanner.prepare(game, gameVersion);
        await prepared.ready;
        movementFingerprints.set(gameVersion, prepared.fingerprint);
        log.info({ version: gameVersion, fingerprint: prepared.fingerprint }, 'ALClient movement geometry ready');
        return prepared;
      } catch (error) { log.warn({error}, 'Could not prepare ALClient; native movement fallback enabled'); return null; }
    }
    await prepareMovement(version);
    const PARTY_CLASSES = ["warrior", "paladin", "rogue", "ranger", "mage", "priest", "merchant"];
    const gameDataPorts: Parameters<typeof coordinatorPolicies.loadCoordinatorBankVaults>[1] = {
      read: (path) => fs_regular.readFileSync(path, "utf8"),
      evaluate: (source, context, filename) =>
        vm.runInNewContext(source, context, filename ? { filename } : undefined),
      warn: (details, message) => log.warn(details, message),
    };
    function loadBankVaultDefinitions() {
      return coordinatorPolicies.loadCoordinatorBankVaults(version, gameDataPorts);
    }
    const DEFAULT_MERCHANT_ROUTINE_PRIORITIES =
      coordinatorPolicies.defaultMerchantRoutinePriorities();
    const DEFAULT_MERCHANT_AUTOMATIONS = coordinatorPolicies.defaultMerchantAutomations();
    const { party, persistedSettings } = coordinatorPolicies.initializeCoordinatorState(
      localStorage,
      character_manage,
      configuredRealm,
      {
        merchantDefault: cfg.merchant || null,
        now: () => Date.now(),
        loadBankVaultDefinitions,
        warn: (details, message) => log.warn(details, message),
      },
    );
    migrateSharedRules(party, Object.keys(character_manage).filter(name => !party.bankbois[name]));
    const farmingScopes = coordinatorPolicies.createFarmingScopes(party);
    const soloServices = new Map<string, ReturnType<typeof createSoloServices>>();
    const aldataPublicationScheduler = coordinatorPolicies.createPublicationScheduler(
      {
        get publishTimer() {
          return party.aldata.publishTimer;
        },
        set publishTimer(value) {
          party.aldata.publishTimer = value;
        },
      },
      {
        later: (callback, delay) => setTimeout(callback, delay),
        publish: publishALDataTrades,
      },
    );
    const activity = coordinatorPolicies.createCoordinatorActivity(party, {
      now: () => Date.now(),
      persistHistory,
    });
    const persistence = coordinatorPolicies.createCoordinatorPersistence(party, localStorage);
    const storageService = coordinatorPolicies.createCoordinatorStorageService(
      party,
      persistBankState,
    );
    coordinatorPolicies.migrateCharacterSelections(party, character_manage, supportedEvents);
    coordinatorPolicies.migrateSharedMonsterFocus(party);
    const createCommandOwnership: import("./infrastructure/navigation-platform.ts").CommandOwnershipPlatform = require("../../scripts/command-ownership.cjs");
    const commandOwnership = createCommandOwnership(party);
    const farmingNavigation = createFarmingNavigation(party, {
      names: () => Object.keys(character_manage),
      activeNames,
      cancelConvoy: cancelActiveConvoy,
      startConvoy: startPartyMonsterConvoy,
      persist: persistSettings,
      log: anniversaryLog,
    });
    coordinatorPolicies.migrateEmptyFocusIntents(
      persistedSettings.navigationIntents,
      party,
      farmingNavigation,
    );
    const workerClock: import("./characters/types.ts").WorkerClock = {
      now: () => Date.now(),
      later: (callback, ms) => setTimeout(callback, ms),
      cancel: (timer) => clearTimeout(timer),
      sleep,
    };
    const { manager: characterManager, code: characterCode } =
      coordinatorPolicies.createCoordinatorCharacterServices({
        blocks: character_manage,
        clock: workerClock,
        log: console,
        local: localStorage,
        session: sessionStorage,
        version,
        currentVersion: () => version,
        clientUpdate: event => { void clientUpdates.request(event); },
        sessionToken: sess,
        classIds: ctype_to_clid,
        configuration: cfg,
        lifecycleState: () => party.lifecycle,
        accountSource: my_acc,
        repair: () => clientUpdates.request("repair"),
        fork: () =>
          child_process.fork("./src/CharacterThread.js", [], {
            stdio: ["ignore", "pipe", "pipe", "ipc"],
          }),
        // The fork above always configures both streams as pipes.
        pipe: (worker) => {
          worker.stdout!.pipe(process.stdout);
          worker.stderr!.pipe(process.stderr);
        },
        monitor: (name, block) =>
          bwi_instance.publisher
            ? monitoring_util.create_monitor_ui(
                bwi_instance,
                name,
                block,
                cfg.web_app.enable_minimap,
              )
            : null,
        code: {
          hash: () => crypto.createHash("sha256"),
          read: (file) => fs_regular.readFileSync(file),
          reload: requestReload,
          stop: (block, reason) => softkill_block(block, reason),
          watch: (script, changed) => fs_regular.watch(script, changed),
          warn: (details, message) => log.warn(details, message),
        },
      });
    const eventReturns = coordinatorPolicies.createCoordinatorEventReturns(party, {
      now: () => Date.now(),
      activeNames: () => activeNames().filter(name => name === party.merchantCharacter || farmingScopes.owner(name) === party.leader),
      enabled: eventsEnabledFor,
      checkpoint: eventCheckpoint,
      cancelConvoy: cancelActiveConvoy,
      startConvoy: startPartyMonsterConvoy,
      anniversaryParticipants: anniversaryCombatParticipants,
      navigation: farmingNavigation,
      persist: persistSettings,
    });
    const bankboiService = coordinatorPolicies.createCoordinatorBankboiService(
      party,
      character_manage,
      {
        now: () => Date.now(),
        plan: () => bankStackRouting.servicePlan(party),
        assignSlot: assignHeadlessSlot,
        stop: (block) => softkill_block(block),
        persistRoster: persistRosterState,
        persistBank: persistBankState,
        collect: queueMerchant,
        log: merchantLog,
      },
    );
    const merchantQueue = coordinatorPolicies.createCoordinatorMerchantQueue(party, {
      now: () => Date.now(),
      collectionReady: markedCollectionReady,
      capacitySignature: merchantCapacitySignature,
      routinePriority: merchantRoutinePriority,
      priority: merchantJobPriority,
      stamp: stampMerchantJob,
      persist: persistSettings,
      dispatch: dispatchMerchant,
      log: merchantLog,
    });
    const realmRoutes = coordinatorPolicies.createCoordinatorRealmActions(party, {
      now: () => Date.now(),
      sleep,
      pauseMerchant: pauseMerchantForRealmSwitch,
      native: nativeName,
      block: ensureCharacterBlock,
      stop: softkill_block,
      persist: persistSettings,
      label: realmLabel,
      dispatch: dispatchMerchant,
      resolve: (realm) => my_acc.resolve_realm(realm),
      bankBusy: () => bankboiService.busy(),
      participants: realmParticipants,
      current: () => realmControlPayload().currentRealm,
      home: accountHomeRealm,
      refresh: () => my_acc.updateInfo(),
    });
    const shutdownCoordinator = coordinatorPolicies.createShutdown({
      log: (message) => console.log(message),
      stopCharacters: () => characterManager.stopAll(),
      closeStorage: () => { movementPlanner.dispose(); localStorage.close(); },
      exit: () => process.exit(),
    });
    const { dispatcher: merchantDispatcher, idle: merchantIdle } =
      coordinatorPolicies.createCoordinatorMerchantServices(party, {
        now: () => Date.now(),
        headless: () => !party.steamMembers.includes(String(party.merchantCharacter)),
        travel: async (realm) => {
          const merchant = String(party.merchantCharacter);
          if (!my_acc.resolve_realm(realm)) throw new Error("Unknown merchant destination realm");
          const block = ensureCharacterBlock(merchant);
          party.merchantHomeReturnAt = 0;
          delete party.commands[merchant];
          block.realm = realm;
          persistSettings();
          await softkill_block(block);
        },
        ensureHome: ensureMerchantHome,
        routineNeedsHome: merchantRoutineNeedsHome,
        storageBusy: () => bankboiService.busy(),
        storagePlan: (state) => bankStackRouting.servicePlan(state, { includeCoolingDown: true }),
        startStorage: maybeStartBankboiService,
        anniversary: merchantAnniversaryControl,
        routinePriority: merchantRoutinePriority,
        priority: merchantJobPriority,
        capacityBlocked: merchantTransferCapacityBlocked,
        collectionReady: markedCollectionReady,
        pick: pickJobByPriority,
        stamp: stampMerchantJob,
        planPonty: (...args) => pontyMarket.planPurchase(...args),
        restock: policyFor,
        persist: persistSettings,
        log: merchantLog,
        inventoryMerge: (state, status) => merchantInventoryStacks.plan(state, status),
      });
    const farmAreaNavigation = coordinatorPolicies.createCoordinatorFarmNavigation(
      party,
      character_manage,
      {
        now: () => Date.now(),
        rareOwns: () => rareControl.owns(),
        members: () => farmingNavigation.members(),
        areas: farmingAreas,
        resolve: (catalog, ids, location) => farmZones.resolve(catalog, ids, location),
        areaId: (area) => farmZones.id(area),
        record: (state, reports, workers, areas, now) =>
          farmAreaControl.record(state, reports, workers, areas, now),
        intent: (name) => farmingNavigation.intent(name),
        contains: (area, report, margin, radius) =>
          farmZones.contains(area, report, margin, radius),
        huntOwns: huntTurnInOwnsTravel,
        eventOwns: (hunt, state) => huntPolicy.eventOwnsTravel(hunt, state),
        cancelConvoy: cancelActiveConvoy,
        alternatives: (state, areas, active, now, excluded) =>
          farmAreaControl.alternatives(state, areas, active, now, excluded),
        advanceHunt: advanceHuntMission,
        fighting: (report, now) => farmAreaControl.fighting(report, now),
        startHunt: startHuntConvoy,
        authorize: (names, location, force) => farmingNavigation.authorize(names, location, force),
        startConvoy: startPartyMonsterConvoy,
        persist: persistSettings,
      },
    );
    const partyConvoys = coordinatorPolicies.createCoordinatorPartyConvoys(party, {
      log: (message) => merchantLog(message, "info"),
      now: () => Date.now(),
      activeNames,
      intent: (name) => farmingNavigation.intent(name),
      resolveArea: (catalog, monsters, location) => farmZones.resolve(catalog, monsters, location),
      persist: persistSettings,
    });
    const anniversaryReturns = coordinatorPolicies.createCoordinatorAnniversaryReturns(party, {
      cancelConvoy: cancelActiveConvoy,
      now: () => Date.now(),
      participants: anniversaryCombatParticipants,
      activeNames,
      navigation: farmingNavigation,
      log: anniversaryLog,
      persist: persistSettings,
      schedule: scheduleAnniversaryReturnConvoy,
    });
    const anniversarySnapshot = coordinatorPolicies.createCoordinatorAnniversarySnapshot(
      party,
      character_manage,
      {
        now: () => Date.now(),
        counts: anniversaryCounts,
        enabled: eventsEnabledFor,
        owned: ownedCharacter,
        log: anniversaryLog,
        persist: persistSettings,
      },
    );
    const {
      lifecycle: huntLifecycle,
      convoy: huntConvoy,
      quests: huntQuests,
      tick: huntTick,
    } = coordinatorPolicies.createCoordinatorHunt(party, {
      now: () => Date.now(),
      participants: huntParticipants,
      fighting: () => convoyDefense.fighting(party, huntParticipants()),
      rareEncounter: () => rareControl.encounter(),
      cancelHuntConvoy,
      cancelConvoy: cancelActiveConvoy,
      clear: clearMonsterHuntState,
      persist: persistSettings,
      selectedDestination: selectedMonsterDestination,
      monsterDestination,
      missionDestination: (hunt) => huntSafety.missionDestination(hunt, monsterDestination),
      start: startPartyMonsterConvoy,
      navigation: farmingNavigation,
      ownsTravel: huntTurnInOwnsTravel,
      recordDeaths: (hunt) => huntSafety.recordDeaths(hunt, party.statuses, Date.now()),
      contains: (destination, status, margin, radius) =>
        farmZones.contains(destination, status, margin, radius),
      arrivalProtected: (hunt, status, destination) =>
        huntSafety.arrivalProtected(
          hunt,
          party.leader,
          status,
          farmingNavigation.intent(party.leader),
          destination,
          Date.now(),
        ),
      partyFighting: (hunt) => huntSafety.partyFighting(hunt, party.statuses, Date.now()),
    });
    const merchantRecovery = coordinatorPolicies.createCoordinatorMerchantRecovery(party, {
      now: () => Date.now(),
      clearOwnedCommand: (name, matches) => commandOwnership.clear(name, matches),
      restockSatisfied,
      stamp: stampMerchantJob,
      log: merchantLog,
      persist: persistSettings,
      dispatch: dispatchMerchant,
      recoverSale: recoverStalledMerchantSale,
    });
    party.deconstructionCatalog = coordinatorPolicies.loadCoordinatorDeconstructionCatalog(version, gameDataPorts);
    const deconstructionRoutes = coordinatorPolicies.createDeconstruction(party, {
      now: () => Date.now(), next: () => party.nextCommandId++, persist: persistSettings,
      owned: ownedCharacter, queue: queueMerchant, log: merchantLog,
      bankService: maybeStartBankboiService,
      persistBank: persistBankState,
      reserved: (name, slot, item) => {
        const lists = [party.marked[name], party.upgrades[name], party.statScrolls[name], party.merchantDeliveries[name],
          name === party.merchantCharacter ? party.npcSaleMarks : [], name === party.merchantCharacter ? party.standListings : []];
        if (lists.some(list => (list || []).some(mark => mark.slot === slot && sameMarkedItem(item, mark.item)))) return true;
        return (party.compounds[name] || []).some(group => group.items.some(mark => mark.slot === slot));
      },
    });
    const merchantScheduling = coordinatorPolicies.createCoordinatorMerchantScheduling(party, {
      log: merchantLog,
      reconcileItems: reconcileAutoItemMarks,
      reconcileUpgrades: reconcileAutoUpgradeMarks,
      reconcileSales: (report) => { const changed = deconstructionRoutes.reconcile(report.name); return reconcileAutomaticMerchantSales(report) || changed; },
      luck: scheduleMerchantLuck,
      recovery: merchantRecovery.observe,
      standMarket: observeStandMarket,
      giveaways: scheduleNearbyGiveaways,
      compounds: scheduleAutoCompound,
      exchanges: scheduleAutoExchange,
      policy: policyFor,
      queue: queueMerchant,
      markedItem,
      sameItem: sameMarkedItem,
      collectionSlots: collectionSlotCount,
      standSync: queueLocalStandSync,
      dispatch: dispatchMerchant,
      idle: dispatchMerchantIdle,
      startStorage: maybeStartBankboiService,
      logStorageError: merchantLog,
      clearOwnedCommand: (name, matches) => commandOwnership.clear(name, matches),
      dispatchBank,
      activeNames,
      persist: persistSettings,
      now: () => Date.now(),
    });
    const upgradePreviews = createUpgradePreviews(party);
    const heartbeatResponse = coordinatorPolicies.createCoordinatorHeartbeatResponse(party, {
      now: () => Date.now(),
      activeNames: () => activeNames().filter(n => n === party.merchantCharacter || farmingScopes.owner(n) === party.leader),
      enabled: eventsEnabledFor,
      intent: (name) => farmingNavigation.intent(name),
      escapeOwns: (name) => escapeControl.owns(name),
      rareControl: (name) => rareControl.control(name),
      convoySignal: (state, name) => convoyNavigation.signal(state, name),
      resolveArea: (catalog, focus, waypoint) => farmZones.resolve(catalog, focus, waypoint),
      waypoint: (name) => farmingNavigation.waypoint(name),
      rareEncounter: () => rareControl.encounter(),
      huntOwns: huntTurnInOwnsTravel,
      mapSubscriberCount,
      stackHomes: (bank, bankbois) => bankStackRouting.homes(bank, bankbois),
      groupedCombat: groupedCombatSnapshot,
      selectedEvents: (state, name) => selectedEvents(state, name),
      anniversary: publicAnniversaryState,
      rareOwns: () => rareControl.owns(),
    });
    const eventObservations = coordinatorPolicies.createCoordinatorEventObservations(party, {
      cancelConvoy: cancelActiveConvoy,
      releaseAnniversary: (cycle) => farmingNavigation.releaseReturn(cycle),
      now: () => Date.now(),
      activeNames: () => activeNames().filter(name => name === party.merchantCharacter || farmingScopes.owner(name) === party.leader),
      enabled: eventsEnabledFor,
      checkpoint: eventCheckpoint,
      navigation: farmingNavigation,
      persist: persistSettings,
      log: anniversaryLog,
      goobrawlStillFighting,
      begin: beginEventReturn,
      finishIfReady: finishEventReturnIfReady,
    });
    const {
      bankboi: bankboiObservation,
      merchant: merchantObservation,
      bankState: bankObservationState,
      bankPorts: bankObservationPorts,
    } = coordinatorPolicies.createCoordinatorStorageObservations(party, {
      now: () => Date.now(),
      stackHomes: (bank, bankbois) => bankStackRouting.homes(bank, bankbois),
      persistBank: persistBankState,
      log: merchantLog,
      persist: persistSettings,
      publish: scheduleALDataPublish,
      adoptReservedCargo: adoptReservedBankboiCargo,
    });
    const merchantExchangeRoutes = coordinatorPolicies.createMerchantExchangeRoutes(party, {
      now: () => Date.now(),
      nextCommand: () => party.nextCommandId++,
      stamp: stampMerchantJob,
      log: merchantLog,
      persist: persistSettings,
      dispatch: dispatchMerchant,
      queueStorage: queueExchangeStorage,
    });
    const {
      visits: anniversaryVisitRoutes,
      navigation: anniversaryNavigationRoutes,
      commerce: anniversaryCommerceRoutes,
      supplies: anniversarySuppliesRoute,
    } = coordinatorPolicies.createCoordinatorAnniversaryActions(party, {
      now: () => Date.now(),
      owned: ownedCharacter,
      enabled: eventsEnabledFor,
      intent: (name) => farmingNavigation.intent(name),
      snapshot: publicAnniversaryState,
      abort: abortAnniversaryRound,
      log: anniversaryLog,
      persist: persistSettings,
      scheduleReturn: scheduleAnniversaryReturnConvoy,
      huntOwns: huntTurnInOwnsTravel,
      supersede: (cycle) => farmingNavigation.supersede(cycle),
      cancelConvoy: cancelActiveConvoy,
      fallback: anniversaryFallbackDestination,
      participants: anniversaryCombatParticipants,
      capture: (names) => farmingNavigation.capture(names),
      identity: anniversaryTradeIdentity,
      alreadyTraded: anniversaryIdentityAlreadyTraded,
      publish: scheduleALDataPublish,
      counts: anniversaryCounts,
      persistBank: persistBankState,
      merchantLog,
    });
    const { market: aldataRoutes, postage: mailPostageRoute } =
      coordinatorPolicies.createCoordinatorMarketAccountActions(party, {
        now: () => Date.now(),
        randomBytes: (size) => crypto.randomBytes(size),
        snapshot: publicALDataState,
        fetch: aldataFetch,
        refresh: refreshALData,
        persistMarket: persistALData,
        publish: scheduleALDataPublish,
        stamp: stampMerchantJob,
        log: merchantLog,
        persist: persistSettings,
        dispatch: dispatchMerchant,
        versions: () => game_files.available_versions(),
        locate: (path, version) => game_files.locate_game_file(path, version),
        read: (path, encoding) => fs_regular.promises.readFile(path, encoding),
        postage: (html) => {
          const postage: import("./infrastructure/mail-platform.ts").MailPostagePlatform = require("../../scripts/mail-postage.cjs");
          return postage.mailPostage(html);
        },
      });
    const { creation: characterCreationRoutes, deletion: bankboiDeleteRoute } =
      coordinatorPolicies.createCoordinatorAccountCharacterActions(party, {
        now: () => Date.now(),
        classes: PARTY_CLASSES,
        characterCount: () => my_acc.response.characters.length,
        owned: ownedCharacter,
        session: sess,
        loadFetch: () => platform.loadFetch(),
        adopt: (snapshot) => {
          my_acc.response = snapshot;
        },
        refresh: () => my_acc.updateInfo(),
        later: (callback, milliseconds) => setTimeout(callback, milliseconds),
        assign: assignHeadlessSlot,
        persistBank: persistBankState,
        serviceBank: maybeStartBankboiService,
        log: merchantLog,
      });
    const {
      storage: bankboiStorageRoutes,
      unlock: bankUnlockRoute,
      restock: restockRoute,
    } = coordinatorPolicies.createCoordinatorBankActions(party, {
      now: () => Date.now(),
      identity: storageIdentity,
      log: merchantLog,
      signature: (state, entry) => bankStackRouting.storageSignature(state, entry),
      adopt: adoptReservedBankboiCargo,
      persistBank: persistBankState,
      plan: (state) => bankStackRouting.servicePlan(state, { includeCoolingDown: true }),
      restore: restoreMerchantAfterBankboi,
      stamp: stampMerchantJob,
      publicJob: publicMerchantJob,
      persist: persistSettings,
      dispatch: dispatchMerchant,
      owned: ownedCharacter,
    });
    const {
      focus: focusRoute,
      formation: formationRoute,
      actions: partyActionRoutes,
    } = coordinatorPolicies.createCoordinatorPartyConfiguration(party, character_manage, {
      changed: previous => coordinatorPolicies.reconcileFarmingMembership(party, farmingScopes, previous),
      now: () => Date.now(),
      owned: ownedCharacter,
      members: () => farmingNavigation.members(),
      invalidate: (...args) => farmingNavigation.invalidate(...args),
      persist: persistSettings,
      supported: supportedEvents,
      inherited: (name) => eventPolicy(party, name).inherited,
      selected: (name) => selectedEvents(party, name),
      release: () => escapeControl.release(),
      active: activeNames,
      authorize: (...args) => farmingNavigation.authorize(...args),
      dispatch: dispatchMerchant,
      escape: (names) => escapeControl.start(names),
      queue: queueMerchant,
      convoy: startPartyMonsterConvoy,
    });
    const {
      mode: huntModeRoute,
      blacklist: huntBlacklistRoute,
      settings: huntSettingsRoute,
      controls: huntControlRoutes,
    } = coordinatorPolicies.createCoordinatorHuntActions(party, {
      now: () => Date.now(),
      fighting: (state, names) => convoyDefense.fighting(state, names),
      participants: huntParticipants,
      intent: (name) => farmingNavigation.intent(name),
      release: () => escapeControl.release(),
      authorize: (...args) => farmingNavigation.authorize(...args),
      monsterDestination,
      clear: clearMonsterHuntState,
      selectedDestination: selectedMonsterDestination,
      convoy: startPartyMonsterConvoy,
      returnToDaisy: returnHuntToDaisy,
      begin: beginMonsterHuntCycle,
      waypoint: (name) => farmingNavigation.waypoint(name),
      validLocation: (catalog, focus, location) => validFarmingLocation(catalog, focus, location),
      persist: persistSettings,
      owned: ownedCharacter,
      ownsTravel: huntTurnInOwnsTravel,
      fresh: freshHuntParty,
      eventDeparture: (name, event, operation) => eventObservations.authorize(name, event, operation),
      cancelConvoy: cancelHuntConvoy,
      start: startHuntConvoy,
    });
    const eventRecoveryRoutes = coordinatorPolicies.createEventRecoveryRoutes(party, {
      owned: ownedCharacter,
      enabled: eventsEnabledFor,
      participants: anniversaryCombatParticipants,
      active: activeNames,
      abort: finishAnniversaryAbort,
      begin: beginEventReturn,
      snapshot: publicAnniversaryState,
    });
    const {
      events: eventAcknowledgementRoutes,
      engagement: convoyEngagementRoutes,
      farmingReturn: farmingReturnRoute,
      acknowledgements: convoyAcknowledgementRoutes,
    } = coordinatorPolicies.createCoordinatorNavigationActions(party, {
      now: () => Date.now(),
      owned: ownedCharacter,
      intent: (name) => farmingNavigation.intent(name),
      group: groupedCombatSnapshot,
      persist: persistSettings,
      selectedDestination: selectedMonsterDestination,
      finishReturn: finishEventReturnIfReady,
      contains: (...args) => farmZones.contains(...args),
      huntOwns: huntTurnInOwnsTravel,
      engage: (state, body, options) => convoyNavigation.engage(state, body, options),
      acceptArrival: (hunt, active, body, at) => huntSafety.acceptArrival(hunt, active, body, at),
      waypoint: (name) => farmingNavigation.waypoint(name),
      start: startPartyMonsterConvoy,
      active: activeNames,
      members: () => farmingNavigation.members(),
      valid: (state, body) => convoyNavigation.validReport(state, body),
      history: persistHistory,
      hold: (state, ...args) => convoyNavigation.hold(state, ...args),
      error: (message) => console.error(message),
    });
    const monsterSelectionRoutes = coordinatorPolicies.createMonsterSelectionRoutes(party, {
      now: () => Date.now(),
      validPhoenixOrder: (order) => rareHunting.validateOrder(party.monsterChoices, order),
      validLocation: (id, location) =>
        validFarmingLocation(party.monsterChoices || [], [id], location),
      destination: monsterDestination,
      release: () => escapeControl.release(),
      clearHunt: clearMonsterHuntState,
      members: () => farmingNavigation.members(),
      authorize: (...args) => farmingNavigation.authorize(...args),
      start: startPartyMonsterConvoy,
      startPhoenix: (order) => rareControl.start(order),
      stopPhoenix: (reason) => rareControl.stop(reason),
      persist: persistSettings,
      validPassive: (settings) => rareHunting.validPassiveSettings(settings),
      setPassive: (settings) => rareControl.setSettings(settings),
      invalidate: (...args) => farmingNavigation.invalidate(...args),
    });
    const staleOrderRoute = coordinatorPolicies.createStaleOrderRoute(party, persistSettings);
    const {
      automatic: automaticSaleRoutes,
      npc: npcSaleRoute,
      stand: standMarkRoute,
      handoff: merchantHandoffRoutes,
      receipts: inventoryReceiptRoutes,
      idle: merchantIdleRoute,
      bid: merchantBidRoute,
      merge: stackMergeRoute,
    } = coordinatorPolicies.createCoordinatorInventoryActions(party, {
      now: () => Date.now(),
      key: automaticCommerceRuleKey,
      reconcile: reconcileAutomaticMerchantSales,
      persist: persistSettings,
      publish: scheduleALDataPublish,
      syncStand: queueLocalStandSync,
      idle: dispatchMerchantIdle,
      persistBank: persistBankState,
      bankService: maybeStartBankboiService,
      stamp: stampMerchantJob,
      queue: queueMerchant,
      log: merchantLog,
      owned: ownedCharacter,
      dispatchBank,
      sameItem: sameMarkedItem,
      removeQueued: removeQueuedBidPurchases,
      observe: observeStandMarket,
      ponty: queuePontyMatches,
      aldata: queueALDataMatches,
      dispatch: dispatchMerchant,
      anniversary: merchantAnniversaryControl,
      bankboiBusy: () => bankboiService.busy(),
      plan: (state, status) => merchantInventoryStacks.plan(state, status),
      identity: bankStackRouting.identity,
    });
    const {
      progress: merchantProgressRoutes,
      marketplace: marketplaceProgressRoutes,
      clusters: merchantClusterRoutes,
      realms: merchantRealmRoutes,
      location: marketplaceLocationRoute,
    } = coordinatorPolicies.createCoordinatorMerchantJobActions(party, {
      now: () => Date.now(),
      priority: merchantJobPriority,
      routinePriority: merchantRoutinePriority,
      persist: persistSettings,
      stamp: stampMerchantJob,
      log: merchantLog,
      dispatch: dispatchMerchant,
      active: activeNames,
      fulfill: fulfillStandBid,
      dismiss: (key) => pontyService.dismiss(key),
      blacklist: blacklistMerchant,
      blacklistingEnabled: () => party.autoBlacklistMerchants !== false,
      resolve: (realm) => my_acc.resolve_realm(realm),
      block: ensureCharacterBlock,
      label: realmLabel,
      stop: (block) => softkill_block(block),
      later: (callback, delay) => setTimeout(callback, delay),
      fetchMarket: aldataFetch,
      normalizePurchases: normalizeALDataMerchants,
      normalizeSales: normalizeALDataMerchantBuyOrders,
    });
    let mailInbox: import("./http/mail-inbox.ts").MailInbox;
    const {
      mail: mailJobs,
      send: sendMailRoute,
      complete: merchantCompletionRoute,
    } = coordinatorPolicies.createCoordinatorMerchantDeliveryActions(party, {
      now: () => Date.now(),
      stamp: stampMerchantJob,
      persist: persistSettings,
      persistBank: persistBankState,
      dispatch: dispatchMerchant,
      bankboi: maybeStartBankboiService,
      log: merchantLog,
      identity: storageIdentity,
      inbox: () => mailInbox,
      fulfill: fulfillStandBid,
      clearUpgrades: clearResolvedUpgradeMarks,
      clearIncoming: clearIncomingCompoundReservation,
      capacitySignature: merchantCapacitySignature,
      persistALData,
      fetchMarket: aldataFetch,
      publishALData: scheduleALDataPublish,
      schedule: (callback, delay) => setTimeout(callback, delay),
      queue: queueMerchant,
      ensureHome: ensureMerchantHome,
      pontyMatches: queuePontyMatches,
      aldataMatches: queueALDataMatches,
    });
    const {
      orders: manualMarketOrderRoutes,
      controls: merchantControlRoutes,
      requests: merchantRequestRoutes,
    } = coordinatorPolicies.createCoordinatorMerchantActions(party, {
      now: () => Date.now(),
      stamp: stampMerchantJob,
      log: merchantLog,
      persist: persistSettings,
      dispatch: dispatchMerchant,
      plan: pontyMarket.planPurchase,
      automations: DEFAULT_MERCHANT_AUTOMATIONS,
      resolveRealm: (realm) => my_acc.resolve_realm(realm),
      block: ensureCharacterBlock,
      realmLabel,
      stop: (block) => softkill_block(block),
      later: (callback, milliseconds) => setTimeout(callback, milliseconds),
    });
    const manualNavigationCommands = coordinatorPolicies.createCoordinatorManualNavigation(party, {
      now: () => Date.now(),
      queue: queueMerchant,
      releaseEscape: () => escapeControl.release(),
      navigation: farmingNavigation,
      convoy: startPartyMonsterConvoy,
      block: ensureCharacterBlock,
      resolveRealm: (realm) => my_acc.resolve_realm(realm),
      realmLabel,
      stop: (block) => softkill_block(block),
      later: (callback, milliseconds) => setTimeout(callback, milliseconds),
      log: merchantLog,
      persist: persistSettings,
    });
    const merchantBlacklistRoute = coordinatorPolicies.createMerchantBlacklistRoute(party, {
      now: () => Date.now(),
      key: merchantBlacklistKey,
      log: merchantLog,
      persist: persistSettings,
    });
    const characterCommandRoute = coordinatorPolicies.createCoordinatorCharacterCommands(
      party,
      character_manage,
      {
        navigation: manualNavigationCommands.handle,
        farmingState: name => farmingScopes.effective(name),
        farmingLocation: validFarmingLocation,
        key: autoItemRuleKey,
        mode: autoItemRuleMode,
        persist: persistSettings,
        persistBank: persistBankState,
        queue: queueMerchant,
        reconcileUpgrades: reconcileAutoUpgradeMarks,
        reconcileMarks: reconcileAutoItemMarks,
        scheduleCompound: scheduleAutoCompound,
        scheduleExchange: scheduleAutoExchange,
        log: merchantLog,
        removeReservations: removeInventoryReservations,
        clearIncoming: clearIncomingCompoundReservation,
        marksCleared: () => { scheduleALDataPublish(); queueLocalStandSync(); },
        sameItem: sameMarkedItem,
        identity: storageIdentity,
        bankboi: maybeStartBankboiService,
      },
    );
    const dashboardImportRoutes = coordinatorPolicies.createCoordinatorDashboardImport(
      party,
      LOCALSTORAGE_PATH,
      {
        rosterReady: () => rosterPayload().length > 0,
        owned: ownedCharacter,
        crypto,
        files: fs_regular,
        header: (request, name) => request.get(name),
        now: () => Date.now(),
        persist: persistSettings,
      },
    );
    const workerSetup = coordinatorPolicies.createWorkerSetup(character_manage, party, {
      // Keep the original TypeError if a queued worker no longer has an account entry.
      configuredRealm,
      script: (name) => classScript("./CODE/adventure_land", ownedCharacter(name)!.type),
      watch: watchCharacterCode,
      persist: persistRosterState,
      start: start_char,
    });
    const rosterProjection = coordinatorPolicies.createRosterProjection(
      party,
      () => my_acc.response,
      () => Date.now(),
    );
    const {
      giveaways: giveawayScheduler,
      improvements: improvementScheduler,
      home: merchantHomeRecovery,
      sales: automaticMerchantSales,
      luck: luckScheduler,
    } = coordinatorPolicies.createCoordinatorMerchantAutomation(party, {
      now: () => Date.now(),
      stamp: stampMerchantJob,
      log: merchantLog,
      persist: persistSettings,
      queue: queueMerchant,
      publish: scheduleALDataPublish,
      syncStand: queueLocalStandSync,
      idle: dispatchMerchantIdle,
      dispatch: dispatchMerchant,
      names: activeNames,
      strong: hasStrongMluck,
      remaining: mluckRemaining,
      lead: mluckTravelLead,
      block: ensureCharacterBlock,
      realmLabel,
      stop: softkill_block,
      later: setTimeout,
    });
    const reservedBankboiCargo = coordinatorPolicies.createReservedBankboiCargo(party, {
      identity: (item) => bankStackRouting.identity(item),
      now: () => Date.now(),
      persist: persistBankState,
    });
    const inventoryReservations = coordinatorPolicies.createInventoryReservations(party);
    const bankQueueService = coordinatorPolicies.createBankQueue(party, {
      now: () => Date.now(),
      nextCommand: () => party.nextCommandId++,
    });
    const merchantOrderRoute = coordinatorPolicies.createMerchantOrderRoute(party, {
      now: () => Date.now(),
      nextCommand: () => party.nextCommandId++,
      activeNames,
      log: merchantLog,
      persist: persistSettings,
      dispatch: dispatchMerchant,
      persistBank: persistBankState,
      bankboi: maybeStartBankboiService,
    });
    const dashboardStream = coordinatorPolicies.createDashboardStream({
      now: Date.now, statuses: () => party.statuses,
      active: (name) => activeNames().includes(name) && Date.now() - Number(party.statuses[name]?.seenAt || 0) < 10000,
      every: (callback, ms) => setInterval(callback, ms), cancel: clearInterval,
    });
    const statusIngestion = coordinatorPolicies.createCoordinatorStatusIngestion(
      party,
      character_manage,
      {
        acceptCatalogs: body => {
          if (!body.clientVersion) return true;
          if (Number(body.clientVersion) !== version) return false;
          return body.runtime !== "headless" || (!character_manage[body.name]?.version && body.clientInstance === character_manage[body.name]?.clientInstance);
        },
        farmingState: name => isCombatCharacter(name) ? farmingScopes.effective(name) : party,
        rareOwns: name => !soloFor(name) && rareControl.owns(),
        now: () => Date.now(),
        owned: ownedCharacter,
        persistRoster: persistRosterState,
        itemKey: pontyMarket.itemKey,
        observePonty: (observation) => pontyService.observe(observation),
        bankState: bankObservationState,
        bankPorts: bankObservationPorts,
        merchant: merchantObservation.observe,
        groupedCombat: groupedCombatSnapshot,
        rareReport: (name, report) => rareControl.report(name, report),
        rareTick: () => rareControl.tick(),
        bankboi: bankboiObservation.observe,
        anniversary: reconcileAnniversaryReturnFromStatus,
        huntTick: monsterHuntTick,
        farmAreaTick,
        persist: persistSettings,
        abtesting: resolveAbtestingStrategy,
        activeNames,
        events: report => (soloFor(report.name)?.eventObservations || eventObservations).observe(report),
        publish: scheduleALDataPublish,
        convoyStep: stepAllConvoys,
        merchantScheduling: merchantScheduling.observe,
        response: (name, mode) => {
          const maintenance = consoleUpdate.current();
          if (maintenance) return { serverNow: Date.now(), consoleMaintenance: maintenance };
          const lease = mode ? undefined : dashboardStream.lease(name);
          return { ...(soloFor(name)?.heartbeatResponse || heartbeatResponse).response(name, mode),
            upgradePreview: upgradePreviews.next(name),
            merchantVisibility: merchantVisibility(party, name, Date.now()),
            ...(party.statuses[name]?.dashboardRuntime ? { dashboardLease: lease } : {}) };
        },
      },
    );
    const publicOverview = coordinatorPolicies.createCoordinatorPublicOverview(party, {
      accountCharacter: ownedCharacter,
      now: () => Date.now(),
      handoff: publicHandoff,
      aldata: publicALDataState,
      servers: () => my_acc.response?.servers || [],
      roster: rosterPayload,
      slots: slotPayload,
      classes: PARTY_CLASSES,
      anniversary: publicAnniversaryState,
      stamp: stampMerchantJob,
      collectionSlots: collectionSlotCount,
      collectionNearby: merchantCollectionNearby,
      luckSchedule: mluckScheduleStatus,
      realmControl: realmControlPayload,
    });
    const publicStateRoute = publicOverview.route;
    const {
      settings: merchantSettingsRoutes,
      priorities: routinePriorityRoute,
      thresholds: thresholdRoute,
    } = coordinatorPolicies.createCoordinatorMerchantConfiguration(party, {
      runtime: (name) => {
        const status = party.statuses[name];
        return status && !status.rip && Date.now() - status.seenAt < 10000
          ? status.combatSelection?.runtimeId : undefined;
      },
      ownedType: (name) => ownedCharacter(name)?.type,
      persist: persistSettings,
      dispatch: dispatchMerchant,
      log: merchantLog,
      priorities: DEFAULT_MERCHANT_ROUTINE_PRIORITIES,
      automations: DEFAULT_MERCHANT_AUTOMATIONS,
      bidPurchaseReasons: () => coordinatorPolicies.automaticBidPurchaseReasons,
      stamp: stampMerchantJob,
    });
    setInterval(() => merchantSettingsRoutes.bankSort.reconcile(), 1000);
    const { maps: mapStreams, combat: combatLogRoutes, prepareVersion } =
      coordinatorPolicies.createCoordinatorTelemetry(__dirname, version, party.combatLogs, {
        owned: ownedCharacter,
        now: () => Date.now(),
        persistHistory,
        data: gameDataPorts,
        every: (callback, milliseconds) => setInterval(callback, milliseconds),
        cancel: (timer: ReturnType<typeof setInterval>) => clearInterval(timer),
      });
    party.gameVersion = version;
    function catalogValidator(gameVersion: number) {
      return coordinatorPolicies.createInstalledCatalogValidation(gameVersion, () => {
        const context: { G?: CatalogDefinitions } = {};
        gameDataPorts.evaluate(gameDataPorts.read('./game_files/' + gameVersion + '/data.js'), context);
        if (!context.G) throw new Error('Catalog validation requires installed game definitions');
        return context.G;
      }, message => log.info({}, message));
    }
    Object.assign(party, { validateCatalog: catalogValidator(version) });
    const clientUpdates = coordinatorPolicies.createClientUpdates({
      current: () => ({version, revision: clientRevision}),
      refresh: force => {
        if (!game_files.refresh_latest) throw Error('Live client refresh is not installed');
        return game_files.refresh_latest(force);
      },
      prepare: async candidate => ({
        movement: await prepareMovement(candidate.version),
        validateCatalog: catalogValidator(candidate.version),
        activateMaps: prepareVersion(candidate.version),
        bankVaults: coordinatorPolicies.loadCoordinatorBankVaults(candidate.version, gameDataPorts),
        deconstruction: coordinatorPolicies.loadCoordinatorDeconstructionCatalog(candidate.version, gameDataPorts),
      }),
      activate: (candidate, data) => {
        data.activateMaps();
        version = candidate.version;
        clientRevision = candidate.revision;
        party.gameVersion = version;
        Object.assign(party, { validateCatalog: data.validateCatalog });
        party.bankVaults = data.bankVaults;
        party.deconstructionCatalog = data.deconstruction;
        party.merchantCatalog = null;
        party.merchantCatalogVersion = null;
        party.bestiaryCatalog = null;
        party.skillCatalog = null;
        party.monsterChoices = null;
        party.travelPlaces = null;
        party.appearanceChoices = null;
      },
      blocks: character_manage,
      stop: (block, reason) => characterManager.stop(block, reason),
      start: name => characterManager.start(name),
      healthy: (name, worker, candidate) => {
        const block = character_manage[name], report = party.statuses[name];
        return block.instance === worker && !!block.connected && report?.clientVersion === candidate.version &&
          report.clientInstance === block.clientInstance && Date.now() - report.seenAt < 10000;
      },
      now: () => Date.now(), sleep, cancel: clearTimeout,
      status: value => {
        party.clientUpdate = value;
        if (value.error) console.warn('Game client update failed', value);
        else console.log('Game client update ' + value.phase, value);
      },
    });
    // This legacy pseudo-routine is now folded into the single Merchant's Luck
    // itinerary and should no longer appear as a separately prioritized job.
    delete party.merchantRoutinePriorities["merchant luck exchange"];
    function mapSubscriberCount(name: Parameters<typeof mapStreams.count>[0]) {
      return mapStreams.count(name);
    }

    coordinatorPolicies.recoverMerchantQueue(party, () => Date.now(), stampMerchantJob);

    function persistRosterState() {
      persistence.roster();
    }

    function ownedCharacter(name: Parameters<typeof rosterProjection.owned>[0]) {
      return rosterProjection.owned(name);
    }

    function eventsEnabledFor(name: string, event?: string) {
      return event ? eventEnabled(party, name, event) : eventPolicy(party, name).enabled;
    }

    function rosterPayload() {
      return rosterProjection.roster();
    }

    function accountHomeRealm() {
      return rosterProjection.homeRealm();
    }

    function realmLabel(realm?: Parameters<typeof coordinatorPolicies.coordinatorRealmLabel>[0]) {
      return coordinatorPolicies.coordinatorRealmLabel(realm);
    }

    function realmParticipants() {
      return rosterProjection.participants();
    }

    function realmControlPayload() {
      return rosterProjection.control();
    }

    function nativeName() {
      return party.nativeOwner;
    }

    function slotPayload() {
      return rosterProjection.slots();
    }

    function persistBankState() {
      persistence.bank();
    }

    function queueExchangeStorage(
      job: Parameters<typeof storageService.queueExchange>[0],
      shortages?: Parameters<typeof storageService.queueExchange>[1],
    ) {
      return storageService.queueExchange(job, shortages);
    }

    function storageIdentity(
      item?: Parameters<typeof coordinatorPolicies.coordinatorStorageIdentity>[0],
    ) {
      return coordinatorPolicies.coordinatorStorageIdentity(item);
    }

    function adoptReservedBankboiCargo() {
      return reservedBankboiCargo.reconcile();
    }

    function persistSettings() {
      persistence.settings();
    }

    function persistHistory() {
      persistence.history();
    }

    function persistALData() {
      persistence.aldata();
    }

    function policyFor(name: Parameters<typeof coordinatorPolicies.coordinatorRestockPolicy>[1]) {
      return coordinatorPolicies.coordinatorRestockPolicy(party.restockPolicies, name);
    }

    function restockSatisfied(
      name: string,
      items: Parameters<typeof coordinatorPolicies.restockInventorySatisfied>[0],
    ) {
      return coordinatorPolicies.restockInventorySatisfied(items, () => policyFor(name));
    }

    function merchantLog(
      message: Parameters<typeof activity.merchant>[0],
      level: Parameters<typeof activity.merchant>[1] = "info",
      details?: Parameters<typeof activity.merchant>[2],
    ) {
      activity.merchant(message, level, details);
    }

    const anniversarySupplies = coordinatorPolicies.createAnniversarySupplies(party);

    function anniversaryLog(
      message: Parameters<typeof activity.anniversary>[0],
      level: Parameters<typeof activity.anniversary>[1] = "info",
      details?: Parameters<typeof activity.anniversary>[2],
    ) {
      activity.anniversary(message, level, details);
    }

    function anniversaryCounts() {
      return anniversarySupplies.counts();
    }

    function anniversaryTradeIdentity(
      owner: Parameters<typeof coordinatorPolicies.anniversaryTradeIdentity>[0],
      sender: Parameters<typeof coordinatorPolicies.anniversaryTradeIdentity>[1],
    ) {
      return coordinatorPolicies.anniversaryTradeIdentity(owner, sender);
    }

    function anniversaryIdentityAlreadyTraded(
      identity: Parameters<typeof anniversarySupplies.alreadyTraded>[0],
    ) {
      return anniversarySupplies.alreadyTraded(identity);
    }

    function publicAnniversaryState() {
      return anniversarySnapshot.snapshot();
    }

    const marketFeeds = coordinatorPolicies.createCoordinatorMarketFeeds(party, {
      baseUrl: process.env.AL_DATA_URL,
      now: () => Date.now(),
      sleep,
      fetch: (url, options) => fetch(url, options),
      timeout: (milliseconds) => AbortSignal.timeout(milliseconds),
      queueMarket: queueALDataMatches,
      queuePonty: queuePontyMatches,
      persistSettings,
      persistAuthentication: persistALData,
      anniversary: publicAnniversaryState,
      normalizePonty: (records, items) => pontyMarket.normalize(records, items),
      realmExists: (realm) => !!my_acc.resolve_realm(realm),
      every: (callback, milliseconds) => setInterval(callback, milliseconds),
    });
    const { client: aldataClient, aldata: aldataService, ponty: pontyService } = marketFeeds;
    async function aldataFetch(
      path: Parameters<typeof aldataClient.request>[0],
      options: Parameters<typeof aldataClient.request>[1] = {},
    ) {
      return aldataClient.request(path, options);
    }

    const { local: localMarket, bids: bidPurchases } =
      coordinatorPolicies.createCoordinatorPurchases(party, {
        now: () => Date.now(),
        priority: merchantJobPriority,
        publish: scheduleALDataPublish,
        log: merchantLog,
        prioritized: prioritizedStandBids,
        planPonty: (candidates, quantity, server, local) =>
          pontyMarket.planPurchase(candidates, quantity, server, local),
        stamp: stampMerchantJob,
        persist: persistSettings,
        dispatch: dispatchMerchant,
        blacklisted: isMerchantBlacklisted,
      });
    function publicALDataState() {
      return aldataService.snapshot();
    }

    function publicMerchantJob(job?: Parameters<typeof publicOverview.job>[0]) {
      return publicOverview.job(job);
    }

    function normalizeALDataMerchants(
      merchants: Parameters<typeof coordinatorPolicies.normalizeMarketSales>[0],
    ) {
      return coordinatorPolicies.normalizeMarketSales(merchants);
    }

    function normalizeALDataMerchantBuyOrders(
      merchants: Parameters<typeof coordinatorPolicies.normalizeMarketBids>[0],
    ) {
      return coordinatorPolicies.normalizeMarketBids(merchants);
    }

    function removeQueuedBidPurchases(itemId: Parameters<typeof bidPurchases.removeQueued>[0]) {
      return bidPurchases.removeQueued(itemId);
    }

    function fulfillStandBid(
      item: Parameters<typeof bidPurchases.fulfill>[0],
      quantity: Parameters<typeof bidPurchases.fulfill>[1],
    ) {
      return bidPurchases.fulfill(item, quantity);
    }

    function queuePontyMatches() {
      return bidPurchases.queuePonty();
    }

    function queueALDataMatches() {
      return bidPurchases.queueMarket();
    }

    function merchantBlacklistKey(
      entry?: Parameters<typeof coordinatorPolicies.merchantIdentityKey>[0],
    ) {
      return coordinatorPolicies.merchantIdentityKey(entry);
    }
    function isMerchantBlacklisted(
      entry?: Parameters<typeof coordinatorPolicies.merchantBlocked>[1],
    ) {
      return coordinatorPolicies.merchantBlocked(party.merchantBlacklist, entry, Date.now(), party.autoBlacklistMerchants !== false);
    }
    function blacklistMerchant(
      listing: Parameters<typeof coordinatorPolicies.recordMerchantFailure>[1],
      reason: Parameters<typeof coordinatorPolicies.recordMerchantFailure>[2],
    ) {
      return coordinatorPolicies.recordMerchantFailure(
        party.merchantBlacklist,
        listing,
        reason,
        Date.now(),
      );
    }

    async function refreshALData(kind: Parameters<typeof aldataService.refresh>[0] = "all") {
      return aldataService.refresh(kind);
    }

    async function publishALDataTrades() {
      return aldataService.publish();
    }

    function scheduleALDataPublish() {
      aldataPublicationScheduler.schedule();
    }

    marketFeeds.start();

    function observeStandMarket(listings: Parameters<typeof localMarket.observe>[0]) {
      return localMarket.observe(listings);
    }

    function markedItem(entry?: Parameters<typeof coordinatorPolicies.markedItem>[0]) {
      return coordinatorPolicies.markedItem(entry);
    }

    function sameMarkedItem(
      first?: Parameters<typeof coordinatorPolicies.sameMarkedItem>[0],
      second?: Parameters<typeof coordinatorPolicies.sameMarkedItem>[1],
    ) {
      return coordinatorPolicies.sameMarkedItem(first, second);
    }

    function autoItemRuleKey(item?: Parameters<typeof coordinatorPolicies.autoItemRuleKey>[0]) {
      return coordinatorPolicies.autoItemRuleKey(item);
    }

    function autoItemRuleMode(
      rules: Parameters<typeof coordinatorPolicies.autoItemRuleMode>[0],
      item?: Parameters<typeof coordinatorPolicies.autoItemRuleMode>[1],
    ) {
      return coordinatorPolicies.autoItemRuleMode(rules, item);
    }

    function automaticCommerceRuleKey(
      item?: Parameters<typeof coordinatorPolicies.automaticCommerceRuleKey>[0],
    ) {
      return coordinatorPolicies.automaticCommerceRuleKey(item);
    }

    function reconcileAutomaticMerchantSales(
      status?: Parameters<typeof automaticMerchantSales.reconcile>[0],
    ) {
      return automaticMerchantSales.reconcile(status);
    }

    function removeInventoryReservations(
      name: Parameters<typeof inventoryReservations.remove>[0],
      slot: Parameters<typeof inventoryReservations.remove>[1],
      item: Parameters<typeof inventoryReservations.remove>[2],
    ) {
      inventoryReservations.remove(name, slot, item);
    }

    function reconcileAutoItemMarks(
      name: Parameters<typeof coordinatorPolicies.reconcileCoordinatorCollectionMarks>[1],
      status?: Parameters<typeof coordinatorPolicies.reconcileCoordinatorCollectionMarks>[2],
    ) {
      if (!sharedMember(party, name)) return false;
      return coordinatorPolicies.reconcileCoordinatorCollectionMarks(party, name, status);
    }

    function clearResolvedUpgradeMarks(
      name: Parameters<typeof coordinatorPolicies.clearCoordinatorResolvedUpgrades>[1],
      resolved: Parameters<typeof coordinatorPolicies.clearCoordinatorResolvedUpgrades>[2],
    ) {
      coordinatorPolicies.clearCoordinatorResolvedUpgrades(party, name, resolved);
    }

    function reconcileAutoUpgradeMarks(
      name: Parameters<typeof coordinatorPolicies.reconcileCoordinatorUpgradeMarks>[1],
      status?: Parameters<typeof coordinatorPolicies.reconcileCoordinatorUpgradeMarks>[2],
    ) {
      if (!sharedMember(party, name)) return false;
      const compounds = coordinatorPolicies.reconcileCoordinatorCompoundMarks(party, name, status);
      return coordinatorPolicies.reconcileCoordinatorUpgradeMarks(party, name, status) || compounds;
    }

    function clearIncomingCompoundReservation(
      name: Parameters<typeof inventoryReservations.clearIncoming>[0],
      item: Parameters<typeof inventoryReservations.clearIncoming>[1],
    ) {
      inventoryReservations.clearIncoming(name, item);
    }

    function merchantRoutinePriority(
      reason: Parameters<typeof coordinatorPolicies.merchantRoutinePriority>[1],
    ) {
      return coordinatorPolicies.merchantRoutinePriority(party.merchantRoutinePriorities, reason);
    }

    function stampMerchantJob<T extends Parameters<typeof coordinatorPolicies.stampMerchantJob>[0]>(
      job: T,
    ) {
      return coordinatorPolicies.stampMerchantJob(job, merchantJobPriority, Date.now());
    }

    function merchantJobPriority(
      job: Parameters<typeof coordinatorPolicies.coordinatorMerchantPriority>[1],
    ) {
      return coordinatorPolicies.coordinatorMerchantPriority(party, job);
    }

    function prioritizedStandBids(
      reason: Parameters<typeof coordinatorPolicies.coordinatorPrioritizedBids>[1],
    ) {
      return coordinatorPolicies.coordinatorPrioritizedBids(party, reason);
    }

    function merchantTransferCapacityBlocked(
      job?: Parameters<typeof coordinatorPolicies.coordinatorMerchantTransferBlocked>[1],
    ) {
      return coordinatorPolicies.coordinatorMerchantTransferBlocked(party, job);
    }

    function collectionSlotCount(
      name: Parameters<typeof coordinatorPolicies.coordinatorCollectionSlots>[1],
    ) {
      return coordinatorPolicies.coordinatorCollectionSlots(party, name);
    }

    function merchantCollectionNearby(
      name: Parameters<typeof coordinatorPolicies.coordinatorCollectionNearby>[1],
    ) {
      return coordinatorPolicies.coordinatorCollectionNearby(party, name, () => Date.now());
    }

    function markedCollectionReady(
      job: Parameters<typeof coordinatorPolicies.coordinatorCollectionReady>[1],
    ) {
      return coordinatorPolicies.coordinatorCollectionReady(party, job, () => Date.now());
    }

    function pickJobByPriority() {
      return coordinatorPolicies.takeCoordinatorMerchantJob(party, () => Date.now());
    }

    function merchantCapacitySignature(
      name: Parameters<typeof coordinatorPolicies.coordinatorMerchantCapacitySignature>[1],
    ) {
      return coordinatorPolicies.coordinatorMerchantCapacitySignature(party, name);
    }

    function queueMerchant(
      names: Parameters<typeof merchantQueue.queue>[0],
      reason: Parameters<typeof merchantQueue.queue>[1] = "service",
    ) {
      merchantQueue.queue(names, reason);
    }

    function queueLocalStandSync() {
      return merchantQueue.localStandSync();
    }

    function scheduleNearbyGiveaways(status?: Parameters<typeof giveawayScheduler.schedule>[0]) {
      giveawayScheduler.schedule(status);
      giveawayScheduler.scheduleMarket(party.aldata.merchants);
    }

    function scheduleAutoCompound(
      name: Parameters<typeof improvementScheduler.compound>[0],
      status?: Parameters<typeof improvementScheduler.compound>[1],
    ) {
      return improvementScheduler.compound(name, status);
    }

    function scheduleAutoExchange(status?: Parameters<typeof improvementScheduler.exchange>[0]) {
      return improvementScheduler.exchange(status);
    }

    function merchantRoutineNeedsHome(
      reason: Parameters<typeof coordinatorPolicies.merchantRoutineNeedsHome>[0],
    ) {
      return coordinatorPolicies.merchantRoutineNeedsHome(reason);
    }

    function ensureMerchantHome(reason: Parameters<typeof merchantHomeRecovery.ensureHome>[0]) {
      const merchant = String(party.merchantCharacter);
      if (party.steamMembers.includes(merchant)) {
        party.merchantHomeReturnAt = 0;
        return "SR_" + String(party.statuses[merchant]?.server || "").replace(/^SR_/, "") === party.activeRealm;
      }
      return merchantHomeRecovery.ensureHome(reason);
    }

    function recoverStalledMerchantSale() {
      return merchantHomeRecovery.recoverStalledSale();
    }

    function dispatchMerchant() {
      if (consoleUpdate.current()) return;
      if (coordinatorPolicies.pruneIneligibleCollections(party, () => Date.now())) persistSettings();
      merchantDispatcher.dispatch();
    }

    function merchantAnniversaryControl() {
      const round = String(party.statuses[String(party.merchantCharacter)]?.anniversaryServer?.round);
      return coordinatorPolicies.merchantAnniversaryControl(
        party.merchantCharacter,
        !!party.merchantCharacter && eventsEnabledFor(party.merchantCharacter, "anniversary"),
        party.statuses[String(party.merchantCharacter)],
        party.anniversary.abortedRounds,
        Date.now(),
        party.anniversary.rounds[round]?.claims?.[String(party.merchantCharacter)] ? round : undefined,
      );
    }

    function dispatchMerchantIdle() {
      if (consoleUpdate.current()) return;
      merchantIdle.idle();
    }

    function activeNames() {
      return coordinatorPolicies.activeCoordinatorNames(party.statuses, Date.now());
    }

    function pauseMerchantForRealmSwitch() {
      coordinatorPolicies.pauseMerchantForRealm(party, () => Date.now(), stampMerchantJob);
    }

    function resolveAbtestingStrategy() {
      return coordinatorPolicies.updateCoordinatorABStrategy(party, {
        activeNames,
        enabled: eventsEnabledFor,
        now: Date.now,
        persist: persistSettings,
      });
    }

    function selectedMonsterDestination(
      name: Parameters<typeof coordinatorPolicies.selectCoordinatorMonsterDestination>[1],
    ) {
      return coordinatorPolicies.selectCoordinatorMonsterDestination(party, name);
    }

    const travelClock = coordinatorPolicies.createCoordinatorTravelClock(party, {
      convoyStep: () => {
        return stepAllConvoys();
      },
      persist: persistSettings,
      escapeStep: () => escapeControl.step(),
      disengagementTick: () => combatDisengagement.tick(),
      rareTick: () => rareControl.tick(),
      eventReturn: reconcileCombatEventReturn,
      anniversaryTick: () => anniversaryReturns.tick(),
      dispatchAnniversary: dispatchAnniversaryReturn,
      every: (callback, milliseconds) => setInterval(callback, milliseconds),
      // Node accepts null as a no-op; retain that call despite the narrower declaration.
      later: (callback, milliseconds) => setTimeout(callback, milliseconds),
      cancel: (timer) => clearTimeout(timer!),
    });
    travelClock.startTravel();

    const restartFailedHunt = coordinatorPolicies.createHuntRetreatRestart(party, {
      now: Date.now,
      intent: name => farmingNavigation.intent(name),
      participants: huntParticipants,
      releaseEscape: () => escapeControl.release(),
      begin: beginMonsterHuntCycle,
      persist: persistSettings,
    });
    const recoveryHooks = coordinatorPolicies.createCoordinatorRecoveryHooks(party, {
      huntParticipants,
      members: () => farmingNavigation.members(),
      intent: (name) => farmingNavigation.intent(name),
      cancelConvoy: cancelActiveConvoy,
      convoy: startPartyMonsterConvoy,
      persist: persistSettings,
      prepareHunt: prepareHuntQuests,
      escape: (names) => escapeControl.start(names),
      releaseEscape: () => escapeControl.release(),
      abandonRare: () => rareControl.abandon(),
      resumeHunt: () => monsterHuntTick(),
      restartFailedHunt,
    });
    const rareControl = rareHunting.createRareHunting(party, {...recoveryHooks.rare,
      routeDistance: createRareRouteDistance(request=>movementPlanner.plan(request),
        ()=>({version, fingerprint:movementFingerprints.get(version) || ''})),
    });
    const escapeControl = createEscape(party, recoveryHooks.escape);
    const combatDisengagement = createDisengagement(party, recoveryHooks.disengagement);

    function createSoloServices(name: string) {
      const party = farmingScopes.view(name);
      const activeNames = () => Object.keys(party.statuses).filter(n => n === name && Date.now() - party.statuses[n]!.seenAt < 10000);
      const rareControl = { owns: () => false, encounter: () => null, control: (_name: string) => null };
      const groupedCombatSnapshot = () => null;
      const huntParticipants = () => coordinatorPolicies.coordinatorHuntParticipants(party, Date.now, activeNames);
      const selectedMonsterDestination = (character: string | null) => coordinatorPolicies.selectCoordinatorMonsterDestination(party, character);
      const monsterDestination = (type: string | null | undefined) => coordinatorPolicies.coordinatorHuntDestination(party, type, (choices, focus) => farmZones.zones(choices, focus));
      const cancelHuntConvoy = () => coordinatorPolicies.cancelCoordinatorHuntConvoy(party);
      const clearMonsterHuntState = () => coordinatorPolicies.clearCoordinatorHunt(party);
      const farmingNavigation = createFarmingNavigation(party, {
        names: () => [name], activeNames,
        cancelConvoy: () => partyConvoys.cancel(),
        startConvoy: (...args) => partyConvoys.start(...args),
        persist: persistSettings, log: anniversaryLog,
      });

    const partyConvoys = coordinatorPolicies.createCoordinatorPartyConvoys(party, {
      log: (message) => merchantLog(message, "info"),
      now: () => Date.now(),
      activeNames,
      intent: (name) => farmingNavigation.intent(name),
      resolveArea: (catalog, monsters, location) => farmZones.resolve(catalog, monsters, location),
      persist: persistSettings,
    });

      const startPartyMonsterConvoy = partyConvoys.start;
      const cancelActiveConvoy = partyConvoys.cancel;

    const {
      lifecycle: huntLifecycle,
      convoy: huntConvoy,
      quests: huntQuests,
      tick: huntTick,
    } = coordinatorPolicies.createCoordinatorHunt(party, {
      now: () => Date.now(),
      participants: huntParticipants,
      fighting: () => convoyDefense.fighting(party, huntParticipants()),
      rareEncounter: () => rareControl.encounter(),
      cancelHuntConvoy,
      cancelConvoy: cancelActiveConvoy,
      clear: clearMonsterHuntState,
      persist: persistSettings,
      selectedDestination: selectedMonsterDestination,
      monsterDestination,
      missionDestination: (hunt) => huntSafety.missionDestination(hunt, monsterDestination),
      start: startPartyMonsterConvoy,
      navigation: farmingNavigation,
      ownsTravel: huntTurnInOwnsTravel,
      recordDeaths: (hunt) => huntSafety.recordDeaths(hunt, party.statuses, Date.now()),
      contains: (destination, status, margin, radius) =>
        farmZones.contains(destination, status, margin, radius),
      arrivalProtected: (hunt, status, destination) =>
        huntSafety.arrivalProtected(
          hunt,
          party.leader,
          status,
          farmingNavigation.intent(party.leader),
          destination,
          Date.now(),
        ),
      partyFighting: (hunt) => huntSafety.partyFighting(hunt, party.statuses, Date.now()),
    });

      const beginMonsterHuntCycle = huntLifecycle.begin;
      const freshHuntParty = huntLifecycle.fresh;
      const returnHuntToDaisy = huntQuests.returnToDaisy;
      const startHuntConvoy = huntConvoy.start;
      const advanceHuntMission = huntQuests.advance;

    const farmAreaNavigation = coordinatorPolicies.createCoordinatorFarmNavigation(
      party,
      character_manage,
      {
        now: () => Date.now(),
        rareOwns: () => rareControl.owns(),
        members: () => farmingNavigation.members(),
        areas: farmingAreas,
        resolve: (catalog, ids, location) => farmZones.resolve(catalog, ids, location),
        areaId: (area) => farmZones.id(area),
        record: (state, reports, workers, areas, now) =>
          farmAreaControl.record(state, reports, workers, areas, now),
        intent: (name) => farmingNavigation.intent(name),
        contains: (area, report, margin, radius) =>
          farmZones.contains(area, report, margin, radius),
        huntOwns: huntTurnInOwnsTravel,
        eventOwns: (hunt, state) => huntPolicy.eventOwnsTravel(hunt, state),
        cancelConvoy: cancelActiveConvoy,
        alternatives: (state, areas, active, now, excluded) =>
          farmAreaControl.alternatives(state, areas, active, now, excluded),
        advanceHunt: advanceHuntMission,
        fighting: (report, now) => farmAreaControl.fighting(report, now),
        startHunt: startHuntConvoy,
        authorize: (names, location, force) => farmingNavigation.authorize(names, location, force),
        startConvoy: startPartyMonsterConvoy,
        persist: persistSettings,
      },
    );


    const heartbeatResponse = coordinatorPolicies.createCoordinatorHeartbeatResponse(party, {
      now: () => Date.now(),
      activeNames,
      enabled: eventsEnabledFor,
      intent: (name) => farmingNavigation.intent(name),
      escapeOwns: (name) => escapeControl.owns(name),
      rareControl: (name) => rareControl.control(name),
      convoySignal: (state, name) => convoyNavigation.signal(state, name),
      resolveArea: (catalog, focus, waypoint) => farmZones.resolve(catalog, focus, waypoint),
      waypoint: (name) => farmingNavigation.waypoint(name),
      rareEncounter: () => rareControl.encounter(),
      huntOwns: huntTurnInOwnsTravel,
      mapSubscriberCount,
      stackHomes: (bank, bankbois) => bankStackRouting.homes(bank, bankbois),
      groupedCombat: groupedCombatSnapshot,
      selectedEvents: (state, name) => selectedEvents(state, name),
      anniversary: publicAnniversaryState,
      rareOwns: () => rareControl.owns(),
    });
      const eventCheckpoint = () => coordinatorPolicies.coordinatorEventCheckpoint(party, character => farmingNavigation.waypoint(character));
      const eventReturns = coordinatorPolicies.createCoordinatorEventReturns(party, {
        now: Date.now, activeNames, enabled: eventsEnabledFor, checkpoint: eventCheckpoint,
        cancelConvoy: cancelActiveConvoy, startConvoy: startPartyMonsterConvoy,
        anniversaryParticipants: activeNames, navigation: farmingNavigation, persist: persistSettings,
      });
      const beginEventReturn = eventReturns.begin;
      const finishEventReturnIfReady = eventReturns.finishIfReady;
      const eventObservations = coordinatorPolicies.createCoordinatorEventObservations(party, {
        now: Date.now, activeNames, enabled: eventsEnabledFor, checkpoint: eventCheckpoint,
        cancelConvoy: cancelActiveConvoy, releaseAnniversary: cycle => farmingNavigation.releaseReturn(cycle),
        navigation: farmingNavigation, persist: persistSettings, log: anniversaryLog,
        goobrawlStillFighting: eventReturns.goobrawlStillFighting,
        begin: beginEventReturn, finishIfReady: finishEventReturnIfReady,
      });
      const eventRecoveryRoutes = coordinatorPolicies.createEventRecoveryRoutes(party, {
        owned: ownedCharacter, enabled: eventsEnabledFor, participants: activeNames, active: activeNames,
        abort: finishAnniversaryAbort, begin: beginEventReturn, snapshot: publicAnniversaryState,
      });
      const focusRoute = coordinatorPolicies.createFocusRoute(party, {
        owned: ownedCharacter, members: () => [name], invalidate: (...args) => farmingNavigation.invalidate(...args), persist: persistSettings,
      });
    const {
      mode: huntModeRoute,
      blacklist: huntBlacklistRoute,
      settings: huntSettingsRoute,
      controls: huntControlRoutes,
    } = coordinatorPolicies.createCoordinatorHuntActions(party, {
      now: () => Date.now(),
      fighting: (state, names) => convoyDefense.fighting(state, names),
      participants: huntParticipants,
      intent: (name) => farmingNavigation.intent(name),
      release: () => {},
      authorize: (...args) => farmingNavigation.authorize(...args),
      monsterDestination,
      clear: clearMonsterHuntState,
      selectedDestination: selectedMonsterDestination,
      convoy: startPartyMonsterConvoy,
      returnToDaisy: returnHuntToDaisy,
      begin: beginMonsterHuntCycle,
      waypoint: (name) => farmingNavigation.waypoint(name),
      validLocation: (catalog, focus, location) => validFarmingLocation(catalog, focus, location),
      persist: persistSettings,
      owned: ownedCharacter,
      ownsTravel: huntTurnInOwnsTravel,
      fresh: freshHuntParty,
      eventDeparture: (name, event, operation) => eventObservations.authorize(name, event, operation),
      cancelConvoy: cancelHuntConvoy,
      start: startHuntConvoy,
    });

    const {
      events: eventAcknowledgementRoutes,
      engagement: convoyEngagementRoutes,
      farmingReturn: farmingReturnRoute,
      acknowledgements: convoyAcknowledgementRoutes,
    } = coordinatorPolicies.createCoordinatorNavigationActions(party, {
      now: () => Date.now(),
      owned: ownedCharacter,
      intent: (name) => farmingNavigation.intent(name),
      group: groupedCombatSnapshot,
      persist: persistSettings,
      selectedDestination: selectedMonsterDestination,
      finishReturn: finishEventReturnIfReady,
      contains: (...args) => farmZones.contains(...args),
      huntOwns: huntTurnInOwnsTravel,
      engage: (state, body, options) => convoyNavigation.engage(state, body, options),
      acceptArrival: (hunt, active, body, at) => huntSafety.acceptArrival(hunt, active, body, at),
      waypoint: (name) => farmingNavigation.waypoint(name),
      start: startPartyMonsterConvoy,
      active: activeNames,
      members: () => farmingNavigation.members(),
      valid: (state, body) => convoyNavigation.validReport(state, body),
      history: persistHistory,
      hold: (state, ...args) => convoyNavigation.hold(state, ...args),
      error: (message) => console.error(message),
    });

      const walks = {
        now: Date.now, members: () => [name], owned: ownedCharacter, enabled: eventsEnabledFor,
        start: startPartyMonsterConvoy, persist: persistSettings, cancel: cancelActiveConvoy,
        allowed: (activity: string) => ["town-return", "event-return"].includes(activity) || !huntTurnInOwnsTravel(party.monsterHunt),
      };
      return { state: party, eventReturns, eventObservations, eventRecoveryRoutes, focusRoute, farmingNavigation, partyConvoys, huntTick, farmAreaNavigation, heartbeatResponse,
        huntModeRoute, huntBlacklistRoute, huntSettingsRoute, huntControlRoutes,
        eventAcknowledgementRoutes, convoyEngagementRoutes, farmingReturnRoute, convoyAcknowledgementRoutes, walks };
    }
    function independentServices() {
      return activeNames().filter(name => isCombatCharacter(name) && farmingScopes.owner(name) === name && name !== party.leader)
        .map(name => soloFor(name)!);
    }
    function stepAllConvoys() {
      partyConvoys.recoverRestart();
      let changed = convoyNavigation.step(party);
      for (const service of independentServices()) {
        service.partyConvoys.recoverRestart();
        changed = convoyNavigation.step(service.state) || changed;
      }
      return changed;
    }
    function scopedRoute(main: HttpHandler, select: (service: ReturnType<typeof createSoloServices>) => HttpHandler, edit = false, savedMode = false): HttpHandler {
      return coordinatorPolicies.createScopedFarmingRoute(main, select, {
        owned: ownedCharacter, merchant: () => party.merchantCharacter, combat: isCombatCharacter, owner: farmingScopes.owner,
        solo: soloFor, mainOwner: () => party.leader, mode: name => farmingScopes.profile(name).farmingPolicy,
      }, edit, savedMode ? coordinatorPolicies.createSavedFarmingModeRoute({
        profile: farmingScopes.profile,
        validLocation: (focus, location) => validFarmingLocation(party.monsterChoices || [], focus, location),
        persist: persistSettings,
      }) : undefined);
    }
    function scopedRouter(router: HttpRouter): HttpRouter {
      const handlers = new Map<string, Map<string, HttpHandler>>();
      const register = (method: "get" | "post", path: string, main: HttpHandler) => router[method](path, (req, res) => {
        const name = String(coordinatorPolicies.requestObject(method === "get" ? req.query : req.body).character);
        if (!ownedCharacter(name)) return res.status(400).json({error: "unknown character"});
        const service = soloFor(name);
        if (!service) return main(req, res);
        if (!handlers.has(name)) {
          const routes = new Map<string, HttpHandler>();
          coordinatorPolicies.installSharedConvoyRoute({
            get: (url, handler) => routes.set("get " + url, handler),
            post: (url, handler) => routes.set("post " + url, handler),
          }, service.state, ownedCharacter, service.walks);
          handlers.set(name, routes);
        }
        return handlers.get(name)!.get(method + " " + path)!(req, res);
      });
      return { get: (path, handler) => register("get", path, handler), post: (path, handler) => register("post", path, handler) };
    }
    function isCombatCharacter(name: string) {
      return name !== party.merchantCharacter && party.statuses[name]?.ctype !== "merchant" && ownedCharacter(name)?.type !== "merchant";
    }
    function soloFor(name: string) {
      if (!isCombatCharacter(name) || farmingScopes.owner(name) === party.leader) return null;
      let service = soloServices.get(name);
      if (!service) { service = createSoloServices(name); soloServices.set(name, service); }
      return service;
    }

    function startPartyMonsterConvoy(
      locationInput: Parameters<typeof partyConvoys.start>[0],
      label?: Parameters<typeof partyConvoys.start>[1],
      participantNames?: Parameters<typeof partyConvoys.start>[2],
      purpose?: Parameters<typeof partyConvoys.start>[3],
      cause?: Parameters<typeof partyConvoys.start>[4],
    ) {
      return partyConvoys.start(locationInput, label, participantNames, purpose, cause);
    }

    function huntParticipants() {
      return coordinatorPolicies.coordinatorHuntParticipants(party, () => Date.now(), activeNames);
    }

    function cancelHuntConvoy() {
      return coordinatorPolicies.cancelCoordinatorHuntConvoy(party);
    }

    function cancelActiveConvoy() {
      return partyConvoys.cancel();
    }

    function clearMonsterHuntState() {
      return coordinatorPolicies.clearCoordinatorHunt(party);
    }

    function farmAreaTick() {
      farmAreaNavigation.tick();
      for (const service of independentServices()) service.farmAreaNavigation.tick();
    }

    function monsterDestination(
      type: Parameters<typeof coordinatorPolicies.coordinatorHuntDestination>[1],
    ) {
      return coordinatorPolicies.coordinatorHuntDestination(party, type, (choices, focus) =>
        farmZones.zones(choices, focus),
      );
    }

    function startHuntConvoy(
      hunt: Parameters<typeof huntConvoy.start>[0],
      location: Parameters<typeof huntConvoy.start>[1],
      label: Parameters<typeof huntConvoy.start>[2],
      nextStage: Parameters<typeof huntConvoy.start>[3],
    ) {
      return huntConvoy.start(hunt, location, label, nextStage);
    }

    function returnHuntToDaisy(hunt: Parameters<typeof huntQuests.returnToDaisy>[0]) {
      return huntQuests.returnToDaisy(hunt);
    }

    function huntTurnInOwnsTravel(hunt: import("../hunt/policy.ts").Hunt | null) {
      return huntPolicy.priority(hunt);
    }

    function advanceHuntMission(hunt: Parameters<typeof huntQuests.advance>[0]) {
      return huntQuests.advance(hunt);
    }

    function beginMonsterHuntCycle(
      returnPolicy?: Parameters<typeof huntLifecycle.begin>[0],
      returnLocation?: Parameters<typeof huntLifecycle.begin>[1],
      resume?: Parameters<typeof huntLifecycle.begin>[2],
    ) {
      return huntLifecycle.begin(returnPolicy, returnLocation, resume);
    }

    function freshHuntParty(hunt: Parameters<typeof huntLifecycle.fresh>[0]) {
      return huntLifecycle.fresh(hunt);
    }

    function prepareHuntQuests(hunt: Parameters<typeof huntQuests.prepare>[0]) {
      return huntQuests.prepare(hunt);
    }

    function monsterHuntTick(_previousStatus?: unknown, _changedName?: string) {
      if (party.leader) huntTick.tick();
      for (const service of independentServices()) {
        const before = JSON.stringify(service.state.monsterHunt);
        service.huntTick.tick();
        if (before !== JSON.stringify(service.state.monsterHunt)) persistSettings();
      }
    }

    function anniversaryCombatParticipants() {
      return activeNames().filter(
        (name) => name !== party.merchantCharacter && eventsEnabledFor(name, "anniversary"),
      );
    }

    function anniversaryFallbackDestination(_candidate?: unknown) {
      return farmingNavigation.waypoint(party.leader);
    }

    function abortAnniversaryRound(body: Parameters<typeof anniversaryReturns.abort>[0]) {
      return anniversaryReturns.abort(body);
    }

    function finishAnniversaryAbort(
      cycle: Parameters<typeof anniversaryReturns.finishAbort>[0],
      round: Parameters<typeof anniversaryReturns.finishAbort>[1],
      target: Parameters<typeof anniversaryReturns.finishAbort>[2],
      name: Parameters<typeof anniversaryReturns.finishAbort>[3],
      reason: Parameters<typeof anniversaryReturns.finishAbort>[4],
    ) {
      return anniversaryReturns.finishAbort(cycle, round, target, name, reason);
    }

    function dispatchAnniversaryReturn(force: Parameters<typeof anniversaryReturns.dispatch>[0]) {
      return anniversaryReturns.dispatch(force);
    }

    function scheduleAnniversaryReturnConvoy() {
      travelClock.scheduleAnniversary();
    }

    function reconcileAnniversaryReturnFromStatus(
      name: Parameters<typeof anniversaryReturns.reconcile>[0],
      status: Parameters<typeof anniversaryReturns.reconcile>[1],
    ) {
      return anniversaryReturns.reconcile(name, status);
    }

    travelClock.startReturns();

    function eventCheckpoint(_candidate?: unknown) {
      return coordinatorPolicies.coordinatorEventCheckpoint(party, (name) =>
        farmingNavigation.waypoint(name),
      );
    }

    function goobrawlStillFighting() {
      return eventReturns.goobrawlStillFighting();
    }
    function beginEventReturn(
      eventName: Parameters<typeof eventReturns.begin>[0],
      session?: Parameters<typeof eventReturns.begin>[1],
      forced: Parameters<typeof eventReturns.begin>[2] = false,
    ) {
      return eventReturns.begin(eventName, session, forced);
    }

    function finishEventReturnIfReady() {
      return eventReturns.finishIfReady();
    }

    function reconcileCombatEventReturn() {
      eventReturns.reconcile();
      for (const service of independentServices()) service.eventReturns.reconcile();
    }

    function mluckRemaining(status?: Parameters<typeof coordinatorPolicies.mluckRemaining>[0]) {
      return coordinatorPolicies.mluckRemaining(
        status,
        party.merchantCharacter,
        status && Number(party.mluckCastAt[status.name]),
        Date.now(),
      );
    }

    function hasStrongMluck(status?: Parameters<typeof coordinatorPolicies.hasStrongMluck>[0]) {
      return coordinatorPolicies.hasStrongMluck(status);
    }

    function mluckTravelLead(
      targetStatus: Parameters<typeof coordinatorPolicies.mluckTravelLead>[1],
    ) {
      return coordinatorPolicies.mluckTravelLead(
        party.statuses[String(party.merchantCharacter)],
        targetStatus,
      );
    }

    function scheduleMerchantLuck() {
      return luckScheduler.schedule();
    }

    function mluckScheduleStatus() {
      return luckScheduler.snapshot();
    }

    function dispatchBank() {
      if (consoleUpdate.current()) return;
      bankQueueService.dispatch();
    }

    let bwi_instance: WebMonitor | { publisher?: never } = {};
    coordinatorPolicies.startCoordinatorWebServices<WebMiddleware, WebRouter, WebMonitor>(
      cfg.web_app,
      cfg.enable_TYPECODE,
      {
        createRouter: () => express(),
        createMonitor: (options) => new bwi(options),
        retainMonitor: (monitor) => {
          bwi_instance = monitor;
        },
        staticFiles: (directory) => express.static(directory),
        directory: __dirname,
        updateRate: STAT_BEAT_INTERVAL,
        info: (details, message) => log.info(details, message),
        error: (...args) => console.error(...args),
        dashboard: (express_inst) =>
          coordinatorPolicies.installCoordinatorDashboard<WebMiddleware, WebMiddleware, WebRouter>(
            express_inst,
            {
              publicStateRoute,
              dashboardImportRoutes,
              anniversaryVisitRoutes,
              anniversaryNavigationRoutes,
              anniversaryCommerceRoutes,
              anniversarySuppliesRoute,
              mailPostageRoute,
              aldataRoutes,
              characterCreationRoutes,
              bankboiStorageRoutes,
              bankboiDeleteRoute,
              realmRoutes,
              statusIngestion,
              monsterSelectionRoutes,
              focusRoute: scopedRoute(focusRoute, service => service.focusRoute),
              formationRoute,
              huntBlacklistRoute: scopedRoute(huntBlacklistRoute, service => service.huntBlacklistRoute, true),
              huntSettingsRoute: scopedRoute(huntSettingsRoute, service => service.huntSettingsRoute, true),
              huntModeRoute: scopedRoute(huntModeRoute, service => service.huntModeRoute, true, true),
              huntControlRoutes: { permission: scopedRoute(huntControlRoutes.permission, service => service.huntControlRoutes.permission), retryReturn: scopedRoute(huntControlRoutes.retryReturn, service => service.huntControlRoutes.retryReturn), interactionComplete: scopedRoute(huntControlRoutes.interactionComplete, service => service.huntControlRoutes.interactionComplete) },
              eventRecoveryRoutes: { disabled: scopedRoute(eventRecoveryRoutes.disabled, service => service.eventRecoveryRoutes.disabled), ended: scopedRoute(eventRecoveryRoutes.ended, service => service.eventRecoveryRoutes.ended) },
              eventAcknowledgementRoutes: { progress: scopedRoute(eventAcknowledgementRoutes.progress, service => service.eventAcknowledgementRoutes.progress), townComplete: scopedRoute(eventAcknowledgementRoutes.townComplete, service => service.eventAcknowledgementRoutes.townComplete), returnComplete: scopedRoute(eventAcknowledgementRoutes.returnComplete, service => service.eventAcknowledgementRoutes.returnComplete), resumeComplete: scopedRoute(eventAcknowledgementRoutes.resumeComplete, service => service.eventAcknowledgementRoutes.resumeComplete) },
              convoyEngagementRoutes: { engage: scopedRoute(convoyEngagementRoutes.engage, service => service.convoyEngagementRoutes.engage), approach: scopedRoute(convoyEngagementRoutes.approach, service => service.convoyEngagementRoutes.approach) },
              farmingReturnRoute: scopedRoute(farmingReturnRoute, service => service.farmingReturnRoute),
              convoyAcknowledgementRoutes: { complete: scopedRoute(convoyAcknowledgementRoutes.complete, service => service.convoyAcknowledgementRoutes.complete), failed: scopedRoute(convoyAcknowledgementRoutes.failed, service => service.convoyAcknowledgementRoutes.failed) },
              partyActionRoutes,
              merchantSettingsRoutes,
              staleOrderRoute,
              standMarkRoute,
              npcSaleRoute,
              deconstructionRoutes,
              automaticSaleRoutes,
              routinePriorityRoute,
              merchantBlacklistRoute,
              merchantControlRoutes,
              merchantBidRoute,
              stackMergeRoute,
              merchantIdleRoute,
              merchantRequestRoutes,
              sendMailRoute,
              manualMarketOrderRoutes,
              merchantOrderRoute,
              merchantExchangeRoutes,
              merchantHandoffRoutes,
              merchantProgressRoutes,
              marketplaceProgressRoutes,
              merchantRealmRoutes,
              marketplaceLocationRoute,
              merchantClusterRoutes,
              bankUnlockRoute,
              merchantCompletionRoute,
              inventoryReceiptRoutes,
              restockRoute,
              thresholdRoute,
              characterCommandRoute,
            },
            {
              json: (options) => express.json(options),
              text: (options) => express.text(options),
              maps: (router) => {
                upgradePreviews.install(router);
                router.get('/party-api/console-maintenance', (_req, res) => res.json(consoleUpdate.status(party.statuses,
                  [...party.headlessSlots, ...party.steamMembers], !!party.steamSwitch && party.steamSwitch.phase !== 'complete')));
                coordinatorPolicies.installMovementRoutes(router, movementPlanner, ownedCharacter);
                installProductionRoutes(router, party, persistSettings, merchantLog);
                installSharedRuleRoutes(router, party, persistSettings);
                router.post("/party-api/merchant/native-stand", coordinatorPolicies.createNativeStandRoute(party, { fulfill: fulfillStandBid, persist: persistSettings }));
                mapStreams.install(router);
                coordinatorPolicies.installSharedConvoyRoute(scopedRouter(router), party, ownedCharacter, {
                  now: () => Date.now(), members: () => farmingNavigation.members(), owned: ownedCharacter,
                  enabled: eventsEnabledFor, start: startPartyMonsterConvoy, persist: persistSettings, cancel: cancelActiveConvoy,
                  allowed: (activity) => (!party.escape || party.escape.stage === "released") &&
                    (["town-return", "event-return"].includes(activity) || !huntTurnInOwnsTravel(party.monsterHunt)),
                });
              },
              liveTelemetry: (router) => dashboardStream.install(router),
              combatLogs: (router) => combatLogRoutes.install(router),
              roster: (express_inst) => {
                const ownership = coordinatorPolicies.coordinatorOwnership(party);
                installRosterRoutes(
                  express_inst,
                  ownership,
                  coordinatorPolicies.createCoordinatorOwnershipPorts(party, character_manage, {
                    now: Date.now,
                    id: () => crypto.randomUUID(),
                    save: persistRosterState,
                    owned: ownedCharacter,
                    updateAccount: () => my_acc.updateInfo(),
                    sleep,
                    stop: softkill_block,
                    assignSlot: assignHeadlessSlot,
                    roster: rosterPayload,
                    configuredRealm,
                    releaseBankboi: (confirm) => bankboiService.releaseForSteam(confirm),
                  }),
                );
              },
              startMail: () =>
                coordinatorPolicies.startCoordinatorMail(party, my_acc, {
                  session: sess,
                  loadFetch: () => platform.loadFetch(),
                  timeout: (milliseconds) => AbortSignal.timeout(milliseconds),
                  createInbox: createMailInbox,
                  enqueue: mailJobs.collect,
                  retain: (inbox) => {
                    mailInbox = inbox;
                  },
                  current: () => mailInbox,
                  every: (callback, milliseconds) => setInterval(callback, milliseconds),
                }),
            },
          ),
      },
    );

    function sleep(ms?: Parameters<typeof setTimeout>[1]) {
      return new Promise<void>((resolve) => setTimeout(resolve, ms));
    }

    function groupedCombatSnapshot() {
      return coordinatorPolicies.coordinatorGroupedSnapshot(party, {
        now: Date.now,
        tickDisengagement: () => combatDisengagement.tick(),
        disengagementActive: () => combatDisengagement.active(),
        intent: (name) => farmingNavigation.intent(name),
        owned: ownedCharacter,
        prepare: (members) => combatDisengagement.prepare(members),
        evaluate: evaluateGroup,
        finalize: (group) => combatDisengagement.finalize(group),
        blocksPulls: () => rareControl.blocksPulls(),
        patrolAcquisitionAllowed: () => rareControl.patrolAcquisitionAllowed?.() || false,
      });
    }

    function watchCharacterCode(
      char_name: Parameters<typeof characterCode.watch>[0],
      char_block: Parameters<typeof characterCode.watch>[1],
    ) {
      characterCode.watch(char_name, char_block);
    }

    function ensureCharacterBlock(name: Parameters<typeof workerSetup.ensure>[0]) {
      return workerSetup.ensure(name);
    }

    function assignHeadlessSlot(
      slot: Parameters<typeof workerSetup.assign>[0],
      name: Parameters<typeof workerSetup.assign>[1],
    ) {
      workerSetup.assign(slot, name);
    }

    async function restoreMerchantAfterBankboi(
      transaction: Parameters<typeof bankboiService.restore>[0],
    ) {
      return bankboiService.restore(transaction);
    }

    async function maybeStartBankboiService() {
      return bankboiService.start();
    }
    //attempts to softkill child processes
    //by sending an ipc if the client is connected and giving some timeout
    //why not actual SIGTERM? cause windows cant even
    async function softkill_block(
      char_block: Parameters<typeof characterManager.stop>[0],
      reason: Parameters<typeof characterManager.stop>[1] = "requested worker restart",
    ) {
      return characterManager.stop(char_block, reason);
    }

    function update_siblings_and_acc(info: Parameters<typeof characterManager.siblings>[0]) {
      characterManager.siblings(info);
    }
    function start_char(char_name: Parameters<typeof characterManager.start>[0]) {
      return characterManager.start(char_name);
    }
    //TODO beta new logic for #5
    //i need to implement decent lifecycle-handling
    async function shutdown(signal: Parameters<typeof shutdownCoordinator>[0]) {
      return shutdownCoordinator(signal);
    }
    coordinatorPolicies.startCoordinatorCharacters(character_manage, party, {
      events: process,
      shutdown,
      watch: watchCharacterCode,
      owned: ownedCharacter,
      ensure: ensureCharacterBlock,
      start: start_char,
      persist: persistRosterState,
      later: (callback, milliseconds) => setTimeout(callback, milliseconds),
      watchCode: cfg.watch_CODE,
      watchGenerations,
      stop: softkill_block,
      report: (message, details) => console.log(message, details),
      subscribeAccount: () => my_acc.add_listener(update_siblings_and_acc),
    });
  })().catch((e) => {
    console.error("failed to start caracAL", e);
  });
}
