import { readFileSync } from 'node:fs';
import path from 'node:path';
import { requestObject } from '../http/contracts.ts';
/** Host-owned maintenance lease; never exported as a game preference. */
export function consoleMaintenance(directory: string | undefined, now = Date.now) {
  let lease: { id: string; expires: number; mode?: 'draining';loadMode?:'now'|'safe'|'main';phase?:string } | null = null, checked = 0;
  const participants = new Set<string>();
  let capturedId:string|undefined,fightTargets:Array<{id:string;map:string;in?:string|number;server?:string}>=[];
  function capture(statuses:Record<string,unknown>,active:typeof lease){
    if(!active||capturedId===active.id)return;
    capturedId=active.id;fightTargets=[];
    for(const raw of Object.values(statuses)){
      const report=requestObject(raw),target=requestObject(report.engagedCombatTarget);
      if(Number(report.seenAt)>now()-5000&&typeof target.id==='string'&&typeof target.map==='string')fightTargets.push({id:target.id,map:target.map,
        ...(['string','number'].includes(typeof target.in)?{in:target.in as string|number}:{}),...(typeof target.server==='string'?{server:target.server}:{})});
    }
  }
  function parseLease(input:Record<string,unknown>):typeof lease {
    if (typeof input.id!=='string' || typeof input.expires!=='number' || input.expires<now()) return null;
    return {id:input.id,expires:input.expires,...(input.mode==='draining'?{mode:'draining' as const}:{}),
      ...(['now','safe','main'].includes(String(input.loadMode))?{loadMode:input.loadMode as 'now'|'safe'|'main'}:{}),
      ...(typeof input.phase==='string'?{phase:input.phase}:{})};
  }
  function waitingForMain(report:Record<string,unknown>,active:NonNullable<typeof lease>):boolean {
    return active.loadMode==='main' && (report.ctype||report.type)!=='merchant' && report.map!=='main';
  }
  function merchantContinues(report:Record<string,unknown>,active:NonNullable<typeof lease>):boolean {
    return active.loadMode==='main' && active.phase!=='holding' && (report.ctype||report.type)==='merchant';
  }
  function current(statuses?:Record<string,unknown>): (NonNullable<typeof lease>&{fightTargets?:typeof fightTargets})|null {
    if(statuses){const active=current();capture(statuses,active);return active?{...active,fightTargets}:null;}
    if (!directory) return null;
    if (now() - checked < 250) return lease;
    checked = now();
    try {
      const input = requestObject(JSON.parse(readFileSync(path.join(directory, 'updates/pause.json'), 'utf8')));
      const parsed=parseLease(input);
      if (!parsed) { lease = null; return null; }
      if (parsed.id !== lease?.id) participants.clear();
      return lease = parsed;
    } catch { lease = null; return null; }
  }
  function observeParticipants(statuses: Record<string, unknown>, expected: readonly (string | null)[], stopped: readonly string[]) {
    const retired = new Set(stopped.filter(name => !expected.includes(name)));
    for (const name of retired) participants.delete(name);
    for (const name of expected) if (name) participants.add(name);
    for (const [name, raw] of Object.entries(statuses)) {
      const report = requestObject(raw);
      if (!retired.has(name) && Number(report.seenAt) > now() - 15000) participants.add(name);
    }
  }
  function status(statuses: Record<string, unknown>, expected: readonly (string | null)[] = [], blocked = false, stopped: readonly string[] = []) {
    const active = current();
    if (!active) return { ready: false, waiting: [], id: null };
    observeParticipants(statuses, expected, stopped);
    const waiting = [...participants].filter(name => {
      const report = requestObject(statuses[name]), ack = requestObject(report.consoleMaintenance);
      if(merchantContinues(report,active))return false;
      return Number(report.seenAt) < now() - 5000 || ack.id !== active.id || ack.ready !== true ||
        active.mode === 'draining' && (ack.mode !== 'draining' || ack.combat !== false) ||
        waitingForMain(report,active);
    });
    if (blocked) waiting.push('active Steam handoff');
    return { id: active.id, ready: waiting.length === 0, waiting, participants: [...participants] };
  }
  function blocksMerchant(){const active=current();return !!active&&!(active.loadMode==='main'&&active.phase!=='holding');}
  return { current, status, blocksMerchant };
}
