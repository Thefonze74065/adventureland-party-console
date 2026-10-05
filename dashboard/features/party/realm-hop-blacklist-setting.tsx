"use client";
import type { RealmOption } from './realm-option';
import { usePartyAction } from './query-actions';

const realmLabel = (realm: string) => realm.replace(/^SR_/, '').replace(/(US|EU|ASIA)/, '$1 ');

/** Realms boss chase and daily-event chase never hop to. Manual realm changes are unaffected. */
export function RealmHopBlacklistSetting({ realms, blacklist }: { realms: RealmOption[]; blacklist?: string[] }) {
  const action = usePartyAction();
  const saved = blacklist || [];
  const toggle = (realm: string, blocked: boolean) => {
    action.reset();
    action.mutate({ path: '/realm/hop-blacklist',
      body: { realms: blocked ? [...saved, realm] : saved.filter(entry => entry !== realm) } });
  };
  return <fieldset disabled={action.isPending} className="mt-4 space-y-2 rounded border border-violet-800 bg-[#0b0d14] p-3 text-sm text-slate-100">
    <legend className="sr-only">Realm hopping blacklist</legend>
    <div>
      <p className="font-semibold text-violet-100">Never hop to these realms</p>
      <p className="text-xs text-slate-300">Boss chase and event prediction skip checked realms, e.g. ones whose ping cripples DPS. Changing realm by hand still works. PVP realms are always skipped.</p>
    </div>
    {realms.length ? <ul className="grid gap-1 text-xs sm:grid-cols-2">
      {realms.map(realm => {
        const blocked = realm.pvp || saved.includes(realm.key);
        return <li key={realm.key}>
          <label className="flex items-center gap-2 rounded border border-slate-700 bg-black px-2 py-1 text-slate-100">
            <input type="checkbox" className="accent-violet-500" checked={blocked} disabled={realm.pvp}
              aria-label={`Never hop to ${realmLabel(realm.key)}`} onChange={event => toggle(realm.key, event.target.checked)} />
            <span className="flex-1">{realmLabel(realm.key)}</span>
            <span className="font-mono text-slate-400">{realm.pvp ? 'PVP · always skipped' : `${realm.players} players`}</span>
          </label>
        </li>;
      })}
    </ul> : <p className="text-xs text-slate-400">Waiting for the realm list…</p>}
    {action.error && <p role="alert" className="text-xs text-rose-200">{action.error.message}</p>}
  </fieldset>;
}
