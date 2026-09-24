'use client';
import { memo, useRef, useState } from 'react';
import { LogOut, Monitor, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { ActiveSlot } from './active-slot';

export const CharacterSessionControls = memo(function CharacterSessionControls({
  name,
  slot,
  primaryCharacter,
  pending,
  onLogout,
  onHeadless,
  onSteam,
}: {
  name: string;
  slot?: ActiveSlot;
  primaryCharacter: string | null;
  pending: boolean;
  onLogout: (slot: number) => Promise<void>;
  onHeadless: (name: string) => Promise<void>;
  onSteam: (name: string, action: 'login' | 'primary') => Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState<{
    action: 'logout' | 'headless' | 'steam';
    slot: number;
    kind: string;
    state: string;
    primary: string | null;
    isPrimary: boolean;
    name: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const native = slot?.kind === 'native';
  const disabled = !slot || pending || busy;
  const changed =
    !slot ||
    slot.index !== confirmation?.slot ||
    slot.kind !== confirmation?.kind ||
    slot.state !== confirmation?.state ||
    primaryCharacter !== confirmation?.primary ||
    !!slot.primary !== confirmation?.isPrimary ||
    name !== confirmation?.name;
  const ask = (action: 'logout' | 'headless' | 'steam') => {
    if (slot && !disabled) {
      setError(null);
      setConfirmation({
        action,
        slot: slot.index,
        kind: slot.kind,
        state: slot.state,
        primary: primaryCharacter,
        isPrimary: !!slot.primary,
        name,
      });
    }
  };
  const action = confirmation?.action;
  const destination = native
    ? 'Become Steam primary'
    : primaryCharacter
      ? 'Join Steam in the background'
      : 'Join Steam as primary';
  const [error, setError] = useState<string | null>(null);
  const label =
    action === 'logout'
      ? `Log out ${name}?`
      : action === 'headless'
        ? `Run ${name} headless?`
        : `${destination}: ${name}?`;
  const base = 'rounded border p-1.5 disabled:opacity-40';
  const inactive =
    'border-emerald-800 bg-[#07100f] text-slate-300 hover:border-cyan-400 hover:bg-[#16352b] hover:text-white';
  const active =
    'border-cyan-300 bg-[#164e63] text-white ring-1 ring-cyan-400 hover:border-cyan-100 hover:bg-[#155e75] hover:text-white';
  return (
    <>
      <div
        className="flex shrink-0 items-center gap-1"
        aria-label={`${name} session controls`}
      >
        <button
          type="button"
          disabled={disabled}
          aria-pressed={native}
          aria-label={
            slot?.primary
              ? `${name} is Steam primary`
              : `${destination}: ${name}`
          }
          title={
            native ? 'Currently in Steam · click to go headless' : destination
          }
          onClick={() => {
            if (!slot?.primary) ask('steam');
          }}
          className={`${base} ${slot?.primary ? 'border-green-400 bg-[#12351c] text-green-200 hover:border-green-300 hover:bg-[#12351c] hover:text-green-100' : native ? 'border-teal-400 bg-[#103a38] text-teal-100 hover:border-teal-200 hover:bg-[#16504b] hover:text-white' : inactive}`}
        >
          <Monitor className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={!!slot && !native}
          aria-label={`Run ${name} headless`}
          title={
            native
              ? 'Go headless · log out of Steam and keep running'
              : 'Currently headless'
          }
          onClick={() => {
            if (native) ask('headless');
          }}
          className={`${base} ${slot && !native ? active : inactive}`}
        >
          <Server className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Log out ${name}`}
          title="Log out character"
          onClick={() => ask('logout')}
          className={`${base} border-emerald-800 bg-[#07100f] text-emerald-100 hover:border-rose-500 hover:bg-[#32151c] hover:text-rose-200`}
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null);
        }}
      >
        <DialogContent
          showCloseButton={false}
          initialFocus={cancel}
          className="border border-emerald-700 bg-[#07100f] text-emerald-50"
        >
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription className="text-slate-200">
            {action === 'logout'
              ? 'This stops the character and its automation. It will not continue running headless.'
              : action === 'headless'
                ? 'This logs the character out of Steam and keeps it running through caracAL.'
                : native
                  ? `${name} will become the primary Steam view. Other Steam characters briefly reconnect, then continue in Steam.`
                  : primaryCharacter
                    ? `${name} will join Steam in the background. ${primaryCharacter} remains primary.`
                    : `${name} will join Steam as the primary view.`}
          </DialogDescription>
          {changed && (
            <p className="text-amber-200">
              The character&apos;s session or Steam primary changed. Cancel and
              choose the action again.
            </p>
          )}
          {error && (
            <p role="alert" className="text-rose-200">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              ref={cancel}
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmation(null)}
              className="border-slate-600 bg-[#111c19] text-slate-100 hover:bg-[#263c34] hover:text-white"
            >
              Cancel
            </Button>
            <Button
              disabled={disabled || changed}
              onClick={async () => {
                if (
                  !confirmation ||
                  !slot ||
                  disabled ||
                  changed ||
                  submitting.current
                )
                  return;
                submitting.current = true;
                setBusy(true);
                setError(null);
                try {
                  if (action === 'logout') await onLogout(slot.index);
                  else if (action === 'headless') await onHeadless(name);
                  else await onSteam(name, native ? 'primary' : 'login');
                  setConfirmation(null);
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : 'Steam request failed',
                  );
                } finally {
                  submitting.current = false;
                  setBusy(false);
                }
              }}
              className="border border-cyan-400 bg-[#164e63] text-white hover:bg-[#155e75] hover:text-white"
            >
              {busy
                ? 'Working…'
                : action === 'logout'
                  ? 'Log out'
                  : action === 'headless'
                    ? 'Go headless'
                    : destination}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
});
