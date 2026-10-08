const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/dashboard-query-module.cjs');
const { dungeonEntryLabel } = load('dungeon-query.ts');
test('entry countdown requires fresh server eligibility and never guesses availability at reset', () => {
  const now = 100000;
  const view = { members: [{ fresh: true, observation: { visit: { checkedAt: now, available: false, resets: now + 65000 } } }] };
  assert.equal(dungeonEntryLabel(view, now), 'Next entry: 0h 1m 5s');
  view.members[0].observation.visit.resets = now;
  assert.equal(dungeonEntryLabel(view, now), 'Checking availability…');
  view.members[0].observation.visit.available = true;
  assert.equal(dungeonEntryLabel(view, now), 'Available now');
  view.members[0].fresh = false;
  assert.equal(dungeonEntryLabel(view, now), 'Availability unknown');
  view.members[0].fresh = true;
  assert.equal(dungeonEntryLabel(view, now + 46000), 'Availability unknown');
});
test('dungeon panel exposes actual objectives and explicit priest recovery controls', () => {
  const React = require('../../dashboard/node_modules/react');
  const { renderToStaticMarkup } = require('../../dashboard/node_modules/react-dom/server');
  const dashboardRequire = require('node:module').createRequire(require('node:path').resolve('dashboard/package.json'));
  const { QueryClientProvider } = dashboardRequire('@tanstack/react-query');
  const { createDashboardClient } = load('query-cache.tsx');
  const { DungeonPanel } = load('dungeon-panel.tsx');
  const client = createDashboardClient(), now = Date.now();
  client.setQueryData(['party', 'daily-dungeons'], { state: { phase: 'active', run: 'r', participants: ['W'],commands:{} }, members: [{ name: 'W', fresh: true,
    observation: { alive: false, cave: { run: 'r', floor: 1, expires: now + 50000, remainingMs: 50000, paused: true, gold: 20, amber: 3,
      points: [{ id: 'stairs', label: 'Stairs down', locked: true }],
      choice: { id: 'nera', title: 'Nera', text: 'Choose where to revive', deadline: now + 30000, resolved: false, votes: {},
        options: [{ id: 'here', label: 'Revive here', amber: 1 }, { id: 'door', label: 'Revive at doorway', amber: 0 }] } } } }] });
  try {
    const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(DungeonPanel,{model:{state:{merchantCatalog:null}}})));
    assert.match(html, /Stairs down.*locked/);
    // Encounter choices now open in a client portal, exercised by live-cave.spec.ts.
    assert.match(html, /paused for Nera/);
    assert.match(html, /Call Nera/);
    assert.match(html, /grid-cols-2/);
    const view = client.getQueryData(['party', 'daily-dungeons']);
    view.state.priestRecovery = {id:'r:revive:W:1',run:'r',priest:'P',target:'W',authorized:true};
    view.members.push({name:'P',fresh:true,observation:{alive:true,recovery:{actor:{c:{}},id:'r:revive:W:1',phase:'uncertain',reason:'Revive outcome unknown'}}});
    view.members[0].observation.cave.choice.resolved=true;
    const render=()=>renderToStaticMarkup(React.createElement(QueryClientProvider,{client},React.createElement(DungeonPanel,{model:{state:{merchantCatalog:null}}})));
    const waiting=render();assert.match(waiting,/Revive outcome unknown/);assert.match(waiting,/disabled=""[^>]*>Call Nera/);
    view.members[1].observation.recovery.phase='failed';
    assert.doesNotMatch(render(),/disabled=""[^>]*>Call Nera/);
  } finally { client.clear(); }
});
