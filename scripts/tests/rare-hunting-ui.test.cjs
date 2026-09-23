const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ts=require('../../node_modules/typescript');
const {farmingAreas,defaultPhoenixOrder}=require('../../.build/shared/farming-areas.cjs');
function harness(file,name,extra={}) {
  const source=fs.readFileSync(`dashboard/features/party/${file}.tsx`,'utf8');
  // Some components are exported as `const X = memo(function X(...) {...})`
  // instead of a bare `export function`; strip the memo() wrapper (both the
  // leading call and its matching trailing paren) so the extracted body is
  // still a plain top-level function declaration the vm context can see.
  const memoMarker=`export const ${name} = memo(function ${name}(`;
  const body=source.includes(memoMarker)
    ? source.slice(source.indexOf(memoMarker)).replace(`export const ${name} = memo(`,'').replace(/\}\);\s*$/,'}')
    : source.slice(source.indexOf(`export function ${name}(`)).replace('export function','function');
  const code=ts.transpileModule(body,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
  let cursor=0;const state=[];
  const c=vm.createContext({ React:{createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)})},
    useState:initial=>{const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;
      return[state[i],v=>state[i]=typeof v==='function'?v(state[i]):v];},useId:()=> 'follow-description',useMemo:fn=>fn(),useEffect(){},useRef:v=>({current:v}),
    farmingAreas,defaultPhoenixOrder,...extra });
  for(const n of ['Button','Checkbox','Input','Dialog','DialogContent','DialogDescription','DialogFooter','DialogHeader','DialogTitle',
    'HuntSettingsControl','FarmingAreaPreview','Maximize2','ItemSprite','Popover','PopoverContent','PopoverTrigger','SpriteCrop','X','ChevronDown','ChevronRight','Settings'])c[n]=n;
  vm.runInContext(code,c);
  return {render:props=>{cursor=0;return c[name](props);}};
}
const nodes=t=>t&&typeof t==='object'?[t,...(t.children||[]).flatMap(nodes)]:[];

test('Phoenix picker preselects screenshot order and preserves a valid saved custom order',()=>{
  const boxes=[['main',708,-300,1668,-86],['main',378,1686,904,1920],['main',-1358,-118,-1010,1680],['halloween',-166,453,182,808],['cave',-375,-1287,14,-1041]];
  const catalog=[{id:'phoenix',locations:boxes.map(([map,...boundary])=>({map,boundary,x:(boundary[0]+boundary[2])/2,y:(boundary[1]+boundary[3])/2}))}];
  const areas=farmingAreas(catalog,['phoenix']);
  for(const saved of [[],[areas[0].id],areas.map(a=>a.id).reverse()]) {
    const tree=harness('farming-area-picker','FarmingAreaPicker').render({catalog,ids:['phoenix'],radius:400,phoenixRouteOrder:saved});
    const buttons=nodes(tree).filter(n=>n.type==='button');
    const expected=saved.length===5?saved:defaultPhoenixOrder(areas);
    buttons.forEach((b,i)=>assert.equal(nodes(b).find(n=>n.type==='span'&&n.props.className?.includes('absolute')).children[0],expected.indexOf(areas[i].id)+1));
    assert.equal(nodes(tree).find(n=>n.type==='Button'&&n.children.includes('Start Phoenix patrol')).props.disabled,false);
  }
});
test('Phoenix picker numbers click order, renumbers removal, requires all five and saves exact order',async()=>{
  const locations=Array.from({length:5},(_,i)=>({map:`map${i}`,x:0,y:0,boundary:[-20,-20,20,20]}));
  const catalog=[{id:'phoenix',name:'Phoenix',locations}];let saved;
  const props={catalog,ids:['phoenix'],radius:400,override:true,busy:false,onStart:async(...args)=>saved=args};
  const h=harness('farming-area-picker','FarmingAreaPicker');let tree=h.render(props);
  const buttons=()=>nodes(tree).filter(n=>n.type==='button');
  const start=()=>nodes(tree).find(n=>n.type==='Button'&&n.children.includes('Start Phoenix patrol'));
  assert.equal(start().props.disabled,true);
  for(const i of [2,0,4,1,3]){buttons()[i].props.onClick();tree=h.render(props);}
  assert.equal(start().props.disabled,false);
  const badge=i=>nodes(buttons()[i]).find(n=>n.type==='span'&&n.props.className?.includes('absolute')).children[0];
  assert.equal(badge(2),1);assert.equal(badge(3),5);
  buttons()[0].props.onClick();tree=h.render(props);assert.equal(start().props.disabled,true);assert.equal(badge(4),2);
  buttons()[0].props.onClick();tree=h.render(props);await start().props.onClick();
  const all=farmingAreas(catalog,['phoenix']);assert.deepEqual(Array.from(saved[1]),[2,4,1,3,0].map(i=>all[i].id));
  assert.equal(saved[0].id,all[2].id);
});
test('Fairy stays searchable but only exposes an explanation, never a focus toggle',()=>{
  let changes=0;const props={monsters:[{id:'tinyp',name:'Fairy'}],selected:[],priorities:{},onChange:()=>changes++,onPriorityChange(){}};
  const h=harness('monster-focus-picker','MonsterFocusPicker');let tree=h.render(props);
  const button=nodes(tree).find(n=>n.type==='button'&&n.props['aria-disabled']==='true');assert.ok(button);
  button.props.onClick();tree=h.render(props);assert.equal(changes,0);
  assert.ok(nodes(tree).some(n=>n.props.role==='status'&&n.children.join('').includes('Passively hunt fairy')));
});
test('passive menu forwards independent rule patches without replacing other settings',async()=>{
  const writes=[];const h=harness('farming-mode-control','FarmingModeControl',{
    PassiveHuntingMenu:'PassiveHuntingMenu',migratePassiveSettings:require('../../runtime/coordinator/navigation/passive-settings.ts').migratePassiveSettings});
  const tree=h.render({policy:'auto',effectiveMode:'default',blacklist:{},catalog:[],passiveRareHunts:{tinyp:false,phoenix:true},
    onRareChange:async patch=>writes.push(patch)});
  const menu=nodes(tree).find(n=>n.type==='PassiveHuntingMenu');assert.ok(menu);
  assert.equal(menu.props.settings.rules.phoenix.enabled,true);
  const patch={rules:{tinyp:{enabled:true}}};await menu.props.onSave(patch);
  assert.deepEqual(writes,[patch]);assert.equal(menu.props.settings.rules.phoenix.enabled,true);
});

test('Hunt settings default enabled, save thresholds, reject invalid values and preserve disabled thresholds',async()=>{
 const defaults=require('../../runtime/coordinator/hunt/settings.ts').defaultHuntSettings;
 const h=harness('hunt-settings-control','HuntSettingsControl',{defaultHuntSettings:defaults});
 const saved=[], props={value:{...defaults},onSave:async patch=>{saved.push(patch);Object.assign(props.value,patch);}};
 let tree=h.render(props), checks=nodes(tree).filter(n=>n.type==='Checkbox');assert.equal(checks.length,3);assert.ok(checks.every(n=>n.props.checked));
 let input=nodes(tree).find(n=>n.props['aria-label']==='Deaths before blacklisting');assert.equal(input.props.value,'1');input.props.onChange({target:{value:'3'}});
 tree=h.render(props);input=nodes(tree).find(n=>n.props['aria-label']==='Deaths before blacklisting');input.props.onBlur();await new Promise(setImmediate);assert.equal(saved.at(-1).deathThreshold,3);
 tree=h.render(props);checks=nodes(tree).filter(n=>n.type==='Checkbox');checks[1].props.onCheckedChange(false);await new Promise(setImmediate);
 tree=h.render(props);input=nodes(tree).find(n=>n.props['aria-label']==='Deaths before blacklisting');assert.equal(input.props.disabled,true);assert.equal(input.props.value,'3');
 checks=nodes(tree).filter(n=>n.type==='Checkbox');checks[1].props.onCheckedChange(true);await new Promise(setImmediate);tree=h.render(props);
 input=nodes(tree).find(n=>n.props['aria-label']==='Deaths before blacklisting');input.props.onChange({target:{value:'0'}});tree=h.render(props);
 const before=saved.length;nodes(tree).find(n=>n.props['aria-label']==='Deaths before blacklisting').props.onBlur();assert.equal(saved.length,before);assert.ok(nodes(h.render(props)).some(n=>n.props.role==='alert'));
});
