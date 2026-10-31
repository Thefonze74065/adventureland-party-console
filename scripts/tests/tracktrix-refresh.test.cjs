const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('characters/shared.js', 'utf8');
test('inventory callbacks acquire and remove Tracktrix without idle polling', () => {
  let requests = 0, nextTimer = 0;
  const timers = new Map();
  const r = vm.createContext({ root: {}, requestSilentTracker: null, character: { items: [] }, trackerDropData: null,
    trackerCatalogInitialized: true, trackerTablesSignature: "", catalogGeneration: 0,
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout: id => timers.delete(id), parent: { caracAL: true, socket: { emit: () => requests++ } } });
  vm.runInContext(require('./helpers/named-function.cjs').namedFunction(source,'trackerCatalogSignature'),r);
  vm.runInContext(source.slice(source.indexOf('  function holdsTracktrix('), source.indexOf('  var playerDirectoryListener')), r);
  const update = items => r.trackerInventoryListener({ items });
  update([]); update([{ name: 'hpot1' }]);
  r.trackerInventoryListener({ hp: 100 });
  assert.equal(requests, 0); assert.equal(timers.size, 0);
  // The packet can arrive before character.items has been updated.
  update([{ name: 'tracker' }]); assert.equal(requests, 1);
  assert.equal([...timers.values()][0].delay, 2000);
  update([null, { name: 'tracker' }]); assert.equal(requests, 1, 'slot changes do not request again');
  [...timers.values()][0].callback(); assert.equal(requests, 2, 'missing responses retry');
  r.trackerCatalogListener({ monsters: {} });
  assert.equal(timers.size, 1); assert.equal([...timers.values()][0].delay, 30000);
  update([]); assert.equal(timers.size, 0, 'banking the item cancels refresh');
  r.trackerCatalogListener({ monsters: {} }); assert.equal(timers.size, 0, 'late responses do not restart timers');
  update([{ name: 'tracker' }]); assert.equal(requests, 3, 'withdrawal immediately requests again');
});
test('dashboard includes BankBoi and inactive merchant snapshots and takes the highest score', () => {
  const { aggregateMonsterAchievements } = require('../../dashboard/features/party/monster-achievements.ts');
  const characters = {
    QwenTina: { name: 'QwenTina', monsterAchievements: null },
    bankboi0: { name: 'bankboi0', monsterAchievements: { ghost: { score: 2100, owner: 'GDroidPT' } } },
    GoldMajesty: { name: 'GoldMajesty', monsterAchievements: { ghost: { score: 2366, owner: 'GDroidPT' } } },
  };
  assert.equal(aggregateMonsterAchievements(characters).ghost.score, 2366);
  delete characters.GoldMajesty;
  assert.equal(aggregateMonsterAchievements(characters).ghost.score, 2100);
});

for (const primary of [true, false]) test(`native Tracktrix refresh stays silent (primary=${primary}) and manual clicks still open`, () => {
 const calls=[]; let popups=0;
 const socket={emit(event){assert.equal(this,socket);calls.push(event);}};
 const originalEmit=socket.emit, originalRender=()=>{popups++;};
 const r=vm.createContext({root:{},parent:{socket,render_tracker:originalRender,no_html:!primary},Date});
 vm.runInContext(source.slice(source.indexOf('  function installSilentTracker('),source.indexOf('  function holdsTracktrix(')),r);
 r.requestSilentTracker();r.parent.tracker={monsters:{croc:123}};r.parent.render_tracker();
 assert.equal(popups,0);assert.equal(r.parent.tracker.monsters.croc,123);
 socket.emit('tracker');r.parent.render_tracker();assert.equal(popups,1);
 r.requestSilentTracker();r.parent.render_tracker();assert.equal(popups,1);
 socket.emit('unrelated');assert.equal(calls.at(-1),'unrelated');
 // Reload replaces rather than stacks hooks.
 r.requestSilentTracker=r.installSilentTracker();r.requestSilentTracker();r.parent.render_tracker();assert.equal(popups,1);
 r.root.__partyRestoreTrackerUI();assert.equal(socket.emit,originalEmit);assert.equal(r.parent.render_tracker,originalRender);
});
