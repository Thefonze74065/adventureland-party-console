import {requestObject} from '../http/contracts.ts';
import type {MailInbox} from '../http/mail-inbox.ts';

export interface SentMailRecord {id:string;recipient:string;subject:string;message:string;sent:string;item?:unknown;quantity?:number}
/** The read marks the settings key keeps; 2000 mail ids are about 70 KB. */
export const SEEN_IDS_KEPT = 2000;
export interface MailboxState {settings:{autoCollect:boolean;autoDelete:boolean};seenIds:string[];outbox:SentMailRecord[]}
export function initialMailbox(value:unknown):MailboxState {
  const saved=requestObject(value),settings=requestObject(saved.settings);
  return {settings:{autoCollect:settings.autoCollect===true,autoDelete:settings.autoDelete===true},
    seenIds:Array.isArray(saved.seenIds)?saved.seenIds.filter((id):id is string=>typeof id==='string'):[],
    outbox:Array.isArray(saved.outbox)?saved.outbox.flatMap(raw=>{const m=requestObject(raw);return typeof m.id==='string'&&typeof m.recipient==='string'&&typeof m.subject==='string'&&typeof m.message==='string'&&typeof m.sent==='string'?[{id:m.id,recipient:m.recipient,subject:m.subject,message:m.message,sent:m.sent,...(m.item?{item:m.item}:{}),...(typeof m.quantity==='number'?{quantity:m.quantity}:{})}]:[];}):[]};
}
/** Account observations decide collection/deletion; local history never recalls native mail. */
export function createMailbox(inner:MailInbox,state:{mailbox?:MailboxState},ports:{now():number;persist():void;collecting(id:string):boolean}):MailInbox {
  const saved=state.mailbox ||= initialMailbox(undefined);
  let flight:Promise<unknown>|undefined;
  const failures=new Map<string,{id:string;action:'collect'|'delete';error:string}>();
  const retryAt=new Map<string,number>();
  const messages=()=>{const inbox=requestObject(inner.snapshot());return (Array.isArray(inbox.messages)?inbox.messages:[]).map(requestObject);};
  function snapshot(){
    const inbox=requestObject(inner.snapshot()),seen=new Set(saved.seenIds),automationErrors=[...failures.values()];
    return {...inbox,automationError:automationErrors.length?automationErrors.map(failure=>
      `Automatic mail ${failure.action==='delete'?'deletion':'collection'} failed (${failure.id}): ${failure.error}`).join('; '):null,
      automationErrors,settings:{...saved.settings},outbox:saved.outbox.map(m=>({...m})),newCount:messages().filter(m=>typeof m.id==='string'&&!seen.has(m.id)).length};
  }
  async function automate(id:string,action:'collect'|'delete'){
    const key=action+':'+id;
    if(ports.now()<(retryAt.get(key)||0))return;
    retryAt.set(key,ports.now()+30000);
    try{
      if(action==='collect')await inner.collect(id);
      else await inner.remove(id);
      failures.delete(key);
      if(action==='delete')retryAt.delete(key);
    }catch(error){
      failures.set(key,{id,action,error:String(requestObject(error).message||error)});
    }
  }
  function actionStillDue(mail: Record<string, unknown> | undefined, action: 'collect' | 'delete'): boolean {
    if (!mail?.item) return false;
    return action === 'delete' ? saved.settings.autoDelete && mail.taken === true : saved.settings.autoCollect && mail.taken === false;
  }
  function retireFailures(current: Record<string, unknown>[]): void {
    for(const [key,failure] of failures){
      if (!actionStillDue(current.find(mail=>mail.id===failure.id), failure.action)) {
        failures.delete(key);retryAt.delete(key);
      }
    }
  }
  function collectionPhase(mail: Record<string, unknown>, phase: string): boolean {
    return !mail.collection || mail.collection === phase;
  }
  async function automateMail(mail: Record<string, unknown>): Promise<void> {
    if(typeof mail.id!=='string'||!mail.item||ports.collecting(mail.id))return;
    if(saved.settings.autoCollect&&mail.taken===false&&collectionPhase(mail,'failed'))await automate(mail.id,'collect');
    else if(saved.settings.autoDelete&&mail.taken===true&&collectionPhase(mail,'collected'))await automate(mail.id,'delete');
  }
  async function refresh(){
    if(flight)return flight;
    flight=(async()=>{
      await inner.refresh();
      const current=messages();
      const ids=new Set(current.map(mail=>mail.id));
      for(const key of retryAt.keys())if(!ids.has(key.slice(key.indexOf(':')+1)))retryAt.delete(key);
      // Errors describe an action still due, independently of listing freshness.
      retireFailures(current);
      for(const mail of current)await automateMail(mail);
      return snapshot();
    })();
    try{return await flight;}finally{flight=undefined;}
  }
  return {snapshot,refresh,collect:async id=>{await inner.collect(id);failures.delete('collect:'+id);return snapshot();},remove:async id=>{await inner.remove(id);failures.delete('delete:'+id);retryAt.delete('delete:'+id);return snapshot();},
    complete(id,success,error){inner.complete(id,success,error);void refresh().catch(()=>{});},
    async configure(input){const settings=requestObject(input);if(typeof settings.autoCollect!=='boolean'||typeof settings.autoDelete!=='boolean')throw Error('Choose both mailbox automation settings');saved.settings={autoCollect:settings.autoCollect,autoDelete:settings.autoDelete};ports.persist();return refresh();},
    // seenIds only marks listed mail as read. It keeps the newest SEEN_IDS_KEPT ids, so the settings key stops growing with each mail received.
    seen(){saved.seenIds=[...new Set([...saved.seenIds,...messages().flatMap(m=>typeof m.id==='string'?[m.id]:[])])].slice(-SEEN_IDS_KEPT);ports.persist();return snapshot();},
    removeSent(id){saved.outbox=saved.outbox.filter(m=>m.id!==id);ports.persist();return snapshot();},
    sent(id,input){const mail=requestObject(input);if(saved.outbox.some(m=>m.id===id)||typeof mail.recipient!=='string'||typeof mail.subject!=='string'||typeof mail.message!=='string')return;
      const source=requestObject(mail.source);saved.outbox.unshift({id,recipient:mail.recipient,subject:mail.subject,message:mail.message,sent:new Date(ports.now()).toISOString(),...(source.item?{item:structuredClone(source.item)}:{}),...(typeof mail.quantity==='number'?{quantity:mail.quantity}:{})});ports.persist();}
  };
}
