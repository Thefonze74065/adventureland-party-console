export function huntBlacklistLabel(entry: {deaths: number; expirations?: number; reason?: string}): string {
  if (entry.reason === 'Manually blacklisted') return 'manually added';
  const expired = entry.expirations ?? (entry.reason === 'Hunt quest expired before completion' ? 1 : 0);
  return [entry.deaths ? `${entry.deaths} hunt death${entry.deaths === 1 ? '' : 's'}` : '',
    expired ? `${expired} hunt${expired === 1 ? '' : 's'} expired` : ''].filter(Boolean).join(' · ');
}
