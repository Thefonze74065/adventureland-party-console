import { ContextMenuItem } from '@/components/ui/context-menu';
import { BrokenStickIcon } from './broken-stick-icon';
import { canDeconstruct, type DeconstructionCatalog } from './deconstruction';
import type { InventoryEntry } from './inventory-entry';
import { AutoActionIcon } from './auto-action-icon';
export function BankDeconstructionActions({ entry, pack, merchant, catalog, onMark }: {
  entry: InventoryEntry; pack: string; merchant?: string | null; catalog: DeconstructionCatalog;
  onMark: (pack: string, entry: InventoryEntry, all: boolean, auto?: boolean) => void;
}) {
  if (!canDeconstruct(entry.item, catalog)) return null;
  return <>
    {[false, true].map(auto => <ContextMenuItem key={String(auto)} disabled={!merchant} onClick={() => onMark(pack, entry, false, auto)}>
      {auto ? <AutoActionIcon><BrokenStickIcon /></AutoActionIcon> : <BrokenStickIcon className="mr-2 h-4 w-4" />}
      {auto ? 'Auto mark for deconstruction' : 'Mark for deconstruction'}
    </ContextMenuItem>)}
  </>;
}
