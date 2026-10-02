import { createContext, runInContext } from 'node:vm';
import type { GameData } from '../../navigation/contracts.ts';

/** Match the game's initialization before hashing or preparing collision geometry. */
export function loadPlannerGeometry(dataSource: string, commonSource: string): GameData {
  return loadCoordinatorGeometry(dataSource, commonSource).game;
}

export function loadCoordinatorGeometry(dataSource: string, commonSource: string) {
  const context = createContext({ Place: 'client' }, { codeGeneration: { strings: false, wasm: false } });
  for (const [filename, source] of [
    ['data.js', dataSource],
    ['old_common_functions.js', commonSource],
    ['prepare-movement.js', 'process_game_data();'],
  ]) runInContext(source, context, { filename, timeout: 10000 });
  if (!context.G?.maps || !context.G?.geometry) throw Error('Missing processed movement geometry');
  return {
    game: context.G as GameData,
    canStand(x: number, y: number): boolean {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !context.G.geometry.main) return false;
      // Native rectangular collision checks include lines crossing the footprint.
      // These are the game's ordinary human movement-base dimensions.
      return context.can_move({map:'main',x,y,going_x:x,going_y:y,base:{h:8,v:7,vn:2}}) === true;
    },
  };
}
