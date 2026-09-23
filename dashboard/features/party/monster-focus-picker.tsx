"use client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { X } from "lucide-react";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { MonsterChoice } from "./monster-choice";
import { Sprite } from "./sprite";
import { SpriteCrop } from "./sprite-crop";

export const MonsterFocusPicker = memo(function MonsterFocusPicker({
  monsters,
  selected,
  onChange,
  priorities,
  onPriorityChange,
  renderRouteButton,
}: {
  monsters: MonsterChoice[];
  selected: string[];
  onChange: (selected: string[]) => void | Promise<void>;
  priorities: Record<string, number>;
  onPriorityChange: (priorities: Record<string, number>) => void;
  renderRouteButton?: (selected: string[]) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [fairyExplanation, setFairyExplanation] = useState(false);
  const [priorityDrafts, setPriorityDrafts] = useState<Record<string, string>>({});
  const [selectionDraft, setSelectionDraft] = useState<string[]>(selected);
  const selectionDirty = useRef(false);
  const selectionGeneration = useRef(0);
  const selectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionWrites = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!selectionDirty.current) setSelectionDraft(selected);
  }, [selected]);
  useEffect(
    () => () => {
      if (selectionTimer.current) clearTimeout(selectionTimer.current);
    },
    [],
  );
  const choices: [string, string, Sprite | null][] = [
    ["all", "All monsters", null],
    ...monsters.map(
      (monster) =>
        [monster.id, `${monster.name} · ${monster.id}`, monster.sprite || null] as [
          string,
          string,
          Sprite | null,
        ],
    ),
  ];
  const [choiceOrder, setChoiceOrder] = useState<string[]>(() => {
    const all = ["all", ...monsters.map((monster) => monster.id)];
    return [
      ...selected.filter((id) => all.includes(id)),
      ...all.filter((id) => !selected.includes(id)),
    ];
  });
  const choiceRanks = new Map(choiceOrder.map((id, index) => [id, index]));
  const orderedChoices = choices
    .slice()
    .sort(
      (a, b) =>
        (choiceRanks.get(a[0]) ?? Number.MAX_SAFE_INTEGER) -
        (choiceRanks.get(b[0]) ?? Number.MAX_SAFE_INTEGER),
    );
  const query = search.trim().toLowerCase();
  const filtered = query
    ? orderedChoices.filter(
        ([id, label]) => id.toLowerCase().includes(query) || label.toLowerCase().includes(query),
      )
    : orderedChoices;
  const queueSelection = (next: string[]) => {
    const generation = ++selectionGeneration.current;
    selectionDirty.current = true;
    setSelectionDraft(next);
    if (selectionTimer.current) clearTimeout(selectionTimer.current);
    selectionTimer.current = setTimeout(() => {
      selectionTimer.current = null;
      // Complete focus lists are replacements, so enforce request ordering.
      selectionWrites.current = selectionWrites.current
        .catch(() => undefined)
        .then(async () => {
          await onChange(next);
        })
        .finally(() => {
          if (selectionGeneration.current === generation) {
            selectionDirty.current = false;
            setSelectionDraft(next);
          }
        });
    }, 180);
  };
  const toggle = (id: string, checked: boolean) => {
    if (id === "tinyp") { setFairyExplanation(true); return; }
    if (id === "all") return queueSelection(checked ? ["all"] : []);
    let next = selectionDraft.filter((value) => value !== "all");
    if (checked) next = [...next, id];
    else next = next.filter((value) => value !== id);
    queueSelection(next);
  };
  const displayedPriority = (id: string) => priorityDrafts[id] ?? String(priorities[id] ?? 50);
  const commitPriority = (id: string) => {
    const parsed = Number(priorityDrafts[id] ?? priorities[id] ?? 50);
    const value = Number.isFinite(parsed) ? Math.max(0, Math.min(1000, Math.round(parsed))) : 50;
    setPriorityDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    onPriorityChange({ ...priorities, [id]: value });
  };
  const updatePriority = (id: string, draft: string) => {
    setPriorityDrafts((current) => ({ ...current, [id]: draft }));
    if (!draft.trim()) return;
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) return;
    const value = Math.max(0, Math.min(1000, Math.round(parsed)));
    onPriorityChange({ ...priorities, [id]: value });
  };
  const labels = selectionDraft.map((id) =>
    id === "all" ? "All monsters" : monsters.find((monster) => monster.id === id)?.name || id,
  );
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {renderRouteButton?.(selectionDraft)}
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            const ids = orderedChoices.map(([id]) => id);
            setChoiceOrder([
              ...ids.filter((id) => selectionDraft.includes(id)),
              ...ids.filter((id) => !selectionDraft.includes(id)),
            ]);
          }
          setOpen(nextOpen);
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              className="h-10 min-w-0 flex-1 justify-start border-emerald-800 bg-[#07100f] text-left text-emerald-50 hover:bg-emerald-950 hover:text-emerald-50"
            />
          }
        >
          <span className="truncate">
            {labels.length ? labels.join(", ") : "No monsters selected"}
          </span>
          <span className="ml-auto rounded bg-emerald-400/10 px-1.5 font-mono text-xs text-emerald-300">
            {selectionDraft.includes("all") ? "ALL" : selectionDraft.length}
          </span>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-80 border border-emerald-800 bg-[#091614] p-2 text-emerald-50"
        >
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search monsters…"
            className="mb-2 border-emerald-800 bg-black/35"
          />
          <div className="max-h-80 overflow-y-auto">
            {filtered.map(([id, label, sprite]) => {
              const checked = selectionDraft.includes(id);
              if (id === "tinyp") return <button key={id} type="button" aria-disabled="true"
                onClick={() => setFairyExplanation(true)}
                className="flex w-full items-center justify-between rounded border border-slate-600 bg-[#101b19] px-2 py-3 text-left text-slate-200 hover:bg-[#20332c]">
                <span>{label}</span><span className="text-sm text-amber-200">Disabled</span>
              </button>;
              return (
                <label
                  key={id}
                  className="flex cursor-pointer items-center gap-3 rounded px-2 py-2 hover:bg-emerald-400/10"
                >
                  <Checkbox checked={checked} onCheckedChange={(value) => toggle(id, !!value)} />
                  <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded bg-black/50">
                    {sprite ? (
                      <SpriteCrop sprite={sprite} size={36} />
                    ) : (
                      <span className="grid h-full place-items-center text-lg">*</span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
                  <Input
                    type="number"
                    min={0}
                    max={1000}
                    aria-label={`${label} priority`}
                    title="Target priority (higher wins)"
                    value={displayedPriority(id)}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => updatePriority(id, event.target.value)}
                    onBlur={() => commitPriority(id)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    className="h-8 w-16 shrink-0 border-emerald-800 bg-black/45 px-2 text-center font-mono text-xs"
                  />
                </label>
              );
            })}
            {!filtered.length ? (
              <p className="px-2 py-6 text-center text-sm text-emerald-100/45">
                No matching monsters
              </p>
            ) : null}
          </div>
          {fairyExplanation && <p role="status" className="mt-2 rounded border border-amber-600 bg-[#241d0c] p-2 text-sm text-amber-100">Fairy has no verified regular spawn route. Enable “Passively hunt fairy” to attack on sight.</p>}
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Clear all monster focus"
        title="Clear all"
        onClick={() => queueSelection([])}
        className="h-10 w-10 shrink-0 border-rose-800 bg-[#07100f] text-rose-400 hover:bg-rose-950 hover:text-rose-300 disabled:opacity-35"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
});
