const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const file=ts.createSourceFile('dialog.tsx',fs.readFileSync('dashboard/features/party/merchant-commerce-dialog.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let submitSource;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='submit')submitSource=node.initializer.getText(file);ts.forEachChild(node,visit)}visit(file);
const executable=ts.transpileModule('globalThis.submit = '+submitSource,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const {PartyActionError}=require('./helpers/dashboard-query-module.cjs')('query-actions.ts');
function fixture(onSubmit){
 const effects=[],r={Error,PartyActionError,pending:{current:false},selected:[{id:'tri'}],cart:{tri:4},catalogKey:i=>i.id,mode:'craft',onSubmit,
 pendingEstimate:false,unavailable:[],validCaps:true,setConfirmUnavailable:v=>effects.push(['estimate-confirmation',v]),
 bankConfirmation:null,setBankConfirmation:v=>{r.bankConfirmation=v;effects.push(['confirmation',v]);},
 setSubmitting:v=>effects.push(['pending',v]),setSubmitError:v=>effects.push(['error',v]),setCraftCart:v=>effects.push(['cart',v])};
 vm.runInNewContext(executable,r);return {submit:r.submit,effects,r};
}
test('dialog catches rejection, preserves cart and renders shortage text without an unhandled rejection',async()=>{
 const f=fixture(async()=>{throw new PartyActionError(409,{error:'Materials unavailable',missing:[{id:'intring',level:0,required:4,available:3}]})});
 await f.submit();assert.equal(f.effects.some(e=>e[0]==='cart'),false);
 assert.match(f.effects.find(e=>e[0]==='error'&&e[1])?.[1],/intring \+0: 4 required, 3 available/);
 assert.equal(f.r.pending.current,false);
});
test('dialog suppresses duplicate pending submissions and clears its cart only on success',async()=>{
 let resolve,calls=0;const f=fixture(()=>{calls++;return new Promise(done=>resolve=done)});
 const first=f.submit();await f.submit();assert.equal(calls,1);assert.equal(f.effects.some(e=>e[0]==='cart'),false);
 resolve();await first;assert.equal(f.effects.filter(e=>e[0]==='cart').length,1);assert.equal(f.r.pending.current,false);
});

test('craft submissions no longer request removal of automatic bank marks',async()=>{
 const calls=[];const f=fixture(async(...args)=>calls.push(args));
 await f.submit();assert.equal(calls.length,1);assert.equal(calls[0].length,3);
 assert.equal(calls[0][1][0].quantity,4);assert.ok(f.effects.some(e=>e[0]==='cart'));
});
