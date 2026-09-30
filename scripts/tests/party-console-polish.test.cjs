const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('../../dashboard/node_modules/react');
const { create, act } = require('../../dashboard/node_modules/react-test-renderer');
const { createRequire } = require('node:module');
const path = require('node:path');
const req = createRequire(path.resolve('dashboard/package.json'));
const { QueryClient, QueryClientProvider } = req('@tanstack/react-query');
const load = require('./helpers/dashboard-query-module.cjs');
const { PartyGold, goldTotals, partyGoldNames } = load('party-gold.tsx');
const { DashboardHealth } = load('dashboard-health.tsx');
const { characterKey, liveConnectionKey } = load('dashboard-live.tsx');
const { drawDue, prepareMap, visibleTiles, receiveMapFrame } = load('map-render-buffer.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('gold preserves unknown and zero, deduplicates active membership and excludes BankBois', () => {
  assert.deepEqual(goldTotals(0, [0, 0]), { carried: 0, total: 0 });
  assert.deepEqual(goldTotals(null, [2]), { carried: 2, total: null });
  assert.deepEqual(goldTotals(2, [undefined]), { carried: null, total: null });
  assert.deepEqual(goldTotals(5, [2, 3]), { carried: 5, total: 10 });
  const activeSlots = ['A', 'A', 'Merchant', 'Bank', 'Offline'].map(character => ({ character, state: character === 'Offline' ? 'offline' : 'online' }));
  assert.deepEqual(partyGoldNames({ activeSlots, bankbois: [{ name: 'Bank' }] }), ['A', 'Merchant']);
});

test('gold only commits for balances or membership; healthy connection renders nothing and failures remain visible', async () => {
  const client = new QueryClient();
  client.setQueryData(characterKey('A', 'vitals'), { gold: 10, hp: 100 });
  client.setQueryData(liveConnectionKey, { healthy: true });
  let commits = 0, tree;
  const state = { bankGold: 20, activeSlots: [{ character: 'A', state: 'online' }] };
  const render = state => React.createElement(QueryClientProvider, { client },
    React.createElement(React.Profiler, { id: 'gold', onRender: () => commits++ }, React.createElement(PartyGold, { state })),
    React.createElement(DashboardHealth));
  try {
    await act(async () => { tree = create(render(state)); });
    assert.equal(tree.root.findAllByType('output').length, 0);
    const before = commits;
    await act(async () => { client.setQueryData(characterKey('A', 'vitals'), { gold: 10, hp: 50 }); await new Promise(r => setTimeout(r, 10)); });
    assert.equal(commits, before);
    await act(async () => { client.setQueryData(characterKey('A', 'vitals'), { gold: 15, hp: 50 }); await new Promise(r => setTimeout(r, 10)); });
    assert.match(JSON.stringify(tree.toJSON()), /combined: 35/);
    await act(async () => tree.update(render({ ...state, activeSlots: [] })));
    assert.match(JSON.stringify(tree.toJSON()), /combined: 20/);
    await act(async () => { client.setQueryData(liveConnectionKey, { healthy: false }); await new Promise(r => setTimeout(r, 10)); });
    assert.match(tree.root.findByType('output').children.join(''), /Connecting/);
  } finally { if (tree) await act(async () => tree.unmount()); client.clear(); }
});

test('20 FPS scheduler reduces one and four 60 Hz map draw counts by two thirds', () => {
  for (const maps of [1, 4]) {
    let draws = 0, last = -Infinity;
    for (let tick = 0; tick < 600; tick++) {
      const now = tick * 1000 / 60;
      if (drawDue(now, last, 20)) { draws += maps; last = now; }
    }
    assert.equal(draws, 200 * maps);
  }
  assert.equal(drawDue(1, 0), true, 'farming preview is uncapped');
});

test('map buffer resets interpolation and old events at map boundaries; tile work is bounded and aligned', () => {
  const buffer = { frame: null, previous: null, receivedAt: 0 };
  receiveMapFrame(buffer, { map: 'main', events: [{ at: 1000 }] }, 0, 1000);
  receiveMapFrame(buffer, { map: 'main', events: [] }, 100, 1100);
  assert.equal(buffer.previous.map, 'main');
  receiveMapFrame(buffer, { map: 'cave', events: [] }, 200, 1200);
  assert.equal(buffer.previous, null); assert.deepEqual(buffer.frame.events, []);
  const definition = { tiles: [['tile', 0, 0, 10, 20]], placements: [[0, -100000, -100000, 100000, 100000]], groups: [[[0, 0, 40]]] };
  const prepared = prepareMap(definition);
  assert.equal(prepared.groups[0].y, 60);
  const range = visibleTiles(prepared.placements[0], 0, 0, 100, 100);
  assert.deepEqual(range, { left: -10, top: -20, right: 100, bottom: 100 });
  assert.equal(visibleTiles(prepared.groups[0].placements[0], 100, 100, 200, 200), null);
});

test('renderer pauses covered/hidden canvases, releases observers, clears mismatched maps and uses shared latest frames', async () => {
  const { MapCanvas } = load('map-canvas.tsx');
  const saved = Object.fromEntries(['requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'devicePixelRatio'].map(key => [key, global[key]]));
  let id = 0, disconnected = 0, clears = 0, paints = 0;
  const callbacks = new Map();
  global.requestAnimationFrame = callback => { callbacks.set(++id, callback); return id; };
  global.cancelAnimationFrame = id => callbacks.delete(id);
  global.ResizeObserver = class { observe() {} disconnect() { disconnected++; } };
  global.devicePixelRatio = 1;
  const ctx = new Proxy({ clearRect() { clears++; }, fillRect() { paints++; } }, { get(target, name) { return target[name] || (() => {}); } });
  const canvas = { clientWidth: 400, clientHeight: 300, width: 400, height: 300, getContext: () => ctx };
  const definition = { name: 'main', tiles: [], groups: [], placements: [], tilesets: {} };
  const buffer = { current: { frame: { map: 'main', x: 0, y: 0, entities: [] }, previous: null, receivedAt: 0 } };
  const props = { definition, frame: null, previous: null, receivedAt: 0, scale: 1, detailed: false, fps: 20, buffer };
  let tree;
  const tick = now => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(now)); };
  try {
    await act(async () => { tree = create(React.createElement(MapCanvas, props), { createNodeMock: () => canvas }); });
    tick(0); tick(16); tick(33); tick(50);
    assert.equal(paints, 2);
    buffer.current.frame = { map: 'cave', x: 0, y: 0, entities: [] };
    tick(100); assert.equal(clears, 1); assert.equal(paints, 2);
    await act(async () => tree.update(React.createElement(MapCanvas, { ...props, active: false })));
    assert.equal(callbacks.size, 0); assert.equal(disconnected, 1);
    await act(async () => tree.update(React.createElement(MapCanvas, { ...props, definition: { ...definition, name: 'cave' }, active: true })));
    tick(150); assert.equal(paints, 3);
    await act(async () => tree.unmount()); tree = null;
    assert.equal(callbacks.size, 0); assert.equal(disconnected, 2);
  } finally {
    if (tree) await act(async () => tree.unmount());
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
});

function loadControls() {
  const Module = require('node:module');
  const filename = path.resolve('dashboard/features/party/character-session-controls.tsx');
  const result = require('esbuild').buildSync({ entryPoints: [filename], bundle: true, packages: 'external', external: ['@/components/ui/button', '@/components/ui/dialog'], platform: 'node', format: 'cjs', write: false });
  const m = new Module(filename, module); m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = m.require.bind(m);
  m.require = name => {
    if (name === '@/components/ui/button') return { Button: props => React.createElement('button', props) };
    if (name === '@/components/ui/dialog') return Object.fromEntries(['Dialog', 'DialogContent', 'DialogTitle', 'DialogDescription'].map(key => [key, props => key === 'Dialog' && !props.open ? null : React.createElement('section', props)]));
    return original(name);
  };
  m._compile(result.outputFiles[0].text, filename); return m.exports.CharacterSessionControls;
}
const Controls = loadControls();
test('Steam monitor joins, promotes, ignores primary, cancels, rejects changed confirmations, handles failure and duplicate submission', async () => {
  for (const [kind, primary, other, expected] of [['headless', false, null, 'login'], ['headless', false, 'B', 'login'], ['native', false, 'B', 'primary'], ['native', true, 'A', null]]) {
    let calls = [], finish, tree;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    client.setQueryData(['debug-browser'], false);
    const render = props => React.createElement(QueryClientProvider, { client }, React.createElement(Controls, props));
    const props = { name: 'A', slot: { index: 1, character: 'A', kind, primary, state: 'online' }, primaryCharacter: other, pending: false,
      onSteam: (name, action) => { calls.push([name, action]); return new Promise(resolve => { finish = resolve; }); }, onLogout: async () => {}, onHeadless: async () => {} };
    await act(async () => { tree = create(render(props)); });
    const monitor = () => tree.root.findAllByType('button').find(button => /Steam/.test(button.props['aria-label'] || ''));
    await act(async () => monitor().props.onClick());
    if (!expected) { assert.equal(tree.root.findAllByType('button').length, 3); await act(async () => tree.unmount()); client.clear(); continue; }
    const buttons = () => tree.root.findAllByType('button');
    await act(async () => buttons()[3].props.onClick());
    assert.equal(buttons().length, 3); assert.deepEqual(calls, []);
    await act(async () => monitor().props.onClick());
    await act(async () => tree.update(render({ ...props, primaryCharacter: 'Changed' })));
    assert.equal(buttons()[4].props.disabled, true);
    await act(async () => buttons()[4].props.onClick()); assert.deepEqual(calls, []);
    await act(async () => buttons()[3].props.onClick());
    await act(async () => tree.update(render(props)));
    await act(async () => monitor().props.onClick());
    const submit = buttons()[4].props.onClick;
    let pending;
    await act(async () => { pending = submit(); void submit(); });
    assert.deepEqual(calls, [['A', expected]]);
    await act(async () => { finish(); await pending; });
    assert.equal(buttons().length, 3);
    await act(async () => tree.update(render({ ...props, onSteam: async () => { throw new Error('failed request'); } })));
    await act(async () => monitor().props.onClick());
    await act(async () => buttons()[4].props.onClick());
    assert.match(tree.root.findByProps({ role: 'alert' }).children.join(''), /failed request/);
    await act(async () => tree.unmount()); client.clear();
  }
});
