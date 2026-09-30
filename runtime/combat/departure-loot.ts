import {huntLootId} from '../hunt/loot-identity.ts';
/** Loot completion requires a pass and a subsequent observation in the same place. */
export function createDepartureLoot(ports:any) {
  let control:any=null, progress:any=null, pending=false, retired=new Set<string>(), latest=0;
  const engagements=new Map<string,number>();
  const identity=(t:any)=>JSON.stringify([t.realm,t.map,String(t.in??t.map),String(t.id)]);
  function samePlace(c:any) {
    const s=ports.position();
    return c && s.realm===c.realm && s.map===c.map && String(s.in)===String(c.in) &&
      !ports.cancelled();
  }
  function valid(c:any) {
    const s=ports.position();
    return samePlace(c) && Math.hypot(s.x-c.x,s.y-c.y)<=180;
  }
  function accept(c:any,at:number) {
    if(at<latest)return;latest=at;
    if(control && c && identity(control)===identity(c) && control.after===c.after)return;
    if(control && control.id!==c?.id)retired.add(control.id);
    control=c && !retired.has(c.id) ? c : null;
  }
  async function tick() {
    const c=control;
    if(!valid(c)||pending||ports.defending()||progress?.id===c.id&&progress.complete)return;
    pending=true;
    try {
      const result=await ports.loot();
      if(control!==c||!valid(c)||ports.defending())return;
      // Yield past the collection result before reading the live chest cache.
      await ports.nextObservation();
      if(control!==c||!valid(c)||ports.defending())return;
      progress={id:c.id,realm:c.realm,map:c.map,in:String(c.in),observedAt:ports.now(),
        complete:result!==false && ports.chests().length===0,error:undefined};
    } catch(error:any) {
      if(control===c)progress={id:c.id,realm:c.realm,map:c.map,in:String(c.in),observedAt:ports.now(),complete:false,error:String(error?.reason||error?.message||error)};
    } finally {pending=false;}
  }
  return {accept,tick,valid,samePlace,report:()=>progress,blocks:()=>valid(control)&&!(progress?.id===control.id&&progress.complete),
    hit(t:any){engagements.set(identity(t),ports.now());},
    engaged(t:any){const at=engagements.get(identity(t));return at!==undefined&&ports.now()-at<300000;}};
}

export function installLootClient(root:any,shared:any) {
  root.partyLootClient?.stop();
  const ports=shared.departureLootPorts?.();
  if(!ports)return null;
  ports.nextObservation=()=>new Promise<void>((resolve,reject)=>{
    const socket=ports.socket();
    const observe=()=>{clearTimeout(timeout);ports.afterDraw(resolve);};
    const timeout=setTimeout(()=>{socket.off('entities',observe);reject(new Error('waiting for fresh chest observation'));},3000);
    socket.once('entities',observe);
  });
  const rare=createDepartureLoot(ports),hunt=createDepartureLoot({...ports,
    defending:()=>mission?.encounter && ports.huntEncounterDefending ? ports.huntEncounterDefending() : ports.defending()}),convoy=createDepartureLoot(ports);
  let convoyHold=false;
  let lastState=0,lastRare:any=null,mission:any=null,finalKill:string|null=null,finalKillAt=0;
  const activeMission=()=>mission && !['ended','failed-return','backup-travel','backup-farming'].includes(mission.stage);
  const retired=new Set<string>();
  const timer=setInterval(()=>{void rare.tick();void hunt.tick();void convoy.tick();},100);
  const ownsMission=()=>mission?.missions?.[mission.currentIndex]?.owners?.includes(ports.name());
  const participant=()=>mission?.participants?.includes(ports.name()) || ownsMission();
  const ownerDone=(limit:number)=>mission?.missions?.[mission.currentIndex]?.owners?.length>0 && mission.missions[mission.currentIndex].owners.every((name:string)=>{
    const q=name===ports.name()?ports.quest():ports.questFor?.(name);return q?.id===mission.target&&q.count<=limit;
  });
  const api={rare,hunt,convoy,
    finalKill(mtype:string){
      if(mission && participant() && ['farming','mission-travel'].includes(mission.stage) && mtype===mission.target &&
          ownerDone(1)) { finalKill=huntLootId(mission);finalKillAt=ports.now?.()??Date.now(); }
    },
    huntPending(){
      if(convoyHold&&!ports.cancelled())return true;
      if(!activeMission() || !participant() || ports.cancelled())return false;
      // Capacity recovery is asynchronous. Keep trying chests, but do not freeze
      // farming while the merchant makes room and collects the party's bags.
      if(mission.stage==='farming' && ports.capacityBlocked?.())return false;
      return !!(hunt.blocks() || mission.batchPickup || ['returning','at-daisy','turning-in'].includes(mission.stage) ||
        mission.loot?.id===huntLootId(mission) || finalKill===huntLootId(mission) ||
        ['farming','mission-travel'].includes(mission.stage)&&ownerDone(0));
    },
    accept(state:any){
      if(state.serverNow<lastState)return lastRare;
      lastState=state.serverNow;
      convoyHold=!!(state.convoySignal?.phase==='defending' && state.convoySignal.loot);
      convoy.accept(convoyHold?state.convoySignal.loot:null,state.serverNow);
      mission=state.monsterHunt;
      if (state.farmingPolicy && state.farmingPolicy!=='hunt' && !mission?.exitMode) mission=null;
      if (!activeMission()) { mission=null;finalKill=null; }
      if(finalKill && state.serverNow>finalKillAt+1500 && !mission?.loot && !ownerDone(0))finalKill=null;
      if(!mission || finalKill!==huntLootId(mission) || mission.loot?.complete)finalKill=null;
      let c=state.rareControl;
      if(lastRare && lastRare.id!==c?.id)retired.add(lastRare.id);
      // The loot owner must be able to approach a kill made by a distant peer.
      // Proximity gates the actual loot pass, not acceptance of its movement.
      if(c && (retired.has(c.id)||c.kind==='loot'&&!rare.samePlace({...c.target,id:c.id})))c=null;
      lastRare=c;
      rare.accept(c?.kind==='loot'?{...c.target,id:c.id,after:c.killedAt}:null,state.serverNow);
      hunt.accept(mission?.loot&&!mission.loot.complete?mission.loot:null,state.serverNow);
      return c;
    },stop(){clearInterval(timer);}};
  root.partyLootClient=api;return api;
}
