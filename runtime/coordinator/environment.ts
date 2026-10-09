import { migrateCoordinatorLegacyStorage } from "./persistence/legacy-storage.ts";

interface EnvironmentConfig {
  cull_versions?: boolean;
  session?: string;
  characters: Record<string, { realm?: unknown; version?: unknown } | null | undefined>;
}
interface Storage {
  set: (key: string, value: unknown) => unknown;
}
type MigrationPorts = Parameters<typeof migrateCoordinatorLegacyStorage>[2];
interface EnvironmentPorts<Store, Version, Config, Account> {
  createStorage: () => Store;
  migration: MigrationPorts;
  ensureLatest: () => Promise<Version>;
  configuration: () => Config;
  cullVersions: (versions: Version[]) => Promise<unknown>;
  environmentSession: () => string | undefined;
  account: (session: string | undefined) => Promise<Account>;
  accountHomeRealm?: (account: Account) => string | null;
}

/** Keep startup I/O ordered: migrate storage, obtain game data, read config, then log in. */
export async function initializeCoordinatorEnvironment<
  Store extends Storage,
  Version,
  Config extends EnvironmentConfig,
  Account,
>(ports: EnvironmentPorts<Store, Version, Config, Account>) {
  const localStorage = ports.createStorage();
  migrateCoordinatorLegacyStorage("./localStorage/storage.json", localStorage, ports.migration);
  const sessionStorage = new Map<string, unknown>();
  localStorage.set("caracAL", "Yeah");
  sessionStorage.set("caracAL", "Yup");
  const version = await ports.ensureLatest();
  const configuration = ports.configuration();
  if (configuration.cull_versions) {
    const pinned = Object.values(configuration.characters).map(entry => entry?.version)
      .filter(value => typeof value === typeof version && !!value) as Version[];
    await ports.cullVersions([version, ...pinned]);
  }
  const session = ports.environmentSession() || configuration.session;
  const account = await ports.account(session);
  const workers: Config["characters"] = configuration.characters;
  const configuredRealm =
    ports.accountHomeRealm?.(account) ||
    Object.values(workers)
      .map((entry) => entry && entry.realm)
      .find((realm): realm is string => typeof realm === "string" && realm.startsWith("SR_")) ||
    "SR_USII";
  return {
    localStorage,
    sessionStorage,
    version,
    configuration,
    session,
    account,
    workers,
    configuredRealm,
  };
}
