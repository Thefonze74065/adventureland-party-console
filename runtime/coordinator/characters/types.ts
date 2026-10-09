import type { ChildProcess } from "node:child_process";
import type { FSWatcher } from "node:fs";
import type { RealmRequest } from './realm-request.ts';

export type Worker = ChildProcess & { partyStopReason?: string };
export type Lifecycle = "starting" | "realm-error" | "repairing" | "online" | "failed" | "offline";
export interface CharacterBlock {
  clientUpdating?: boolean;
  clientVersion?: number;
  clientInstance?: string;
  enabled?: boolean;
  connected?: boolean;
  realm?: string;
  pendingRealm?: RealmRequest;
  script?: string;
  typescript?: string | null;
  version?: number;
  instance?: Worker | null;
  monitor?: { destroy(): void } | null;
  bootstrapRepair?: Promise<unknown> | null;
  restart_timeout?: ReturnType<typeof setTimeout>;
  reload_timeout?: ReturnType<typeof setTimeout>;
  code_watcher?: FSWatcher | null;
  codeReloadRunning?: boolean;
  codeReloadPending?: boolean;
  codeGeneration?: string;
  lastExit?: { at: number; code: number | null; signal: string | null; reason: string };
}

export interface WorkerStore {
  set(key: string, value: unknown): void;
  delete(key: string): void;
  entries(): IterableIterator<[string, unknown]>;
}

export interface WorkerArguments {
  version: number;
  clientInstance?: string;
  realm_address?: string;
  realm_path: string;
  realm_port: string | number;
  sess: string | undefined;
  cid: string | number;
  script_file?: string;
  enable_map: boolean;
  cname: string;
  clid: number;
  typescript_file?: string | null;
}

export interface WorkerLog {
  log(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

export interface WorkerClock {
  now(): number;
  later(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
  cancel(timer: ReturnType<typeof setTimeout> | undefined): void;
  sleep(milliseconds: number): Promise<unknown>;
}
