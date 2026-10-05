import { partyApiResponseHeaders } from "./middleware.ts";
import {
  installAnniversaryAndCommerceRoutes,
  installFarmingAndTravelRoutes,
  installMerchantControlsRoutes,
  installMerchantTransactionsRoutes,
} from "./registration.ts";
import type {
  AnniversaryAndCommerceHandlers,
  FarmingAndTravelHandlers,
  MerchantControlsHandlers,
  MerchantTransactionsHandlers,
} from "./registration.ts";

interface DashboardRouter<Handler, Middleware> {
  get: (path: string, handler: Handler) => unknown;
  post: (path: string, ...handlers: (Handler | Middleware)[]) => unknown;
  use: {
    (middleware: Middleware): unknown;
    (path: string, middleware: typeof partyApiResponseHeaders): unknown;
  };
}
type DashboardHandlers<Handler> = AnniversaryAndCommerceHandlers<Handler> &
  FarmingAndTravelHandlers<Handler> &
  MerchantControlsHandlers<Handler> &
  MerchantTransactionsHandlers<Handler> & {
    publicStateRoute: Handler;
    dashboardImportRoutes: { metadata: Handler; exportState: Handler; preferences: Handler; preview: Handler; importState: Handler };
    characterCreationRoutes: { roster: Handler; bankboi: Handler };
    bankboiStorageRoutes: { checkpoint: Handler; complete: Handler };
    bankboiDeleteRoute: Handler;
    realmRoutes: { switchRealm: Handler; homeComplete: Handler };
    bossChaseRoute: Handler;
    dailyChaseRoute: Handler;
    realmHopBlacklistRoute: Handler;
    statusIngestion: { handle: Handler };
    partyActionRoutes: { escape: Handler };
  };
interface DashboardPorts<Handler, Middleware, Router> {
  json: (options: { limit: string }) => Middleware;
  text: (options: { type: string; limit: string }) => Middleware;
  maps: (router: Router) => void;
  liveTelemetry?: (router: Router) => void;
  roster: (router: Router) => void;
  combatLogs: (router: Router) => void;
  startMail: () => {
    snapshot: Handler;
    action: (name: "refresh" | "collect" | "delete") => Handler;
  };
}

/** Install the dashboard in its original middleware, route and service-start order. */
export function installCoordinatorDashboard<
  Handler,
  Middleware,
  Router extends DashboardRouter<Handler, Middleware>,
>(
  router: Router,
  handlers: DashboardHandlers<Handler>,
  ports: DashboardPorts<Handler, Middleware, Router>,
): void {
  // Initial heartbeats include catalogs plus the merchant's bank. Expanded
  // reward tables and a populated bank can exceed 12 MB; later reports omit catalogs.
  router.use(ports.json({ limit: "32mb" }));
  router.use("/party-api", partyApiResponseHeaders);
  router.get("/party-api/state", handlers.publicStateRoute);
  router.get("/party-api/dashboard-state/export", handlers.dashboardImportRoutes.exportState);
  router.post("/party-api/dashboard-preferences", handlers.dashboardImportRoutes.preferences);
  router.get("/party-api/dashboard-state", handlers.dashboardImportRoutes.metadata);
  router.post(
    "/party-api/dashboard-state/preview",
    ports.text({ type: "text/plain", limit: "128mb" }),
    handlers.dashboardImportRoutes.preview,
  );
  router.post(
    "/party-api/dashboard-state/import",
    ports.text({ type: "text/plain", limit: "128mb" }),
    handlers.dashboardImportRoutes.importState,
  );
  installAnniversaryAndCommerceRoutes(router, handlers);
  ports.maps(router);
  ports.liveTelemetry?.(router);
  router.post("/party-api/roster/create", handlers.characterCreationRoutes.roster);
  router.post("/party-api/bankbois/create", handlers.characterCreationRoutes.bankboi);
  router.post("/party-api/bankboi/checkpoint", handlers.bankboiStorageRoutes.checkpoint);
  router.post("/party-api/bankboi/complete", handlers.bankboiStorageRoutes.complete);
  router.post("/party-api/bankbois/:name/delete", handlers.bankboiDeleteRoute);
  ports.roster(router);
  router.post("/party-api/realm/switch", handlers.realmRoutes.switchRealm);
  router.post("/party-api/realm/home-complete", handlers.realmRoutes.homeComplete);
  router.post("/party-api/realm/boss-chase", handlers.bossChaseRoute);
  router.post("/party-api/realm/hop-blacklist", handlers.realmHopBlacklistRoute);
  router.post("/party-api/realm/daily-chase", handlers.dailyChaseRoute);
  router.post("/party-api/status", handlers.statusIngestion.handle);
  ports.combatLogs(router);
  installFarmingAndTravelRoutes(router, handlers);
  router.post("/party-api/escape", handlers.partyActionRoutes.escape);
  installMerchantControlsRoutes(router, handlers);
  const mail = ports.startMail();
  router.get("/party-api/mail", mail.snapshot);
  for (const action of ["refresh", "collect", "delete"] as const)
    router.post("/party-api/mail/" + action, mail.action(action));
  installMerchantTransactionsRoutes(router, handlers);
}
