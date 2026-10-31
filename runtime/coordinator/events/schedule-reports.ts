import {requestObject} from '../http/contracts.ts';

export interface TrickOrTreatCounts {
  day:string;
  observedAt:number;
  characterRemaining:number;
  characterLimit:number;
  accountRemainingUpperBound:number;
  accountLimit:number;
}
interface Schedule {
  [key: string]: unknown;
}
interface Report {
  seenAt: number;
  owner?: unknown;
  server?: string;
  eventSchedules?: Schedule[];
  eventFeedAt?: unknown;
  eventClockStale?: unknown;
  eventFeedConnected?: boolean;
}

/** Prefer the latest feed among fresh reports from the leader's realm. */
export function projectEventSchedules(
  statuses: Record<string, Report | null | undefined>,
  leader: string | null,
  now: () => number,
): Schedule[] {
  const server = statuses[String(leader)]?.server;
  const reports = Object.values(statuses).filter(
    (report): report is Report & { eventSchedules: Schedule[] } =>
      !!report &&
      !!report.eventSchedules &&
      now() - report.seenAt < 15000 &&
      (!server || report.server === server),
  );
  reports.sort((a, b) => Number(b.eventFeedAt || 0) - Number(a.eventFeedAt || 0));
  const report = reports[0];
  return report
    ? report.eventSchedules.map((event) => ({
        ...event,
        // server_info is change-only. A fresh connected heartbeat with a synced
        // clock retains the confirmed calendar even when no event changed lately.
        stale: report.eventFeedConnected === false || !!report.eventClockStale,
        ...(event.id === 'witchcipher' ? {cipher: cipherView(event, statuses, report.server, now())} : {}),
        ...(event.id === 'trickortreat' ? {trickOrTreat: {characters: knockCounts(statuses, now())}} : {}),
      }))
    : [];
}

function validKnockLimits(value: Record<string, unknown>): boolean {
  return Number.isInteger(value.characterLimit) && Number(value.characterLimit)>0 &&
    Number.isInteger(value.accountLimit) && Number(value.accountLimit)>0 &&
    Number.isInteger(value.doorsLeft) && Number(value.doorsLeft)>=0;
}
function accountIdentity(owner: unknown): string | null {
  return typeof owner==='string'||typeof owner==='number' ? String(owner) : null;
}
function knockCounts(statuses:Record<string,Report|null|undefined>, now:number):Record<string,TrickOrTreatCounts> {
  const observations=Object.entries(statuses).flatMap(([name,report])=>{
    const event=report?.eventSchedules?.find(entry=>entry.id==='trickortreat');
    const value=requestObject(event?.trickOrTreat);
    const offset=Number(event?.clockOffsetMs)||0;
    if(!report || value.day!==new Date(now+offset).toISOString().slice(0,10) || !Array.isArray(value.doors) ||
      !validKnockLimits(value))return [];
    const characterLimit=Number(value.characterLimit),accountLimit=Number(value.accountLimit);
    const used=new Set(value.doors.filter(id=>Number.isInteger(id)&&id>=0&&id<characterLimit)).size;
    const unused=characterLimit-used;
    return [{name,report,day:String(value.day),characterLimit,accountLimit,used,unused,
      remaining:Math.min(unused,Number(value.doorsLeft)),
      account:accountIdentity(report.owner)}];
  });
  return Object.fromEntries(observations.filter(o=>now-o.report.seenAt<15000&&o.report.eventFeedConnected!==false&&!o.report.eventClockStale).map(o=>{
    const account=observations.filter(peer=>peer.day===o.day&&(o.account!==null?peer.account===o.account:peer.name===o.name));
    // The native feed omits the account's counter. Door histories prove a
    // minimum usage; a capped allowance can tighten the remaining upper bound.
    // Same-day older histories remain safe bounds because knocks only increase.
    let upper=Math.max(0,o.accountLimit-account.reduce((sum,peer)=>sum+peer.used,0));
    for(const peer of account)if(peer.remaining<peer.unused)upper=Math.min(upper,peer.remaining);
    return [o.name,{day:o.day,observedAt:o.report.seenAt,characterRemaining:Math.min(o.remaining,upper),characterLimit:o.characterLimit,
      accountRemainingUpperBound:upper,accountLimit:o.accountLimit}];
  }));
}

function cipherView(event: Schedule, statuses: Record<string,Report|null|undefined>, realm: string|undefined, now:number) {
  const view = event.cipher as {merchant?:string;runtime?:unknown} | undefined;
  if (!view) return view;
  const merchant = view.merchant && statuses[view.merchant];
  const observation = merchant && now-merchant.seenAt<15000 && merchant.server===realm
    ? merchant.eventSchedules?.find(entry=>entry.id==='witchcipher')?.cipher as {runtime?:unknown}|undefined : undefined;
  return {...view,runtime:observation?.runtime};
}
