const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../../dashboard/node_modules/typescript');
const { standSaleRows, standBuyRows, occupiedStandSlots, standOccupancy } = require('../../dashboard/features/party/stand-inspection.ts');
const bid = {price: 100, quantity: 15000, minimumQuality: 2, useStandSlot: true};
const entry = (name, b=false) => ({item:{name, level:2, price:100, q:99, b}});

test('only placed buys count, not pending explicit reservations',()=>{
 const sales=Array.from({length:12},(_,i)=>({tradeSlot:`trade${i+1}`,state:'live'}));
 const bids={vitscroll:bid,slice_blueberry:bid,shopping:{...bid,useStandSlot:false}};
 const offers={offers:{v:{itemId:'vitscroll',slot:'trade13',phase:'live'},b:{itemId:'slice_blueberry',slot:'trade14',phase:'live'}}};
 for(const native of [{offers:{}},offers])
  assert.deepEqual(standOccupancy(sales,native,{standOpen:false},bids),{sales:12,buys:native === offers ? 2 : 0,total:native === offers ? 14 : 12});
 const slots=Object.fromEntries(sales.map(s=>[s.tradeSlot,entry('sale')]));
 slots.trade13=entry('vitscroll',true);slots.trade14=entry('slice_blueberry',true);
 assert.equal(occupiedStandSlots(sales,offers,{standOpen:true,slots},bids),14);
 assert.equal(occupiedStandSlots(sales,{offers:{}},{standOpen:false},{slice_blueberry:bid}),12);
});

test('twelve sales and four buys exclude a paused stale seventeenth listing',()=>{
 const listings=Array.from({length:12},(_,i)=>({id:String(i),tradeSlot:`trade${i+1}`,state:'live',item:{name:'item'+i,level:2}}));
 listings.push({id:'paused',tradeSlot:'trade12',state:'paused',item:{name:'pants',level:2}});
 const slots=Object.fromEntries(Array.from({length:16},(_,i)=>[`trade${i+1}`,entry(i<12?'item'+i:'buy'+i,i>=12)]));
 const native={offers:Object.fromEntries([13,14,15,16].map(i=>[i,{slot:`trade${i}`,phase:'live'}]))};
 for(const standOpen of [true,false]) {
   const merchant={standOpen,slots:standOpen?slots:{}};
   assert.deepEqual(standOccupancy(listings,native,merchant),{sales:12,buys:4,total:16});
   const rows=standSaleRows(listings,merchant,native);
   assert.equal(rows.filter(r=>r.occupied).length,12);
   assert.deepEqual(rows.filter(r=>!r.occupied).map(r=>r.key),['paused']);
 }
 // An observed buy slot takes precedence over a stale sale reference, even closed.
 assert.deepEqual(standOccupancy([listings[0]],{}, {standOpen:false,slots:{trade1:entry('buy',true)}}),{sales:0,buys:1,total:1});
});

test('closed stand counts retained sale and buy slots once, excluding waiting orders',()=>{
 const sales=Array.from({length:12},(_,i)=>({tradeSlot:'trade'+(i+1),state:'live'}));
 sales.push({tradeSlot:'trade13',state:'paused'},{state:'waiting'});
 const native={offers:Object.fromEntries([13,14,15,16].map(i=>[i,{slot:'trade'+i,phase:'live'}]))};
 assert.equal(occupiedStandSlots(sales,native,{standOpen:false,slots:{}}),16);
 assert.equal(occupiedStandSlots(sales,native,{standOpen:false,slots:{trade1:entry('cap')}}),16);
 assert.equal(occupiedStandSlots(sales,native,{standOpen:true,slots:{trade1:entry('cap')}}),1);
 assert.equal(occupiedStandSlots([{state:'waiting'}],{offers:{q:{slot:'trade2',phase:'placing'}}},{standOpen:false}),0);
});
test('sales exclude buys, consume matches once, retain queued/paused and unmatched slots', () => {
 const listings = [{id:'one',slot:0,item:{name:'cap',level:2},price:100,quantity:1}, {id:'two',slot:1,item:{name:'cap',level:2},price:100,quantity:1}, {id:'three',slot:2,item:{name:'paused'},price:10,quantity:1,state:'paused'}];
 const merchant = {standOpen:true,slots:{trade1:entry('cap'),trade2:entry('buy',true),trade3:entry('extra')}};
 const rows = standSaleRows(listings,merchant);
 assert.deepEqual(rows.map(r=>r.status),['Live','Queued','Paused','Live']);
 assert.equal(rows[3].editable,false);
 assert.equal(standSaleRows(listings,{...merchant,standOpen:false})[0].status,'Queued');
});
test('buys include observed explicit and automatic batches, excluding waiting orders',()=>{
 const bids={cap:bid,auto:{...bid,useStandSlot:false},waiting:bid,shopping:{...bid,useStandSlot:false}};
 const native={offers:{a:{itemId:'cap',slot:'trade1',auto:false,phase:'live',level:2,price:100},b:{itemId:'auto',slot:'trade2',auto:true,phase:'placing',level:2,price:100}},problems:{waiting:'Price exceeds limit'}};
 const merchant={standOpen:true,slots:{trade1:entry('cap',true),trade2:entry('auto',true)}};
 const rows=standBuyRows(bids,native,merchant);
 assert.equal(rows.length,2);assert.equal(rows[0].observed.item.q,99); assert.equal(rows[0].bid.quantity,15000);
 assert.equal(rows[1].offer.auto,true);assert.equal(rows[1].bid.useStandSlot,false);
 assert.equal(standBuyRows(bids,native,{...merchant,standOpen:false}).length,2);
 assert.equal(standBuyRows(bids,native,{...merchant,slots:{trade1:entry('cap')}}).length,0);
});
const React = require('../../dashboard/node_modules/react');
const renderer = require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const code=ts.transpileModule(fs.readFileSync('dashboard/features/party/stand-sheet.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const context={exports:{},require(name){
 if(name==='react')return React;
 if(name==='react/jsx-runtime')return require('../../dashboard/node_modules/react/jsx-runtime');
 if(name==='./stand-inspection')return {standSaleRows,standBuyRows,occupiedStandSlots,standOccupancy};
 if(name==='./level-price-history')return {levelPriceHistory:()=>({})};
 if(name==='@/hooks/use-clock')return {useClock:()=>1000};
 if(name==='@/hooks/use-stored-boolean')return {useStoredBoolean:(_,v)=>React.useState(v)};
 if(name==='./query-actions')return {usePartyAction:()=>({})};
 if(name==='./wtb-preferences')return {WTBPreference:'WTBPreference',useWTBReplacement:()=>({save:fn=>fn(),dialog:null})};
 return new Proxy({}, {get:(_,key)=>String(key)});
}};
vm.runInNewContext(code,context);
const props=()=>({open:true,marketOpen:true,merchant:{standOpen:true,slots:{trade1:entry('cap',true)}},onOpenChange(){},onMarketOpenChange(){},catalog:[{id:'cap',name:'Cap'}],buyable:[],bids:{cap:bid},listings:[],priceHistory:{},blacklist:{},onBid:async()=>{},onInspect(){}});

test('WTB catalog is a narrow name-and-add picker opening the regular order editor',async()=>{
 const p=props(),opened=[];let saves=0,root;
 p.onEditBuy=(item,meta)=>opened.push({item,meta});p.onBid=async()=>{saves++};
 await renderer.act(async()=>{root=renderer.create(React.createElement(context.exports.StandSheet,p))});
 const picker=root.root.findAllByType('DialogContent').find(n=>n.findAllByType('DialogTitle').some(t=>t.children.includes('WTB orders')));
 assert.ok(picker.props.className.includes('sm:max-w-md'));
 assert.equal(picker.findAllByType('Input').length,1);
 assert.equal(picker.findAllByType('span').filter(n=>['Bid','Quantity','Minimum quality','Lowest seen','Most recent'].includes(n.children.join(''))).length,0);
 const add=picker.findAllByType('Button').find(n=>n.children.includes('Add'));
 await renderer.act(async()=>add.props.onClick());
 assert.equal(saves,0);assert.equal(opened[0].item.name,'cap');assert.equal(opened[0].item.level,2);
 assert.equal(picker.parent.props.open,false);
 await renderer.act(async()=>root.unmount());
});

test('stand amounts open pricing and inline priority saves without changing buy price or quantity',async()=>{
 const p=props(),calls=[];p.listings=[{id:'sale',slot:0,item:{name:'cap',level:2},price:250,quantity:1}];
 p.onEdit=listing=>calls.push(['sale',listing.id]);p.onEditBuy=item=>calls.push(['buy',item.name]);p.onBid=async(...args)=>calls.push(['priority',...args]);
 let root;await renderer.act(async()=>{root=renderer.create(React.createElement(context.exports.StandSheet,p))});
 const button=label=>root.root.findAll(n=>n.type==='Button'&&n.props['aria-label']===label)[0];
 await renderer.act(async()=>button('Edit sale price for cap').props.onClick());
 await renderer.act(async()=>button('Edit buy price for Cap').props.onClick());
 assert.deepEqual(calls,[['sale','sale'],['buy','cap']]);
 const priority=()=>root.root.findAll(n=>n.type==='WTBPriorityInput'&&n.props.onBlur)[0];
 await renderer.act(async()=>priority().props.onChange('99'));
 await renderer.act(async()=>priority().props.onBlur());
 assert.deepEqual(calls[2].slice(0,7),['priority','cap',100,15000,2,false,99]);
 assert.equal(root.root.findAll(n=>n.type==='p'&&n.children.join('').includes('stand closed')).length,0);
 await renderer.act(async()=>root.unmount());
});
test('both cancellation views require two clicks, reset on close/order removal, and expose failures', async()=>{
 let calls=0;const p=props();p.onBid=async()=>{calls++;throw Error('Request failed')};let root;
 await renderer.act(async()=>{root=renderer.create(React.createElement(context.exports.StandSheet,p))});
 const buttons=()=>root.root.findAll(n=>n.type==='Button' && n.children.some(c=>c==='Cancel'||c==='Really cancel?'));
 // The picker only adds orders; stand and active-order cancellation share a handler.
 const orderButtons=()=>buttons().filter(n=>n.props.className?.includes('border-rose-700'));
 assert.equal(orderButtons().length,2);
 for(let i=0;i<2;i++){
  await renderer.act(async()=>{root.update(React.createElement(context.exports.StandSheet,{...p,open:false}))});
  await renderer.act(async()=>{root.update(React.createElement(context.exports.StandSheet,p))});
  const before=calls;
  await renderer.act(async()=>{orderButtons()[i].props.onClick()});assert.equal(calls,before);
  assert.ok(orderButtons()[i].children.includes('Really cancel?'));
  await renderer.act(async()=>{orderButtons()[i].props.onClick()});assert.equal(calls,before+1);
  assert.ok(root.root.findAll(n=>n.props.role==='alert').length);
 }
 await renderer.act(async()=>{root.update(React.createElement(context.exports.StandSheet,{...p,bids:{}}))});
 await renderer.act(async()=>{root.update(React.createElement(context.exports.StandSheet,p))});
 assert.ok(orderButtons().every(n=>n.children.includes('Cancel')));
 await renderer.act(async()=>{root.unmount()});
});
test('selecting another order resets confirmation; successful submission locks all cancellation controls', async()=>{
 let calls=[];let finish;const p=props();p.bids={cap:bid,other:bid};p.merchant.slots.trade2=entry('other',true);p.onBid=(...args)=>{calls.push(args);return new Promise(resolve=>{finish=resolve})};let root;
 await renderer.act(async()=>{root=renderer.create(React.createElement(context.exports.StandSheet,p))});
 const controls=()=>root.root.findAll(n=>n.type==='Button' && n.props.className?.includes('border-rose-700'));
 await renderer.act(async()=>{controls()[0].props.onClick()});
 await renderer.act(async()=>{controls()[1].props.onClick()});
 assert.equal(calls.length,0);assert.ok(controls()[0].children.includes('Cancel'));assert.ok(controls()[1].children.includes('Really cancel?'));
 await renderer.act(async()=>{controls()[1].props.onClick()});
 assert.equal(calls.length,1);assert.equal(calls[0][0],'other');assert.equal(calls[0][4],true);
 assert.ok(controls().every(n=>n.props.disabled));
 await renderer.act(async()=>{finish()});
 assert.ok(controls().every(n=>n.children.includes('Cancel')));
 await renderer.act(async()=>root.unmount());
});
test('pending price edits do not duplicate the observed sale',()=>{
 const listing={slot:0,item:{name:'cap',level:2},price:200,quantity:1};
 const rows=standSaleRows([listing],{standOpen:true,slots:{trade1:entry('cap')}});
 assert.equal(rows.length,1);assert.equal(rows[0].status,'Queued');
});
test('empty stand keeps section headings and only the header close control',async()=>{
 const p={...props(),merchant:undefined,bids:{},catalog:[]};let root;
 await renderer.act(async()=>{root=renderer.create(React.createElement(context.exports.StandSheet,p))});
 const dialog=root.root.findAll(n=>n.type==='DialogContent')[0];
 assert.equal(dialog.props.showCloseButton,false);
 assert.ok(dialog.findAll(n=>n.type==='h2').some(n=>n.children.join('').includes('Items for sale')));
 assert.ok(dialog.findAll(n=>n.type==='h2').some(n=>n.children.join('').includes('Buy orders')));
 assert.equal(dialog.findAllByType('DialogFooter').length,0);
 assert.equal(dialog.findAllByProps({'aria-label':'Close stand'}).length,1);
 assert.ok(dialog.findByType('DialogHeader').props.className.includes('pr-12'));
 await renderer.act(async()=>root.unmount());
});
test('sale removal requires two clicks and resets when a buy cancellation is selected',async()=>{
 const p=props();let removed=0,root;p.listings=[{id:'sale',slot:1,item:{name:'cap'},quantity:1,price:10}];p.onRemove=async()=>{removed++};
 await renderer.act(async()=>root=renderer.create(React.createElement(context.exports.StandSheet,p)));
 const remove=()=>root.root.findAllByType('Button').find(n=>String(n.props['aria-label']).startsWith('Remove '));
 await renderer.act(async()=>remove().props.onClick());assert.equal(removed,0);assert.ok(remove().children.includes('Really remove?'));
 const cancel=root.root.findAllByType('Button').find(n=>n.children.includes('Cancel')&&n.props.className?.includes('border-rose-700'));
 await renderer.act(async()=>cancel.props.onClick());assert.ok(remove().children.includes('Remove'));
 await renderer.act(async()=>remove().props.onClick());await renderer.act(async()=>remove().props.onClick());assert.equal(removed,1);
 await renderer.act(async()=>root.unmount());
});

test('queued sales render between occupied sales and buy orders',async()=>{
 const p=props();p.merchant={standOpen:true,slots:{trade1:entry('cap'),trade2:entry('buy',true)}};
 p.listings=[{id:'live',slot:0,item:{name:'cap',level:2},price:100,state:'live',tradeSlot:'trade1'},{id:'paused',slot:1,item:{name:'pants'},price:10,state:'paused',tradeSlot:'trade1'}];
 let root;await renderer.act(async()=>root=renderer.create(React.createElement(context.exports.StandSheet,p)));
 const dialog=root.root.findAllByType('DialogContent')[0];
 assert.deepEqual(dialog.findAllByType('h2').map(n=>n.children.join('')),['Items for sale · 1/16 slots','Queued sales for stand','Buy orders · 1/16 slots']);
 const sections=dialog.findAllByType('section');assert.equal(sections.length,2);
 assert.equal(sections[0].findAllByType('Tooltip').length,1);assert.equal(sections[1].findAllByType('Tooltip').length,1);
 await renderer.act(async()=>root.unmount());
});

function fullStandFixture() {
 const listings=Array.from({length:12},(_,i)=>({id:`sale${i}`,tradeSlot:`trade${i+1}`,state:'live',item:{name:'sale'+i,level:2},price:100}));
 const bids=Object.fromEntries(Array.from({length:6},(_,i)=>['buy'+i,{...bid,useStandSlot:i>=4}]));
 const offers=Object.fromEntries(Array.from({length:6},(_,i)=>[i,{itemId:'buy'+i,slot:'trade'+(i<4?13+i:i-3),phase:i<4?'live':i===4?'placing':'blocked',auto:true,level:2,price:100,quantity:99,acknowledged:0}]));
 const slots=Object.fromEntries(Array.from({length:16},(_,i)=>['trade'+(i+1),entry(i<12?'sale'+i:'buy'+(i-12),i>=12)]));
 return {listings,bids,native:{offers,problems:{}},slots};
}
test('twelve sale slots and four buy slots show exactly four of six candidate buys open or closed',()=>{
 const {listings,bids,native,slots}=fullStandFixture();
 for(const merchant of [{standOpen:true,slots},{standOpen:false,slots},{standOpen:false,slots:{}}]) {
  const rows=standBuyRows(bids,native,merchant,listings);
  assert.equal(rows.length,4);
  assert.deepEqual(rows.map(r=>r.id),['buy0','buy1','buy2','buy3']);
  assert.deepEqual(standOccupancy(listings,native,merchant,bids),{sales:12,buys:rows.length,total:16});
 }
});
test('slot collisions, stale offers and invalid slots cannot add buy cards',()=>{
 const {listings,bids,native,slots}=fullStandFixture();
 native.offers.extra={...native.offers[0],slot:'trade1',itemId:'buy4'};
 native.offers.invalid={...native.offers[0],slot:'trade17'};
 slots.trade17=entry('buy4',true);
 for(const standOpen of [true,false]) {
  const merchant={standOpen,slots};
  assert.equal(standBuyRows(bids,native,merchant,listings).length,4);
  assert.equal(standSaleRows(listings,merchant,native).filter(r=>r.occupied).length,12);
 }
 native.offers[0].phase='removing';
 assert.equal(standBuyRows(bids,native,{standOpen:false},listings).find(r=>r.key==='trade13').offer.phase,'removing');
 assert.equal(standBuyRows(bids,native,{standOpen:true,slots:{}},listings).length,0);
});
test('observed buy slots survive missing orders and duplicate item names with distinct keys',()=>{
 const merchant={standOpen:true,slots:{trade1:entry('unknown',true),trade2:entry('unknown',true)}};
 const rows=standBuyRows({},undefined,merchant);
 assert.deepEqual(rows.map(r=>r.key),['trade1','trade2']);
 assert.ok(rows.every(r=>!r.bid && r.price===100 && r.quantity===99));
});
test('stand dialog matches four occupied cards and renders open/closed badges without queued sale badges',async()=>{
 const {listings,bids,native,slots}=fullStandFixture();let root;
 for(const standOpen of [true,false]) {
  const p={...props(),listings,bids,nativeStand:native,merchant:{standOpen,slots:standOpen?slots:{}}};
  await renderer.act(async()=>{root=renderer.create(React.createElement(context.exports.StandSheet,p))});
  const dialog=root.root.findAllByType('DialogContent')[0];
  assert.deepEqual(dialog.findAllByType('h2').map(n=>n.children.join('')),['Items for sale · 12/16 slots','Buy orders · 4/16 slots']);
  assert.equal(dialog.findAllByType('WTBPreference').length,4);
  assert.equal(dialog.findAllByType('span').filter(n=>n.children.includes('Queued')).length,0);
  const badge=dialog.findAllByType('span').find(n=>n.children.includes(standOpen?'Stand open':'Stand closed'));
  assert.ok(badge.props.className.includes(standOpen?'bg-emerald-950':'bg-red-950'));
  await renderer.act(async()=>root.unmount());
 }
});
test('unconfigured occupied buys display terms without editable order controls',async()=>{
 let root;const p={...props(),bids:{}};
 await renderer.act(async()=>root=renderer.create(React.createElement(context.exports.StandSheet,p)));
 const dialog=root.root.findAllByType('DialogContent')[0];
 assert.equal(dialog.findAllByType('WTBPreference').length,0);
 assert.equal(dialog.findAllByType('WTBPriorityInput').length,0);
 assert.equal(dialog.findAllByType('Button').find(n=>n.props['aria-label']==='Edit buy price for Cap').props.disabled,true);
 assert.ok(dialog.findAllByType('span').some(n=>n.children.join('')==='99 wanted'));
 await renderer.act(async()=>root.unmount());
});
