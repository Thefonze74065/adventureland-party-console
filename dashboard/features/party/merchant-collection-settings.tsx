"use client";
import { BankSortControl, type BankSortState } from "./bank-sort-control";
import { BuyUpgradeBatchSetting } from "./buy-upgrade-batch-setting";
import { MerchantStandLocationSetting } from './merchant-stand-location-setting';
import { DeliveryTripSetting } from "./delivery-trip-setting";
import { WithdrawalTripSetting } from "./withdrawal-trip-setting";
import { useState } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
export interface MerchantCollectionSettingsProps {
  buyUpgradeBatchSize?: number;
  merchantStandLocation?: import('../../../runtime/coordinator/merchant/stand-location').MerchantStandLocation | null;
  bankSortState?: BankSortState;
  deliveryTripsEnabled?: boolean;
  withdrawalTripsEnabled?: boolean;
  thresholdError?: string | null;
  itemCollectionThresholdError?: string | null;
  onClearErrors: () => void;
  threshold: string;
  onThresholdChange(value: string): void;
  onThresholdSave(): Promise<void>;
  itemCollectionThreshold: string;
  onItemCollectionThresholdChange(value: string): void;
  onItemCollectionThresholdSave(): Promise<void>;
}
export function MerchantCollectionSettings({buyUpgradeBatchSize, merchantStandLocation, deliveryTripsEnabled = true, withdrawalTripsEnabled = true, thresholdError, itemCollectionThresholdError, onClearErrors, bankSortState = {},threshold,onThresholdChange,onThresholdSave,itemCollectionThreshold,onItemCollectionThresholdChange,onItemCollectionThresholdSave}: MerchantCollectionSettingsProps) {
 const [open,setOpen]=useState(false);
 return <>
  <Button variant="outline" onClick={()=>setOpen(true)} className="h-9 border-slate-600 bg-[#07100f] text-xs text-slate-100 hover:bg-slate-800 hover:text-white"><Settings className="mr-1.5 size-3.5" />Settings</Button>
  <Dialog open={open} onOpenChange={open => { onClearErrors(); setOpen(open); }}>
   <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto border-slate-600 bg-slate-950 text-slate-100 sm:max-w-2xl">
    <DialogHeader><DialogTitle>Merchant settings</DialogTitle></DialogHeader>
          <BankSortControl state={bankSortState} settings />
          <BuyUpgradeBatchSetting value={buyUpgradeBatchSize} />
          <MerchantStandLocationSetting location={merchantStandLocation} />
          <DeliveryTripSetting enabled={deliveryTripsEnabled} />
          <WithdrawalTripSetting enabled={withdrawalTripsEnabled} />
          <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-lg border border-emerald-900/80 bg-slate-900 p-4">
            <p className="font-mono text-xs uppercase tracking-wider text-emerald-400">
              Automatic gold collection
            </p>
            <p className="mt-1 text-xs text-slate-300">
              Send the merchant when any active character carries more than this amount.
            </p>
            <div className="mt-3 flex items-end gap-2">
              <label
                htmlFor="merchant-gold-threshold"
                className="grid min-w-0 flex-1 gap-1.5 font-mono text-xs text-emerald-200"
              >
                Collect above
                <Input
                  id="merchant-gold-threshold"
                  inputMode="numeric"
                  value={threshold}
                  onChange={(event) => onThresholdChange(event.target.value.replace(/[^0-9]/g, ""))}
                  className="border-emerald-800 bg-slate-950 font-mono text-slate-100"
                />
              </label>
              <Button
                type="button"
                onClick={() => void onThresholdSave()}
                className="border border-emerald-400 bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
              >
                Apply
              </Button>
            </div>
            {thresholdError && <p role="alert" className="text-sm text-rose-200">{thresholdError}</p>}
          </section>
          <section className="rounded-lg border border-violet-900/80 bg-slate-900 p-4">
            <p className="font-mono text-xs uppercase tracking-wider text-violet-300">
              Automatic item collection
            </p>
            <p className="mt-1 text-xs text-slate-300">
              Start a collection trip when one party member has this many marked inventory slots.
              Smaller pickups run only while the merchant is within 200 units. Queued pickups and
              retries recheck this rule. NPC-sale marks count toward this threshold. Manual visits and other merchant jobs still collect
              immediately.
            </p>
            <div className="mt-3 flex items-end gap-2">
              <label
                htmlFor="item-collection-threshold"
                className="grid min-w-0 flex-1 gap-1.5 font-mono text-xs text-violet-200"
              >
                Marked slots required
                <Input
                  id="item-collection-threshold"
                  inputMode="numeric"
                  value={itemCollectionThreshold}
                  onChange={(event) =>
                    onItemCollectionThresholdChange(event.target.value.replace(/[^0-9]/g, ""))
                  }
                  className="border-violet-800 bg-slate-950 font-mono text-slate-100"
                />
              </label>
              <Button
                type="button"
                onClick={() => void onItemCollectionThresholdSave()}
                className="border border-violet-400 bg-violet-500 text-black hover:bg-violet-400"
              >
                Apply
              </Button>
            </div>
            {itemCollectionThresholdError && <p role="alert" className="text-sm text-rose-200">{itemCollectionThresholdError}</p>}
          </section>
          </div>
</DialogContent></Dialog></>;
}
