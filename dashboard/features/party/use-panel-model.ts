'use client';
import { levelPriceHistory } from './level-price-history';
import { occupiedStandSlots } from './stand-inspection';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { domainOptions, useVisible } from './query-cache';
import { characterKey } from './dashboard-live';
import { STAT_SCROLLS } from './stat-scrolls';
import { aggregateMonsterAchievements } from './monster-achievements';
import { emptyArray } from './empty-values';
import type { Char } from './char';
import type { PartyConsoleModel } from './use-party-console';
import type { Item } from './item';
import type { PartyState } from './party-state';

export function usePanelModel<T extends Pick<PartyConsoleModel, 'state' | 'chars'> & Partial<Pick<PartyConsoleModel, 'standItem'>>>(
  model: T,
  needs: {
    inventory?: boolean;
    vitals?: boolean;
    position?: boolean;
    diagnostics?: boolean;
    bank?: boolean;
    market?: boolean;
    logs?: boolean;
  },
) {
  const client = useQueryClient(),
    visible = useVisible();
  const names = Object.keys(model.state.characters);
  const kinds = (['inventory', 'vitals', 'position', 'diagnostics'] as const).filter(
    (kind) => kind === 'position' ? needs.position ?? needs.vitals : needs[kind],
  );
  const subscriptions: ((typeof kinds)[number] | 'presence')[] = needs.inventory
    ? [...kinds, 'presence']
    : kinds;
  const values = useQueries({
    queries: names.flatMap((name) =>
      subscriptions.map((kind) => ({
        queryKey: characterKey(name, kind),
        enabled: false,
        staleTime: Infinity,
        gcTime: 60000,
        queryFn: (): Partial<Char> => ({}),
      })),
    ),
  });
  const domains = (['bank', 'market', 'logs'] as const).filter(
    (domain) => needs[domain],
  );
  const queries = useQueries({
    queries: domains.map((domain) => ({
      ...domainOptions(client, domain),
      enabled: visible,
    })),
  });
  // Rebuilding these per-character merges unconditionally on every render defeats
  // memo()/useCallback() everywhere downstream, since `state.characters[name]`
  // would get a new identity even when nothing about that character changed.
  // Only rebuild when a subscribed field or the base roster actually changed.
  const valuesData = values.map((value) => value.data);
  const characters = useMemo(
    () =>
      Object.fromEntries(
        names.map((name, index) => [
          name,
          Object.assign(
            {},
            model.state.characters[name],
            ...subscriptions.map(
              (_, kind) => values[index * subscriptions.length + kind].data,
            ),
          ) as Char,
        ]),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed
    // on the flattened query data instead of `values`/`names`/`subscriptions`
    // themselves, which are rebuilt every render regardless of whether any
    // subscribed field actually changed.
    [model.state.characters, subscriptions.length, ...valuesData],
  );
  const queriesData = queries.map((query) => query.data);
  const state: PartyState = useMemo(
    () => Object.assign({}, model.state, ...queriesData, { characters }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model.state, characters, ...queriesData],
  );
  const merchant = characters[state.merchantCharacter || ''];
  const quantities: Record<string, number> = useMemo(() => {
    const totals: Record<string, number> = {};
    const add = (item?: Item | null) => {
      if (item && STAT_SCROLLS.some((entry) => entry.scroll === item.name))
        totals[item.name] =
          (totals[item.name] || 0) + Math.max(1, Number(item.q) || 1);
    };
    (merchant?.items || []).forEach((entry) => add(entry?.item));
    Object.values(state.bank?.packs || {}).forEach((pack) =>
      pack.forEach((entry) => add(entry?.item)),
    );
    return totals;
  }, [merchant?.items, state.bank?.packs]);
  const standObserved = model.standItem
    ? levelPriceHistory(
        state.standPriceHistory?.[model.standItem.entry.item.name],
        Number(model.standItem.entry.item.level) || 0,
      )
    : undefined;
  const marketAt = queries[domains.indexOf('market')]?.dataUpdatedAt || 0;
  const standMarketCount = model.standItem
    ? (state.aldata?.listings || [])
        .filter(
          (listing) =>
            listing.seenAt >= marketAt - 120000 &&
            listing.serverIdentifier !== 'PVP' &&
            listing.item.name === model.standItem!.entry.item.name &&
            Number(listing.item.level || 0) ===
              Number(model.standItem!.entry.item.level || 0) &&
            (listing.item.p || null) ===
              (model.standItem!.entry.item.p || null),
        )
        .reduce(
          (sum, listing) => sum + Math.max(1, Number(listing.quantity) || 1),
          0,
        )
    : 0;
  const previousChars = useRef<Char[]>([]);
  const chars = useMemo(() => {
    const computed = model.chars.map((char) => characters[char.name]);
    // model.chars (from usePartyConsole()'s orderCharacters()) is a fresh
    // array every render even when the roster and order haven't changed.
    // Reusing the previous reference here when nothing actually differs lets
    // memoized consumers (InventoryPanel's "Deliver to..." list, etc.) skip
    // re-rendering on unrelated state changes.
    const previous = previousChars.current;
    const unchanged = previous.length === computed.length &&
      computed.every((char, index) => char === previous[index]);
    const result = unchanged ? previous : computed;
    previousChars.current = result;
    return result;
  }, [model.chars, characters]);
  const monsterAchievements = useMemo(
    () => aggregateMonsterAchievements(characters),
    [characters],
  );
  const standListings = state.standListings || emptyArray();
  const occupiedSlots = useMemo(
    () => occupiedStandSlots(standListings, state.nativeStand, merchant, state.standBids),
    [standListings, state.nativeStand, merchant, state.standBids],
  );
  return {
    ...model,
    state,
    chars,
    standObserved,
    standMarketCount,
    standMarketReference:
      standObserved?.marketLow || standObserved?.lowest || 0,
    statScrollInventory: quantities,
    monsterAchievements,
    occupiedStandSlots: occupiedSlots,
  };
}
