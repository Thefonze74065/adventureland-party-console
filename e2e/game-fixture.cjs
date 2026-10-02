// Deterministic external game observations, delivered through the real status HTTP endpoint.
// This does not execute game clients, movement, trades, or upgrade operations.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { restoreGameFixtures } = require('../scripts/ci/restore-game-fixtures.cjs');
const version = 17175;

function createGameFixture(directory) {
  restoreGameFixtures(path.join(directory, 'game_files'));
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(directory, 'game_files', String(version), 'data.js'), 'utf8'), context);
  const game = JSON.parse(JSON.stringify(context.G));
  const itemMeta = id => {
    const definition = game.items[id];
    return { definition: Object.fromEntries(Object.entries(definition).filter(([, value]) =>
      ['string', 'number', 'boolean'].includes(typeof value) || Array.isArray(value))),
    upgradeable: !!definition.upgrade, compoundable: !!definition.compound,
    scaling: definition.upgrade || definition.compound || {}, maxLevel: 12 };
  };
  const merchantCatalog = { version: 'e2e-game-17175', buyable: [], craftable: [], exchangeable: [],
    allItems: Object.keys(game.items).map(id => ({ id, name: game.items[id].name || id,
      upgradeable: !!game.items[id].upgrade, compoundable: !!game.items[id].compound, meta: itemMeta(id) })) };
  // Read-boundary catalog fixture; native exchange execution is covered separately.
  merchantCatalog.exchangeable = ['gem0', 'armorbox'].map(id => ({ key: id, id, level: 0,
    name: game.items[id].name, required: 1, cost: 0, npc: 'exchange', sprite: null,
    results: [...(id === 'gem0' ? ['coat', 'armorbox', 'strring'] : ['coat']).map(reward => ({
        id: reward, kind: reward, name: game.items[reward].name, quantity: 1, chance: 0.5, sprite: null,
      })), { id: 'gold', kind: 'gold', name: 'Gold', quantity: 10000, chance: 0.1, sprite: null },
      { id: 'empty', kind: 'empty', name: 'Nothing', quantity: 1, chance: 0.05, sprite: null }] }));
  const gooSpawn = game.maps.main.monsters.find(spawn => spawn.type === 'goo');
  const boundary = gooSpawn.boundary;
  const location = { map: 'main', mapName: game.maps.main.name || 'main', boundary,
    x: (boundary[0] + boundary[2]) / 2, y: (boundary[1] + boundary[3]) / 2 };
  const spawnRecords = [{ ...location, sourceMap: 'main', count: gooSpawn.count, restrictions: [] }];
  const monsterChoices = [{ id: 'goo', name: game.monsters.goo.name || 'goo', locations: [location], spawnRecords }];
  const bestiaryCatalog = Object.entries(game.monsters).map(([id, definition]) => ({
    ...definition, id, name: definition.name || id, definition, threat: 0, drops: [], spawnRecords: id === 'goo' ? spawnRecords : [],
  }));
  const hunter = game.maps.main.npcs.find(npc => npc.id === 'monsterhunter');
  let sequence = 0;
  function reports(catalogs = false) {
    const sample = ++sequence;
    return [['W', 'warrior'], ['P', 'priest'], ['M', 'merchant']].filter(([name]) => name !== 'M' || process.env.E2E_MERCHANT_CONNECTED !== 'false').map(([name, ctype]) => ({
      name, ctype, level: 80, runtime: 'native', steamPrimary: name === 'W',
      clientVersion: version, runtimeId: 'e2e-' + name, clientInstance: 'e2e-' + name,
      statusSequence: sample, connected: true, map: 'main', in: 'main', server: 'USII',
      x: 0, y: 0, moving: false, rip: false, hp: 1000, max_hp: 1000, mp: 1000, max_mp: 1000,
      gold: 1000000, speed: 50, range: 100, attack: 100, frequency: 1,
      gameParty: ['W', 'P'], threats: [], conditions: [], slots: {},
      monsterHunt: name === 'W' ? { id: 'goo', count: 10, remainingMs: 600000, server: 'USII' } : null,
      navigationState: 'idle', standOpen: name === 'M',
      items: Array.from({ length: 42 }, (_, slot) => (name === 'M' || name === 'W' && process.env.E2E_PLAYER_INVENTORY === 'true') && slot === 0
        ? { slot, item: { name: 'sword', level: 0 }, meta: itemMeta('sword') } : name === 'M' && slot === 1
        ? { slot, item: { name: 'gem0', q: 1 }, meta: itemMeta('gem0') } : name === 'M' && slot === 2
        ? { slot, item: { name: 'coat', level: 0 }, meta: itemMeta('coat') } : null),
      ...(process.env.E2E_MERCHANT_DIALOGS === 'true' && name === 'M' ? {
        bank: {gold:1000000,packs:{items0:[{slot:0,item:{name:'bkey'},meta:itemMeta('bkey')}]}},
        bankVaults: [
          {pack:'items0',floor:'bank',gold:0,shells:0,key:null},
          {pack:'items1',floor:'bank',gold:10000,shells:0,key:null},
          {pack:'items8',floor:'bank_b',gold:0,shells:0,key:{id:'bkey',name:'The Bank Key'}},
        ],
        ponty: {updatedAt:Date.now(),listings:[{rid:'e2e-ponty-sword',item:{name:'sword',level:0},price:1000,quantity:1,unitPrice:1000}]},
      } : {}),
      ...(catalogs && name === (process.env.E2E_MERCHANT_CONNECTED === 'false' ? 'W' : 'M') ? { merchantCatalog, merchantCatalogVersion: merchantCatalog.version,
        bestiaryCatalog, monsterChoices, monsterLocationsVersion: 3,
        monsterHunterLocation: { map: 'main', x: hunter.position[0], y: hunter.position[1] } } : {}),
    }));
  }
  return { version, reports };
}
module.exports = { createGameFixture, version };
