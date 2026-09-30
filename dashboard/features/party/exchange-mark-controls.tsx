'use client';
import { Landmark, Store, Swords, DollarSign } from 'lucide-react';
import { AutoActionIcon } from './auto-action-icon';
import { Button } from '@/components/ui/button';
export type ExchangeMarkMode = { action: 'bank' | 'stand' | 'npc' | 'upgrade'; targetLevel?: number };
export function ExchangeMarkControls({ enabled, mode, saving, onMode }: {
  enabled: boolean; mode: ExchangeMarkMode | null; saving: boolean; onMode: (mode: ExchangeMarkMode) => void;
}) {
  return <div className="flex flex-wrap items-center gap-2">
    <>
      {(['bank', 'stand', 'upgrade', 'npc'] as const).map(action => <Button key={action}
        disabled={!enabled || saving}
        aria-pressed={mode?.action === action}
        onClick={() => onMode({ action, ...(action === 'upgrade' ? { targetLevel: mode?.targetLevel || 1 } : {}) })}
        className={`border bg-slate-950 hover:bg-slate-800 ${!enabled || mode && mode.action !== action ? 'border-slate-700 text-slate-500' : `text-white ${action === 'bank' ? 'border-yellow-400' : action === 'stand' ? 'border-sky-400' : action === 'upgrade' ? 'border-violet-400' : 'border-rose-400'}`}`}>
        <AutoActionIcon>{action === 'bank' ? <Landmark /> : action === 'stand' ? <Store /> : action === 'upgrade' ? <Swords /> : <DollarSign />}</AutoActionIcon>
        {action === 'npc' ? 'NPC' : action[0].toUpperCase() + action.slice(1)}
      </Button>)}
      {enabled && mode?.action === 'upgrade' && <label className="flex items-center gap-2 text-xs text-violet-100">Target level
        <select aria-label="Bulk upgrade target level" value={mode.targetLevel} onChange={event => onMode({ action: 'upgrade', targetLevel: Number(event.target.value) })}
          className="rounded border border-violet-400 bg-slate-950 p-2 text-white">
          {Array.from({ length: 13 }, (_, index) => index + 1).map(level => <option key={level} value={level}>+{level}</option>)}
        </select>
      </label>}

    </>
  </div>;
}
