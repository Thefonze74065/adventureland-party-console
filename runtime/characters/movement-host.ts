import type { GameData, Geometry, Point, Step } from '../navigation/contracts.ts';
type GameCharacter = typeof character;
export interface MoveState extends Point {
  moving: boolean; found: boolean; searching: boolean; plot: Step[]; use_town: boolean; try_exact_spot: boolean; edge: number;
  on_done(done: boolean, reason?: string, failure?: unknown): void;
}
// The movement host accepts a minimal payload, with normalized geometry and death state.
export interface Character extends Point, Pick<GameCharacter, 'name' | 'real_x' | 'real_y' | 'speed' | 'moving'> {
  base: Geometry;
  rip?: Extract<GameCharacter['rip'], boolean>;
  // Inventory observations need only a name and may include newly introduced item IDs.
  items: ({ name: string } | null)[];
}
export interface MovementHost {
  character: Character; G: GameData & { version: number };
  smart: MoveState;
  smart_move(this: void, destination: unknown, callback?: (done: boolean) => void): Promise<unknown>;
  smart_move_logic(this: void): void;
  start_pathfinding(this: void): void; continue_pathfinding(this: void): void;
  stop(this: void, action?: string, success?: boolean): Promise<unknown>;
  move(x: number, y: number): Promise<unknown>;
  use(skill: string): Promise<unknown>;
  town?(): Promise<unknown>;
  can_use(skill: string): boolean;
  can_walk(character: Character): boolean;
  is_transporting(character: Character): boolean;
  can_move(input: { map: string; x: number; y: number; going_x: number; going_y: number; base: Geometry }): boolean;
  is_door_close(map: string, door: unknown[], x: number, y: number): boolean;
  can_use_door(map: string, door: unknown[], x: number, y: number): boolean;
  find_npc(name: string): Point | null;
  game_log(message: string, color: string): void;
  // caracAL supplies its selected game-file version through process arguments.
  parent: { __partyClientVersion?: number | string; socket: { emit(event: string, data: unknown): void }; push_deferred(key: string): Promise<unknown> };
  __partyMovement?: { dispose(): void };
  __partyNativeMovement?: NativeFunctions;
}
export interface NativeFunctions {
  move: MovementHost['smart_move']; stop: MovementHost['stop']; start: () => void; next: () => void; tick: () => void;
}
export interface MovementContext {
  runtime: string; revision: number; current: boolean; paused: boolean;
  map?: string; instance?: string | number;
}
export interface MovementOptions {
  // Cave combat may stop direct movement without retiring the dungeon journey.
  retainOnDirectStop?: boolean;
  // Cave combat can displace an actor off its validated shared walking edge.
  // Repair only the local same-map connector, never the destination route.
  repairSharedDrift?: boolean;
  relocation?: 'town' | 'door';
  owner?: {convoyId?: string; epoch?: number; commandId?: number; navigationRevision?: number; recoveryStage?: string};
  transitionComplete?: (destination: Point) => void;
  townAttempt?: (state: 'casting' | 'interrupted' | 'complete' | 'unavailable', index: number, from: Point, destination: Point) => void;
  compareTown?: boolean;
  skipLootWait?: boolean;
  avoidLeave?: boolean; town?: boolean; native?: boolean; shared?: boolean; speed?: number;
  arrivalTolerance?: number;
  // Assembled Cave followers consume the leader's validated route instead of
  // duplicating its search. Large generated floors need an explicit bound.
  awaitSharedRoute?: boolean;
  nativePlanningTimeoutMs?: number;
  barrier?: (step: Step, index: number, completed: boolean) => Promise<boolean>;
}
export interface MovementPorts {
  now(this: void): number;
  context(): MovementContext;
  townReady?(): boolean;
  transitionReady?(): boolean;
  request(path: string, options: { method: string; timeout: number; body: unknown }): Promise<unknown>;
  diagnostic(event: Record<string, unknown>, message: string): void;
  metrics?(event: Record<string, unknown>): void;
}
