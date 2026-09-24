'use client';
import {
  QueryClient,
  QueryClientProvider,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { API } from './api';
import type { PartyState } from './party-state';
import type { ALDataState } from './aldata-state';
import type { MapDefinition } from './map-definition';
import { synchronizeDashboardClock } from './live-metrics';
import { writeVitals } from './character-cache';

export type Domain =
  | 'core'
  | 'config'
  | 'fast'
  | 'inventory'
  | 'logs'
  | 'bank'
  | 'market'
  | 'catalog'
  | 'mail';
export const key = (domain: Domain) => ['party', domain] as const;
export class ReadError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function createDashboardClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}
export function DashboardQueries({ children }: { children: ReactNode }) {
  const [client] = useState(createDashboardClient);
  const [sessionLost, setSessionLost] = useState(false),
    [account, setAccount] = useState(0);
  useEffect(() => {
    const lost = () => {
      client.clear();
      setSessionLost(true);
    };
    const replaced = () => setAccount((value) => value + 1);
    window.addEventListener('party-auth-loss', lost);
    window.addEventListener('party-account-change', replaced);
    return () => {
      window.removeEventListener('party-auth-loss', lost);
      window.removeEventListener('party-account-change', replaced);
    };
  }, [client]);
  return (
    <QueryClientProvider client={client}>
      {sessionLost ? (
        <main className="min-h-screen bg-[#07100f] p-8 text-emerald-100">
          <p>Session expired. Reconnect this browser.</p>
          <button
            className="mt-4 rounded border border-emerald-600 bg-[#0b1916] px-4 py-2 text-emerald-100 hover:bg-emerald-950 hover:text-white"
            onClick={() => window.location.reload()}
          >
            Reconnect
          </button>
        </main>
      ) : (
        <Fragment key={account}>{children}</Fragment>
      )}
    </QueryClientProvider>
  );
}
export function authenticationLost(client: QueryClient) {
  client.clear();
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event('party-auth-loss'));
}
export async function read<T>(
  client: QueryClient,
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(API + path, { cache: 'no-store', signal });
  if (
    response.status === 401 ||
    response.status === 403 ||
    response.redirected
  ) {
    authenticationLost(client);
    throw new ReadError(401, 'Session expired. Reconnect this browser.');
  }
  if (!response.ok)
    throw new ReadError(
      response.status,
      'Reconnecting — showing last received data',
    );
  return response.json() as Promise<T>;
}
export function useVisible() {
  const [visible, setVisible] = useState(
    () => typeof document !== 'undefined' && !document.hidden,
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const change = () => setVisible(!document.hidden);
    change();
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  return visible;
}
export const policies = {
  core: [1000, 1000, 300000],
  // Configuration/rules/marks the dashboard rarely needs fresher than a few
  // seconds old, split out of 'core' so the fast-changing majority there
  // doesn't force a full structural diff of this much larger, slower-changing
  // payload on every 1s poll (and vice versa).
  config: [15000, 15000, 300000],
  fast: [250, 0, 60000],
  inventory: [2000, 0, 60000],
  logs: [1000, 1000, 60000],
  bank: [2000, 2000, 300000],
  market: [10000, 10000, 120000],
  catalog: [0, Infinity, 1800000],
  mail: [2000, 2000, 300000],
} as const;
export function domainOptions(client: QueryClient, domain: Domain) {
  const [interval, staleTime, gcTime] = policies[domain];
  return {
    queryKey:
      domain === 'catalog'
        ? [
            ...key(domain),
            client.getQueryData<Partial<PartyState>>(key('core'))
              ?.referenceRevision || '0',
          ]
        : key(domain),
    staleTime,
    gcTime,
    refetchInterval: interval || (false as false),
    queryFn: async ({
      signal,
    }: {
      signal: AbortSignal;
    }): Promise<Partial<PartyState>> => {
      if (
        domain === 'market' &&
        !client.getQueryData<Partial<PartyState>>(key('core'))
          ?.referenceRevision
      )
        return {
          aldata: await read<ALDataState>(client, '/aldata/market', signal),
        };
      const version = client.getQueryData<{ version: number }>([
        'party',
        'connection',
      ])?.version;
      const sentAt = Date.now();
      const result = await read<
        Partial<PartyState> & {
          serverNow?: number;
          characterDetails?: Record<string, Partial<import('./char').Char>>;
        }
      >(client, `/state?catalog=0&dashboard=1&section=${domain}`, signal);
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (domain === 'catalog') {
        const fields = new Set(['travelPlaces', 'monsterChoices', 'bestiaryCatalog', 'skillCatalog',
          'appearanceChoices', 'merchantCatalog', 'bankVaults', 'referenceRevision']);
        return Object.fromEntries(Object.entries(result).filter(([field]) => fields.has(field)));
      }
      if (domain === 'core') {
        const priorAccount = client.getQueryData<Partial<PartyState>>(
          key('core'),
        )?.accountId;
        if (
          priorAccount &&
          result.accountId &&
          priorAccount !== result.accountId
        ) {
          await client.cancelQueries({
            predicate: (query) => query.queryKey[1] !== 'core',
          });
          client.removeQueries({
            predicate: (query) => query.queryKey[1] !== 'core',
          });
          if (typeof window !== 'undefined')
            window.dispatchEvent(new Event('party-account-change'));
        }
        if (result.serverNow)
          synchronizeDashboardClock(result.serverNow, sentAt, Date.now());
        delete result.serverNow;
        if (!result.characters)
          result.characters = client.getQueryData<Partial<PartyState>>(
            key('core'),
          )?.characters;
        for (const [name, data] of Object.entries(
          result.characterDetails || {},
        ))
          client.setQueryData(
            ['party', 'character', name, 'diagnostics'],
            data,
          );
        for (const [name, data] of Object.entries(
          result.characterDetails || {},
        ))
          client.setQueryData(['party', 'character', name, 'presence'], {
            seenAt:
              Date.now() - Number(data.seenAt || 0) < 10000
                ? Number.MAX_SAFE_INTEGER
                : 0,
          });
        delete result.characterDetails;
      }
      if (domain === 'fast' || domain === 'inventory') {
        const connection = client.getQueryData<{
          version: number;
          healthy: boolean;
        }>(['party', 'connection']);
        if (connection?.healthy || connection?.version !== version)
          return client.getQueryData(key(domain)) || {};
        for (const [name, data] of Object.entries(result.characters || {})) {
          if (domain === 'fast') writeVitals(client, name, data);
          else client.setQueryData(
            [
              'party',
              'character',
              name,
              'inventory',
            ],
            data,
          );
        }
        if (
          domain === 'fast' &&
          !client.getQueryData<Partial<PartyState>>(key('core'))
            ?.referenceRevision
        ) {
          for (const [name, data] of Object.entries(result.characters || {}))
            client.setQueryData(
              ['party', 'character', name, 'diagnostics'],
              data,
            );
          const characters = Object.fromEntries(
            Object.entries(result.characters || {}).map(([name, data]) => [
              name,
              {
                name,
                ctype: data.ctype,
                level: data.level,
                server: data.server,
              },
            ]),
          );
          client.setQueryData(
            key('core'),
            (previous: Partial<PartyState> | undefined) => ({
              ...previous,
              characters,
            }),
          );
        }
      }
      return result;
    },
  };
}
export function useDomain(domain: Domain, needed = true) {
  const client = useQueryClient();
  const visible = useVisible();
  return useQuery({
    ...domainOptions(client, domain),
    enabled: visible && needed,
    ...(domain === 'catalog'
      ? {
          retry: transientRetry,
          retryDelay: 1000,
          refetchOnWindowFocus: true,
          refetchOnReconnect: true,
        }
      : {}),
  });
}
export function transientRetry(count: number, error: Error) {
  return (
    count < 1 &&
    (!(error instanceof ReadError) ||
      error.status >= 500 ||
      error.status === 408 ||
      error.status === 429)
  );
}
export function useMapDefinition(map: string, enabled = true) {
  const client = useQueryClient();
  const visible = useVisible();
  const revision =
    useQuery({
      ...domainOptions(client, 'core'),
      enabled: false,
      select: (data) => data.referenceRevision || '0',
    }).data || '0';
  const result = useQueries({
    queries: [
      {
        queryKey: ['party', 'reference', revision, 'map', map],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          read<MapDefinition>(
            client,
            `/maps/${encodeURIComponent(map)}?revision=${revision}`,
            signal,
          ),
        staleTime: Infinity,
        gcTime: 1800000,
        retry: transientRetry,
        retryDelay: 1000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
    ].filter(() => visible && enabled && !!map),
  })[0];
  return { data: result?.data, isError: result?.isError || false };
}
