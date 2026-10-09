import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { MerchantWork } from "../merchant/work.ts";
import type { RealmRequest } from '../characters/realm-request.ts';

interface MerchantRealmState {
  merchantCharacter: string | null;
  merchantCurrent: MerchantWork | null;
  activeRealm: string;
  merchantRealmRequests?: Record<string, RealmRequest | undefined>;
}
interface RealmBlock {
  realm?: string;
  connected?: boolean;
}
interface MerchantRealmPorts<Block extends RealmBlock> {
  now(): number;
  resolve(realm: string): unknown;
  block(name: string): Block;
  log(message: string, level: string): void;
  persist(): void;
  restart(block: Block, delay: number): void;
  label(realm: string): string;
}
const realmJobs = [
  "ALData marketplace purchases",
  "ALData marketplace sales",
  "join giveaway",
  "Ponty purchases",
];

function matchingRealmJob(current: MerchantWork | null, jobId: unknown): current is MerchantWork {
  return !!current && current.id === jobId && realmJobs.includes(current.reason);
}

export function createMerchantRealmRoutes<Block extends RealmBlock>(
  state: MerchantRealmState,
  ports: MerchantRealmPorts<Block>,
) {
  function switchRealm(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      current = state.merchantCurrent,
      merchant = state.merchantCharacter;
    if (!merchant || !matchingRealmJob(current, body.jobId) || body.character !== merchant)
      return res.status(409).json({ error: "ALData marketplace job is no longer current" });
    const realm = typeof body.realm === "string" ? body.realm : "";
    if (!ports.resolve(realm))
      return res.status(400).json({ error: "unknown Adventure Land realm" });
    const block = ports.block(merchant);
    if (block.realm === realm && block.connected) return res.json({ ok: true, alreadyThere: true });
    block.realm = realm;
    (state.merchantRealmRequests ||= {})[merchant] = {realm, owner:'job', requestedAt:ports.now(), attempts:1};
    current.phase = "switching realm";
    current.heartbeatAt = current.progressAt = ports.now();
    ports.log(
      "Switching " +
        merchant +
        " to " +
        realm.replace(/^SR_/, "") +
        (current.reason === "join giveaway"
          ? " for giveaway entry"
          : " for marketplace transaction"),
      "info",
    );
    ports.persist();
    const response = res.json({ ok: true, realm });
    ports.restart(block, 150);
    return response;
  }
  function ensureHome(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      merchant = state.merchantCharacter;
    if (!merchant || body.character !== merchant)
      return res.status(409).json({ error: "merchant is no longer configured" });
    const realm = typeof body.realm === "string" ? body.realm : "";
    if (realm !== state.activeRealm || !ports.resolve(realm))
      return res.status(400).json({ error: "invalid merchant home realm" });
    const block = ports.block(merchant);
    if (block.realm === realm && block.connected) return res.json({ ok: true, alreadyThere: true });
    block.realm = realm;
    (state.merchantRealmRequests ||= {})[merchant] = {realm, owner:'home', requestedAt:ports.now(), attempts:1};
    ports.log(
      "Returning " + merchant + " to active realm " + ports.label(realm) + " before opening stand",
      "info",
    );
    ports.persist();
    const response = res.json({ ok: true, realm });
    ports.restart(block, 150);
    return response;
  }
  return { switchRealm, ensureHome };
}
