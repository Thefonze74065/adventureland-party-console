import { requestObject } from '../http/contracts.ts';
import { sameMarkedItem } from './item-identity.ts';

/** A bank pass becomes eligible only after native withdrawal confirms its source. */
export function receiveBankUpgrades(state: { upgrades: Record<string, unknown[] | undefined>; merchantCharacter?: string | null }, name: string | null, receipts: unknown): void {
  if (!name || name !== state.merchantCharacter || !Array.isArray(receipts)) return;
  for (const raw of state.upgrades[name] || []) {
    const mark = requestObject(raw), storage = requestObject(mark.storage), item = requestObject(mark.item);
    if (!mark.storage) continue;
    if (receipts.some(raw => {
      const receipt = requestObject(raw), received = requestObject(receipt.item);
      return receipt.pack === storage.pack && receipt.slot === storage.slot && sameMarkedItem(item, received) && sameMarkedItem(received, item);
    })) mark.storageReceived = true;
  }
}
