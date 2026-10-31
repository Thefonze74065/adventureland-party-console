/** Transport failures leave durable storage work retryable; game rejections do not. */
export function retryableStorageError(error: string | null | undefined): boolean {
  return /^(bank_unavailable|not_in_bank|interrupted)$/.test(error || '') ||
    (error || '').startsWith('bank data did not load:') ||
    /Cannot read properties of undefined \(reading 'items1'\)/.test(error || '') ||
    /^(GET|POST) \/(movement-plan|merchant\/bank-sort\/checkpoint|bankboi\/(checkpoint|complete)) · (network|timeout)(:.*)?$/.test(error || '');
}
