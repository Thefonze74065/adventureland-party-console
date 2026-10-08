import type { CharacterEntity } from "typed-adventureland";
import type {Step} from '../navigation/contracts.ts';
export interface CaveRoute {plot:Step[];identity:{version:number;fingerprint:string}}

export interface PriestRecoveryAssignment {
  id: string;
  run: string;
  priest: string;
  target: string;
  authorized: boolean;
}
export interface PriestRecoveryObservation {
  actor: Pick<CharacterEntity, "ctype" | "hp" | "max_hp" | "mp" | "max_mp" | "c">;
  essence: boolean;
  id?: string;
  target?: string;
  phase: "idle" | "healing" | "waiting" | "ready" | "dispatched" | "reviving" | "uncertain" | "failed" | "complete";
  reason?: string;
}
/** Local wire observations. typed-adventureland 0.0.57 has no Cave of Many Dreams
 * contracts. Verified against official generated_zones.js / runner_functions.js
 * version 17175; review when upgrading the upstream package. */
export interface CavePoint {
  room?: string;
  kind?: string;
  id: string;
  label: string;
  map: string;
  x: number;
  y: number;
  locked?: boolean;
  done?: boolean;
  exit?: boolean;
  down?: boolean;
  to?: string;
  required?: boolean;
}
export interface CaveChoice {
  resultLabel?: string;
  summary?: string[];
  id: string;
  title: string;
  text: string;
  deadline: number;
  resolved: boolean;
  votes: Record<string, string>;
  options: { id: string; label: string; unavailable?: string; cost?: number; amber?: number }[];
  shop?: { room: string; name: string; price: number; sold: boolean; nearby: boolean };
}
export interface CaveObservation {
  protocol: 1;
  at: number;
  supported: boolean;
  alive: boolean;
  ready: boolean;
  travel?: {id:string;distance:number;prepared:boolean;route?:CaveRoute};
  members: string[];
  leader?: string;
  visitError?: string;
  visit?: {
    available: boolean;
    resets: number;
    home: string;
    resume?: { server: string; run?: string };
    checkedAt: number;
  };
  cave: {
    run: string;
    floor: number;
    expires: number;
    remainingMs: number;
    paused: boolean;
    gold: number;
    amber: number;
    points: CavePoint[];
    choice?: CaveChoice;
  } | null;
  recovery?: PriestRecoveryObservation;
  keeper?: { map: string; x: number; y: number };
  action?: {
    id: string;
    status: "dispatched" | "complete" | "uncertain" | "failed";
    error?: string;
  };
}
export interface CaveCommand {
  cruiseSpeed?: number;
  id: string;
  action: "gather" | "enter" | "move" | "vote" | "buy" | "exit" | "revival" | "stairs";
  run?: string;
  resume?: boolean;
  target?: CavePoint;
  choice?: string;
  option?: string;
  room?: string;
  cost?: number;
  amber?: number;
}
export interface DungeonState {
  travel?: { target: CavePoint; origin: CavePoint; stage: 'assembling' | 'travelling'; serial: number; repairs?:number; assemblyRepairs?:number };
  stairContinuation?: CavePoint;
  progress?: { enabled: boolean; target?: string; floor?: number; serial: number; message?: string };
  protectFromEvents: boolean;
  participants: string[];
  phase: "idle" | "gathering" | "entering" | "active" | "exiting" | "held";
  run?: string;
  server?: string;
  pendingEvent?: string;
  commands: Record<string, CaveCommand>;
  resuming?: boolean;
  interruptedPhase?: DungeonState["phase"];
  interruptedCommands?: Record<string, CaveCommand>;
  operations: string[];
  error?: string;
  exitDispatched?: boolean;
  priestRecovery?: PriestRecoveryAssignment;
  recoveryDeaths?: Record<string, { dead: boolean; generation: number; attempted?: boolean }>;
  manualRecovery?: boolean;
}
export interface DungeonParty {
  dailyDungeons?: DungeonState;
  leader: string | null;
  followers?: Record<string, boolean>;
  merchantCharacter: string | null;
  statuses: Record<
    string,
    | {
        seenAt: number;
        map?: string;
        x?: number;
        y?: number;
        server?: string;
        rip?: boolean;
        speed?: CharacterEntity['speed'];
        dungeon?: CaveObservation;
      }
    | undefined
  >;
}
export function dungeonOwns(party: Pick<DungeonParty, "dailyDungeons">, name?: string): boolean {
  const d = party.dailyDungeons;
  return !!d && d.phase !== "idle" && (name === undefined || d.participants.includes(name));
}
export interface DungeonView {
  state: DungeonState;
  members: { name: string; fresh: boolean; observation?: CaveObservation }[];
}
