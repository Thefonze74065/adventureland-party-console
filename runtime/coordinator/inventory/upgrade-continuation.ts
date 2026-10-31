import { requestObject } from '../http/contracts.ts';
import { autoItemRuleKey, sameMarkedItem } from './item-identity.ts';

interface State {
  merchantCharacter: string | null;
  upgrades?: Record<string, unknown[] | undefined>;
  autoUpgradeMarks: Record<string, Record<string, unknown> | undefined>;
}
/** Persist the original target before production, including bank-sourced passes. */
export function rememberUpgradeContinuation(state: State, body: Record<string, unknown>): void {
  const automatic = requestObject(body.automatic), mark = requestObject(automatic.mark);
  if (body.kind !== 'upgrade' || !automatic.mark) return;
  if(automatic.family==='manual-upgrade') {
    rememberManualContinuation(state,body,mark);
    return;
  }
  if(automatic.family!=='upgrade') return;
  rememberAutomaticContinuation(state,body,automatic,mark);
}
function rememberAutomaticContinuation(state:State,body:Record<string,unknown>,automatic:Record<string,unknown>,mark:Record<string,unknown>):void {
  const item = requestObject(mark.item), live = requestObject(body.item), owner = String(state.merchantCharacter);
  const rule = state.autoUpgradeMarks[owner]?.[String(automatic.key)];
  const tiers = Number(typeof rule === 'object' && rule ? requestObject(rule).tiers : rule);
  validateContinuation(mark, item, live, automatic.key, tiers);
  const list = (state.upgrades ||= {})[owner] ||= [];
  const existing = list.findIndex(raw => {
    const entry = requestObject(raw);
    return entry.passId === mark.passId || entry.slot === mark.slot && entry.auto === true &&
      sameMarkedItem(requestObject(entry.item), item);
  });
  // The request's slot is the actual input to this roll. A command can still
  // carry the previous checkpoint's liveSlot after native inventory relocation.
  const saved = {...mark, auto:true, liveSlot:mark.slot, liveItem:live};
  if (existing < 0) list.push(saved);
  else list[existing] = saved;
}
function rememberManualContinuation(state:State,body:Record<string,unknown>,mark:Record<string,unknown>):void {
    const list=Object.values(state.upgrades || {}).flatMap(list=>list || []);
    // Bank withdrawal marks historically used passId. Keep already admitted
    // commands valid when their saved intent is normalized to requestId.
    const identity=mark.requestId || mark.passId;
    const saved=list.map(requestObject).find(entry=>typeof identity==='string' && entry.auto!==true &&
      (entry.requestId===identity || !mark.requestId && entry.passId===identity));
    if(!saved) throw Error('Manual upgrade continuation changed');
    const start=requestObject(saved.item),live=requestObject(body.item);
    validateItem(start,live,Number(saved.tiers));
    if(Number(saved.tiers)!==Number(mark.tiers) || !sameMarkedItem(requestObject(mark.item),start)) throw Error('Manual upgrade target changed');
    saved.liveSlot=mark.slot;saved.liveItem=live;
}
function validateContinuation(mark: Record<string, unknown>, item: Record<string, unknown>, live: Record<string, unknown>, key: unknown, tiers: number): void {
  if (typeof mark.passId !== 'string' || mark.passId.length > 200 || !Number.isInteger(mark.slot) ||
      mark.auto !== true || autoItemRuleKey(item) !== key || tiers !== mark.tiers)
    throw Error('Automatic upgrade continuation changed');
  validateItem(item, live, tiers);
}
function validateItem(item: Record<string, unknown>, live: Record<string, unknown>, tiers: number): void {
  const start = Number(item.level) || 0, level = Number(live.level) || 0;
  if (level < start || level >= start + tiers || !sameMarkedItem({...live,level:start}, {...item,level:start}))
    throw Error('Automatic upgrade continuation item changed');
}

/** Only a completed native journal advances or retires an original upgrade pass. */
export function settleUpgradeContinuation(state:State,value:unknown):void {
  const journal=requestObject(value),request=requestObject(journal.request),automatic=requestObject(request.automatic);
  if(journal.phase!=='complete' || request.kind!=='upgrade' || !['upgrade','manual-upgrade'].includes(String(automatic.family))) return;
  const intent=requestObject(automatic.mark);
  for(const [owner,list] of Object.entries(state.upgrades || {})) {
    state.upgrades![owner]=list?.filter(raw=>settleUpgradeMark(requestObject(raw),intent,journal));
  }
}
function settleUpgradeMark(mark:Record<string,unknown>,intent:Record<string,unknown>,journal:Record<string,unknown>):boolean {
  if(!matchesUpgradeIntent(mark,intent)) return true;
  if(journal.destroyed===true) return false;
  const result=requestObject(journal.outcomeItem),start=requestObject(mark.item);
  if(!sameUpgradeOutcome(result,start)) return true;
  if(Number(result.level||0)>=Number(start.level||0)+Number(mark.tiers)) return false;
  const slots=Array.isArray(journal.slots)?journal.slots:[];
  mark.liveSlot=slots[0];mark.liveItem=result;
  return true;
}

function matchesUpgradeIntent(mark:Record<string,unknown>,intent:Record<string,unknown>):boolean {
  if(intent.requestId) return mark.requestId===intent.requestId;
  return typeof intent.passId==='string' && mark.passId===intent.passId;
}

function sameUpgradeOutcome(result:Record<string,unknown>,start:Record<string,unknown>):boolean {
  const level=Number(start.level)||0;
  return result.name===start.name && sameMarkedItem({...result,level},{...start,level});
}
