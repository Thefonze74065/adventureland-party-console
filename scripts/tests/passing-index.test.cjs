const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {namedFunction}=require('./helpers/named-function.cjs');
const {reconcileQueue}=require('../../runtime/combat/queue.ts');
const source=fs.readFileSync('characters/shared.js','utf8');
// Retained isolated performance boundary: native gameplay cannot deterministically
// produce malformed historical timestamps or count identity builds. Failure modes:
// stale indexes after push/replacement/realm changes; invalid duplicate hides a
// valid one; Infinity semantics change; death suppression precedence changes;
// scanning work remains per monster; tombstone index includes filtered/evicted deaths.
function fixture(){
 let now=100000,realm='USII',calls=0;
 const c=vm.createContext({Date:{now:()=>now},character:{map:'main',in:'main'},reunionRealm:()=>realm,
  committedHuntEncounter:()=>false,passiveHunting:{rules:{}},coordinatorClockOffset:0,
  fightDeaths:[],peerPassingEncounters:[],passingEncounters:{},groupedCombat:{deaths:[],passingEncounters:[]}});
 vm.runInContext(namedFunction(source,'passingKey')+'\n'+namedFunction(source,'isPassingEncounter'),c);
 const key=c.passingKey;c.passingKey=t=>{calls++;return key(t);};
 const reference=t=>{
  const k=key(t);if(t.dead||t.hp===0)return false;
  if([...c.fightDeaths,...c.groupedCombat.deaths].some(d=>key(d)===k&&now-d.at<60000))return false;
  return c.peerPassingEncounters.some(e=>key(e)===k&&now-e.at<60000)||
   !!(c.passingEncounters[k]&&now-c.passingEncounters[k].at<60000)||
   c.groupedCombat.passingEncounters.some(e=>key(e)===k&&now-e.at<60000);
 };
 return {c,reference,calls:()=>calls,resetCalls:()=>calls=0,setRealm:v=>realm=v,setNow:v=>now=v};
}
test('indexed passing matches scanning over partial identities, duplicates, invalid times and realm changes',()=>{
 const f=fixture();let seed=123456;
 const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 const times=[undefined,NaN,Infinity,-Infinity,40000,40001,99999,null,'99999'];
 const entry=()=>({id:String(random(8)),...(random(2)?{server:['USII','EUI'][random(2)]}:{}),
  ...(random(2)?{map:['main','bank'][random(2)]}:{}),...(random(2)?{in:['main','instance',0][random(3)]}:{}),at:times[random(times.length)]});
 for(let round=0;round<100;round++){
  f.setRealm(round%2?'USII':'EUI');f.c.character.map=round%3?'main':'bank';f.c.character.in=round%4?'main':'instance';
  f.c.fightDeaths=Array.from({length:random(20)},entry);f.c.groupedCombat.deaths=Array.from({length:random(20)},entry);
  f.c.peerPassingEncounters=Array.from({length:random(30)},entry);f.c.groupedCombat.passingEncounters=Array.from({length:random(30)},entry);
  for(let i=0;i<40;i++){const target=entry();assert.equal(f.c.isPassingEncounter(target),f.reference(target));}
  f.c.fightDeaths.push(entry());f.c.peerPassingEncounters.push(entry());
  for(let i=0;i<10;i++){const target=entry();assert.equal(f.c.isPassingEncounter(target),f.reference(target));}
 }
});
test('stable lists build identity once and use one identity per subsequent lookup',()=>{
 const f=fixture();f.c.fightDeaths=Array.from({length:400},(_,i)=>({id:'dead'+i,at:99999}));
 f.c.peerPassingEncounters=Array.from({length:400},(_,i)=>({id:'passing'+i,at:99999}));
 assert.equal(f.c.isPassingEncounter({id:'passing1'}),true);f.resetCalls();
 for(let i=0;i<1000;i++)assert.equal(f.c.isPassingEncounter({id:'passing1'}),true);
 assert.ok(f.calls()<=1000,'repeated lookups must not rebuild all 800 entry identities');
 f.c.fightDeaths.push({id:'passing1',at:99999});assert.equal(f.c.isPassingEncounter({id:'passing1'}),false);
 f.c.fightDeaths=[];assert.equal(f.c.isPassingEncounter({id:'passing1'}),true);
 f.setNow(160000);assert.equal(f.c.isPassingEncounter({id:'passing1'}),false);
});
test('same array index refreshes contextual defaults after realm map and instance changes',()=>{
 const f=fixture();f.c.peerPassingEncounters=[{id:'x',at:99999}];
 assert.equal(f.c.isPassingEncounter({id:'x',server:'USII',map:'main',in:'main'}),true);
 f.setRealm('EUI');f.c.character.map='bank';f.c.character.in='instance';
 assert.equal(f.c.isPassingEncounter({id:'x',server:'USII',map:'main',in:'main'}),false);
 assert.equal(f.c.isPassingEncounter({id:'x',server:'EUI',map:'bank',in:'instance'}),true);
});
test('queue tombstone index excludes future deaths and entries evicted from the kept 512',()=>{
 const target=id=>({id,mtype:'goo',map:'main',in:'main',server:'USII',x:20,y:0});
 const deaths=Array.from({length:513},(_,i)=>({...target(String(i)),at:99999}));
 deaths.push({...target('future'),at:100501});
 const members=[{name:'W',ctype:'warrior',revision:1,status:{seenAt:100000,map:'main',in:'main',server:'USII',x:0,y:0,
  groupedCombat:{candidates:[target('0'),target('512'),target('future')],deaths:[],evidence:[],threats:[]}}}];
 const result=reconcileQueue({deaths,fights:[],claims:[],queue:[]},members,'W',100000,'key');
 assert.equal(result.deaths.length,512);
 assert.deepEqual(result.queue.map(t=>t.id).sort(),['0','future']);
});
