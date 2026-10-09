const test=require('node:test'),assert=require('node:assert/strict');
const {createNativePlanner}=require('../../runtime/characters/native-planner.ts');
function fixture(){
 const host={smart:{moving:true,searching:false,found:false,plot:[]},queue:[],start:0};
 const native={move:()=>Promise.resolve(),stop:()=>{},start:()=>{host.smart.searching=true;host.queue.length=2;host.start=1;},next:()=>{}};
 const planner=createNativePlanner(host,native);planner.begin({map:'main',x:100,y:0},false,0,90000,240000);planner.tick(0);
 return {host,planner,advance(now,index){host.start=index;host.queue.length=index+1;return planner.tick(now);}};
}
test('progressing Cave BFS completes after90s before240s',()=>{
 const r=fixture();for(let t=10000;t<=150000;t+=10000)r.advance(t,t/10000+1);
 r.host.smart.found=true;r.host.smart.plot=[{map:'main',x:100,y:0}];assert.deepEqual(r.advance(160000,18),r.host.smart.plot);
});
test('stagnant Cave BFS fails its original90s bound',()=>{const r=fixture();assert.throws(()=>r.planner.tick(90000),/90 seconds/);});
test('missing native progress never extends Cave preparation',()=>{const r=fixture();delete r.host.start;assert.throws(()=>r.planner.tick(90000),/90 seconds/);});
test('reset frontier cannot extend a different native search',()=>{const r=fixture();r.advance(80000,100);r.advance(81000,1);assert.throws(()=>r.advance(90000,200),/90 seconds/);});
test('Cave search stalls fail within15s after initial deadline',()=>{const r=fixture();r.advance(85000,100);r.planner.tick(90000);assert.throws(()=>r.planner.tick(100001),/planning/);});
test('progress cannot evade the240s absolute Cave search bound',()=>{const r=fixture();for(let t=10000;t<240000;t+=10000)r.advance(t,t/10000+1);assert.throws(()=>r.advance(240000,30),/planning/);});
test('ordinary and local connector native deadlines remain30s and3s',()=>{for(const limit of [30000,3000]){const r=fixture();r.planner.begin({map:'main',x:100,y:0},false,0,limit);r.planner.tick(0);r.host.start=100;assert.throws(()=>r.planner.tick(limit),/planning/);}});
