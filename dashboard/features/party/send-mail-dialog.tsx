'use client';
import {MailboxControls} from './mailbox-controls';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useInbox } from './mail-query';
import { read, transientRetry, useVisible } from './query-cache';
import { usePartyAction } from './query-actions';
import { BankSnapshot } from './bank-snapshot';
import { Bankboi } from './bankboi';
import { Char } from './char';
import { InventoryEntry } from './inventory-entry';
import { Item } from './item';
import { ItemMeta } from './item-meta';
import { ItemSprite } from './item-sprite';
import { MailAttachment } from './mail-attachment';
import { MailInbox } from './mail-inbox';
import { MerchantCatalogItem } from './merchant-catalog-item';

export function SendMailDialog({
  draft,
  open,
  onOpenChange,
  merchant,
  bank,
  bankbois,
  onSend,
  onCount,
  catalog,
  onInspect,
  inspectionPanel,
}: {
  draft?: { recipient: string; subject: string; message: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  merchant?: Char;
  bank: BankSnapshot | null;
  bankbois: Bankboi[];
  onCount: (count: number) => void;
  catalog: MerchantCatalogItem[];
  onInspect: (entry: InventoryEntry) => void;
  inspectionPanel?: import("react").ReactNode;
  onSend: (value: {
    recipient: string;
    subject: string;
    message: string;
    quantity: number;
    source?: { pack: string; slot: number; item: Item };
  }) => Promise<void>;
}) {
  const [recipient, setRecipient] = useState(draft?.recipient || ''),
    [subject, setSubject] = useState(draft?.subject || ''),
    [message, setMessage] = useState(draft?.message || ''),
    [attachment, setAttachment] = useState<MailAttachment | null>(null),
    [quantity, setQuantity] = useState(''),
    [confirming, setConfirming] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [attachmentSearch, setAttachmentSearch] = useState('');
  const [mailTab,setMailTab]=useState<'inbox'|'outbox'>('inbox');
  const client = useQueryClient();
  const visible = useVisible();
  const action = usePartyAction();
  const postageQuery = useQuery({
    queryKey: ['party', 'postage'],
    queryFn: ({ signal }) =>
      read<{ gold?: number }>(client, '/mail/postage', signal),
    enabled: open && visible,
    staleTime: 900000,
    gcTime: 1800000,
    retry: transientRetry,
    retryDelay: 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const postage = postageQuery.data?.gold ?? null;
  const inboxQuery = useInbox();
  const inbox: MailInbox = {
    messages: [],
    count: 0,
    updatedAt: null,
    error: null,
    ...inboxQuery.data,
    ...(inboxQuery.isError ? { error: inboxQuery.error.message } : {}),
  };
  useEffect(() => {
    if (inboxQuery.data) onCount(inboxQuery.data.count);
  }, [inboxQuery.data, onCount]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mailBusy, setMailBusy] = useState(false),
    [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const selected = inbox.messages.find((mail) => mail.id === selectedId);
  const attachmentInfo = selected?.item
    ? catalog.find((entry) => entry.id === selected.item?.name)
    : undefined;
  async function mailAction(
    actionName: 'refresh' | 'collect' | 'delete',
    id?: string,
  ) {
    setMailBusy(true);
    setError(null);
    try {
      await action.mutateAsync({ path: `/mail/${actionName}`, body: { id } });
      setDeleteConfirm(null);
      if (actionName === 'delete') setSelectedId(null);
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : 'Mail action failed',
      );
    } finally {
      setMailBusy(false);
    }
  }
  const sources = useMemo(() => {
    const rows: {
      label: string;
      pack: string;
      items: (InventoryEntry | null)[];
    }[] = [];
    if (merchant)
      rows.push({
        label: `${merchant.name} inventory`,
        pack: 'merchant',
        items: merchant.items || [],
      });
    Object.entries(bank?.packs || {}).forEach(([pack, items]) =>
      rows.push({ label: `Bank · ${pack}`, pack, items }),
    );
    bankbois.forEach((entry) =>
      rows.push({
        label: `Bankboi · ${entry.name}`,
        pack: `bankboi:${entry.name}`,
        items: entry.items || [],
      }),
    );
    return rows;
  }, [merchant, bank, bankbois]);
  const filteredSources = sources.map(source => ({...source, items: source.items.filter(entry => entry && `${entry.item.name} ${entry.meta?.definition?.name || ''} ${catalog.find(item => item.id === entry.item.name)?.name || ''}`.toLowerCase().includes(attachmentSearch.trim().toLowerCase()))})).filter(source => source.items.length);
  const attachmentLevel = (
    item: Item,
    info?: MerchantCatalogItem,
    meta?: ItemMeta | null,
  ) =>
    item.level != null ||
    info?.upgradeable ||
    info?.compoundable ||
    meta?.definition?.upgrade ||
    meta?.definition?.compound
      ? ` +${Number(item.level) || 0}`
      : '';
  const inspectAttachment = (entry: InventoryEntry) => {
    onInspect(entry);
  };
  const available = Math.max(1, Number(attachment?.entry.item.q) || 1);
  const stackable =
    available > 1 || Number(attachment?.entry.meta?.definition?.s || 1) > 1;
  const validQuantity =
    !stackable ||
    (Number.isSafeInteger(Number(quantity)) &&
      Number(quantity) >= 1 &&
      Number(quantity) <= available);
  const resetConfirmation = () => {
    setConfirming(false);
    setError(null);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setConfirming(false);
          setError(null);
        }
      }}
    >
      <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden border-cyan-800 bg-[#081513] text-emerald-50 sm:max-w-7xl">
        {inspectionPanel}
        <DialogHeader>
          <DialogTitle>Mail</DialogTitle>
          <DialogDescription className="text-emerald-100/80">
            Read received mail or write a message. Attachments are collected
            separately by the merchant.
          </DialogDescription>
        </DialogHeader>
        <MailboxControls inbox={inbox} tab={mailTab} onTab={setMailTab} />
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className={mailTab==='inbox'?'grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]':'hidden'}>
            <aside className="max-h-[65vh] space-y-3 overflow-y-auto rounded border border-cyan-800 bg-[#06110f] p-3">
              <h3 className="font-semibold text-cyan-100">
                Mail received ({inbox.count})
              </h3>
              <div className="flex gap-2">
                <Button
                  disabled={mailBusy}
                  onClick={() => void mailAction('refresh')}
                  className="border border-cyan-700 bg-black text-cyan-100 hover:bg-cyan-950"
                >
                  Refresh
                </Button>
                <Button
                  onClick={() => {
                    setSelectedId(null);
                    setDeleteConfirm(null);
                  }}
                  className="border border-cyan-700 bg-black text-cyan-100 hover:bg-cyan-950"
                >
                  Write message
                </Button>
              </div>
              {inbox.error && (
                <p className="text-sm text-amber-200">
                  Mail may be out of date: {inbox.error}
                </p>
              )}
                {inbox.automationError && (
                  <p className="text-sm text-amber-200" role="status">
                    {inbox.automationError}. Retrying automatically.
                  </p>
                )}
                {!inbox.messages.length && (
                <p className="text-sm text-emerald-100/80">
                  {inbox.updatedAt ? 'No received mail.' : 'Loading mail…'}
                </p>
              )}
              {inbox.messages.map((mail) => (
                <button
                  key={mail.id}
                  onClick={() => {
                    setSelectedId(mail.id);
                    setDeleteConfirm(null);
                  }}
                  className={`block w-full rounded border p-3 text-left text-emerald-50 hover:bg-[#17352e] ${selectedId === mail.id ? 'border-cyan-300 bg-[#17352e]' : 'border-cyan-900 bg-[#0b201b]'}`}
                >
                  <p className="break-words font-semibold">
                    {mail.subject || '(No subject)'}
                  </p>
                  <p className="text-sm text-cyan-200">From {mail.from}</p>
                  <p className="text-xs text-emerald-100/80">
                    {new Date(mail.sent).toLocaleString()}
                  </p>
                  {mail.item && (
                    <p className="mt-1 text-xs text-amber-200">
                      {mail.taken === true
                        ? 'Attachment collected'
                        : mail.collection || 'Attachment available'}
                    </p>
                  )}
                </button>
              ))}
            </aside>
            <div className="min-w-0">
              {selected && (
                <section className="space-y-4 rounded border border-cyan-800 bg-[#06110f] p-4">
                  <h3 className="text-lg font-semibold">{selected.subject}</h3>
                  <p className="text-sm text-cyan-200">
                    {selected.from} → {selected.to} ·{' '}
                    {new Date(selected.sent).toLocaleString()}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm text-emerald-50">
                    {selected.message}
                  </p>
                  {selected.item && (
                    <div className="rounded border border-amber-800 bg-black p-3 text-amber-100">
                      <button
                        type="button"
                        onClick={() =>
                          inspectAttachment({
                            slot: -1,
                            item: selected.item!,
                            meta: attachmentInfo?.meta,
                          })
                        }
                        title="View attachment details"
                        className="flex w-full items-center gap-3 rounded border border-amber-700 bg-[#091614] p-2 text-left text-amber-100 hover:border-amber-300 hover:bg-[#183127] focus-visible:outline-2 focus-visible:outline-amber-300"
                      >
                        <div className="relative h-12 w-12 shrink-0 border border-amber-800 bg-[#091614]">
                          {(attachmentInfo?.sprite ||
                            attachmentInfo?.meta?.sprite) && (
                            <ItemSprite
                              sprite={
                                (attachmentInfo?.sprite ||
                                  attachmentInfo?.meta?.sprite)!
                              }
                            />
                          )}
                        </div>
                        <p>
                          {attachmentInfo?.name ||
                            selected.item.name ||
                            'Unknown attachment'}
                          {attachmentLevel(
                            selected.item,
                            attachmentInfo,
                            attachmentInfo?.meta,
                          )}{' '}
                          × {selected.item.q || 1}
                        </p>
                      </button>
                      <p className="mt-2 text-sm">
                        {selected.taken === true
                          ? 'Collected'
                          : selected.taken === 'pending'
                            ? 'Game is processing collection'
                            : selected.collection || 'Unclaimed'}
                        {selected.collectionError
                          ? `: ${selected.collectionError}`
                          : ''}
                      </p>
                      <Button
                        disabled={
                          mailBusy ||
                          selected.taken !== false ||
                          ['queued', 'collecting'].includes(
                            selected.collection || '',
                          )
                        }
                        onClick={() => void mailAction('collect', selected.id)}
                        className="mt-2 border border-amber-600 bg-black text-amber-100 hover:bg-amber-950"
                      >
                        Collect attachment
                      </Button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      disabled={
                        mailBusy ||
                        !!(selected.item && selected.taken !== true) ||
                        ['queued', 'collecting'].includes(
                          selected.collection || '',
                        )
                      }
                      onClick={() =>
                        deleteConfirm === selected.id
                          ? void mailAction('delete', selected.id)
                          : setDeleteConfirm(selected.id)
                      }
                      className="border border-rose-600 bg-black text-rose-200 hover:bg-rose-950"
                    >
                      {deleteConfirm === selected.id
                        ? 'Confirm permanent deletion'
                        : 'Delete message'}
                    </Button>
                    {deleteConfirm === selected.id && (
                      <Button
                        onClick={() => setDeleteConfirm(null)}
                        className="border border-slate-600 bg-black text-slate-100 hover:bg-slate-900"
                      >
                        Cancel deletion
                      </Button>
                    )}
                    <Button
                      disabled={mailBusy || busy}
                      onClick={() => {
                        setRecipient(selected.from);
                        setSubject('');
                        setMessage('');
                        setAttachment(null);
                        setQuantity('');
                        setSelectedId(null);
                        setDeleteConfirm(null);
                        resetConfirmation();
                      }}
                      className="ml-auto border border-cyan-700 bg-black text-cyan-100 hover:bg-cyan-950 hover:text-white"
                    >
                      Reply
                    </Button>
                  </div>
                </section>
              )}
              <div className={selected ? 'hidden' : ''}>
                <h3 className="mb-3 font-semibold text-cyan-100">
                  Write message
                </h3>
                {attachment && (
                  <Button
                    onClick={() => {
                      setAttachment(null);
                      resetConfirmation();
                    }}
                    className="mb-3 border border-slate-600 bg-black text-slate-100 hover:bg-slate-900"
                  >
                    Remove attachment
                  </Button>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3">
                    <label className="grid gap-1 font-mono text-xs text-cyan-200">
                      Character name
                      <Input
                        value={recipient}
                        onChange={(event) => {
                          setRecipient(event.target.value);
                          resetConfirmation();
                        }}
                        className="border-cyan-800 bg-black text-emerald-50"
                      />
                    </label>
                    <label className="grid gap-1 font-mono text-xs text-cyan-200">
                      Subject
                      <Input
                        value={subject}
                        maxLength={74}
                        onChange={(event) => {
                          setSubject(event.target.value);
                          resetConfirmation();
                        }}
                        className="border-cyan-800 bg-black text-emerald-50"
                      />
                    </label>
                    <label className="grid gap-1 font-mono text-xs text-cyan-200">
                      Message
                      <textarea
                        value={message}
                        maxLength={1000}
                        rows={6}
                        onChange={(event) => {
                          setMessage(event.target.value);
                          resetConfirmation();
                        }}
                        className="resize-y rounded-md border border-cyan-800 bg-black px-3 py-2 text-sm text-emerald-50 outline-none focus:border-cyan-400"
                      />
                    </label>
                    {attachment ? (
                      <div className="border border-amber-700 bg-black p-3">
                        <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => inspectAttachment(attachment.entry)}
                          title="View attachment details"
                          className="flex w-full items-center gap-3 rounded border border-amber-700 bg-[#091614] p-2 text-left text-amber-100 hover:border-amber-300 hover:bg-[#183127] focus-visible:outline-2 focus-visible:outline-amber-300"
                        >
                          <div className="relative h-12 w-12 shrink-0 border border-amber-900 bg-[#091614]">
                            {attachment.entry.meta?.sprite && (
                              <ItemSprite
                                sprite={attachment.entry.meta.sprite}
                              />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-amber-100">
                              {String(
                                attachment.entry.meta?.definition?.name ||
                                  attachment.entry.item.name,
                              )}
                              {attachmentLevel(
                                attachment.entry.item,
                                undefined,
                                attachment.entry.meta,
                              )}
                            </p>
                            <p className="font-mono text-[10px] text-amber-300/70">
                              {attachment.label} · slot {attachment.entry.slot}
                            </p>
                          </div>
                        </button>
                        <Button type="button" variant="outline" disabled={busy} className="shrink-0 border-slate-600 bg-black text-white hover:bg-slate-800 hover:text-white" onClick={() => {setAttachment(null);setQuantity('');resetConfirmation();}}>Clear attachment</Button>
                        </div>
                        {stackable ? (
                          <label className="mt-3 grid gap-1 font-mono text-xs text-amber-200">
                            Quantity (1–{available})
                            <Input
                              inputMode="numeric"
                              value={quantity}
                              onChange={(event) => {
                                setQuantity(
                                  event.target.value.replace(/[^0-9]/g, ''),
                                );
                                resetConfirmation();
                              }}
                              className="border-amber-700 bg-black text-emerald-50"
                            />
                          </label>
                        ) : null}
                      </div>
                    ) : (
                      <p className="border border-dashed border-slate-700 bg-black p-3 text-sm text-slate-400">
                        Optional: select an attachment from the inventory pane.
                      </p>
                    )}
                  </div>
                  <div className="max-h-[58vh] space-y-4 overflow-y-auto border border-cyan-900 bg-[#06110f] p-3">
                    <Input aria-label="Search attachments" placeholder="Search items to attach…" value={attachmentSearch} onChange={event => setAttachmentSearch(event.target.value)} className="sticky top-0 z-10 border-cyan-700 bg-black text-white" />
                    {!filteredSources.length && <p className="text-sm text-slate-300">No matching items.</p>}
                    {filteredSources.map((source) => (
                      <section key={source.pack}>
                        <h3 className="mb-2 font-mono text-xs uppercase tracking-wider text-cyan-300">
                          {source.label}
                        </h3>
                        <div className="grid grid-cols-7 gap-1.5">
                          {source.items.map((entry, index) =>
                            entry ? (
                              <button
                                key={entry.slot ?? index}
                                type="button"
                                onClick={() => {
                                  setAttachment({
                                    pack: source.pack,
                                    label: source.label,
                                    entry,
                                  });
                                  setQuantity('');
                                  resetConfirmation();
                                }}
                                className={`relative aspect-square overflow-hidden border bg-black text-left hover:border-cyan-300 ${attachment?.pack === source.pack && attachment.entry.slot === entry.slot ? 'border-amber-300' : 'border-cyan-950'}`}
                                title={String(
                                  entry.meta?.definition?.name ||
                                    entry.item.name,
                                )}
                              >
                                {entry.meta?.sprite && (
                                  <ItemSprite sprite={entry.meta.sprite} />
                                )}
                                {attachmentLevel(
                                  entry.item,
                                  undefined,
                                  entry.meta,
                                ) ? (
                                  <span className="absolute bottom-0.5 left-0.5 bg-black px-1 font-mono text-[9px] text-emerald-300">
                                    {attachmentLevel(
                                      entry.item,
                                      undefined,
                                      entry.meta,
                                    ).trim()}
                                  </span>
                                ) : null}
                                {Number(entry.item.q) > 1 ? (
                                  <span className="absolute bottom-0.5 right-0.5 bg-black px-1 font-mono text-[9px] text-amber-300">
                                    {entry.item.q}
                                  </span>
                                ) : null}
                              </button>
                            ) : (
                              <div
                                key={index}
                                className="aspect-square border border-dashed border-cyan-950/60"
                              />
                            ),
                          )}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          {error ? (
            <p className="border border-rose-700 bg-rose-950 px-3 py-2 text-sm text-rose-100">
              {error}
            </p>
          ) : null}
          <p className="border border-amber-700 bg-amber-950 p-3 text-sm text-amber-100">
            {postage === null
              ? 'Postage estimate unavailable. Sending mail spends your character’s gold.'
              : `Postage: ${postage.toLocaleString()} gold per message, charged by Adventure Land.`}
            {attachment ? ' The attached items also leave your inventory.' : ''}
          </p>
        </div>
        <DialogFooter className="shrink-0 border-t border-emerald-900 bg-[#081513] pt-3">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
            className="border-slate-600 bg-black text-slate-100 hover:bg-slate-900 hover:text-white"
          >
            Cancel
          </Button>
          <Button
            disabled={
              busy ||
              !!selected ||
              !recipient.trim() ||
              !subject.trim() ||
              (!!attachment && !validQuantity)
            }
            onClick={async () => {
              if (!confirming) {
                setConfirming(true);
                return;
              }
              setBusy(true);
              setError(null);
              try {
                await onSend({
                  recipient: recipient.trim(),
                  subject: subject.trim(),
                  message,
                  quantity: stackable ? Number(quantity) : 1,
                  source: attachment
                    ? {
                        pack: attachment.pack,
                        slot: attachment.entry.slot,
                        item: attachment.entry.item,
                      }
                    : undefined,
                });
                onOpenChange(false);
                setRecipient('');
                setSubject('');
                setMessage('');
                setAttachment(null);
                setQuantity('');
                setConfirming(false);
              } catch (problem) {
                setError(
                  problem instanceof Error
                    ? problem.message
                    : 'Mail could not be queued',
                );
                setConfirming(false);
              } finally {
                setBusy(false);
              }
            }}
            className={
              confirming
                ? 'border border-rose-200 bg-rose-600 text-white hover:bg-rose-500'
                : 'border border-cyan-300 bg-cyan-400 text-black hover:bg-cyan-300'
            }
          >
            {busy ? 'Queuing…' : confirming ? 'Really send mail?' : 'Send mail'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
