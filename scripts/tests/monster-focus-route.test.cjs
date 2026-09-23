const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../../node_modules/typescript');
const React = require('../../dashboard/node_modules/react');
const renderer = require('../../dashboard/node_modules/react-test-renderer');
const { canRouteToMonster, FOLLOWER_ROUTE_MESSAGE } = require('../../dashboard/lib/party-routing.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;

function transpile(source) {
  return ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
}
function findNode(file, predicate) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result;
  function visit(node) {
    if (predicate(node)) result = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(result, `Missing source in ${file}`);
  return { node: result, source };
}
function findSource(file, predicate) {
  const { node, source } = findNode(file, predicate);
  return node.getText(source);
}
// The route button is built by a `useCallback` a few lines away from the
// picker's JSX, not inlined as a JSX attribute; pull out just its callback
// argument so this stays in sync with connected-character-card.tsx.
function findCallbackArgument(file, variableName) {
  const { node, source } = findNode(file, (n) => ts.isVariableDeclaration(n) && n.name.getText() === variableName);
  let call;
  function visit(n) {
    if (call) return;
    if (ts.isCallExpression(n) && n.expression.getText() === 'useCallback') { call = n; return; }
    ts.forEachChild(n, visit);
  }
  visit(node);
  assert.ok(call, `Missing useCallback initializer for ${variableName} in ${file}`);
  return call.arguments[0].getText(source);
}
function setup() {
  const timers = new Map(), writes = [], routes = [];
  let timerId = 0, completeSave;
  const context = {
    exports: {},
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return require('../../dashboard/node_modules/react/jsx-runtime');
      return new Proxy({}, { get: (_, key) => key });
    },
    state: { leader: 'Leader', followers: {} }, char: { name: 'Leader' }, name: 'Leader',
    canRouteToMonster, FOLLOWER_ROUTE_MESSAGE,
    setActionError(message) { throw Error(message); },
    setFarmAreaRequest(request) { routes.push(request); },
    MonsterRouteButton: 'RouteButton',
  };
  // The picker only narrows formation to {leader, followers}; sharing the same
  // object as `state` keeps the test's live mutation of leader/followers visible.
  context.routingFormation = context.state;
  vm.createContext(context);
  vm.runInContext(transpile(fs.readFileSync('dashboard/features/party/monster-focus-picker.tsx', 'utf8')), context);
  const findMonster = findSource('dashboard/features/party/use-party-console.tsx', n => ts.isFunctionDeclaration(n) && n.name?.text === 'findMonsterFor');
  const routeRenderer = findCallbackArgument('dashboard/features/party/connected-character-card.tsx', 'renderMonsterRouteButton');
  vm.runInContext('{\n' + transpile(findMonster + '\nglobalThis.renderRoute = ' + routeRenderer) + '\n}', context);
  const props = {
    monsters: [{ id: 'phoenix', name: 'Phoenix' }, { id: 'goo', name: 'Goo' }],
    selected: ['phoenix'], priorities: {}, onPriorityChange() {},
    renderRouteButton: context.renderRoute,
    onChange: focus => { writes.push(Array.from(focus)); return new Promise(resolve => { completeSave = resolve; }); },
  };
  return {
    context, props, writes, routes,
    flushTimer() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); },
    completeSave() { completeSave(); },
  };
}

test('Find uses the displayed Goo draft after clearing imported Phoenix, before and during the save', async () => {
  const h = setup(); let root;
  const render = () => React.createElement(h.context.exports.MonsterFocusPicker, h.props);
  const route = () => root.root.findByType('RouteButton').props.onRoute();
  await renderer.act(async () => { root = renderer.create(render()); });
  try {
    route(); assert.deepEqual(Array.from(h.routes.at(-1).ids), ['phoenix']);
    await renderer.act(async () => root.root.findByProps({ 'aria-label': 'Clear all monster focus' }).props.onClick());
    route(); assert.deepEqual(Array.from(h.routes.at(-1).ids), []);
    await renderer.act(async () => root.root.findAllByType('Checkbox')[2].props.onCheckedChange(true));
    route(); assert.deepEqual(Array.from(h.routes.at(-1).ids), ['goo']);
    assert.equal(h.writes.length, 0, 'route opens before the debounce fires');
    await renderer.act(async () => h.flushTimer());
    assert.deepEqual(h.writes, [['goo']]);
    h.props.selected = ['phoenix']; // A poll still contains the imported selection while saving.
    await renderer.act(async () => root.update(render()));
    route(); assert.deepEqual(Array.from(h.routes.at(-1).ids), ['goo']);
    assert.equal(h.routes.at(-1).character, 'Leader');
    h.props.selected = ['goo'];
    await renderer.act(async () => { root.update(render()); h.completeSave(); });
    route(); assert.deepEqual(Array.from(h.routes.at(-1).ids), ['goo']);
    h.props.selected = ['phoenix']; // Later external changes still update the settled picker.
    await renderer.act(async () => root.update(render()));
    route(); assert.deepEqual(Array.from(h.routes.at(-1).ids), ['phoenix']);
  } finally { await renderer.act(async () => root.unmount()); }
});

test('Find retains all-monsters filtering and current follower routing restrictions', async () => {
  const h = setup(); let root;
  await renderer.act(async () => { root = renderer.create(React.createElement(h.context.exports.MonsterFocusPicker, h.props)); });
  try {
    await renderer.act(async () => root.root.findAllByType('Checkbox')[1].props.onCheckedChange(true));
    root.root.findByType('RouteButton').props.onRoute();
    assert.deepEqual(Array.from(h.routes.at(-1).ids), []);
    h.context.state.leader = 'Other'; h.context.state.followers.Leader = true;
    assert.throws(() => root.root.findByType('RouteButton').props.onRoute(), /only leader can route to monster/);
    assert.equal(h.routes.length, 1);
  } finally { await renderer.act(async () => root.unmount()); }
});
