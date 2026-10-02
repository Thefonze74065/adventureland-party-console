import type { PartyConsoleModel } from './use-party-console';
import { CharacterPortrait } from './character-portrait';
const labels = {
  loading: 'Loading in Steam',
  code: 'CODE active — waiting for Party Console',
  stopped: 'CODE stopped',
  waiting: 'Waiting for Steam status',
  lost: 'Connection lost',
  connected: 'Connected',
};
export function pendingCharacters(model: PartyConsoleModel) {
  const bankbois = new Set((model.state.bankbois || []).map((bankboi) => bankboi.name));
  if (model.state.bankboiTransaction) bankbois.add(model.state.bankboiTransaction.bankboi);
  const entries = model.state.characterConnections || [];
  const known = new Set(entries.map((entry) => entry.name));
  const waiting = (model.state.activeSlots || []).filter(
    (slot) =>
      slot.character &&
      !bankbois.has(slot.character) &&
      !known.has(slot.character) &&
      !model.chars.some((char) => char.name === slot.character),
  );
  return [
    ...entries.filter(
      (entry) =>
        !bankbois.has(entry.name) && (
          entry.status !== 'connected' ||
          !model.chars.some((char) => char.name === entry.name)
        ),
    ),
    ...waiting.map((slot) => ({
      name: slot.character!,
      primary: !!slot.primary,
      status: 'waiting' as const,
      delayed: false,
      error: undefined,
    })),
  ];
}
export function PendingCharacterCards({ model }: { model: PartyConsoleModel }) {
  return pendingCharacters(model).map((entry) => (
    <article
      key={entry.name}
      className="min-h-48 rounded border border-slate-500 bg-[#101c1a] p-5 text-slate-100"
      aria-live="polite"
    >
      <div className="relative h-20 w-14 overflow-hidden rounded border border-emerald-800 bg-[#07100f]">
        <CharacterPortrait
          html={
            model.state.characterAppearances?.[entry.name]?.characterDollHtml
          }
          sprite={
            model.state.characterAppearances?.[entry.name]?.characterSprite
          }
          skin={model.state.characterAppearances?.[entry.name]?.skin}
        />
      </div>
      <h3 className="text-lg font-semibold">{entry.name}</h3>
      <p className="text-sm text-slate-300">
        {
          model.state.roster?.find((member) => member.name === entry.name)
            ?.ctype
        }{' '}
        ·{' '}
        {model.state.activeSlots?.some(
          (slot) => slot.character === entry.name && slot.kind === 'headless',
        )
          ? 'Headless character'
          : entry.primary
            ? 'Steam primary'
            : 'Steam companion'}
      </p>
      <p className="mt-4 text-cyan-200">
        {entry.status === 'waiting'
          ? 'Waiting for your character to connect…'
          : labels[entry.status]}
      </p>
      {entry.error && <p className="mt-2 text-rose-200">{entry.error}</p>}
      {entry.delayed && (
        <p className="mt-2 text-amber-200">{entry.status === 'stopped'
          ? 'CODE is stopped. Click Engage in the game client when you want to resume.'
          : entry.status === 'lost'
            ? 'The game client stopped reporting. Check that it is open and can reach Party Console.'
            : entry.status === 'code'
              ? 'Party Console hasn’t received this character’s status yet. If it stays stuck, click Disengage, then Engage in the Steam client’s CODE window.'
              : 'Still waiting for the game client to finish loading. Check its window for a connection or loading error.'}</p>
      )}
    </article>
  ));
}
