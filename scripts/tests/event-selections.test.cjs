const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const ts = require('../../node_modules/typescript');
const policy = require('../../.build/shared/event-policy.cjs');
const runtime = fs.readFileSync('characters/shared.js', 'utf8');
const coordinator = require('./helpers/coordinator-source.cjs').coordinatorSource();

test('clock samples use request midpoint and reject stale responses', () => {
  let now = 1700000000000, emitted = 0;
  const c = { root: {}, Date: { now: () => now, parse: Date.parse }, parent: {socket:{emit:()=>emitted++}} };
  vm.runInNewContext(runtime.slice(runtime.indexOf('  var eventsEnabled = false;'), runtime.indexOf('  function eventScheduleSnapshot(')), c);
  c.syncEventClock(); now += 100;
  c.receiveEventClock({date:new Date(now + 60000).toISOString()});
  assert.equal(c.eventClockOffset, 60050); assert.equal(emitted,1);
  c.syncEventClock(); now += 6000; c.receiveEventClock({date:new Date(now+90000).toISOString()});
  assert.equal(c.eventClockOffset,60050);
});

test('browser timezone formats the event instant without changing its countdown', () => {
  const source = fs.readFileSync('dashboard/features/party/event-selection-control.tsx','utf8');
  const end = source.includes('export const EventSelectionControl')
    ? source.indexOf('export const EventSelectionControl')
    : source.indexOf('export function EventSelectionControl(');
  const body = source.slice(source.indexOf('export function eventTimeLabel('), end).replace('export function','function');
  const code = ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const c={Intl};vm.runInNewContext(code,c);
  const previous=process.env.TZ;
  try {
    const epoch=Date.parse('2026-09-11T19:00:00Z');
    process.env.TZ='America/New_York'; const eastern=c.eventTimeLabel(epoch,epoch-125000);
    process.env.TZ='Asia/Tokyo'; const tokyo=c.eventTimeLabel(epoch,epoch-125000);
    assert.notEqual(eastern,tokyo);assert.match(eastern,/\(2m 5s\)/);assert.match(tokyo,/\(2m 5s\)/);
    assert.equal(c.eventTimeLabel(undefined,epoch),'Time not announced');
  } finally { if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous; }
});

test('dropdown disables inherited and unsupported selections and permits independent choices',()=>{
  const source=fs.readFileSync('dashboard/features/party/event-selection-control.tsx','utf8');
  // EventSelectionControl is exported as `const X = memo(function X(...) {...})`;
  // strip the memo() wrapper (both the leading call and its matching trailing
  // paren) so this stays a plain top-level function declaration for the vm context.
  const memoMarker='export const EventSelectionControl = memo(function EventSelectionControl(';
  const body=source.includes(memoMarker)
    ? source.slice(source.indexOf(memoMarker)).replace('export const EventSelectionControl = memo(','').replace(/\}\);\s*$/,'}')
    : source.slice(source.indexOf('export function EventSelectionControl(')).replace('export function','function');
  const c={Settings:'Settings',Popover:"Popover",PopoverTrigger:"PopoverTrigger",PopoverContent:"PopoverContent",...policy,useClock:()=>0,eventTimeLabel:()=> 'Time not announced',React:{createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)})}};
  vm.runInNewContext(ts.transpileModule(body,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText,c);
  const nodes=t=>t&&typeof t==='object'?[t,...t.children.flatMap(nodes)]:[];
  const state={leader:'L',followers:{F:true},eventSelectionsByCharacter:{L:['anniversary'],F:['snowman']},eventSchedules:[{id:'anniversary',name:'Anniversary'},{id:'egghunt',name:'Egg Hunt'}]};
  let saved;
  const render=()=>nodes(c.EventSelectionControl({state,name:'F',merchant:false,onChange:ids=>saved=ids})).filter(n=>n.type==='input');
  let inputs=render();assert.equal(inputs[0].props.checked,true);assert.equal(inputs[0].props.disabled,true);assert.equal(inputs[1].props.disabled,true);
  state.followers.F=false;inputs=render();assert.equal(inputs[0].props.disabled,false);inputs[0].props.onChange({target:{checked:true}});assert.deepEqual(Array.from(saved),['snowman','anniversary']);
  state.merchantCharacter='F';state.eventSchedules=policy.supportedEvents.map(id=>({id,name:id}));
  inputs=render();assert.equal(inputs.length,policy.supportedEvents.length);assert.ok(inputs.every(input=>!input.props.disabled));
});
