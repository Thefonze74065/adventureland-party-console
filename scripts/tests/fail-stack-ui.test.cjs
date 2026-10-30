const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const {buildSync}=require('esbuild'),React=require('../../dashboard/node_modules/react'),{create,act}=require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
const filename=path.resolve('dashboard/features/party/fail-stack-ui-fixture.cjs'),m=new Module(filename,module);
m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
const posts=[];let fail=null;
m.require=function(id){
 if(id.startsWith('@/components/ui/'))return new Proxy({},{get:(_,key)=>String(key)});
 if(id==='./query-actions')return {usePartyAction:()=>{const [error,setError]=React.useState(null);return {error,isPending:false,reset:()=>setError(null),mutateAsync:async args=>{posts.push(args);if(fail){const e=new Error(fail);setError(e);throw e;}}};}};
 return Module.prototype.require.call(this,id);
};
m._compile(buildSync({stdin:{contents:"export {FailStackDialog, failStackError} from './fail-stack-dialog';",resolveDir:path.dirname(filename),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',external:['react','react/jsx-runtime','lucide-react','@/components/ui/*','./query-actions'],jsx:'automatic',logLevel:'silent'}).outputFiles[0].text,filename);
const {FailStackDialog,failStackError}=m.exports;
const text=n=>typeof n==='string'?n:(n.children||[]).map(text).join('');
const catalog=[{id:'sword',name:'Sword',upgradeable:true,meta:{upgradeable:true,maxLevel:13,definition:{}}},{id:'hat',name:'Hat',upgradeable:true,meta:{upgradeable:true,maxLevel:10,definition:{}}},{id:'apple',name:'Apple',meta:null}];
async function render({primlings=2,closed=[]}={}){
 let view;await act(async()=>{view=create(React.createElement(FailStackDialog,{item:{name:'sword',level:7},name:'Sword',catalog,character:'M',slot:3,primlings,close:()=>closed.push(1)}));});return view;
}
const button=(v,label)=>v.root.findAllByType('Button').find(n=>text(n)===label);
const field=(v,label)=>v.root.findByProps({'aria-label':label});
const change=async(v,label,value)=>act(async()=>field(v,label).props.onChange({target:{value}}));
const alertText=v=>v.root.findAllByProps({role:'alert'}).map(text).join('|');

test('limits and stop chance are validated',()=>{
 assert.equal(failStackError('5',''),'');assert.equal(failStackError('50','100'),'');assert.equal(failStackError('1','0.5'),'');
 for(const bad of ['0','51','1.5','x',''])assert.match(failStackError(bad,''),/between 1 and 50/);
 for(const bad of ['0','101','-1','abc'])assert.match(failStackError('5',bad),/stop chance/);
});
test('defaults burn spares at the stacked item\'s own level and warn what can be destroyed',async()=>{
 posts.length=0;const v=await render();
 try{
  assert.equal(field(v,'Spare item').props.value,'sword');assert.equal(field(v,'Spare level').props.value,7);assert.equal(field(v,'Attempts').props.value,'5');
  assert.deepEqual(field(v,'Spare item').findAllByType('option').map(o=>o.props.value),['sword','hat'],'only upgradeable items are offered');
  assert.match(text(v.root.findByProps({role:'note'})),/up to 5 Sword \+7/);assert.match(text(v.root.findByProps({role:'note'})),/never used/);
 }finally{await act(async()=>v.unmount());}
});
test('confirm sends the exact request and closes',async()=>{
 posts.length=0;fail=null;const closed=[],v=await render({closed});
 try{
  await change(v,'Attempts','12');await change(v,'Stop chance percent','40');
  await act(async()=>field(v,'Use a Primling on each attempt').props.onChange({target:{checked:true}}));
  await act(async()=>field(v,'Measure with a Primling').props.onChange({target:{checked:true}}));
  assert.match(text(v.root.findByProps({role:'note'})),/up to 12 Sword/);
  await act(async()=>button(v,'Burn spares').props.onClick());
  assert.deepEqual(posts,[{path:'/fail-stack',body:{character:'M',slot:3,item:{name:'sword',level:7},sacrifice:{name:'sword',level:7},attempts:12,stopChance:0.4,offering:true,previewOffering:true}}]);
  assert.equal(closed.length,1);
 }finally{await act(async()=>v.unmount());}
});
test('without a stop chance or Primling the request leaves them out',async()=>{
 posts.length=0;fail=null;const v=await render({primlings:0});
 try{
  assert.equal(field(v,'Use a Primling on each attempt').props.disabled,true);
  await change(v,'Spare item','hat');await change(v,'Spare level','2');
  await act(async()=>button(v,'Burn spares').props.onClick());
  assert.deepEqual(posts[0].body,{character:'M',slot:3,item:{name:'sword',level:7},sacrifice:{name:'hat',level:2},attempts:5,offering:false,previewOffering:false});
 }finally{await act(async()=>v.unmount());}
});
test('invalid input disables confirm and sends nothing',async()=>{
 posts.length=0;const v=await render();
 try{
  for(const bad of ['0','51','abc']){await change(v,'Attempts',bad);assert.match(alertText(v),/between 1 and 50/);assert.equal(button(v,'Burn spares').props.disabled,true);}
  await change(v,'Attempts','5');await change(v,'Stop chance percent','150');assert.match(alertText(v),/stop chance/);assert.equal(button(v,'Burn spares').props.disabled,true);
  assert.equal(posts.length,0);
 }finally{await act(async()=>v.unmount());}
});
test('a rejected request shows the coordinator error and keeps the dialog open',async()=>{
 posts.length=0;fail='No spare copy of that item and level is in merchant inventory';const closed=[],v=await render({closed});
 try{
  await act(async()=>button(v,'Burn spares').props.onClick());
  assert.match(alertText(v),/No spare copy/);assert.equal(closed.length,0);
 }finally{fail=null;await act(async()=>v.unmount());}
});
