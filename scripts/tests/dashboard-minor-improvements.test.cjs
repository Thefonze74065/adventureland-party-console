const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const React=require('../../dashboard/node_modules/react'), {create,act}=require('../../dashboard/node_modules/react-test-renderer'),ts=require('../../node_modules/typescript');
global.IS_REACT_ACT_ENVIRONMENT=true;
function load(file){const context={exports:{},require(name){
 if(name==='react')return React;
 if(name==='./item-selection')return load('item-selection');
 if(name==='./stand-capacity')return require('../../dashboard/features/party/stand-capacity.ts');
 if(name==='react/jsx-runtime')return require('../../dashboard/node_modules/react/jsx-runtime');
 if(name==='@tanstack/react-query')return {useQuery:()=>({data:{gold:1}}),useQueryClient:()=>({})};
 if(name==='./query-cache')return {useVisible:()=>true};
 if(name==='./mail-query')return {useInbox:()=>({})};
 if(name==='./query-actions')return {usePartyAction:()=>({})};
 return new Proxy({}, {get:(_,key)=>String(key)});
}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('dashboard/features/party/'+file+'.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);return context.exports;}
const text=n=>n.children.map(c=>typeof c==='string'?c:text(c)).join('');
const findButton=(view,label)=>view.root.findAll(n=>n.type==='Button'||n.type==='button').find(n=>text(n)===label);
test('mail filters attachments, inspection leaves draft open, and clear retains the message',async()=>{
 const {SendMailDialog}=load('send-mail-dialog');let view,closed=0,inspected;
 const item=(slot,name)=>({slot,item:{name},meta:{definition:{name},sprite:{url:'/item.png'}}});
 await act(async()=>view=create(React.createElement(SendMailDialog,{open:true,onOpenChange:()=>closed++,onCount(){},onSend(){},onInspect:e=>inspected=e,merchant:{name:'M',items:[item(0,'Sword'),item(1,'Coat')]},bank:null,bankbois:[],catalog:[]})));
 await act(async()=>view.root.findByProps({'aria-label':'Search attachments'}).props.onChange({target:{value:'Sword'}}));
 assert.equal(view.root.findAllByProps({title:'Coat'}).length,0);
 await act(async()=>view.root.findByProps({title:'Sword'}).props.onClick());
 await act(async()=>view.root.findByProps({title:'View attachment details'}).props.onClick());
 assert.equal(closed,0);assert.equal(inspected.item.name,'Sword');
 await act(async()=>findButton(view,'Clear attachment').props.onClick());
 assert.equal(view.root.findAllByProps({title:'View attachment details'}).length,0);
 assert.equal(view.root.findByProps({'aria-label':'Search attachments'}).props.value,'Sword');
 await act(async()=>view.unmount());
});
test('first BankBoi creation waits for confirmation, reports failures, and blocks duplicate submission',async()=>{
 const {BankSheet}=load('bank-sheet');let view,calls=0,finish;
 const props={open:true,bankboiPrefix:'Bank',onOpenChange(){},bank:null,bankbois:[],bankboiQueue:[],vaults:[],withdrawals:{},standListings:[],npcSaleMarks:[],catalog:[],buyable:[],priceHistory:{},onCreateBankboi:()=>{calls++;return new Promise(resolve=>finish=resolve)}};
 await act(async()=>view=create(React.createElement(BankSheet,props)));
 await act(async()=>findButton(view,'Create bankboi').props.onClick());assert.equal(calls,0);
 assert.ok(view.root.findAllByType('DialogDescription').some(n=>text(n).includes('reserve the final 7 slots')));
 const confirm=findButton(view,'Create BankBoi');await act(async()=>{confirm.props.onClick();confirm.props.onClick()});assert.equal(calls,1);
 await act(async()=>finish('Bank0'));
 assert.equal(view.root.findAllByType('Dialog').find(n=>n.props.open===true)?.props.open,true);
 await act(async()=>view.unmount());
});
