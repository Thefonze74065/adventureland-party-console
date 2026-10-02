import { requestObject } from '../http/contracts.ts';

/** Plain bank withdrawal marks; specialized production and BankBoi jobs keep their own scheduling. */
export function hasMarkedWithdrawals(requests: readonly unknown[] = []): boolean {
  return requests.some(value => {
    const request = requestObject(value);
    return typeof request.pack === 'string' && !request.pack.startsWith('bankboi:') &&
      !['improvement', 'standListingId', 'deconstructionId', 'craftJobId', 'mailJobId']
        .some(key => request[key]);
  });
}
