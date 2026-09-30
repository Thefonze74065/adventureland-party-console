// Native renderer descriptors are Pixi animation state, not game entity reports.
// Keep this boundary local; these fields are absent from typed-adventureland.
interface Sprite {
  skin: string; stype: string; frames?: number; cskin?: string;
}
export interface GameRenderHost {
  textures: Record<string, unknown>;
  set_texture(this: void, sprite: Sprite, i: number, j?: number): void;
  console?: Pick<Console, 'warn'>;
  __partyTextureGuard?: GameRenderHost['set_texture'];
}
const sheets = new Set(['full', 'wings', 'body', 'armor', 'skin', 'tail', 'character', 'upper']);
const directional = new Set(['v_animation', 'head', 'hair', 'hat', 's_wings', 'face', 'makeup', 'beard']);
const animated = new Set(['animation', 'animatable']);
const layered = new Set(['a_makeup', 'a_hat']);
function at(value: unknown, index: number | undefined): unknown {
  return Array.isArray(value) && index !== undefined ? value[index] : undefined;
}
function frame(game: GameRenderHost, sprite: Sprite, i: number, j?: number): unknown {
  const texture = game.textures[(sprite.stype === 'upper' ? 'upper' : '') + sprite.skin];
  if (sheets.has(sprite.stype)) return at(at(texture, i), j);
  if (animated.has(sprite.stype)) return at(texture, i % Number(sprite.frames));
  if (sprite.stype === 'emote') return at(texture, i % 3);
  const row = at(texture, i % Number(sprite.frames));
  if (layered.has(sprite.stype)) return at(row, Number(j) % (at(texture, 0) as unknown[])?.length);
  return Array.isArray(row) ? at(row, (j || 0) % row.length) : row;
}
function supported(sprite: Sprite): boolean {
  return sheets.has(sprite.stype) || directional.has(sprite.stype) || animated.has(sprite.stype) ||
    layered.has(sprite.stype) || sprite.stype === 'emote';
}

/** An unavailable cosmetic frame must not terminate native draw/physics scheduling. */
export function installGameRendering(game: GameRenderHost): void {
  if (typeof game.set_texture !== 'function' || game.set_texture === game.__partyTextureGuard) return;
  const original = game.set_texture, reported = new Set<string>();
  const guarded: GameRenderHost['set_texture'] = function(sprite, i, j) {
    if (supported(sprite) && sprite.cskin !== String(i) + String(j) && frame(game, sprite, i, j) == null) {
      const key = JSON.stringify([sprite.skin, sprite.stype, i, j]);
      if (!reported.has(key)) {
        if (reported.size >= 64) reported.delete(reported.values().next().value!);
        reported.add(key);
        game.console?.warn('Native sprite frame unavailable; retaining previous texture', {skin:sprite.skin, stype:sprite.stype, i, j});
      }
      // Do not set cskin: a later draw must retry a newly available texture.
      return;
    }
    original(sprite, i, j);
  };
  game.set_texture = game.__partyTextureGuard = guarded;
}
