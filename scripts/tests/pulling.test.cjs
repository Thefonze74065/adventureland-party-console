const test=require('node:test'),assert=require('node:assert/strict');
const {stagingPoint,STAGING_GAP,choosePuller,waitingSpot,choosePullTarget,pullAllowed,outsideReach,AGGRO_REACH,PULL_MARGIN}=require('../../runtime/combat/pulling.ts');
const reach=AGGRO_REACH+PULL_MARGIN;
// Four idle targetrons, 160 apart in a row, east of the party.
const pack=()=>[0,1,2,3].map(i=>({id:'t'+i,x:400+i*160,y:0,target:null}));

test('the puller is the longest-range living member of a ranged class',()=>{
 assert.equal(choosePuller([{name:'W',ctype:'warrior',range:30},{name:'P',ctype:'priest',range:196},{name:'M',ctype:'mage',range:230}]),'M');
 assert.equal(choosePuller([{name:'W',ctype:'warrior',range:30},{name:'P',ctype:'priest',range:196},{name:'M',ctype:'mage',range:230,rip:true}]),'P');
 assert.equal(choosePuller([{name:'W',ctype:'warrior',range:30}]),null,'no ranged member, no puller');
 assert.equal(choosePuller([{name:'B',ctype:'mage',range:200},{name:'A',ctype:'ranger',range:200}]),'A','ties by name');
});
test('the waiting spot stays where the party is when it is already clear',()=>{
 assert.deepEqual(waitingSpot({x:0,y:0},pack()),{x:0,y:0});
});
test('the waiting spot moves the party out of every idle monster aggro check',()=>{
 const spot=waitingSpot({x:420,y:30},pack());
 assert.ok(spot);assert.ok(outsideReach(spot,pack()));
 assert.ok(pack().every(m=>Math.hypot(spot.x-m.x,spot.y-m.y)>reach));
 assert.ok(Math.hypot(spot.x-420,spot.y-30)<=200,'the nearest clear point, not a far one');
 assert.equal(waitingSpot({x:420,y:30},pack(),()=>false),null,'no walkable clear point');
});
test('monsters already on the party do not push the waiting spot',()=>{
 assert.deepEqual(waitingSpot({x:400,y:20},[{id:'a',x:400,y:0,target:'W'}]),{x:400,y:20});
});
test('the pull takes the edge monster farthest from the others and stands outside the rest',()=>{
 const monsters=[{id:'a',x:400,y:0},{id:'b',x:520,y:0},{id:'c',x:640,y:0},{id:'far',x:400,y:-400}].map(m=>({...m,target:null}));
 const plan=choosePullTarget(monsters,{x:0,y:0},230);
 assert.equal(plan.target,'far','the isolated monster');
 assert.ok(Math.abs(Math.hypot(plan.from.x-400,plan.from.y+400)-220)<1,'range - 10 from it');
 assert.ok(outsideReach(plan.from,monsters,'far'));
});
test('the pull skips monsters it cannot reach without standing in another aggro check',()=>{
 const tight=[{id:'a',x:400,y:0},{id:'b',x:400,y:30}].map(m=>({...m,target:null}));
 assert.equal(choosePullTarget(tight,{x:0,y:0},120),null,'a short range stands inside the neighbour');
 const plan=choosePullTarget(pack(),{x:0,y:0},230);
 assert.equal(plan.target,'t0','an end of the row, nearest the spot');
});
test('only eligible monsters are pulled, but every idle monster counts for the aggro check',()=>{
 const monsters=[{id:'goo',x:400,y:0,target:null},{id:'bot',x:200,y:30,target:null}];
 assert.equal(choosePullTarget(monsters,{x:0,y:0},230,undefined,m=>m.id==='goo'),null,'a sparkbot beside the pull spot blocks the goo');
 assert.equal(choosePullTarget([{id:'goo',x:400,y:0,target:null},{id:'bot',x:400,y:-400,target:null}],{x:0,y:0},230,undefined,m=>m.id==='goo').target,'goo');
});
test('monsters already targeting someone are never pulled',()=>{
 assert.equal(choosePullTarget([{id:'a',x:300,y:0,target:'Other'}],{x:0,y:0},230),null);
});
test('the next pull waits for the current fight and for every attacker on the party',()=>{
 assert.equal(pullAllowed(pack(),['W','P','M'],false),true);
 assert.equal(pullAllowed(pack(),['W','P','M'],true),false,'unfinished fight');
 assert.equal(pullAllowed([...pack(),{id:'x',x:0,y:0,target:'P'}],['W','P','M'],false),false,'a monster on the priest');
 assert.equal(pullAllowed([{id:'x',x:0,y:0,target:'Stranger'}],['W','P','M'],false),true);
});
test('the party stages at the pack edge, outside its aggro reach, on its own side',()=>{
 const p=stagingPoint({x:0,y:0},pack());
 assert.ok(Math.abs(p.x-(400-reach-STAGING_GAP))<1&&Math.abs(p.y)<1,'on the line to the nearest idle monster');
 assert.ok(outsideReach(p,pack()));
 assert.deepEqual(stagingPoint({x:300,y:0},pack()),{x:300,y:0},'already close enough');
 assert.deepEqual(stagingPoint({x:0,y:0},pack().map(m=>({...m,target:'W'}))),{x:0,y:0},'nothing idle');
 assert.deepEqual(stagingPoint({x:0,y:0},pack(),m=>m.id==='t3').x,Math.round(1e6*(880-reach-STAGING_GAP))/1e6,'only eligible monsters');
});
test('the walk from the spot to the pull point stays outside every other idle monster',()=>{
 // A sparkbot sits halfway between the spot and the goo's pull point.
 const monsters=[{id:'goo',x:500,y:0,target:null},{id:'bot',x:140,y:60,target:null}];
 assert.equal(choosePullTarget(monsters,{x:0,y:0},230,undefined,m=>m.id==='goo'),null);
 assert.equal(choosePullTarget([{id:'goo',x:500,y:0,target:null},{id:'bot',x:140,y:300,target:null}],{x:0,y:0},230,undefined,m=>m.id==='goo').target,'goo');
});
