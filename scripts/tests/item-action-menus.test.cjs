const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const {buildSync}=require('esbuild'),React=require('../../dashboard/node_modules/react'),{create,act}=require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
global.window=new EventTarget();
const preferences=new Map();
global.localStorage={getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value))};
function load(name){const filename=path.resolve('dashboard/features/party/'+name+'.tsx'),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));m.require=function(id){if(id==='@base-ui/react/menu')return {Menu:new Proxy({},{get:(_,key)=>'LuckyMenu'+String(key)})};if(id==='./query-actions')return {usePartyAction:()=>({})};if(id.startsWith('@/components/ui/'))return new Proxy({},{get:(_,key)=>String(key)});return Module.prototype.require.call(this,id)};m._compile(buildSync({entryPoints:[filename],bundle:true,packages:'external',external:['@/components/ui/*','./query-actions'],platform:'node',format:'cjs',write:false}).outputFiles[0].text,filename);return m.exports;}
const text=n=>typeof n==='string'?n:(n.children||[]).map(text).join('');
const {InventoryPanel}=load('inventory-panel'),{EquipSlot}=load('equip-slot');
test('occupied lucky slot chooses data or item details without the large inventory banner',async()=>{
 const p=props('weapon');let data=0,selected=[],view;p.onLuckySlot=()=>data++;p.onSelect=entry=>selected.push(entry);
 try{
  await act(async()=>view=create(React.createElement(InventoryPanel,p)));
  const trigger=()=>view.root.findAllByType('TooltipTrigger').find(n=>n.props.render?.props['aria-label']==='Test').props.render;
  await act(async()=>trigger().props.onClick({currentTarget:{}}));assert.equal(data,0);assert.equal(selected.length,0);
  const details=()=>view.root.findAllByType('LuckyMenuItem').find(n=>text(n)==='Show item details');
  assert.equal(details().props.disabled,false);await act(async()=>details().props.onClick());assert.deepEqual(selected,[p.character.items[0]]);
  assert.equal(view.root.findByType('LuckyMenuRoot').props.open,false);
  await act(async()=>trigger().props.onClick({currentTarget:{}}));
  await act(async()=>view.root.findAllByType('LuckyMenuItem').find(n=>text(n)==='Show lucky slot data').props.onClick());assert.equal(data,1);
  assert.ok(!view.root.findAllByType('button').some(n=>text(n).includes('View testing statistics')));
  assert.ok(!view.root.findAllByType('ContextMenuItem').some(n=>text(n)==='Item details'));
 }finally{await act(async()=>view?.unmount());}
});
function props(type){const entry={slot:0,item:{name:'test'},meta:{definition:{name:'Test',type,stat:type==='weapon'?1:0},sprite:null}};return {character:{name:'M',ctype:'merchant',items:[entry],slots:{},seenAt:1},characters:[{name:'M',seenAt:1},{name:'F',seenAt:1}],merchant:'M',marked:[],merchantMarked:[],autoItemMarks:{},autoUpgradeMarks:{},allAutoUpgradeMarks:{},merchantDeliveries:{},standListings:[],autoNpcSales:{},autoStandMarks:{},buyable:[],catalog:[],priceHistory:{},upgradeMarks:[],statScrollMarks:[],statScrollInventory:{},compoundGroups:[],autoCompoundMarks:[],allAutoCompoundMarks:{},autoExchanges:{}};}
test('gold marker follows the next test slot and clicking the empty slot opens a choice menu',async()=>{
 const p=props('weapon');p.character.items=[];let opened=0,view;p.onLuckySlot=()=>opened++;
 const marker=()=>view.root.findAllByType('TooltipTrigger').find(n=>n.props.render?.props['aria-label']?.includes('Open lucky slot options'));
 try{
  await act(async()=>view=create(React.createElement(InventoryPanel,p)));
  assert.match(marker().props.render.props['aria-label'],/Next upgrade will test for lucky upgrade, slot 0/);
  await act(async()=>marker().props.render.props.onClick({currentTarget:{}}));assert.equal(opened,0);
  assert.equal(view.root.findByType('LuckyMenuRoot').props.open,true);
  assert.equal(view.root.findAllByType('LuckyMenuItem').find(n=>text(n)==='Show item details').props.disabled,true);
  await act(async()=>view.root.findAllByType('LuckyMenuItem').find(n=>text(n)==='Show lucky slot data').props.onClick());assert.equal(opened,1);
  p.luckySlotTracking={version:1,cursor:{slot:1,at:1000,rolls:1},slots:{0:{totalRolls:1,sumRolls:0.4,rollsAbove96_3:0,perfectRolls:0}}};
  await act(async()=>view.update(React.createElement(InventoryPanel,{...p})));
  assert.match(marker().props.render.props['aria-label'],/slot 1/);
  await act(async()=>marker().props.render.props.onClick({currentTarget:{}}));assert.equal(opened,1);
  await act(async()=>view.root.findAllByType('LuckyMenuItem').find(n=>text(n)==='Show lucky slot data').props.onClick());assert.equal(opened,2);
 }finally{await act(async()=>view?.unmount());}
});


test('overlapping marks use one aligned red footer and active creation actions cannot toggle off',async()=>{
 const p=props('weapon'),item=p.character.items[0].item,calls=[];
 p.marked=[{slot:0,item}];p.autoItemMarks={'test@+0':'bank'};p.upgradeMarks=[{slot:0,item,tiers:1}];p.autoUpgradeMarks={'test@+0':1};
 p.character.items[0].meta.upgradeable=true;p.character.items[0].meta.definition.upgrade={};p.onCommand=(...args)=>calls.push(args);
 let view;try{await act(async()=>view=create(React.createElement(InventoryPanel,p)));
 const entries=view.root.findAllByType('ContextMenuItem'),footer=entries.filter(n=>text(n)==='Clear all marks');assert.equal(footer.length,1);
 assert.equal(entries.find(n=>text(n)==='Auto mark for bank').props.disabled,true);
 assert.ok(!entries.some(n=>/^(Unmark|Remove .*mark|Stop auto|Disable auto)/.test(text(n))));
 await act(async()=>footer[0].props.onClick());assert.deepEqual(calls,[['M','clear-item-marks',item,{slot:0}]]);
 }finally{await act(async()=>view?.unmount());}
});
test('equipped marks use the same clear footer',async()=>{
 const p=props('weapon'),item=p.character.items[0].item,calls=[];let view;
 try{await act(async()=>view=create(React.createElement(EquipSlot,{slot:'mainhand',equipped:p.character.items[0],mark:{slot:'mainhand',equipped:true,item,tiers:1},autoUpgradeMarks:{},statScrollInventory:{},onClearMarks:(...args)=>calls.push(args)})));
 const footer=view.root.findAllByType('ContextMenuItem').filter(n=>text(n)==='Clear all marks');assert.equal(footer.length,1);await act(async()=>footer[0].props.onClick());assert.deepEqual(calls,[['mainhand',item]]);
 }finally{await act(async()=>view?.unmount());}
});
