"use client";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PartyActionError } from "./query-actions";
import type { InventoryEntry } from "./inventory-entry";
import type { PartyConsoleModel } from "./use-party-console";

type Request = { character: string; type: "withdraw"; pack: string; slot: number; item: InventoryEntry["item"]; markAll: boolean };

export function useBankWithdrawal(post: PartyConsoleModel["post"], onError: (message: string) => void) {
  const [pending, setPending] = useState<Request | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const submit = useCallback(async (request: Request, confirmed = false) => {
    if (inFlight.current) return;
    setConfirmationError(null);
    inFlight.current = true;
    setBusy(true);
    try {
      await post("/command", { ...request, removeAutoBankMark: confirmed });
      setPending(null);
    } catch (error) {
      if (!confirmed && error instanceof PartyActionError && error.details.code === "auto_bank_confirmation_required") setPending(request);
      else if (confirmed) setConfirmationError(error instanceof Error ? error.message : "Withdrawal failed");
      else onError(error instanceof Error ? error.message : "Withdrawal failed");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [post, onError]);
  const withdraw = useCallback((character: string | null | undefined, pack: string, entry: InventoryEntry, markAll = false) => {
    if (!character) return onError("No merchant is configured");
    if (pending) return;
    void submit({ character, type: "withdraw", pack, slot: entry.slot, item: { ...entry.item }, markAll });
  }, [pending, onError, submit]);
  function close() { setPending(null); setConfirmationError(null); }
  const confirmation = <Dialog open={!!pending} onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent showCloseButton={false} className="border border-emerald-800 bg-[#091614] text-emerald-50">
      <DialogHeader>
        <DialogTitle className="text-emerald-50">Remove automatic bank mark?</DialogTitle>
        <DialogDescription className="text-emerald-100">This item is automatically marked for bank. Allow withdrawal and remove mark?</DialogDescription>
      </DialogHeader>
      {confirmationError && <p role="alert" className="text-sm text-rose-200">{confirmationError}</p>}
      <DialogFooter>
        <Button disabled={busy} onClick={close} className="border border-slate-500 bg-[#101c1a] text-slate-100 hover:bg-slate-700 hover:text-white">Cancel</Button>
        <Button disabled={busy} onClick={() => { if (pending) void submit(pending, true); }} className="border border-emerald-500 bg-[#10392b] text-emerald-50 hover:bg-[#18513c] hover:text-white">{busy ? "Withdrawing…" : "Confirm"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
  return { withdraw, confirmation };
}
