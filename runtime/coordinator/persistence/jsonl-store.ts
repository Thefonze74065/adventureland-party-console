import * as fs from 'node:fs';
import type {CoordinatorFileStore} from '../infrastructure/platform-contracts.ts';

/** "pid starttime bootid" on Linux; just the PID where /proc is unavailable. */
function writerIdentity(pid:number):string {
  try {
    const stat=fs.readFileSync('/proc/'+pid+'/stat','utf8');
    // Field 22 (starttime) counts from boot; the command name in field 2 may contain spaces or parentheses.
    const start=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
    const boot=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
    if(start && boot)return pid+' '+start+' '+boot;
  } catch {}
  return String(pid);
}

/** Compatible JSONL store: replay one record at a time, never the entire journal. */
export class CoordinatorJsonlStore implements CoordinatorFileStore {
  private values = new Map<string,unknown>();
  private handle: number | undefined;
  private lock: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private bytes = 0;
  private compactRetryAt = 0;
  private closed = false;
  private lockPath: string;
  private mainPath:string;
  private replacementPath:string;
  constructor(mainPath='garage.jsonl',replacementPath='garage.new.jsonl',interval=30000) {
    this.mainPath=mainPath;this.replacementPath=replacementPath;
    if(mainPath===replacementPath)throw new Error('Storage main and replacement paths must differ');
    this.lockPath=mainPath+'.writer.lock';
    this.acquire();
    try {
      if(!fs.existsSync(mainPath) && fs.existsSync(replacementPath))fs.renameSync(replacementPath,mainPath);
      this.handle=fs.openSync(mainPath,'a+');
      this.replay();
      this.refactor();
      this.timer=setInterval(()=>this.refactor(),interval);
      this.timer.unref();
    } catch(error) {this.close();throw error;}
  }
  private acquire():void {
    try {this.lock=fs.openSync(this.lockPath,'wx');}
    catch(error) {
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      if(this.alive(fs.readFileSync(this.lockPath,'utf8')))throw new Error('Storage already has a live writer: '+this.mainPath);
      fs.unlinkSync(this.lockPath);
      this.lock=fs.openSync(this.lockPath,'wx');
    }
    fs.writeFileSync(this.lock,writerIdentity(process.pid));
  }
  /** A PID alone is not proof: after a reboot or container restart the stale lock's PID can belong to another process. */
  private alive(owner:string):boolean {
    const [pid,start,boot]=owner.trim().split(' ');
    const id=Number(pid);
    if(!Number.isSafeInteger(id) || id<=0)return false;
    try {process.kill(id,0);}
    catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;}
    // Locks written before identities were recorded, or on platforms without /proc, fall back to the PID.
    if(start===undefined)return true;
    const current=writerIdentity(id).split(' ');
    return current.length<3 || current[1]===start && current[2]===boot;
  }
  private replay():void {
    const chunk=Buffer.allocUnsafe(64*1024);
    let fragments:Buffer[]=[];
    for(;;) {
      const count=fs.readSync(this.handle!,chunk,0,chunk.length,null);
      if(!count)break;
      let start=0;
      for(let i=0;i<count;i++)if(chunk[i]===10) {
        fragments.push(Buffer.from(chunk.subarray(start,i)));
        this.record(Buffer.concat(fragments).toString('utf8'));
        fragments=[];start=i+1;
      }
      if(start<count)fragments.push(Buffer.from(chunk.subarray(start,count)));
    }
    if(fragments.length)this.record(Buffer.concat(fragments).toString('utf8'));
  }
  private record(line:string):void {
    if(!line.trim())return;
    const entry=Object.entries(JSON.parse(line) as Record<string,unknown>)[0];
    if(!entry)throw new Error('Empty storage record');
    const [key,value]=entry;
    if(value===null)this.values.delete(key);else this.values.set(key,value);
  }
  refactor():void {
    if(this.closed || Date.now()<this.compactRetryAt)return;
    const replacement=fs.openSync(this.replacementPath,'w');
    let bytes=0;
    try {
      for(const [key,value] of this.values) {
        const record=JSON.stringify({[key]:value})+'\n';
        fs.writeFileSync(replacement,record);bytes+=Buffer.byteLength(record);
      }
      fs.fsyncSync(replacement);
    } finally {fs.closeSync(replacement);}
    fs.closeSync(this.handle!);this.handle=undefined;
    try {fs.renameSync(this.replacementPath,this.mainPath);this.bytes=bytes;this.compactRetryAt=0;}
    catch(error) {this.deferCompaction(error);}
    finally {this.handle=fs.openSync(this.mainPath,'a+');}
  }
  private deferCompaction(error:unknown):void {
    const code=(error as NodeJS.ErrnoException).code;
    if(!['EPERM','EACCES','EBUSY'].includes(code || ''))throw error;
    // The append journal remains authoritative. Do not turn a Windows sharing
    // conflict during optional compaction into a failed, already-written request.
    this.compactRetryAt=Date.now()+30000;
    console.warn('Coordinator journal compaction deferred for 30 seconds: '+code);
  }
  private append(key:string,value:unknown):void {
    if(this.closed)throw new Error('Storage is closed');
    const record=JSON.stringify({[key]:value})+'\n';
    fs.writeFileSync(this.handle!,record);this.bytes+=Buffer.byteLength(record);
  }
  private compactIfNeeded():void {
    // Bound append history even if a busy event loop delays the periodic timer.
    if(this.bytes>=128*1024*1024)this.refactor();
  }
  get(key:string):unknown {return this.values.get(key);}
  set(key:string,value:unknown):this {
    if(this.get(key)===value)return this;
    this.append(key,value);
    if(value===null)this.values.delete(key);else this.values.set(key,value);
    this.compactIfNeeded();return this;
  }
  delete(key:string):boolean {
    if(!this.values.has(key))return false;
    this.append(key,null);const removed=this.values.delete(key);
    this.compactIfNeeded();return removed;
  }
  entries():IterableIterator<[string,unknown]> {return this.values.entries();}
  close():void {
    if(this.closed)return;
    this.closed=true;clearInterval(this.timer);
    if(this.handle!==undefined)fs.closeSync(this.handle);
    if(this.lock!==undefined){fs.closeSync(this.lock);fs.unlinkSync(this.lockPath);}
  }
}
