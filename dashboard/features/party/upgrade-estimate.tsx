'use client';
import { useEffect, useState } from 'react';
import {
  estimateUpgradeBatch,
  type UpgradeChoice,
  type UpgradeEstimate,
} from '../../../runtime/upgrade-estimate.ts';
export { highestUpgradeLevel } from '../../../runtime/upgrade-estimate.ts';
export type { UpgradeEstimate } from '../../../runtime/upgrade-estimate.ts';
export type EstimateState = UpgradeEstimate | { status: 'pending' };
export function useUpgradeEstimates(
  lines: {
    item: UpgradeChoice;
    quantity: number;
    target: number;
    key: string;
  }[],
) {
  const signature = JSON.stringify(
    lines.map((line) => ({
      ...line,
      item: {
        id: line.item.id,
        cost: line.item.cost,
        upgradeable: line.item.upgradeable,
        upgradeGrade: line.item.upgradeGrade,
        upgradeChances: line.item.upgradeChances,
        grades: line.item.grades,
        scrollCosts: line.item.scrollCosts,
      },
    })),
  );
  const [stored, setStored] = useState<{
    signature: string;
    values: Record<string, EstimateState>;
  }>({ signature: '', values: {} });
  useEffect(() => {
    const lines = JSON.parse(signature) as {
      item: UpgradeChoice;
      quantity: number;
      target: number;
      key: string;
    }[];
    let current = true;
    const abort = new AbortController();
    const values: Record<string, EstimateState> = {};
    for (const line of lines) values[line.key] = { status: 'pending' };
    void estimateUpgradeBatch(
      lines.map((line) => ({
        choice: line.item,
        quantity: line.quantity,
        target: line.target,
      })),
      abort.signal,
    )
      .then((results) => {
        if (current) {
          lines.forEach((line, index) => {
            values[line.key] = results[index]!;
          });
          setStored({ signature, values: { ...values } });
        }
      })
      .catch(() => {
        if (current) {
          for (const line of lines)
            values[line.key] = {
              status: 'unavailable',
              completed: 0,
              rolls: 0,
            };
          setStored({ signature, values: { ...values } });
        }
      });
    return () => {
      current = false;
      abort.abort();
    };
  }, [signature]);
  return stored.signature === signature
    ? stored.values
    : Object.fromEntries(
        lines.map((line) => [line.key, { status: 'pending' } as EstimateState]),
      );
}
