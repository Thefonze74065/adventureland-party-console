const test=require('node:test'),assert=require('node:assert/strict');
const {attemptChance,estimateUpgrade,estimateUpgradeBatch}=require('../../runtime/upgrade-estimate.ts');
// Expected chances hand-computed from the server's upgrade handler (server.js) over the default base table.
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<0.0006,`${actual} !~ ${expected}`);
const common7=0.25,all={itemGrace:3,serverGrace:18,ograce:3};
test('no grace matches the base chance, with item grace and ugrace counted',()=>{
 near(attemptChance(common7,7,0,1,{},null),0.25);
 near(attemptChance(common7,7,13.5,1,{itemGrace:3,serverGrace:18,ograce:3},null),0.345);
});
test('offerings multiply the base and add undivided grace',()=>{
 near(attemptChance(common7,7,0,1,{},0),0.387);
 near(attemptChance(common7,7,0,1,{serverGrace:18},1),0.610);
 near(attemptChance(0.14,8,13.5,-1,all,1),0.420);
});
test('the grace bonus saturates at the server cap',()=>{
 near(attemptChance(common7,7,0,1,{serverGrace:18},0),attemptChance(common7,7,13.5,1,all,0));
});
const choice={id:'helmet',cost:1000,upgradeable:true,upgradeGrade:1};
test('grace options lower the estimate; absent options keep the old model',async()=>{
 const plain=await estimateUpgrade(choice,1,8);
 const again=await estimateUpgradeBatch([{choice,quantity:1,target:8}]);
 assert.deepEqual(again[0],plain);
 const graced=await estimateUpgradeBatch([{choice,quantity:1,target:8,grace:{itemGrace:3,serverGrace:18}}]);
 assert.equal(graced[0].status,'available');
 assert.ok(graced[0].gold<=plain.gold,`${graced[0].gold} > ${plain.gold}`);
 assert.equal('offerings' in plain,false);
});
test('offerings are counted and improve the estimate',async()=>{
 const offerings=Array(9).fill(0);
 const [result]=await estimateUpgradeBatch([{choice,quantity:1,target:8,grace:{offerings}}]);
 assert.equal(result.status,'available');
 assert.ok(result.offerings>0);
 const [base]=await estimateUpgradeBatch([{choice,quantity:1,target:8}]);
 assert.ok(result.attempts<=base.attempts);
});
