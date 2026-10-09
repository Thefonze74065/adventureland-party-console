const test=require('node:test'),assert=require('node:assert/strict');
const {classifyGameLog,showGameLog,defaultLogFilters}=require('../../runtime/game-log-filters.ts');
const {installGameLogs}=require('../../runtime/characters/game-logs.ts');
const {appendGameLogs,gameLogs}=require('../../runtime/coordinator/telemetry/game-logs.ts');
const {exportDashboardSettings,parseDashboardImport}=require('../../runtime/coordinator/persistence/dashboard-import.ts');
const {initialAnniversaryState}=require('../../runtime/coordinator/anniversary/initial-state.ts');
function response(){return {code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}};}
test('game filters prioritize errors and retain unmatched entries',()=>{
 assert.equal(classifyGameLog('Upgrade failed: not enough gold'),'errors');assert.equal(classifyGameLog('Found a ring'),'items');
 assert.equal(showGameLog(classifyGameLog('Killed goo'),defaultLogFilters),false);
 assert.equal(showGameLog(classifyGameLog('Welcome'),defaultLogFilters),true);
});
test('capture retains failed batches, preserves original logging and survives reinstall without duplicate hooks',async()=>{
 const rendered=[],sent=[],host={add_log:(...args)=>rendered.push(args)};
 const first=installGameLogs(host,async()=>{throw Error('offline');});host.add_log('found item','#fff');await first.pulse();
 const second=installGameLogs(host,async events=>sent.push(events));host.add_log('gold received','gold');await second.pulse();await second.pulse();
 assert.equal(rendered.length,2);assert.equal(sent.length,1);assert.equal(sent[0].length,2);assert.deepEqual(sent[0].map(e=>e.seq),[1,2]);
});
test('game ingestion rejects outsiders, deduplicates retries and bounds history',()=>{
 const event={session:'session',seq:1,at:10,message:'gold',color:'#fff'};
 assert.equal(appendGameLogs({body:{character:'X',events:[event]}},response(),()=>false).code,400);
 for(let i=0;i<12;i++)appendGameLogs({body:{character:'Test',events:Array.from({length:100},(_,n)=>({...event,seq:i*100+n+1}))}},response(),()=>true);
 appendGameLogs({body:{character:'Test',events:[{...event,seq:1200}]}},response(),()=>true);
 assert.equal(gameLogs.Test.length,1000);assert.equal(gameLogs.Test[0].seq,201);delete gameLogs.Test;
});
test('settings JSON round trip includes new preferences without credentials or active work',()=>{
 const original={bankboiPrefix:'MyBank',anniversaryAutoChat:false,threshold:10,autoCompounds:{M:[]},secret:'hide',merchantQueue:[1],anniversary:{blacklist:['old']}};
 const exported=exportDashboardSettings(original),parsed=parseDashboardImport(JSON.stringify(exported),n=>n==='M');
 assert.deepEqual(parsed.values,{bankboiPrefix:'MyBank',anniversaryAutoChat:false,threshold:10,autoCompounds:{M:[]}});
 assert.ok(!JSON.stringify(exported).includes('hide'));assert.ok(!JSON.stringify(exported).includes('blacklist'));
 assert.throws(()=>parseDashboardImport(JSON.stringify({...exported,version:99}),()=>true));
});
test('blacklist migration drops blacklist aborts but preserves failed-round protection',()=>{
 const state=initialAnniversaryState({blacklist:['old'],abortedRounds:{a:{reason:'target-blacklisted'},b:{reason:'kiss-timeout'}}});
 assert.equal(Object.hasOwn(state,'blacklist'),false);assert.deepEqual(Object.keys(state.abortedRounds),['b']);
});

test('public daily slots handle UTC day rollover without promising a specific event',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('characters/shared.js','utf8');
 const start=source.indexOf('  function eventScheduleSnapshot()'),end=source.indexOf('  var eventTargetTypes',start);
 const now=Date.UTC(2026,8,18,0,0),context={Date:class extends Date {static now(){return now;}},eventClockOffset:0,
 eventStatus:()=>({schedule:{time_offset:-5,dailies:[13,20],nightlies:[23]}}),anniversaryEpoch:x=>Number(x)||0,
 G:{events:{franky:{name:'Franky'},goobrawl:{name:'Goobrawl'}}}};
 const names=source.slice(source.indexOf('  function supportedEventNames('),source.indexOf('  function halloweenEvent('));
 vm.createContext(context);vm.runInContext(names+source.slice(start,end),context);
 const schedule=context.eventScheduleSnapshot();assert.equal(schedule.find(e=>e.id==='franky').slotAt,Date.UTC(2026,8,18,4));
 assert.equal(schedule.find(e=>e.id==='goobrawl').slotAt,Date.UTC(2026,8,18,1));assert.equal(schedule[0].next,undefined);
});
