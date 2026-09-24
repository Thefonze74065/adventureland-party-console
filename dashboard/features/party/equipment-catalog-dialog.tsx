"use client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { EQUIPMENT_TYPES } from "./equipment-types";
import { ItemSprite } from "./item-sprite";
import { MerchantCatalogItem } from "./merchant-catalog-item";
import type { InventoryEntry } from "./inventory-entry";

// The full equipment catalog can run into the hundreds of items; mounting every
// row at once (each with a sprite, several labels and an optional compare
// button) has been observed to freeze the tab for multiple seconds on open.
// Render a bounded window and let the user page in more.
const ROW_BATCH = 120;

export const EquipmentCatalogDialog = memo(function EquipmentCatalogDialog({
  open,
  onOpenChange,
  catalog,
  onInspect,
  comparison,
  comparisonSource,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: MerchantCatalogItem[];
  onInspect: (item: MerchantCatalogItem) => void;
  comparisonSource?: InventoryEntry | null;
  comparison?: {
    selectedIds: string[];
    onAdd: (item: MerchantCatalogItem) => void;
    controls: ReactNode;
  };
}) {
  const [search, setSearch] = useState("");
  const [types, setTypes] = useState<string[]>(() => {
    const type = String(comparisonSource?.meta?.definition.type || "");
    return type ? [type] : [];
  });
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [exclusiveGear, setExclusiveGear] = useState(false);
  const [previousComparisonSource, setPreviousComparisonSource] = useState(comparisonSource);
  if (previousComparisonSource !== comparisonSource) {
    setPreviousComparisonSource(comparisonSource);
    if (comparisonSource) {
      const type = String(comparisonSource.meta?.definition.type || "");
      setTypes(type ? [type] : []);
      setSearch("");
      setSelectedClasses([]);
      setExclusiveGear(false);
    }
  }
  const [sort, setSort] = useState("tier");
  const equipment = useMemo(
    () =>
      catalog.filter((item) => EQUIPMENT_TYPES.includes(String(item.meta?.definition.type || ""))),
    [catalog],
  );
  const availableTypes = useMemo(
    () => [...new Set(equipment.map((item) => String(item.meta?.definition.type || "")))].sort(),
    [equipment],
  );
  const availableClasses = useMemo(
    () =>
      [
        ...new Map(
          equipment.flatMap((item) =>
            (item.meta?.usage?.classes || []).map((entry) => [entry.id, entry.name] as const),
          ),
        ).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1])),
    [equipment],
  );
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const value = (item: MerchantCatalogItem, key: string) =>
      Number(item.meta?.properties?.[key] ?? item.meta?.definition[key] ?? 0);
    return equipment
      .filter(
        (item) =>
          (!query ||
            `${item.name} ${item.id} ${String(item.meta?.definition.set || "")}`
              .toLowerCase()
              .includes(query)) &&
          (!types.length || types.includes(String(item.meta?.definition.type || ""))) &&
          (!selectedClasses.length ||
            (() => {
              const eligible = new Set((item.meta?.usage?.classes || []).map((entry) => entry.id));
              return (
                selectedClasses.every((id) => eligible.has(id)) &&
                (!exclusiveGear || eligible.size === selectedClasses.length)
              );
            })()),
      )
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        if (sort === "set")
          return (
            String(a.meta?.definition.set || "zzz").localeCompare(
              String(b.meta?.definition.set || "zzz"),
            ) || a.name.localeCompare(b.name)
          );
        if (sort === "value") return value(b, "g") - value(a, "g") || a.name.localeCompare(b.name);
        if (sort === "tier")
          return value(b, "tier") - value(a, "tier") || a.name.localeCompare(b.name);
        return value(b, sort) - value(a, sort) || a.name.localeCompare(b.name);
      });
  }, [equipment, search, sort, types, selectedClasses, exclusiveGear]);
  const [visibleCount, setVisibleCount] = useState(ROW_BATCH);
  useEffect(() => setVisibleCount(ROW_BATCH), [rows]);
  const visibleRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount]);
  const sorts = [
    ["tier", "Tier"],
    ["name", "Name"],
    ["set", "Set"],
    ["value", "Default value"],
    ["attack", "Attack"],
    ["armor", "Armor"],
    ["resistance", "Resistance"],
    ["stat", "Stat"],
    ["str", "STR"],
    ["int", "INT"],
    ["dex", "DEX"],
    ["vit", "VIT"],
    ["speed", "Speed"],
    ["frequency", "Attack speed"],
    ["range", "Range"],
    ["apiercing", "Armor piercing"],
    ["rpiercing", "Resistance piercing"],
    ["pnresistance", "Poison resistance"],
    ["firesistance", "Fire resistance"],
    ["fzresistance", "Freeze resistance"],
    ["phresistance", "Physical resistance"],
    ["stresistance", "Status resistance"],
    ["evasion", "Evasion"],
    ["crit", "Critical"],
    ["luck", "Luck"],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[96vw] max-w-[1500px] flex-col border-cyan-800 bg-[#07120f] text-emerald-50 sm:max-w-[96vw] 2xl:max-w-[1500px]">
        <DialogHeader>
          <DialogTitle>Equipment catalog</DialogTitle>
          <DialogDescription>
            Every equippable item in the current game data. Click an item for its full details and
            WTB action.
          </DialogDescription>
        </DialogHeader>
        {comparison?.controls}
        <div className="grid gap-2 md:grid-cols-[1fr_16rem]">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search equipment, ID, or set…"
            className="border-cyan-800 bg-black"
          />
          <Select value={sort} onValueChange={(value) => value && setSort(value)}>
            <SelectTrigger className="border-cyan-800 bg-black">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sorts.map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setTypes([])}
            className={
              !types.length
                ? "border-cyan-400 bg-cyan-950 text-cyan-100"
                : "border-slate-700 bg-black text-slate-300"
            }
          >
            All
          </Button>
          {availableTypes.map((type) => (
            <Button
              key={type}
              size="sm"
              variant="outline"
              onClick={() =>
                setTypes((old) =>
                  old.includes(type) ? old.filter((entry) => entry !== type) : [...old, type],
                )
              }
              className={
                types.includes(type)
                  ? "border-cyan-400 bg-cyan-950 text-cyan-100"
                  : "border-slate-700 bg-black text-slate-300 hover:text-white"
              }
            >
              {type.replaceAll("_", " ")}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <fieldset aria-label="Usable by every selected class" className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              aria-pressed={!selectedClasses.length}
              onClick={() => setSelectedClasses([])}
              className={`rounded-full border ${!selectedClasses.length ? "border-cyan-400 bg-cyan-950 text-cyan-100 hover:border-cyan-300 hover:bg-cyan-900 hover:text-white" : "border-slate-600 bg-[#091510] text-slate-200 hover:border-cyan-500 hover:bg-slate-800 hover:text-white"}`}
            >
              All classes
            </Button>
            {availableClasses.map(([id, name]) => (
              <Button
                key={id}
                size="sm"
                variant="outline"
                aria-pressed={selectedClasses.includes(id)}
                onClick={() =>
                  setSelectedClasses((previous) =>
                    previous.includes(id)
                      ? previous.filter((entry) => entry !== id)
                      : [...previous, id],
                  )
                }
                className={`rounded-full border ${selectedClasses.includes(id) ? "border-cyan-400 bg-cyan-950 text-cyan-100 hover:border-cyan-300 hover:bg-cyan-900 hover:text-white" : "border-slate-600 bg-[#091510] text-slate-200 hover:border-cyan-500 hover:bg-slate-800 hover:text-white"}`}
              >
                {name}
              </Button>
            ))}
          </fieldset>
          <label
            title={
              selectedClasses.length
                ? "Only gear usable by exactly the selected classes"
                : "Select classes to filter exclusive gear"
            }
            className="ml-auto flex shrink-0 items-center gap-2 rounded border border-slate-600 bg-[#091510] px-3 py-2 text-sm text-cyan-100 hover:border-cyan-500 hover:bg-slate-800"
          >
            <Checkbox
              checked={exclusiveGear}
              disabled={!selectedClasses.length}
              onCheckedChange={(checked) => setExclusiveGear(checked === true)}
              className="border-cyan-500 bg-black text-cyan-100 hover:border-cyan-300 hover:bg-cyan-950 data-checked:border-cyan-300 data-checked:bg-cyan-950 data-checked:text-cyan-100"
            />
            Exclusive gear
          </label>
        </div>
        <p className="font-mono text-[10px] uppercase text-cyan-200/55">
          {visibleRows.length === rows.length
            ? `${rows.length} item${rows.length === 1 ? "" : "s"}`
            : `Showing ${visibleRows.length} of ${rows.length} items`}
          {" "}· sorted by{" "}
          {sorts.find(([id]) => id === sort)?.[1]}
          {selectedClasses.length
            ? exclusiveGear
              ? " · usable only by the selected classes"
              : " · usable by every selected class"
            : ""}
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {visibleRows.map((item) => {
              const def = item.meta?.definition || {},
                primary =
                  sort !== "tier" && !["name", "set", "value"].includes(sort)
                    ? Number(item.meta?.properties?.[sort] ?? def[sort] ?? 0)
                    : null;
              return (
                <div key={item.id} className="flex min-w-0 flex-col gap-1">
                <button
                  type="button"
                  onClick={() => onInspect(item)}
                  className="min-w-0 flex-1 rounded border border-cyan-950 bg-[#081510] p-2 text-center text-emerald-50 hover:border-cyan-400 hover:bg-cyan-950"
                >
                  <div className="relative mx-auto h-12 w-12">
                    {item.sprite && <ItemSprite sprite={item.sprite} />}
                  </div>
                  <p className="mt-1 truncate text-xs font-semibold">{item.name}</p>
                  <p className="font-mono text-[9px] uppercase text-cyan-100/45">
                    {String(def.type || "")} · T{Number(def.tier) || 0}
                  </p>
                  {def.set ? (
                    <p className="truncate font-mono text-[9px] text-violet-300">
                      {String(def.set)}
                    </p>
                  ) : null}
                  {primary !== null ? (
                    <p className="font-mono text-[10px] text-amber-300">
                      {sort.toUpperCase()} {primary}
                    </p>
                  ) : null}
                </button>
                {comparison && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={comparison.selectedIds.includes(item.id) || comparison.selectedIds.length >= 3}
                    onClick={() => comparison.onAdd(item)}
                    className="h-auto whitespace-normal border-cyan-700 bg-[#10251f] px-1 py-2 text-xs text-cyan-100 hover:border-cyan-400 hover:bg-cyan-950 hover:text-white disabled:opacity-60"
                  >
                    {comparison.selectedIds.includes(item.id) ? "Added to compare" : "Add to compare"}
                  </Button>
                )}
                </div>
              );
            })}
          </div>
          {visibleRows.length < rows.length ? (
            <div className="mt-3 flex justify-center">
              <Button
                variant="outline"
                onClick={() => setVisibleCount((count) => count + ROW_BATCH)}
                className="border-cyan-700 bg-black text-cyan-100 hover:bg-cyan-950 hover:text-white"
              >
                Show {Math.min(ROW_BATCH, rows.length - visibleRows.length)} more ({rows.length - visibleRows.length} remaining)
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
});
