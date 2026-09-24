import {passiveStopRequired, type PassiveTravelSettings} from './passive-travel.ts';
import { collectPassing, passingIdentity, type PassingEncounter } from './passing.ts';
import type { Member } from './grouped.ts';
import {updateHuntTravel, type HuntTravelConvoy, type HuntTravelControl} from './hunt-travel.ts';

export interface PassingControl {
  scope: string;
  ready: boolean;
  admitted: string[];
  hunt?: HuntTravelControl;
}
export interface PassingAcknowledgement { scope: string; tokens: string[]; at: number }
const freshAcknowledgement = (ack:PassingAcknowledgement|undefined,now:number) =>
  !!ack && Number.isFinite(ack.at) && now-ack.at<3000 && ack.at<=now+500;

function memberReady(m:Member,scope:string,now:number):boolean {
  const s=m.status;
  if(!s || m.cancelled || s.rip || s.hp<=0)return false;
  const ack=s.groupedCombat?.passingAcknowledgement;
  if(!freshAcknowledgement(ack,now))return false;
  return [!!s.combatSelection?.runtimeId,now-s.seenAt<3000,s.seenAt<=now+500,
    ack?.scope===scope].every(Boolean);
}

/** Reservations precede the game attack. Every participant must have installed
 * the exact encounter before the sender may fire; this never gates movement. */
export function passingControl(members: Member[], convoy: unknown, now: number, huntConvoy?: HuntTravelConvoy | null, settings?: PassiveTravelSettings): PassingControl {
  const ordered = [...members].sort((a, b) => a.name.localeCompare(b.name));
  const scope = JSON.stringify([convoy, ordered.map(m => [m.name, m.revision,
    m.status?.combatSelection?.runtimeId, m.status?.server, m.status?.map, m.status?.in])]);
  const ready = ordered.length > 0 && ordered.every(m => memberReady(m,scope,now));
  const encounters = collectPassing(ordered, [], now);
  const hunt=huntConvoy ? updateHuntTravel(huntConvoy,ordered,now,scope,settings) : undefined;
  const admitted = ready ? encounters.filter(e => e.admission?.scope === scope &&
    (!hunt || !hunt.reason && !passiveStopRequired(settings,e.mtype) && !hunt.defending && !!hunt.primary && passingIdentity(e)===passingIdentity(hunt.primary)) &&
    ordered.every(m => m.status?.groupedCombat?.passingAcknowledgement?.tokens.includes(e.admission!.token)))
    .map(e => e.admission!.token) : [];
  return { scope, ready, admitted, ...(hunt ? {hunt} : {}) };
}

export function createPassingAdmission(ports: {
  now(): number;
  reserve(target: PassingEncounter, admission: NonNullable<PassingEncounter['admission']>): void;
}) {
  let control: PassingControl | null = null, receivedAt = 0, serial = 0, serverAt = -Infinity;
  let acknowledgement: PassingAcknowledgement | undefined;
  const proposals = new Map<string, { scope: string; token: string }>();
  const freshControl = () => !!control?.ready && ports.now()-receivedAt<1000;
  function apply(next: PassingControl | undefined, encounters: PassingEncounter[], at: number) {
    if (!next || at < serverAt) return;
    serverAt = at; receivedAt = ports.now(); control = next;
    acknowledgement = { scope: next.scope, at, tokens: encounters.filter(e =>
      e.admission?.scope === next.scope && at - e.at < 60000).map(e => e.admission!.token) };
  }
  function prepare(target: PassingEncounter, present?: PassingEncounter[]): boolean {
    if (!control || !freshControl()) return false;
    const key = passingIdentity(target);
    if(control.hunt && (control.hunt.defending || control.hunt.reason || control.hunt.primary && passingIdentity(control.hunt.primary)!==key))return false;
    let proposal = proposals.get(key);
    const token=proposal?.token;
    if (!proposal || proposal.scope !== control.scope || present && !present.some(e=>e.admission?.token===token)) {
      proposal = { scope: control.scope, token: JSON.stringify([control.scope, key, ports.now(), ++serial]) };
      proposals.set(key, proposal);
      if (proposals.size > 128) proposals.delete(proposals.keys().next().value!);
      ports.reserve(target, proposal);
      return false;
    }
    return control.ready && control.admitted.includes(proposal.token);
  }
  return { apply, prepare, report: () => ports.now()-receivedAt<1000 ? acknowledgement : undefined };
}
