// One authority for deliberate abandonment. Movement/escape implementations remain separate.
module.exports = function createCombatDisengagement(party, hooks) {
  const huntSafety=require('./hunt-safety.cjs');
  const zones=require('../characters/farming-zones.cjs');
  const now=hooks.now||Date.now;
  party.combatResetByCharacter ||= {};
  party.combatDeathSeen ||= {};
  const fresh=s=>!!s && now()-s.seenAt<=3000 && s.seenAt<=now()+500;
  const dead=s=>!!s && (s.rip || s.hp<=0);
  const event=s=>!!(s?.activeEvent || s?.joinedEvent || s?.mapEvent || s?.eventTraveling);
  const active=()=>!!party.combatRecovery && !['complete','cancelled'].includes(party.combatRecovery.phase);
  const id=t=>JSON.stringify([t.server,t.map,t.in,t.id]);
  function log(reason) {
    const entries=party.combatLogs[party.leader] ||= [];
    entries.push({at:now(),type:'disengagement',message:reason});
    if(entries.length>200)entries.splice(0,entries.length-200);
  }
  function reset(names,reason,group=true) {
    const at=Math.max(now(),...names.map(n=>(party.combatResetByCharacter[n]||0)+1));
    for(const name of names)party.combatResetByCharacter[name]=at;
    if(group){party.groupedCombat=null;party.groupedCombatResetAt=at;}
    log(reason);hooks.persist();return at;
  }
  function newDeaths(names) {
    const deaths=[];
    for(const name of names) {
      const s=party.statuses[name];if(!fresh(s))continue;
      const prior=party.combatDeathSeen[name], stamp=Number(s.lastDeath?.at)||0;
      const started=party.groupedCombat?.target?.startedAt ?? Infinity;
      const reported = stamp > (prior?.at || 0);
      if(!huntSafety.eventDeath(s,party.huntEventTrips?.[name]||[],reported ? stamp : now(),reported) &&
          (!prior ? dead(s)||stamp>started : !prior.dead&&(dead(s)||stamp>prior.at)))deaths.push(name);
      party.combatDeathSeen[name]={at:Math.max(prior?.at||0,stamp),dead:dead(s)};
    }
    return deaths;
  }
  function capture(names) {
    return {names,leader:party.leader,server:party.statuses[party.leader]?.server,focus:JSON.stringify(party.monsterFocus),policy:party.farmingPolicy,
      location:party.rareHuntReturn?.returnLocation || party.location,
      revisions:Object.fromEntries(names.map(n=>[n,hooks.intent(n).revision]))};
  }
  function current(r) {
    return r.leader===party.leader && r.focus===JSON.stringify(party.monsterFocus) && r.policy===party.farmingPolicy &&
      r.names.every(n=>!hooks.intent(n).cancelled && hooks.intent(n).revision===r.revisions[n]);
  }
  function foes(r) {
    const found=new Map();
    for(const name of r.names) {
      const s=party.statuses[name];if(!fresh(s)||dead(s))continue;
      for(const t of s.groupedCombat?.threats||[])found.set(id({...t,server:s.server}),{...t,server:s.server});
    }
    for(const fight of party.groupedCombat?.fights||[])found.set(id(fight),fight);
    return [...found.values()].filter(t=>!party.groupedCombat?.deaths?.some(d=>id(d)===id(t)));
  }
  function health(t,r) {
    const observations=r.names.flatMap(n=> {
      const s=party.statuses[n];
      return fresh(s)&&!dead(s)&&s.server===t.server&&s.map===t.map&&s.in===t.in ?
        (s.groupedCombat?.sightings||[]).concat(s.groupedCombat?.threats||[]).filter(v=>v.id===t.id) : [];
    });
    return observations.length>0 && observations.every(v=>Number.isFinite(v.hp)&&v.max_hp>0&&v.hp/v.max_hp<=0.25);
  }
  function canFinish(r,targets) {
    const survivors=r.names.map(n=>party.statuses[n]).filter(s=>!dead(s));
    return targets.length>0 && survivors.length>0 && survivors.every(s=>fresh(s)&&s.max_hp>0&&s.hp/s.max_hp>=0.5) &&
      targets.every(t=>health(t,r));
  }
  function escape(r,reason) {
    r.phase='escaping';r.reason=reason;
    reset(r.names,reason);
    hooks.abandonRare();
    hooks.escape(r.names);
    // Escape owns any revisions produced by its own cancellation/recovery.
    r.revisions=Object.fromEntries(r.names.map(n=>[n,hooks.intent(n).revision]));
    hooks.persist();
  }
  function start(names,deaths) {
    const r=party.combatRecovery={...capture(names),id:'death-'+now(),phase:'finishing',at:now(),deaths,reason:'Checking remaining attackers'};
    const targets=foes(r);r.targets=targets;
    if(!canFinish(r,targets))escape(r,'Party death: escaping unsafe or completed encounter');
    else {hooks.cancelCombatTravel();r.reason='Finishing weakened attackers before escape';log(r.reason);hooks.persist();}
  }
  function safe(r) {
    return r.names.every(n=> {
      const s=party.statuses[n];return fresh(s)&&!dead(s)&&s.max_hp>0&&s.hp/s.max_hp>=0.5&&
        s.map==='main'&&Math.hypot(s.x,s.y)<=65&&!(s.groupedCombat?.threats||[]).length;
    });
  }
  function recover(r) {
    r.phase='recovering';r.reason='Waiting for respawn and safe regroup at 50% HP';
    if(!safe(r))return;
    // Discard all observations gathered during escape before allowing fresh pulls.
    if(!r.resumeReset) {
      reset(r.names,'Recovery complete: recalculating farming targets');
      hooks.releaseEscape();r.resumeReset=true;
    }
    if(r.policy!=='hunt' && r.location) {r.phase='returning-to-farm';return returnToFarm(r);}
    r.phase='complete';r.reason='Recovery complete';
    if(r.policy==='hunt')hooks.resumeHunt();
    hooks.persist();
  }
  function returnToFarm(r) {
    const arrived=r.names.every(n=>{const s=party.statuses[n];return fresh(s)&&!dead(s)&&s.server===(r.server||party.statuses[r.leader]?.server)&&zones.contains(r.location,s,0,400);});
    const handoff=party.lastConvoyEngagement;
    if(arrived || r.returnConvoyId && handoff?.convoyId===r.returnConvoyId && zones.contains(r.location,handoff.target,0,400)) {
      r.phase='complete';r.reason='Arrived at saved farm';hooks.persist();return;
    }
    const c=party.activeConvoy;
    if(c && c.id===r.returnConvoyId && c.phase!=='failed') {r.reason=c.phase==='defending'?'Defending during farm return':'Returning to saved farm';return;}
    if(c && c.id!==r.returnConvoyId) {r.reason='Waiting for current travel before farm return';return;}
    if(!r.returnRetryAt) {
      r.returnRetryAt=now()+(r.returnConvoyId?[5000,15000,30000,60000][Math.min(r.returnRetries||0,3)]:0);
      r.reason='Retrying farm return'+(c?.failure?': '+c.failure:'');hooks.persist();
    }
    if(now()<r.returnRetryAt || !r.names.every(n=>fresh(party.statuses[n])&&!dead(party.statuses[n])))return;
    if(c)hooks.cancelCombatTravel();
    if(hooks.returnToFarm(r.location,r.names)===false) {r.returnRetryAt=now()+5000;hooks.persist();return;}
    r.returnConvoyId=party.activeConvoy?.id||null;r.returnRetries=(r.returnRetries||0)+1;r.returnRetryAt=0;
    r.reason='Returning to saved farm';hooks.persist();
  }
  function tick() {
    const legacy=party.combatRecovery;
    if(legacy?.phase==='complete' && party.activeConvoy?.purpose==='death-recovery' && current(legacy)) {
      legacy.phase='returning-to-farm';legacy.returnConvoyId=party.activeConvoy.id;
    }
    const names=active()?party.combatRecovery.names:hooks.members();
    const deaths=newDeaths(names);
    if(active()) {
      const r=party.combatRecovery;
      if(!current(r)) {
        r.phase='cancelled';r.reason='Recovery superseded by new activity';hooks.releaseEscape();hooks.persist();return;
      }
      if(names.some(n=>event(party.statuses[n])))return;
      if(hooks.restartFailedHunt?.())return;
      if(r.phase==='returning-to-farm') {
        if(deaths.length) {r.resumeReset=false;r.returnConvoyId=null;escape(r,'Another death during farm return');}
        else returnToFarm(r);
        return;
      }
      if(r.phase==='finishing') {
        const targets=foes(r);r.targets=targets;
        if(deaths.length||!canFinish(r,targets))escape(r,'Finishing ended: escaping after party death');
      } else recover(r);
      return;
    }
    if(deaths.length && names.length && !names.some(n=>event(party.statuses[n])) &&
        names.every(n=>!hooks.intent(n).cancelled))start(names,deaths);
  }
  function prepare(members) {
    // Travel filtering belongs to coordinatorGroupedSnapshot/travelCombatFor.
    // A saved Hunt stage can outlive its convoy after an authorized rare handoff.
    if(!active())return members;
    const r=party.combatRecovery;
    return members.map(m=>({...m,status:m.status && {...m.status,groupedCombat:{...m.status.groupedCombat,
      candidates:[], retentionPaused:true, ...(!active() || ['finishing','returning-to-farm'].includes(r.phase)?{}:{evidence:[],threats:[],state:null})}}}));
  }
  function finalize(group) {
    group.resetAt=party.groupedCombatResetAt||0;
    if(active()) {
      group.recovery=party.combatRecovery;
      if(party.combatRecovery.phase==='finishing' && group.target && group.fights.some(t=>id(t)===id(group.target)))group.committed=true;
      if(!['finishing','returning-to-farm'].includes(party.combatRecovery.phase)) {
        group.queue=[];group.fights=[];group.target=null;group.selection=null;group.committed=false;
      }
    }
    return group;
  }
  return {tick,prepare,finalize,reset,active};
};
