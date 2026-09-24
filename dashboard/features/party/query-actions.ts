import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { API } from './api';
import { authenticationLost, key, type Domain } from './query-cache';

// 'config' (rules/marks/configuration) sits alongside 'core' (live operational
// state) in every one of these groups: most mutations here are dashboard-driven
// settings changes, and the two domains split what used to be one 'core'
// payload, so anything that used to be covered by invalidating 'core' alone
// needs 'config' invalidated too or the user's own change looks stale for up
// to the config domain's poll interval.
const core = ['core', 'config'] as const;
const inventory = ['core', 'config', 'inventory', 'fast'] as const;
const commerce = ['core', 'config', 'inventory', 'fast', 'bank', 'market'] as const;
export const actionDomains = {
  '/merchant/bank-sort': core,
  '/config': core,
  '/formation': core,
  '/focus': core,
  '/farming-mode': core,
  '/hunt-blacklist': core,
  '/hunt-settings': core,
  '/rare-hunting': core,
  '/navigate-to-monster': core,
  '/town-party': core,
  '/restock': core,
  '/escape': core,
  '/bank-party': ['core', 'config', 'bank'],
  '/realm/switch': inventory,
  '/steam/action': inventory,
  '/steam/recover': inventory,
  '/roster/create': core,
  '/bankbois/create': ['core', 'config', 'bank'],
  '/bank/unlock': ['bank', 'core', 'config'],
  '/merchant/clear': core,
  '/merchant/force-stand': core,
  '/merchant/gather': core,
  '/merchant/job/cancel': commerce,
  '/merchant/job/retry': commerce,
  '/merchant/routine-priorities': core,
  '/merchant/blacklist': core,
  '/merchant/stale-orders/clear': commerce,
  '/merchant/activity/clear': ['logs'],
  '/merchant/auto-npc-sale': core,
  '/merchant/rule-conflict': commerce,
  '/deconstruction/mark': core,
  '/deconstruction/auto': core,
  '/merchant/auto-stand': core,
  '/merchant/stand': commerce,
  '/merchant/bid': commerce,
  '/merchant/native-stand': commerce,
  '/merchant/npc-sale': commerce,
  '/merchant/order': commerce,
  '/merchant/exchange-order': commerce,
  '/merchant/aldata-order': commerce,
  '/merchant/aldata-sale': commerce,
  '/merchant/ponty-order': commerce,
  '/merchant/donate': inventory,
  '/merchant/join-giveaway': inventory,
  '/merchant/send-mail': [...commerce, 'mail'],
  '/mail/collect': ['mail', 'inventory', 'config', 'bank', 'core'],
  '/mail/delete': ['mail'],
  '/mail/refresh': ['mail'],
  '/aldata/key': core,
  '/aldata/refresh': ['market', 'core', 'config'],
  '/anniversary/chat-advertise': core,
} satisfies Record<string, readonly Domain[]>;
export type ActionPath =
  | keyof typeof actionDomains
  | '/command'
  | `/slots/${number}/${'spawn' | 'logout'}`
  | `/bankbois/${string}/delete`
  | `/combat-log/${string}/clear`;
export function affectedDomains(
  path: string,
  body?: unknown,
): readonly Domain[] {
  if (path === '/command') {
    const type = (body as { type?: string } | undefined)?.type || '';
    if (type === 'withdraw') return commerce;
    return /travel|town|gold-target/.test(type) ? core : inventory;
  }
  if (/^\/slots\/\d+\/(spawn|logout)$/.test(path)) return inventory;
  if (/^\/bankbois\/[^/]+\/delete$/.test(path)) return ['core', 'config', 'bank'];
  if (/^\/combat-log\/[^/]+\/clear$/.test(path)) return ['logs'];
  const domains = actionDomains[path as keyof typeof actionDomains];
  if (!domains) throw new Error(`Missing action cache policy: ${path}`);
  return domains;
}
export class PartyActionError extends Error {
  readonly status: number;
  readonly details: Record<string, unknown>;
  constructor(status: number, details: Record<string, unknown>) {
    super(typeof details.error === 'string' ? details.error : 'Action failed');
    this.status = status;
    this.details = details;
  }
}
export async function performAction(
  client: QueryClient,
  path: string,
  body: unknown,
) {
  const domains = affectedDomains(path, body);
  await Promise.all(
    domains.map((domain) => client.cancelQueries({ queryKey: key(domain) })),
  );
  const response = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (response.status === 401 || response.status === 403 || response.redirected)
    authenticationLost(client);
  if (!response.ok || response.redirected) {
    if (response.status === 409 && Array.isArray(result.missing))
      await Promise.all(
        commerce.map((domain) =>
          client.invalidateQueries({
            queryKey: key(domain),
            refetchType: 'active',
          }),
        ),
      );
    throw new PartyActionError(response.status, result);
  }
  if (path.startsWith('/mail/') && Array.isArray(result.messages))
    client.setQueryData(key('mail'), result);
  // A successful enqueue is not an inventory receipt. Keep confirmed items until a later observation.
  await Promise.all(
    domains.map((domain) =>
      client.invalidateQueries({
        queryKey: key(domain),
        refetchType: 'active',
      }),
    ),
  );
  return result;
}
export function usePartyAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: ActionPath; body: unknown }) =>
      performAction(client, path, body),
    retry: false,
    networkMode: 'always',
  });
}
