const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const React=require('../../dashboard/node_modules/react'),renderer=require('../../dashboard/node_modules/react-test-renderer');
const ts=require('../../dashboard/node_modules/typescript');
const code=ts.transpileModule(fs.readFileSync('dashboard/features/party/active-wtb-fields.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const context={exports:{},require(name){if(name==='react')return React;if(name==='react/jsx-runtime')return require('../../dashboard/node_modules/react/jsx-runtime');return {Input:'input'};}};
vm.runInNewContext(code,context);global.IS_REACT_ACT_ENVIRONMENT=true;
const bid={quantity:12,price:300,priorityOverride:88};
test('each button becomes only its own same-size input and saves just that field',async()=>{
 const calls=[];let root,priceEdits=0;
 await renderer.act(async()=>{root=renderer.create(React.createElement(context.exports.ActiveWTBFields,{name:'Cap',bid,onEditPrice:()=>priceEdits++,onSave:async(...args)=>calls.push(args)}))});
 for(const field of ['quantity','priority']){
  const button=root.root.findByProps({'aria-label':`Edit ${field} for Cap`});
  await renderer.act(async()=>button.props.onClick());
  const input=root.root.findByType('input');
  assert.equal(root.root.findAllByType('button').length,2);assert.equal(root.root.findAllByType('label').length,0);
  await renderer.act(async()=>input.props.onChange({target:{value:'25'}}));
  await renderer.act(async()=>root.root.findByType('input').props.onKeyDown({key:'Enter',preventDefault(){}}));
  assert.deepEqual(calls.at(-1),[field,25]);
 }
 await renderer.act(async()=>root.root.findByProps({'aria-label':'Edit price for Cap'}).props.onClick());
 assert.equal(priceEdits,1);assert.equal(root.root.findAllByType('input').length,0);
 await renderer.act(async()=>root.unmount());
});
test('Escape cancels, blank priority saves default, invalid input and failures keep editing',async()=>{
 let calls=[],fail=false,root;
 await renderer.act(async()=>{root=renderer.create(React.createElement(context.exports.ActiveWTBFields,{name:'Cap',bid,onEditPrice:()=>{},onSave:async(...args)=>{calls.push(args);if(fail)throw Error('Server rejected edit')}}))});
 const edit=async field=>renderer.act(async()=>root.root.findByProps({'aria-label':`Edit ${field} for Cap`}).props.onClick());
 const change=async value=>renderer.act(async()=>root.root.findByType('input').props.onChange({target:{value}}));
 await edit('quantity');const old=root.root.findByType('input').props;
 await renderer.act(async()=>{old.onKeyDown({key:'Escape',preventDefault(){}});old.onBlur()});assert.equal(calls.length,0);
 await edit('priority');await change('');await renderer.act(async()=>root.root.findByType('input').props.onBlur());assert.deepEqual(calls,[['priority',null]]);
 await edit('quantity');await change('0');await renderer.act(async()=>root.root.findByType('input').props.onBlur());assert.equal(calls.length,1);assert.equal(root.root.findAllByType('input').length,1);
 fail=true;await change('42');await renderer.act(async()=>root.root.findByType('input').props.onBlur());assert.match(root.root.findByProps({role:'alert'}).children[0],/Server rejected edit/);
 await renderer.act(async()=>root.unmount());
});

test('actual stand-sheet callbacks preserve fills between dashboard rendering and saving',async()=>{
 const {createMerchantBidRoute}=require('../../runtime/coordinator/http/merchant-bid.ts');
 const file=ts.createSourceFile('stand-sheet.tsx',fs.readFileSync('dashboard/features/party/stand-sheet.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let inline,priority;
 function visit(node){
  if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(file)==='ActiveWTBFields')
   inline=node.attributes.properties.find(p=>p.name?.getText(file)==='onSave').initializer.expression.getText(file);
  if(ts.isFunctionDeclaration(node)&&node.name?.text==='saveStandPriority')priority=node.getText(file);
  ts.forEachChild(node,visit);
 }
 visit(file);assert.ok(inline);assert.ok(priority);
 const state={merchantCharacter:'M',merchantCatalog:{allItems:[{id:'vitscroll'}]},statuses:{},standListings:[],
  standBids:{vitscroll:{price:9600,quantity:6,revision:4,priorityOverride:75}}};
 const route=createMerchantBidRoute(state,{removeQueued(){},log(){},observe(){},persist(){},publish(){},ponty:()=>true,aldata(){},dispatch(){}});
 const posted=[],c={itemId:'vitscroll',bid:{...state.standBids.vitscroll,quantity:10},
  standPriorityDrafts:{vitscroll:'88'},savingStandPriority:{current:false},setSavingBid(){},setBidError(){},setStandPriorityDrafts(){},
  onBid:async(itemId,price,quantity,minimumQuality,clear,priorityOverride,options)=>{
   const body={itemId,price,quantity,minimumQuality,clear,priorityOverride,...options};posted.push(body);
   const response={status(code){this.code=code;return this},json(body){this.body=body}};
   route({body},response);if(response.code>=400)throw Error(response.body.error);
  }};
 vm.runInNewContext(ts.transpileModule('globalThis.inline='+inline+';'+priority,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c);
 await c.inline('price',9500);assert.equal(state.standBids.vitscroll.quantity,6);assert.equal(state.standBids.vitscroll.price,9500);
 await c.inline('priority',99);assert.equal(state.standBids.vitscroll.priorityOverride,99);assert.equal(state.standBids.vitscroll.price,9500);
 await c.saveStandPriority('vitscroll',c.bid);assert.equal(state.standBids.vitscroll.priorityOverride,88);
 await c.inline('priority',null);assert.equal(state.standBids.vitscroll.priorityOverride,undefined);
 assert.equal(state.standBids.vitscroll.quantity,6);assert.ok(posted.every(body=>body.bidRevision===4));
 delete state.standBids.vitscroll;
 await assert.rejects(c.inline('price',9000),/completed/);assert.equal(state.standBids.vitscroll,undefined);
});
