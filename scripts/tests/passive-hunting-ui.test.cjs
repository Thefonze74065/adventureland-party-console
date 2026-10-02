const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const {buildSync}=require('esbuild'),React=require('../../dashboard/node_modules/react'),{create,act}=require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
const filename=path.resolve('dashboard/features/party/passive-hunting-menu.tsx'),m=new Module(filename,module);
m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
m.require=function(id){if(id.startsWith('@/components/ui/'))return new Proxy({},{get:(_,key)=>String(key)});return Module.prototype.require.call(this,id);};
m._compile(buildSync({entryPoints:[filename],bundle:true,packages:'external',external:['@/components/ui/*'],platform:'node',format:'cjs',write:false}).outputFiles[0].text,filename);
const {PassiveHuntingMenu}=m.exports;
const text=n=>typeof n==='string'?n:(n.children||[]).map(text).join('');
test('searchable menu saves separate enable, movement, priority and generator choices with readable controls',async()=>{
 const calls=[],props={renderMonsterDetails:(id,onClose)=>React.createElement('MonsterDetails',{id,onClose}),settings:{version:1,rules:{},useFieldGenerators:true},catalog:[{id:'bee',name:'Bee'},{id:'phoenix',name:'Phoenix'},{id:'fieldgen0',name:'Generator'}],onSave:async patch=>calls.push(patch)};
 let view;try{
  await act(async()=>view=create(React.createElement(PassiveHuntingMenu,props)));
  assert.ok(text(view.toJSON()).includes('Monsters that are automatically attacked when spotted on the map'));
  const button=view.root.findByType('Button');assert.equal(text(button),'Open passive hunting menu');
  await act(async()=>button.props.onClick());assert.equal(view.root.findByType('Dialog').props.open,true);
  assert.ok(text(view.root.findByType('PopoverContent')).includes('Priority affects both active and passive hunting targets'));
  assert.equal(view.root.findAllByType('Checkbox').some(n=>n.props['aria-label']==='Passively hunt Generator'),false);
  const enabled=view.root.findAllByType('Checkbox').find(n=>n.props['aria-label']==='Passively hunt Bee');
  await act(async()=>enabled.props.onCheckedChange(true));assert.deepEqual(calls.pop(),{rules:{bee:{enabled:true}}});
  const moving=view.root.findAllByType('Checkbox').find(n=>n.props['aria-label']==='Keep moving to destination for Bee');assert.equal(moving.props.checked,false);
  await act(async()=>moving.props.onCheckedChange(true));assert.deepEqual(calls.pop(),{rules:{bee:{keepMoving:true}}});
  const input=()=>view.root.findAllByType('input').find(n=>n.props['aria-label']==='Bee passive priority');
  await act(async()=>input().props.onChange({target:{value:'123'}}));await act(async()=>input().props.onBlur());assert.deepEqual(calls.pop(),{rules:{bee:{priority:123}}});
  await act(async()=>input().props.onChange({target:{value:'-1'}}));await act(async()=>input().props.onBlur());assert.equal(calls.length,0);assert.ok(view.root.findByProps({role:'alert'}));
  await act(async()=>view.root.findAllByType('Checkbox')[0].props.onCheckedChange(false));assert.deepEqual(calls.pop(),{useFieldGenerators:false});
  await act(async()=>view.root.findByProps({'aria-label':'Filter passive hunting monsters'}).props.onChange({target:{value:'PHOENIX'}}));
  assert.equal(view.root.findAllByType('Checkbox').some(n=>n.props['aria-label']==='Passively hunt Bee'),false);
  assert.equal(view.root.findAllByType('Checkbox').some(n=>n.props['aria-label']==='Passively hunt Phoenix'),true);
  await act(async()=>view.root.findByProps({'aria-label':'Inspect Phoenix'}).props.onClick());
  assert.equal(view.root.findByType('MonsterDetails').props.id,'phoenix');
  assert.equal(view.root.findByType('Dialog').props.open,true);
  await act(async()=>view.root.findByType('MonsterDetails').props.onClose());
  assert.equal(view.root.findAllByType('MonsterDetails').length,0);
  assert.equal(view.root.findByType('Dialog').props.open,true);
  assert.equal(view.root.findByProps({'aria-label':'Filter passive hunting monsters'}).props.value,'PHOENIX');
  assert.equal(calls.length,0);
 }finally{await act(async()=>view?.unmount());}
});

const farmingFilename=path.resolve('dashboard/features/party/farming-mode-control.tsx'),farmingModule=new Module(farmingFilename,module);
farmingModule.filename=farmingFilename;farmingModule.paths=Module._nodeModulePaths(path.dirname(farmingFilename));farmingModule.require=m.require;
farmingModule._compile(buildSync({entryPoints:[farmingFilename],bundle:true,packages:'external',external:['@/components/ui/*'],platform:'node',format:'cjs',write:false}).outputFiles[0].text,farmingFilename);

test('closing nested monster details preserves both passive hunting and farming dialogs',async()=>{
 const props={policy:'default',effectiveMode:'default',blacklist:{},catalog:[{id:'bee',name:'Bee'}],onClearBlacklist:async()=>{},onSelect(){},onRareChange:async()=>{},
  renderMonsterDetails:(id,close)=>React.createElement('Dialog',{open:true,'data-monster':id,onOpenChange:open=>{if(!open)close()}},React.createElement('button',{'aria-label':'Close monster',onClick:close}))};
 let view;try{
  await act(async()=>view=create(React.createElement(farmingModule.exports.FarmingModeControl,props)));
  await act(async()=>view.root.findAllByType('Button').find(n=>n.props['aria-label']==='Farming settings').props.onClick());
  await act(async()=>view.root.findAllByType('Button').find(n=>text(n)==='Open passive hunting menu').props.onClick());
  const search=()=>view.root.findByProps({'aria-label':'Filter passive hunting monsters'});
  await act(async()=>search().props.onChange({target:{value:'bee'}}));
  for(const dismiss of ['x','escape']) {
   await act(async()=>view.root.findAllByType('button').find(n=>n.props['aria-label']==='Inspect Bee').props.onClick());
   const dialogs=view.root.findAllByType('Dialog').filter(dialog=>dialog.props.open);assert.equal(dialogs.length,3);assert.ok(dialogs.every(dialog=>dialog.props.open));
   assert.ok(dialogs[1].findAllByType('Dialog').includes(dialogs[2]),'monster dialog must be nested inside passive hunting');
   await act(async()=>dismiss==='x'?view.root.findByProps({'aria-label':'Close monster'}).props.onClick():dialogs[2].props.onOpenChange(false));
   const remaining=view.root.findAllByType('Dialog').filter(dialog=>dialog.props.open);assert.equal(remaining.length,2);assert.ok(remaining.every(dialog=>dialog.props.open));assert.equal(search().props.value,'bee');
  }
 }finally{await act(async()=>view?.unmount());}
});
