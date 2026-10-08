import * as fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import type {CoordinatorFileStore} from '../infrastructure/platform-contracts.ts';
import {processLockActive, processLockIdentity} from './process-lock.ts';

/** Compatible JSONL store: replay one record at a time, never the entire journal. */
export class CoordinatorJsonlStore implements CoordinatorFileStore {
  private values = new Map<string,unknown>();
  private handle: number | undefined;
  private lock: number | undefined;
  private guard: number | undefined;
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
    try {
      this.acquire();
      if(!fs.existsSync(mainPath) && fs.existsSync(replacementPath))fs.renameSync(replacementPath,mainPath);
      this.handle=fs.openSync(mainPath,'a+');
      this.replay();
      this.refactor();
      this.timer=setInterval(()=>this.refactor(),interval);
      this.timer.unref();
    } catch(error) {this.close();throw error;}
  }
  private acquire():void {
    if (process.platform === 'linux') this.acquireGuard();
    const identity = JSON.stringify({...processLockIdentity(), ...(this.guard !== undefined ? {advisory:true} : {})});
    try {this.lock=fs.openSync(this.lockPath,'wx');}
    catch(error) {
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      const owner=fs.readFileSync(this.lockPath,'utf8');
      if(processLockActive(owner, this.guard !== undefined))throw new Error('Storage already has a live writer: '+this.mainPath);
      fs.unlinkSync(this.lockPath);
      this.lock=fs.openSync(this.lockPath,'wx');
    }
    fs.writeFileSync(this.lock,identity);
    fs.fsyncSync(this.lock);
  }
  private acquireGuard():void {
    // flock attaches to the inherited open file description. The parent keeps
    // that description after the helper exits; close/crash releases ownership.
    // Never unlink this inode: another writer may already have opened it.
    this.guard = fs.openSync(this.lockPath.replace(/\.lock$/, '.guard'), 'a+');
    const result = spawnSync('flock', ['--exclusive', '--nonblock', '3'], {
      stdio: ['ignore', 'pipe', 'pipe', this.guard], timeout: 5000,
    });
    if (result.error) throw new Error('Storage requires Linux flock: '+result.error.message);
    if (result.status === 1) throw new Error('Storage already has a live writer: '+this.mainPath);
    if (result.status !== 0) throw new Error('Storage advisory ownership is unverifiable: '+result.stderr.toString());
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
    if(this.guard!==undefined)fs.closeSync(this.guard);
  }
}
