const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../../dashboard/node_modules/typescript');
const source = require('./helpers/dashboard-source.cjs')();
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const code = ts.transpileModule(
  extract('function WTBOrderDialog(', 'function WTBPriorityInput(') +
  extract('function npcSaleValue(', 'const UPGRADE_CHANCES:') +
  extract('function exactLevelPrice(', 'function SuggestedPriceDetails('),
  { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }
).outputText;

function setup() {
  const state = [];
  let cursor = 0;
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }) },
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = value; }];
    },
    useWTBReplacement: () => ({ save: action => action(), dialog: null }),
    standBuyExplanation: 'stand', higherLevelExplanation: 'levels',
    useSuggestedItemValue: () => ({ suggested: 100, defaultPrice: 100 }),
  };
  for (const name of ['Info','Popover','PopoverContent','PopoverTrigger','SuggestedPriceDetails','Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription', 'DialogFooter', 'Input', 'Button', 'WTBPriorityInput', 'StandPriceButton', 'WTBPreference']) context[name] = name;
  vm.createContext(context);
  vm.runInContext(code, context);
  return {
    render(props) { cursor = 0; return context.WTBOrderDialog(props); },
    ponty: context.pontyPrice,
  };
}
function nodes(tree) {
  return tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : [];
}
const cap = level => ({ item: { name: 'wcap', level }, meta: { definition: { name: "Wanderer's Cap", g: 10000, upgrade: {}, grades: [7, 9] }, upgradeable: true } });
const props = level => ({ item: cap(level), buyable: [], onOpenChange() {}, onSave: async () => {} });
const preset = (tree, label) => nodes(tree).find(node => node.type === 'StandPriceButton' && node.props.label === label);

test('slider +8 overrides an existing +0 bid; Ponty selection survives polling and saves +8', async () => {
  const harness = setup();
  const input = { ...props(8), existing: { price: 100, quantity: 2, minimumQuality: 0, priorityOverride: 60 } };
  let saved;
  input.onSave = async (...args) => { saved = args; };
  let tree = harness.render(input);
  assert.equal(nodes(tree).find(node => node.type === 'DialogTitle').children.join(''), "Add to WTB · Wanderer's Cap +8");
  assert.equal(nodes(tree).find(node => node.type === 'Input').props.value, '', 'do not reuse a bid priced for +0');
  const price = preset(tree, 'Ponty price').props.value;
  assert.equal(price, harness.ponty(cap(8).item, cap(8).meta));
  assert.ok(price > harness.ponty(cap(7).item, cap(7).meta));
  preset(tree, 'Ponty price').props.onClick();
  tree = harness.render({ ...input, existing: { ...input.existing, price: 999 } });
  assert.equal(nodes(tree).find(node => node.type === 'Input').props.value, String(price));
  await nodes(tree).find(node => node.type === 'Button' && node.children.includes('Place WTB')).props.onClick();
  assert.deepEqual(saved.slice(0,5), ['wcap', price, 2, 8, 60]);
  assert.equal(saved[5].useStandSlot,false); assert.equal(saved[5].acceptHigherLevels,true);
});

test('market presets require the selected level and update when the dialog level changes', () => {
  const harness = setup();
  const input = { ...props(8), history: { marketLow: 700, marketLowLevel: 7, lowest: 800, lowestLevel: 8, recent: 900, recentLevel: 8, highestPublicWTB: 500, highestPublicWTBLevel: 0 } };
  let tree = harness.render(input);
  assert.equal(preset(tree, 'Market price').props.disabled, true);
  assert.equal(preset(tree, 'Highest WTB price').props.disabled, true);
  assert.equal(preset(tree, 'Lowest seen').props.value, 800);
  assert.equal(preset(tree, 'Recent price').props.value, 900);
  nodes(tree).filter(node => node.type === 'Input')[2].props.onChange({ target: { value: '7' } });
  tree = harness.render(input);
  assert.equal(preset(tree, 'Market price').props.value, 700);
  assert.equal(preset(tree, 'Recent price').props.disabled, true);
  assert.equal(preset(tree, 'Ponty price').props.value, harness.ponty(cap(7).item, cap(7).meta));
});

test('new dialog sessions use their selected level and retain only matching existing prices', () => {
  for (const level of [0, 7, 8]) {
    const input = { ...props(level), existing: { minimumQuality: level, price: 123, quantity: 1 } };
    const tree = setup().render(input);
    assert.equal(nodes(tree).find(node => node.type === 'Input').props.value, '123');
    assert.ok(nodes(tree).find(node => node.type === 'DialogTitle').children.join('').endsWith(`+${level}`));
  }
  const wrapper = ts.transpileModule(fs.readFileSync('dashboard/features/party/party-wtborder-dialog.tsx', 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = vm.createContext({ exports: {}, require(name) {
    if (name === 'react/jsx-runtime') return require('../../dashboard/node_modules/react/jsx-runtime');
    if (name === './use-panel-model') return { usePanelModel: model => model };
    if (name === './wtborder-dialog') return { WTBOrderDialog: () => null };
    throw new Error('Unexpected component dependency: ' + name);
  } });
  vm.runInContext(wrapper, context);
  const render = context.exports.PartyWTBOrderDialog;
  const model = { state: {}, wtbItem: null };
  assert.equal(render({ model }), null, 'a closed order has no dialog instance');
  model.wtbItem = cap(8);
  const connected=render({ model });
  assert.equal(connected.type(connected.props).props.item, model.wtbItem, 'new sessions receive the selected item and level');
});
