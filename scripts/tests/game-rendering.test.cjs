const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { namedFunction } = require('./helpers/named-function.cjs');
const { installGameRendering } = require('../../runtime/characters/game-rendering.ts');

// Failure modes and the native-versus-isolated boundary were recorded first in
// docs/testing-ice-roamer-failures.md. Execute the pinned native selector itself.
function fixture() {
  const source = fs.readFileSync('.caracal/game_files/17175/functions.js', 'utf8');
  const game = { textures: {}, in_arr: (value, values) => values.includes(value), warnings: [] };
  game.console = { warn: (...args) => game.warnings.push(args) };
  vm.runInNewContext(namedFunction(source, 'set_texture'), game);
  return game;
}

test('a missing native texture cannot stop the draw caller; restored frames render normally', () => {
  const game = fixture(), sprite = { skin: 'iceroamer', stype: 'full', texture: 'previous' };
  assert.throws(() => game.set_texture(sprite, 1, 1), /undefined/);
  installGameRendering(game);
  let frames = 0;
  for (let i = 0; i < 4; i++) { game.set_texture(sprite, 1, 1); frames++; }
  assert.equal(frames, 4);
  assert.equal(sprite.texture, 'previous');
  assert.notEqual(sprite.cskin, '11', 'missing frames are not recorded as rendered');
  assert.equal(game.warnings.length, 1, 'a recurring missing frame logs once');
  game.textures.iceroamer = [[], [null, 'restored']];
  game.set_texture(sprite, 1, 1);
  assert.equal(sprite.texture, 'restored');
  assert.equal(sprite.cskin, '11');
});

test('undefined native walking frame is contained without changing valid animation selection', () => {
  const game = fixture(), sprite = { skin: 'iceroamer', stype: 'full', texture: 'previous' };
  game.textures.iceroamer = [['left'], ['idle'], ['right']];
  installGameRendering(game);
  game.set_texture(sprite, undefined, 0);
  assert.equal(sprite.texture, 'previous');
  game.set_texture(sprite, 2, 0);
  assert.equal(sprite.texture, 'right');
});

test('renderer installation is idempotent and does not swallow unrelated native exceptions', () => {
  const game = fixture();
  installGameRendering(game);
  const installed = game.set_texture;
  installGameRendering(game);
  assert.equal(game.set_texture, installed);
  game.textures.iceroamer = [[], ['valid']];
  const sprite = {skin:'iceroamer', stype:'full', set texture(_) { throw Error('unrelated setter failure'); }};
  assert.throws(() => game.set_texture(sprite, 1, 0), /unrelated setter failure/);
});
