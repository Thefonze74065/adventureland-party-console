import { requestObject, type HttpRequest, type HttpResponse } from "../http/contracts.ts";

/**
 * Realms automatic realm hopping (boss chase, daily-event chase) must never pick,
 * e.g. ones whose ping cripples DPS. PVP realms are always excluded on top of
 * this list. Manual realm switching and the return home are not hop choices.
 */
export function initialRealmHopBlacklist(saved: unknown): string[] {
  return Array.isArray(saved) ? [...new Set(saved.filter((realm): realm is string => typeof realm === "string"))] : [];
}

export function realmHopAllowed(blacklist: readonly string[], realm: string): boolean {
  return !realm.endsWith("PVP") && !blacklist.includes(realm);
}

interface RealmHopBlacklistState {
  realmHopBlacklist: string[];
}
interface RealmHopBlacklistPorts {
  realmExists(realm: string): boolean;
  log(message: string, level: string): void;
  persist(): void;
}

export function createRealmHopBlacklistRoute(state: RealmHopBlacklistState, ports: RealmHopBlacklistPorts) {
  return function realmHopBlacklist(req: HttpRequest, res: HttpResponse): unknown {
    const realms = requestObject(req.body).realms;
    if (!Array.isArray(realms) || !realms.every((realm): realm is string => typeof realm === "string"))
      return res.status(400).json({ error: "realms must be a list of realm keys" });
    if (new Set(realms).size !== realms.length) return res.status(400).json({ error: "realms must not repeat" });
    const unknown = realms.filter((realm) => !ports.realmExists(realm));
    if (unknown.length) return res.status(400).json({ error: "unknown Adventure Land realm: " + unknown.join(", ") });
    state.realmHopBlacklist = realms;
    ports.log("Realm hopping blacklist: " + (realms.length ? realms.join(", ") : "none"), "info");
    ports.persist();
    return res.json({ ok: true, realmHopBlacklist: state.realmHopBlacklist });
  };
}
