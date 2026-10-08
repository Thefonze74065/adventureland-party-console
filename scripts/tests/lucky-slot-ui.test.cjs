const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/dashboard-query-module.cjs');
const React=require('../../dashboard/node_modules/react');
const {renderToStaticMarkup}=require('../../dashboard/node_modules/react-dom/server');
const {physicalInventory,validLuckySlot}=load('lucky-upgrade-slot.tsx');
test('physical slots preserve index 7 and do not compact empty cells',()=>{
 const entries=[{slot:8,item:{name:'sword'}},{slot:0,item:{name:'tracker'}}];
 const cells=physicalInventory(entries);assert.equal(cells.length,42);assert.equal(cells[7],null);
 assert.equal(cells[8],entries[0]);assert.equal(cells[0],entries[1]);
 assert.equal(validLuckySlot(0),true);for(const value of [null,undefined,-1,42,7.5,'7'])assert.equal(validLuckySlot(value),false);
});
test('slot search UI distinguishes missing evidence, inference, and verified slot zero',()=>{
 const {LuckySlotStatistics}=load('lucky-slot-tracker.tsx');
 const render=props=>renderToStaticMarkup(React.createElement(LuckySlotStatistics,props));
 assert.match(render({}),/Testing starts at slot 0/);
 assert.match(render({verified:0}),/Verified slot: 0/);
 const markup=render({tracking:{version:1,slots:{7:{totalRolls:1,sumRolls:0,rollsAbove96_3:0,perfectRolls:1}}}});
 assert.match(markup,/Leading candidate: slot 7/);assert.doesNotMatch(markup,/Statistically inferred:/);
 assert.match(markup,/No extra upgrades are queued/);
 assert.equal((markup.match(/<tr\b[^>]*\bdata-slot=/g)||[]).length,42);
 assert.match(markup,/Next upgrade will test for lucky upgrade/);
});
test('shared Tracktrix info renders a single account-wide bonus list',()=>{
 const req=require('node:module').createRequire(require('node:path').resolve('dashboard/package.json'));
 const {QueryClient,QueryClientProvider}=req('@tanstack/react-query');
 const {SharedTracktrixBonuses}=load('tracktrix-bonuses.tsx');
 const client=new QueryClient();
 client.setQueryData(['party','character','A','diagnostics'],{tracktrix:{active:false,bonuses:{}}});
 client.setQueryData(['party','character','B','diagnostics'],{tracktrix:{active:true,bonuses:{dex:7}}});
 const markup=renderToStaticMarkup(React.createElement(QueryClientProvider,{client},React.createElement(SharedTracktrixBonuses,{names:['A','B']})));
 assert.equal((markup.match(/Current bonuses for holding a tracktrix/g)||[]).length,1);assert.match(markup,/DEX/);assert.match(markup,/\+7/);assert.doesNotMatch(markup,/Inactive/);client.clear();
});
