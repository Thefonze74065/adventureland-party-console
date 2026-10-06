const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createSkillEngine}=require('../../runtime/characters/skills/engine.ts');
const {fixture}=require('./helpers/skill-world.cjs');
const source=fs.readFileSync('characters/shared.js','utf8');
const code=source.slice(source.indexOf('  async function absorbSinsBelow('),source.indexOf('  async function healPartyBelow('));
test('legacy priest hook delegates to the live leader policy without the old HP cutoff',async()=>{
 const r=fixture('priest');r.ally('Friend',{hp:10000});r.add('a',{target:'Friend'});
 const engine=createSkillEngine(r.ports);
 const c=vm.createContext({root:{sharedRoutine:{absorbLeaderAggro:()=>engine.absorb()}}});vm.runInContext(code,c);
 assert.equal(await c.absorbSinsBelow(.6),true);assert.equal(r.calls[0].skill,'absorb');
 r.cooldowns.clear();r.w.context.leader='Friend';assert.equal(await c.absorbSinsBelow(.6),false);
 engine.stop();
});
test('missing skill runtime never falls back to unowned aggro transfers',async()=>{
 const c=vm.createContext({root:{sharedRoutine:{}}});vm.runInContext(code,c);
 assert.equal(await c.absorbSinsBelow(.6),false);
});
// Failure inventory: e2e/boss-absorb-failures.md. Written before the change.
test('a boss off-tank never absorbs; a boss tank and ordinary farming still do',async()=>{
 const run=async(context)=>{
  const r=fixture('priest');r.ally('Friend',{hp:10000});r.add('a',{target:'Friend'});
  Object.assign(r.w.context,context);
  const engine=createSkillEngine(r.ports);
  const absorbed=await engine.absorb();engine.stop();
  return absorbed && r.calls.some(call=>call.skill==='absorb');
 };
 assert.equal(await run({bossRoutine:'offtank'}),false,'off-tank at a boss must not pull attackers onto itself');
 assert.equal(await run({bossRoutine:'tank'}),true,'the boss tank keeps its rescue');
 assert.equal(await run({bossRoutine:null}),true,'ordinary farming is unchanged');
 assert.equal(await run({}),true,'a context without the field is unchanged');
});
