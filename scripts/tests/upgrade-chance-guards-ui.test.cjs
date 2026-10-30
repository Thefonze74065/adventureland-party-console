const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const {buildSync}=require('esbuild'),React=require('../../dashboard/node_modules/react'),{create,act}=require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
const filename=path.resolve('dashboard/features/party/upgrade-chance-guards-ui-fixture.cjs'),m=new Module(filename,module);
m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
m.require=function(id){if(id.startsWith('@/components/ui/'))return new Proxy({},{get:(_,key)=>String(key)});return Module.prototype.require.call(this,id);};
m._compile(buildSync({stdin:{contents:"export {UpgradeOfferingProvider} from './upgrade-offering-controls'; export {UpgradeChanceGuardRules} from './upgrade-chance-guards';",resolveDir:path.dirname(filename),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',external:['react','react/jsx-runtime','lucide-react','@/components/ui/*'],jsx:'automatic',logLevel:'silent'}).outputFiles[0].text,filename);
const {UpgradeOfferingProvider,UpgradeChanceGuardRules}=m.exports;
const text=n=>typeof n==='string'?n:(n.children||[]).map(text).join('');
const catalog=[{id:'sword',name:'Sword',upgradeable:true,meta:{upgradeable:true,maxLevel:13,definition:{}}},{id:'apple',name:'Apple',meta:null}];
const guard={id:'g1',name:'sword',floor:7,ceiling:9,minChance:0.3};
async function render({guards=[],post=async()=>{}}={}){
 let view;await act(async()=>{view=create(React.createElement(UpgradeOfferingProvider,{character:'M',stock:{},rules:[],guards,catalog,post},React.createElement(UpgradeChanceGuardRules)));});
 await act(async()=>view.root.findByProps({'aria-label':'Chance guards'}).props.onClick());
 return view;
}
const button=(v,label)=>v.root.findAllByType('Button').find(n=>text(n)===label);
const field=(v,label)=>v.root.findByProps({'aria-label':label});
const change=async(v,label,value)=>act(async()=>field(v,label).props.onChange({target:{value}}));
const alertText=v=>v.root.findAllByProps({role:'alert'}).map(text).join('|');

test('lists guards with level range and minimum chance, and removes one',async()=>{
 const calls=[],v=await render({guards:[guard],post:async(...a)=>calls.push(a)});
 try{
  const row=text(v.root);assert.match(row,/Sword/);assert.match(row,/\+7 → \+9/);assert.match(row,/at least 30%/);
  await act(async()=>button(v,'Remove').props.onClick());
  assert.deepEqual(calls,[['/command',{character:'M',type:'upgrade-chance-guard',rule:{id:'g1'},remove:true}]]);
 }finally{await act(async()=>v.unmount());}
});
test('shows an empty state',async()=>{
 const v=await render();try{assert.match(text(v.root),/No chance guards/);}finally{await act(async()=>v.unmount());}
});
test('adds a guard with a percent converted to a fraction, offering only upgradeable items',async()=>{
 const calls=[],v=await render({post:async(...a)=>calls.push(a)});
 try{
  await act(async()=>button(v,'Add guard').props.onClick());
  const options=field(v,'Guarded item').findAllByType('option').map(o=>o.props.value);
  assert.deepEqual(options,['','sword']);
  assert.equal(button(v,'Confirm').props.disabled,true);
  await change(v,'Guarded item','sword');await change(v,'Starting level','7');await change(v,'Ending level','9');
  assert.equal(button(v,'Confirm').props.disabled,true,'a minimum chance is required');
  await change(v,'Minimum chance percent','35');
  assert.equal(button(v,'Confirm').props.disabled,false);
  await act(async()=>button(v,'Confirm').props.onClick());
  assert.deepEqual(calls,[['/command',{character:'M',type:'upgrade-chance-guard',rule:{name:'sword',floor:7,ceiling:9,minChance:0.35}}]]);
  assert.equal(v.root.findAllByType('DialogContent').length,0,'the dialog closes after saving');
 }finally{await act(async()=>v.unmount());}
});
test('edits a guard in place, keeping its id and item',async()=>{
 const calls=[],v=await render({guards:[guard],post:async(...a)=>calls.push(a)});
 try{
  await act(async()=>button(v,'Edit').props.onClick());
  assert.equal(field(v,'Guarded item').props.disabled,true);assert.equal(field(v,'Minimum chance percent').props.value,'30');
  await change(v,'Minimum chance percent','45.5');await act(async()=>button(v,'Confirm').props.onClick());
  assert.deepEqual(calls,[['/command',{character:'M',type:'upgrade-chance-guard',rule:{id:'g1',name:'sword',floor:7,ceiling:9,minChance:0.455}}]]);
 }finally{await act(async()=>v.unmount());}
});
test('rejects out-of-range percents and overlapping ranges before sending',async()=>{
 const calls=[],v=await render({guards:[guard],post:async(...a)=>calls.push(a)});
 try{
  await act(async()=>button(v,'Add guard').props.onClick());
  await change(v,'Guarded item','sword');await change(v,'Starting level','8');await change(v,'Ending level','10');
  await change(v,'Minimum chance percent','50');
  assert.match(alertText(v),/already a guard that covers \+7 to \+9/);assert.equal(button(v,'Confirm').props.disabled,true);
  await change(v,'Starting level','9');await change(v,'Ending level','11');
  for(const bad of ['0','101','abc','-5']){await change(v,'Minimum chance percent',bad);assert.match(alertText(v),/minimum chance above 0%/);assert.equal(button(v,'Confirm').props.disabled,true);}
  await change(v,'Minimum chance percent','100');assert.equal(button(v,'Confirm').props.disabled,false);
  assert.equal(calls.length,0);
 }finally{await act(async()=>v.unmount());}
});
test('shows the coordinator error and keeps the dialog open when saving fails',async()=>{
 const v=await render({post:async()=>{throw new Error('There is already a guard that covers +7 to +9.');}});
 try{
  await act(async()=>button(v,'Add guard').props.onClick());
  await change(v,'Guarded item','sword');await change(v,'Ending level','2');await change(v,'Minimum chance percent','20');
  await act(async()=>button(v,'Confirm').props.onClick());
  assert.match(alertText(v),/already a guard/);assert.equal(v.root.findAllByType('DialogContent').length,1);
 }finally{await act(async()=>v.unmount());}
});

test('adds a scroll-only rule, and shows chance and scroll together',async()=>{
 const calls=[],v=await render({guards:[{...guard,scrollGrade:2}],post:async(...a)=>calls.push(a)});
 try{
  assert.match(text(v.root),/at least 30%, grade 2\+ scrolls/);
  await act(async()=>button(v,'Add guard').props.onClick());
  await change(v,'Guarded item','sword');await change(v,'Starting level','2');await change(v,'Ending level','4');
  assert.match(alertText(v),/minimum chance, choose a scroll grade/);assert.equal(button(v,'Confirm').props.disabled,true);
  assert.deepEqual(field(v,'Scroll grade').findAllByType('option').map(o=>o.props.value),['',1,2,3,4]);
  await change(v,'Scroll grade','1');assert.equal(button(v,'Confirm').props.disabled,false);
  await act(async()=>button(v,'Confirm').props.onClick());
  assert.deepEqual(calls,[['/command',{character:'M',type:'upgrade-chance-guard',rule:{name:'sword',floor:2,ceiling:4,scrollGrade:1}}]]);
 }finally{await act(async()=>v.unmount());}
});
test('editing can drop the chance or the scroll and keeps the other',async()=>{
 const calls=[],v=await render({guards:[{...guard,scrollGrade:2}],post:async(...a)=>calls.push(a)});
 try{
  await act(async()=>button(v,'Edit').props.onClick());
  assert.equal(field(v,'Scroll grade').props.value,'2');
  await change(v,'Minimum chance percent','');await act(async()=>button(v,'Confirm').props.onClick());
  assert.deepEqual(calls[0][1].rule,{id:'g1',name:'sword',floor:7,ceiling:9,scrollGrade:2});
 }finally{await act(async()=>v.unmount());}
});
test('a rule with a scroll grade only is listed without a chance',async()=>{
 const v=await render({guards:[{id:'s',name:'sword',floor:1,ceiling:3,scrollGrade:1}]});
 try{assert.match(text(v.root),/grade 1\+ scrolls/);assert.doesNotMatch(text(v.root),/at least/);}finally{await act(async()=>v.unmount());}
});
