// Bridge rare navigation/support to the shared combat authority.
function createRareCombat(party, members, realm) {
  const combatRealm = server => {
    const status = Object.values(party.statuses).find(s => s.server === server);
    return status ? realm(status) : ':'+server;
  };
  const same = (fight, target) => !!fight && fight.id === target.id && fight.map === target.map &&
    String(fight.in ?? fight.map) === String(target.in) && combatRealm(fight.server) === target.realm;
  const grouped = () => party.partyFarmingMode !== 'scatter' && members().length > 1 &&
    members().some(name => party.statuses[name]?.groupedCombat?.protocol === 4);
  const target = () => party.groupedCombat?.target;
  return {
    grouped,
    selected: sight => same(target(), sight),
    queued: sight => !!party.groupedCombat?.queue?.some(candidate => same(candidate, sight)),
    locked: sight => !!party.groupedCombat?.fights?.some(f => same(f, sight)),
    engaged: sight => !!party.groupedCombat?.fights?.some(f => same(f, sight) && f.state === 'engaged'),
    busy: () => !!party.groupedCombat?.fights?.length,
    killed: sight => !!party.groupedCombat?.deaths?.some(d => same(d, sight)),
    claimed: sight => !!party.groupedCombat?.claims?.some(c => same(c,sight) && c.external),
    rejected(sight) {
      const g=party.groupedCombat,c=party.activeConvoy?.huntTravel;
      const server=Object.values(party.statuses).find(s=>realm(s)===sight.realm)?.server || sight.realm.split(':').at(-1);
      const identity=JSON.stringify([server,sight.map,sight.in,sight.id]);
      return (!g || (g.rareRejections||[]).some(t=>same(t,sight)&&t.until===Number.MAX_SAFE_INTEGER)) &&
        (!party.activeConvoy || !!c?.rejected?.includes(identity));
    },
    allow(sight) {
      const g=party.groupedCombat,c=party.activeConvoy?.huntTravel;
      if(g)g.rareRejections=(g.rareRejections||[]).filter(t=>!same(t,sight));
      if(c)c.rejected=(c.rejected||[]).filter(k=>k!==JSON.stringify([(Object.values(party.statuses).find(s=>realm(s)===sight.realm)?.server || sight.realm.split(':').at(-1)),sight.map,sight.in,sight.id]));
    },
    release(sight, until, rejectedAt = Date.now()) {
      const c=party.activeConvoy ? (party.activeConvoy.huntTravel ||= {primary:null,searches:{}}) : null;
      if(c) {
        const identity=JSON.stringify([(Object.values(party.statuses).find(s=>realm(s)===sight.realm)?.server || sight.realm.split(':').at(-1)),sight.map,sight.in,sight.id]);
        if(until===Number.MAX_SAFE_INTEGER)c.rejected=[...new Set([...(c.rejected||[]),identity])];
        (c.released||={})[identity]=rejectedAt;
        c.committed=(c.committed||[]).filter(t=>!same(t,sight));
        if(same(c.primary,sight))c.primary=null;
        if(!c.committed.length)delete c.reason;
      }
      const g=party.groupedCombat;
      if (!g) return;
      const target={...sight,server:(Object.values(party.statuses).find(s=>realm(s)===sight.realm)?.server || sight.realm.split(':').at(-1)),until,rejectedAt,expiresAt:Math.max(until,rejectedAt+120000)};
      g.rareRejections=[...(g.rareRejections||[]).filter(t=>!same(t,sight)),target];
      const attacking=Object.values(party.statuses).some(s=>rejectedAt-(s.groupedCombat?.currentAttackersAt||0)<=3000 && (s.groupedCombat?.currentAttackers||[]).some(t=>same({...t,server:s.server},sight)));
      g.evidence=(g.evidence||[]).filter(t=>!same(t,sight)||attacking);
      g.fights=(g.fights||[]).filter(t=>!same(t,sight)||attacking);
      g.queue=(g.queue||[]).filter(t=>!same(t,sight)||attacking);
      const selected=same(g.target,sight);
      if(selected)g.target=g.queue[0]||null;
      if(selected && !attacking){g.committed=false;g.selection=null;}
    },
    current() {
      const t = target();
      if (!t) return null;
      return {...t, realm:combatRealm(t.server), in:String(t.in ?? t.map), hp:1,
        reporter:party.leader, seenAt:party.groupedCombat.seenAt};
    },
  };
}
module.exports = createRareCombat;
