"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { domainOptions, useVisible } from './query-cache';
import { logFilters, defaultLogFilters, showGameLog, classifyGameLog } from '../../../runtime/game-log-filters';
import type { PartyState } from './party-state';
export function LogSidebar({state,width,onWidth,onClose}:{state:PartyState;width:number;onWidth:(n:number)=>void;onClose:()=>void}){
  const client=useQueryClient(),visible=useVisible();
  const query=useQuery({...domainOptions(client,'logs'),enabled:visible,refetchInterval:1000});
  const [tab,setTab]=useState<'game'|'dashboard'>('game'),[character,setCharacter]=useState('all'),[source,setSource]=useState('all');
  const [filters,setFilters]=useState<Record<string,boolean>>({...defaultLogFilters});
  const scroller=useRef<HTMLDivElement>(null),following=useRef(true);
  useEffect(()=>{try{setFilters({...defaultLogFilters,...JSON.parse(localStorage.getItem('party-log-filters')||'{}')});}catch{}},[]);
  const gameLogs=query.data?.gameLogs,combatLogs=query.data?.combatLogs,merchantActivity=query.data?.merchantActivity;
  const game=useMemo(()=>Object.entries(gameLogs||{}).flatMap(([name,events])=>events.map(e=>({...e,category:classifyGameLog(e.message),name,source:'game',key:name+e.session+e.seq}))),[gameLogs]);
  const combat=useMemo(()=>Object.entries(combatLogs||{}).flatMap(([name,events])=>events.map((e,i)=>({at:e.at,message:e.message,name,source:'combat',category:e.type,key:`combat:${name}:${e.at}:${i}`,color:''}))),[combatLogs]);
  const merchant=useMemo(()=>(merchantActivity||[]).map((e,i)=>({at:e.at,message:e.message,name:state.merchantCharacter||'',source:'merchant',category:e.level,key:`merchant:${e.at}:${i}`,color:''})),[merchantActivity,state.merchantCharacter]);
  const anniversary=useMemo(()=>(state.anniversary?.activity||[]).map((e,i)=>({at:e.at,message:e.message,name:'',source:'anniversary',category:e.level,key:`anniversary:${e.at}:${i}`,color:''})),[state.anniversary]);
  const entries=useMemo(()=>(tab==='game'?game:[...combat,...merchant,...anniversary]).filter(e=>(character==='all'||e.name===character)&&(tab==='game'?showGameLog(e.category||'other',filters):source==='all'||source===e.source)).sort((a,b)=>a.at-b.at).slice(-1000),[tab,game,combat,merchant,anniversary,character,source,filters]);
  useEffect(()=>{if(following.current && scroller.current)scroller.current.scrollTop=scroller.current.scrollHeight;},[entries]);
  const names=useMemo(()=>Array.from(new Set([...Object.keys(state.characters),...Object.keys(gameLogs||{}),...(state.bankbois||[]).map(b=>b.name)])),[state.characters,gameLogs,state.bankbois]);
  const entryList=useMemo(()=>entries.map(e=><p key={e.key} className="break-words"><span className="text-slate-500">{new Date(e.at).toLocaleTimeString()} {e.name ? `[${e.name}]` : `[${e.source}]`} </span><span style={{color: /^#[0-9a-f]{3,8}$/i.test(e.color)?e.color:undefined}} className={e.category==='errors'||e.category==='error'?'text-rose-300':'text-slate-100'}>{e.message}</span></p>),[entries]);
  const button='rounded border border-slate-500 bg-slate-950 px-2 py-1 text-sm text-slate-100 hover:bg-slate-700';
  return <aside aria-label="Live logs" className="fixed bottom-0 right-0 top-0 z-40 flex flex-col border-l border-slate-500 bg-slate-950 text-slate-100 shadow-xl" style={{width,maxWidth:'75vw'}}>
    <div role="separator" aria-label="Resize logs" aria-orientation="vertical" tabIndex={0} className="absolute -left-1 top-0 h-full w-2 cursor-col-resize touch-none hover:bg-cyan-600/40" onPointerDown={e=>e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))onWidth(Math.max(260,Math.min(window.innerWidth*.75,window.innerWidth-e.clientX)));}} onKeyDown={e=>{if(e.key==='ArrowLeft')onWidth(width+20);if(e.key==='ArrowRight')onWidth(Math.max(260,width-20));}} />
    <div className="flex items-center justify-between p-3"><h2 className="font-semibold">Live logs</h2><button aria-label="Close logs" className={button} onClick={onClose}><X className="size-4" /></button></div>
    <div role="tablist" className="flex gap-2 px-3">{(['game','dashboard'] as const).map(t=><button key={t} role="tab" aria-selected={tab===t} className={button+(tab===t?' border-cyan-300 bg-cyan-950':'')} onClick={()=>setTab(t)}>{t==='game'?'Game logs':'Dashboard logs'}</button>)}</div>
    <div className="flex flex-wrap gap-1 p-3">{tab==='game'?logFilters.map(f=><button key={f.id} aria-pressed={filters[f.id]} className={button+(!filters[f.id]?' text-slate-500':' border-cyan-700')} onClick={()=>{const next={...filters,[f.id]:!filters[f.id]};setFilters(next);localStorage.setItem('party-log-filters',JSON.stringify(next));}}>{f.label}</button>):<select aria-label="Dashboard log source" value={source} onChange={e=>setSource(e.target.value)} className={button}><option value="all">All sources</option><option value="combat">Combat</option><option value="merchant">Merchant / coordinator</option><option value="anniversary">Anniversary</option></select>}</div>
    <select aria-label="Log character" className={'mx-3 '+button} value={character} onChange={e=>setCharacter(e.target.value)}><option value="all">All characters</option>{names.map(n=><option key={n}>{n}</option>)}</select>
    <p className="px-3 py-2 text-xs text-slate-400">{query.isError?'Disconnected — showing retained logs':character!=='all' && Date.now()-(state.characters[character]?.seenAt||0)>15000?'Character offline — showing retained logs':'Live updates · latest 1,000 matching entries'}</p>
    <div ref={scroller} onScroll={e=>{const el=e.currentTarget;following.current=el.scrollHeight-el.scrollTop-el.clientHeight<32;}} className="min-h-0 flex-1 space-y-2 overflow-auto px-3 pb-3 font-mono text-xs">{entryList}{!entries.length&&<p className="text-slate-400">No matching logs yet.</p>}</div>
  </aside>;
}
