import { realmPattern } from "./realms.ts";
interface Character {
  name: string;
  type?: string;
  ctype?: string;
}
interface Account {
  characters: Character[];
  servers: { key: string }[];
}
export function sessionValue(raw: string) {
  const session = raw.trim().replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
  // MongoDB accounts use US_ IDs; older accounts may still export numeric IDs.
  if (!/^(?:\d+|US_[A-Za-z0-9_]+)-[A-Za-z0-9._~-]+$/.test(session))
    throw new Error("Invalid game session format. Copy the full user ID and auth value shown by the CODE command above.");
  return session;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
export function accountPayload(payload: unknown): Account {
  const value = record(payload);
  const infs = Array.isArray(value.infs) ? value.infs : [];
  const account = record(
    Array.isArray(payload)
      ? payload[0]
      : value.characters
        ? value
        : infs.find((info) => record(info).type === "servers_and_characters"),
  );
  if (!Array.isArray(account.characters) || !Array.isArray(account.servers))
    throw new Error("Game session was not accepted. Copy a fresh session from Steam.");
  if (
    !account.characters.every((character) => typeof record(character).name === "string") ||
    !account.servers.every((server) => typeof record(server).key === "string")
  )
    throw new Error("Invalid game account response");
  return account as unknown as Account;
}
export async function accountConfig(session: string, realm: string) {
  if (!realmPattern.test(realm)) throw new Error("Invalid realm");
  const response = await fetch("https://adventure.land/api/servers_and_characters", {
    method: "POST",
    headers: { Cookie: "auth=" + session, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Game account service unavailable");
  const account = accountPayload(await response.json());
  if (!account.servers.some((server) => server.key === realm))
    throw new Error("That realm is not available");
  const characters = Object.fromEntries(
    account.characters.map((character) => [
      character.name,
      {
        realm,
        enabled: false,
        script: "adventure_land/party-member.js",
        version: 0,
      },
    ]),
  );
  const merchant =
    account.characters.find((character) => (character.type || character.ctype) === "merchant")
      ?.name || null;
  return {
    session: "",
    characters,
    merchant,
    cull_versions: true,
    enable_TYPECODE: false,
    watch_CODE: false,
    log_level: "info",
    log_sinks: [["node", "./standalones/LogPrinter.js"]],
    web_app: { party_dashboard: true, expose_CODE: true, port: 924 },
  };
}
