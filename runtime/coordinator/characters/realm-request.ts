/** Durable coordinator travel intent, distinct from the account's native home. */
export interface RealmRequest {
  realm: string;
  owner: 'home' | 'job';
  requestedAt: number;
  attempts: number;
  exhausted?: boolean;
}

export function realmRequestArrived(status: {server?: string; seenAt?: number} | undefined, request: RealmRequest, now: number): boolean {
  return Number(status?.seenAt) > request.requestedAt && Number(status?.seenAt) >= now - 3000 &&
    'SR_' + String(status?.server || '').replace(/^SR_/, '') === request.realm;
}
