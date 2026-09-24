const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Load the complete component; replace UI primitives and hooks with a render-tree
// harness so the expanded selector can be tested without a browser or game API.
const code = ts.transpileModule(fs.readFileSync('dashboard/features/party/farming-mode-control.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function render(policy, hunt, characterHunt) {
  const selected = [];
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(code, { exports, require(id) {
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (id === 'react') return { useId: () => 'follow-description', useState: initial => [initial === false ? true : initial, () => {}], memo: fn => fn };
    if (id.endsWith('/passive-settings')) return require('../../runtime/coordinator/navigation/passive-settings.ts');
    if (id === './duration-label') return { durationLabel: () => '10m' };
    if (id === './hunt-blacklist-label') return require('../../dashboard/features/party/hunt-blacklist-label.ts');
    return new Proxy({}, { get: (_, key) => String(key) });
  }});
  const tree = exports.FarmingModeControl({ policy, hunt, characterHunt, effectiveMode: 'default',
    blacklist: { bbpompom: { deaths: 2 } }, catalog: [], onSelect: mode => selected.push(mode), onClearBlacklist: async () => {} });
  const nodes = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node && typeof node === 'object') { nodes.push(node); visit(node.props?.children); }
  }
  visit(tree);
  return { selected, nodes, text: JSON.stringify(tree) };
}

test('Hunt remains clickable and explains blacklist fallback after returning to Auto', () => {
  const view = render('auto', { stage: 'ended', message: 'Hunt ended: no eligible quests remain (Hunt blacklist)' },
    { id: 'bbpompom', count: 20, remainingMs: 600000 });
  const button = view.nodes.find(node => node.type === 'button' && node.props.children === 'Hunt');
  assert.ok(button);
  assert.ok(!button.props.disabled);
  button.props.onClick();
  assert.deepEqual(view.selected, ['hunt']);
  assert.match(view.text, /Last Hunt status/);
  assert.match(view.text, /no eligible quests remain/);
  assert.match(view.text, /Blacklisted — skipped for Hunt/);
});

test('active Hunt still shows its current progress', () => {
  const view = render('hunt', { stage: 'mission-travel', message: 'Travelling to bees' });
  assert.match(view.text, /Hunt status/);
  assert.match(view.text, /Travelling to bees/);
  assert.doesNotMatch(view.text, /Last Hunt status/);
});

test('ordinary farming without Hunt history does not show an empty Hunt panel', () => {
  assert.doesNotMatch(render('default').text, /Last Hunt status|Preparing Monster Hunt cycle/);
});
test('backup status shows batch readiness instead of three-minute turn-in advice',()=>{
 const view=render('hunt',{stage:'backup-farming',backup:{members:{W:{ready:true,fresh:true,remainingMs:0},P:{target:'mole',ready:false,fresh:true,remainingMs:500000},M:{fresh:false,remainingMs:0}}}});
 assert.match(view.text,/Next batch after every blacklisted quest expires/);assert.match(view.text,/waiting for fresh status/);assert.doesNotMatch(view.text,/return at 3 minutes/);
});
