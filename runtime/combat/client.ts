import type {HandoffReport} from './successor-grant.ts';
import {createSuccessorClient} from './successor-client.ts';
import {createFormationRecoveryClient} from './formation-recovery-client.ts';
import type {Evidence} from './queue.ts';
import {createSightRecovery} from './sight-recovery.ts';
import {retireDeadEvidence, sameEvidenceTarget} from './evidence.ts';
import type {Death} from './grouped.ts';
import type {Target} from '../characters/roles/types.ts';
import {createPassingAdmission} from './passing-admission.ts';
import {createHandoffTiming} from './handoff-timing.ts';
/** Small adapter around the game globals; lifecycle belongs to the role runner. */
export function installQueueClient(root:any, shared:any) {
  root.partyQueueClient?.stop();
  let active=true,busy=false,waiting=false,dirty=false,signature='',sentAt=0,retryAt=0,revision='',serial=0;
  let sentAcknowledgement='';
  const acknowledgement=(report:{groupedCombat?:{ack?:string|null;queueAck?:string|null;handoff?:HandoffReport}})=>JSON.stringify([report.groupedCombat?.ack,report.groupedCombat?.queueAck,report.groupedCombat?.handoff]);
  const timing=createHandoffTiming(root.__partyHandoffTrace ||= []);
  const handoff=createSuccessorClient({now:()=>Date.now(),monotonic:()=>performance.now(),serverNow:()=>Date.now()+shared.queueClockOffset(),
    allowed:g=>!!shared.successorAllowed?.(g),live:g=>!!shared.successorVisible?.(g),trace:(stage,details)=>timing.event(stage,details)});
  const enabled=()=>!!(shared.convoyActive?.() || shared.usesGroupedCombat?.() || shared.passingEncounterReport?.().length || shared.getPassingTarget?.() || shared.queueMembers?.().length);
  const formation=shared.terrainRecoveryPorts ? createFormationRecoveryClient(shared.terrainRecoveryPorts()) : null;
  const host=parent as any;
  const passing=createPassingAdmission({now:()=>Date.now(),reserve:(target,admission)=>shared.beginPassingAttack(target,admission,true)});
  const events:Evidence[]=host.__partyQueueEvidence||[];
  let claims:any[]=[];
  const sight=createSightRecovery({now:()=>Date.now(),self:()=>character,clear:p=>shared.queueSafePoint(p),cost:p=>shared.queueCoverageCost(p),
    move:p=>{shared.queueRecoveryMove(p);},report:reason=>shared.queueRecoveryReason(reason)});
  host.__partyQueueEvidence=events;
  function trace(event:Evidence,reason:string){
    const entries=root.__partyQueueEvidenceTrace ||= [];
    entries.push({at:Date.now()+shared.queueClockOffset(),id:event.id,map:event.map,in:event.in,server:event.server,
      action:event.action,state:event.state,mode:shared.getFarmingMode?.(),reason});
    if(entries.length>32)entries.splice(0,entries.length-32);
  }
  function reportEvidence(deaths:Death[]=root.__partyFightDeaths||[]){
    for(let i=events.length-1;i>=0;i--)if(shared.isPassingEncounter?.(events[i]))events.splice(i,1);
    retireDeadEvidence(events,deaths,event=>trace(event,'confirmed local death'));
    return events;
  }
  reportEvidence();
  function flush(){dirty=true;signature='';sentAt=0;tick();}
  function evidence(target:any,state:Evidence['state'],action?:string){
    if(!active||!target||shared.isPassingEncounter?.(target))return null;
    reportEvidence();
    const old=action ? events.findIndex(e=>e.action===action) : -1;
    if(action && old<0)return null; // Never recreate an invalidated action.
    if(!action && !shared.usesGroupedCombat?.())return null;
    if(old>=0){
      const previous=events[old];
      events[old]={...previous,state,at:Date.now()+shared.queueClockOffset(),startedAt:previous.startedAt??previous.at};
      trace(events[old],'action settled');
      flush();return action;
    }
    const report=shared.queueReport();
    const event:Evidence={id:target.id,mtype:target.mtype,map:character.map,in:character.in,server:report.server,x:target.x,y:target.y,
      action:action||character.name+':'+Date.now()+':'+(++serial),state,at:Date.now()+shared.queueClockOffset()};
    if((report.groupedCombat.deaths||[]).some((death:Death)=>sameEvidenceTarget(event,death)))return null;
    event.startedAt=event.at;
    events.push(event);
    while(events.length>256){const i=events.findIndex(e=>e.state!=='pending');if(i<0)break;events.splice(i,1);}
    flush();return event.action;
  }
  function hit(data:any){
    const names=shared.queueMembers();
    if(!data||!names.includes(String(data.hid||data.actor||'')))return;
    const target=get_entity(data.id);
    if(!target||target.type!=='monster')return;
    const report=shared.queueReport();
    const identity={id:target.id,map:character.map,in:character.in,server:report.server};
    const pending=reportEvidence().filter(e=>sameEvidenceTarget(e,identity)&&e.state==='pending');
    if(!pending.length && shared.sharedTargetId()!==target.id)return;
    if(!pending.length && (shared.queueReport().groupedCombat.epoch||0)>0)return;
    if(!pending.length && claims.some(c=>c.id===target.id&&c.map===character.map&&c.in===character.in&&c.releasedAt!==undefined))return;
    if(pending.length)pending.forEach(e=>evidence(target,'engaged',e.action));else evidence(target,'engaged');
  }
  function apply(data:any){
    if(!active)return;
    shared.acceptCombatControl?.(data);
    passing.apply(data.passingControl,(data.passingEncounters||[]).filter((e:Target)=>shared.isPassingEncounter?.(e)),data.serverNow||0);
    const group=data.groupedCombat;
    claims=group?.claims||claims;
    for(let i=events.length-1;i>=0;i--)if(group?.lostTargets?.some((d:any)=>d.id===events[i].id&&d.map===events[i].map&&d.in===events[i].in&&d.server===events[i].server&&(events[i].startedAt??events[i].at)<=d.retiredAt)||group?.rareRejections?.some((d:any)=>events[i].state==='pending'&&d.id===events[i].id&&d.map===events[i].map&&d.in===events[i].in&&d.server===events[i].server)||group?.deaths?.some((d:any)=>d.id===events[i].id&&d.map===events[i].map&&d.in===events[i].in&&d.server===events[i].server)||
      group?.claims?.some((c:any)=>c.id===events[i].id&&c.map===events[i].map&&c.in===events[i].in&&c.server===events[i].server&&
        (c.external||c.releasedAt>=(events[i].startedAt??events[i].at))))events.splice(i,1);
    if(shared.sharedTargetId()!==group?.target?.id)sight.reset();
    revision=data.combatRevision||revision;shared.acceptQueue(group);
    timing.selection(root.__partyGroupedCombat ?? group);root.partyRoleRunner?.wake();
    // A received selection/queue must not wait for the next reporting interval.
    if(acknowledgement(shared.queueAcknowledgement ? shared.queueAcknowledgement() : shared.queueReport())!==sentAcknowledgement)flush();
  }
  function wait(){
    if(!active||!enabled()||waiting||Date.now()<retryAt)return;
    waiting=true;
    shared.queueRequest({combatWait:true,combatRevision:revision}).then(apply)
      .catch(()=>{retryAt=Date.now()+1000;})
      .finally(()=>{waiting=false;wait();});
  }
  function tick(){
    if(!active||Date.now()<retryAt)return;
    if(!enabled())return;
    formation?.tick();
    // Admission needs round trips through every participant. Start that exchange
    // while an eligible passing monster is still ahead; this never attacks it.
    const passingTarget=shared.getWalkingPassiveTarget?.(true);
    if(passingTarget)preparePassing(passingTarget,true);
    const id=shared.sharedTargetId(),entity=id&&get_entity(id);
    if(id)sight.observe(id,character,!!(entity&&entity.visible&&!entity.dead));
    wait();
    if(busy)return;
    dirty=false;
    const report=shared.queueReport();report.groupedCombat.evidence=reportEvidence(report.groupedCombat.deaths).filter(e=>e.server===report.server&&e.map===character.map&&e.in===character.in);
    const next=JSON.stringify([report.x,report.y,report.hp,report.rip,report.lastDeath,report.groupedCombat.epoch,report.groupedCombat.currentAttackers,report.groupedCombat.travelCandidates,report.groupedCombat.huntDefense,report.groupedCombat.passingAcknowledgement,report.groupedCombat.passingEncounters,report.groupedCombat.formationRecovery,report.groupedCombat.pursuitAck,report.groupedCombat.lootPending,report.groupedCombat.claims?.map((c:any)=>[c.id,c.map,c.in,c.server,c.external]),report.groupedCombat.candidates,report.groupedCombat.threats,report.groupedCombat.sightings,report.groupedCombat.evidence,report.groupedCombat.deaths,report.groupedCombat.queueAck,report.groupedCombat.ack,report.groupedCombat.handoff,report.monsterHunt]);
    if(next===signature&&Date.now()-sentAt<1000)return;
    signature=next;sentAt=Date.now();busy=true;sentAcknowledgement=acknowledgement(report);
    const started=performance.now(),body={...report,combatOnly:true};
    // The shared transport stamps the atomic sample synchronously at send time.
    const pending:Promise<{combatReportReceipt?:unknown}>=shared.queueRequest(body);
    const sequence=body.travelSample?.sequence;
    timing.report({sequence,deaths:(report.groupedCombat.deaths||[]).map((d:Death)=>d.id),ack:report.groupedCombat.ack});
    pending.then(data=>{
      if(!active)return;
      timing.response({sequence,roundTripMs:Math.max(0,performance.now()-started),coordinator:data.combatReportReceipt});apply(data);
    }).catch(()=>{signature='';retryAt=Date.now()+1000;})
      .finally(()=>{busy=false;if(dirty)tick();});
  }
  const timer=setInterval(tick,100);
  function preparePassing(target:Target,reserveOnly=false) {
    if(target.type!=='monster')return false;
    if(shared.convoyHoldDefenseTarget?.()?.id===target.id)return true;
    const report=shared.queueReport();
    const identity={...target,map:report.map,in:report.in,server:report.server,at:Date.now()+shared.queueClockOffset(),
      keepMoving:shared.getWalkingPassiveTarget?.(reserveOnly)?.id===target.id};
    if(!passing.prepare(identity,report.groupedCombat.passingEncounters))return false;
    if(!reserveOnly)shared.beginPassingAttack(target);
    return true;
  }
  const api={tick,flush,hit,evidence,events,reportEvidence,sight,formation,timing,handoff,
    death(id:string){const next=handoff.death(id);if(next){shared.acceptQueue(next);timing.selection(next);root.partyRoleRunner?.wake();}flush();},preparePassing,passingAcknowledgement:passing.report,reset(){handoff.reset();events.length=0;sight.reset();signature='';sentAt=0;},stop(){formation?.stop();active=false;clearInterval(timer);}};
  root.partyQueueClient=api;return api;
}
