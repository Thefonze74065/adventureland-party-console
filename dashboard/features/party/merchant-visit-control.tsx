"use client";
import { useRef, useState } from "react";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useClock } from "@/hooks/use-clock";
import { usePartyAction } from "./query-actions";
import type { Char } from "./char";

export function MerchantVisitControl({ characters, merchant }: { characters: Char[]; merchant?: string | null }) {
  const [open, setOpen] = useState(false), [message, setMessage] = useState("");
  const action = usePartyAction(), now = useClock(), submitting = useRef(false);
  const eligible = characters.filter(char => char.name !== merchant && char.ctype !== "merchant" && char.seenAt > 0 && now - char.seenAt < 10000);
  async function visit(name: string) {
    if (submitting.current) return;
    submitting.current = true;
    setMessage("");
    try {
      await action.mutateAsync({ path: "/command", body: { character: name, type: "bank" } });
      setMessage(name === merchant ? 'Bank visit queued' : `Merchant visit queued for ${name}`);
      setOpen(false);
    } finally { submitting.current = false; }
  }
  return <>
    <Button variant="outline" onClick={() => { action.reset(); setOpen(true); }} className="h-9 w-full justify-start border-amber-700 bg-[#071719] text-xs text-amber-100 hover:border-amber-400 hover:bg-amber-950 hover:text-white">
      <Truck className="mr-2 h-4 w-4" />Send merchant to…
    </Button>
    {message && <p role="status" className="text-xs text-amber-100">{message}</p>}
    <Dialog open={open} onOpenChange={value => { if (!action.isPending) setOpen(value); }}>
      <DialogContent className="border-amber-700 bg-[#081713] text-emerald-50">
        <DialogHeader><DialogTitle>Send merchant to</DialogTitle></DialogHeader>
        <div className="grid gap-2">
          {merchant && <Button disabled={action.isPending} onClick={() => void visit(merchant).catch(() => {})} className="justify-start border border-amber-700 bg-[#071719] text-amber-100 hover:border-amber-400 hover:bg-amber-950 hover:text-white">Visit bank</Button>}
          {eligible.map(char => <Button key={char.name} disabled={action.isPending} onClick={() => void visit(char.name).catch(() => {})} className="justify-start border border-amber-700 bg-[#071719] text-amber-100 hover:bg-amber-950 hover:text-white">{char.name}</Button>)}
          {!eligible.length && <p>No other characters are online.</p>}
        </div>
        {action.isPending && <p role="status">Queuing visit…</p>}
        {action.error && <p role="alert" className="text-rose-200">{action.error.message}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
