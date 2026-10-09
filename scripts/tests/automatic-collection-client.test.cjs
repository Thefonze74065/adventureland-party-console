const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {availableCraftStock}=require('../../runtime/craft-reservations.ts');
const source=fs.readFileSync(process.env.AL_COLLECTION_SOURCE || 'characters/shared.js','utf8');
const ast=ts.createSourceFile('shared.js',source,ts.ScriptTarget.Latest,true);
function declaration(name){let found;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)found=n;ts.forEachChild(n,visit);}visit(ast);assert.ok(found,name);return found.getText(ast);}
function fixture(){
 const item={name:'gem',level:0,q:8},pickup={slot:0,item:{...item},quantity:4,automaticPickup:true},sent=[],requests=[];
 let current=[pickup],protection={requirements:[]};
 const context={character:{name:'F',map:'main',in:'main',x:0,y:0,cc:0,rip:false,items:[{...item}],slots:{},gold:0},navigationIntent:{revision:1},lastCommand:1,
 runtimeCurrent:()=>true,reunionRealm:()=> 'USI',get_player:()=>({name:'M',map:'main',in:'main',x:1,y:0,rip:false}),engagedMonster:()=>null,sleep:async()=>{},
 waitForPlayer:async()=>({}),assertMerchantContinuation(){},sameItem:(a,b)=>!!a&&!!b&&a.name===b.name&&a.level===b.level,
 findItem:()=>0,freeInventorySlots:()=>10,itemQuantity:i=>i.q||1,game_log(){},encodeURIComponent,
 send_item:async(to,slot,q)=>{sent.push({to,slot,q});context.character.items[slot].q-=q;if(!context.character.items[slot].q)context.character.items[slot]=null;},
 request:async(url,options)=>{requests.push({url,body:options?.body});return{collectionPickups:{keep:current},craftProtection:protection};},partyAvailableCraftStock:availableCraftStock};
 vm.createContext(context);vm.runInContext(['isPersonalTracker','waitForHandoffSendWindow','merchantHandoff','compoundAvailableStock','merchantOperationStage'].map(declaration).join('\n'),context);
 return{context,pickup,sent,requests,command:{id:1,jobId:'j',merchant:'M',capacity:3,merchantMarked:[pickup]},disable(){current=[]},protect(){protection={requirements:[{id:'gem',level:0,quantity:5}]}}};
}
test('automatic pickup sends only the currently authorized unreserved quantity as kept cargo',async()=>{
 const f=fixture();f.protect();await f.context.merchantHandoff(f.command);
 assert.deepEqual(f.sent,[{to:'M',slot:0,q:3}]);
 const receipt=f.requests.find(r=>r.url==='/merchant/handoff-complete').body;assert.equal(receipt.kept[0].quantity,3);assert.equal(receipt.kept[0].automaticPickup,true);assert.equal(receipt.banked.length,0);
});
test('disabled rules, locked items and stale slots cannot send an automatic pickup',async()=>{
 for(const mode of ['disabled','locked','moved']){const f=fixture();if(mode==='disabled')f.disable();if(mode==='locked')f.context.character.items[0].l='l';if(mode==='moved'){f.context.character.items[1]=f.context.character.items[0];f.context.character.items[0]=null;}await f.context.merchantHandoff(f.command);assert.equal(f.sent.length,0,mode);}
});
test('activity reports only processing commands and suppresses duplicate stage reports',async()=>{
 const f=fixture(),command={jobId:'j',processingRoutine:'auto compound'};
 await f.context.merchantOperationStage(command,'retrieving');await f.context.merchantOperationStage(command,'retrieving');await f.context.merchantOperationStage(command,'processing');await f.context.merchantOperationStage(command,'storing');await f.context.merchantOperationStage({jobId:'pickup'},'processing');
 assert.deepEqual(f.requests.map(r=>r.body.operationStage),['retrieving','processing','storing']);
});
