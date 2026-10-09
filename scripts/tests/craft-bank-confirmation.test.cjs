const test=require('node:test'),assert=require('node:assert/strict');
const {createMerchantOrderRoute}=require('../../runtime/coordinator/http/merchant-order.ts');
function fixture(){
 const state={merchantCharacter:'M',merchantCatalog:{buyable:[{id:'fur'}],craftable:[{id:'orb',materials:[{id:'fur',quantity:2,level:0}]}]},statuses:{M:{items:[]}},bankSnapshot:null,merchantCurrent:null,merchantQueue:[],
 autoItemMarks:{M:{fur:'bank','fur@+0':'bank','fur@+1':'bank','orb@+0':'bank'},P:{fur:'bank'}},marked:{M:[{auto:true,item:{name:'fur'}},{auto:false,item:{name:'fur'}}]}};
 const effects=[];const route=createMerchantOrderRoute(state,{now:()=>1,nextCommand:()=>1,activeNames:()=>['M'],log(){},persist(){effects.push('persist')},dispatch(){effects.push('dispatch')}});
 const post=async(confirmed=false)=>{const r={status(n){this.code=n;return this},json(body){this.body=body;return this}};await route.handle({body:{crafts:[{id:'orb',quantity:1}],removeAutoBankMark:confirmed}},r);return r};return {state,effects,post};
}
test('crafting keeps automatic bank rules and concrete marks, including requests from older clients',async()=>{
 const f=fixture(),rules=JSON.stringify(f.state.autoItemMarks),marks=JSON.stringify(f.state.marked);
 assert.equal((await f.post()).body.ok,true);assert.equal(JSON.stringify(f.state.autoItemMarks),rules);assert.equal(JSON.stringify(f.state.marked),marks);
 assert.equal((await f.post(true)).body.duplicate,true);assert.equal(f.state.merchantQueue.length,1);assert.equal(JSON.stringify(f.state.autoItemMarks),rules);
});
test('missing crafting materials still fail without changing storage preferences',async()=>{
 const f=fixture();f.state.merchantCatalog.buyable=[];assert.equal((await f.post()).code,409);assert.equal(f.state.autoItemMarks.M.fur,'bank');assert.equal(f.state.merchantQueue.length,0);
});
test('crafting allocates both bag and bank stock without removing either level-specific bank rule',async()=>{
 const f=fixture();f.state.merchantCatalog.craftable[0].materials.push({id:'ring',level:2,quantity:1});f.state.autoItemMarks.M['ring@+2']='bank';
 f.state.bankSnapshot={packs:{items0:[{slot:0,item:{name:'ring',level:2}}]}};f.state.statuses.M.items=[{slot:1,item:{name:'fur',q:2}}];
 assert.equal((await f.post()).body.ok,true);assert.equal(f.state.autoItemMarks.M['ring@+2'],'bank');assert.equal(f.state.autoItemMarks.M['fur@+0'],'bank');
 assert.equal(f.state.merchantQueue[0].order.bank[0].item.name,'ring');
});
