import { requestObject } from "../http/contracts.ts";
import type { OrderChoice, OrderLine } from "./order-types.ts";
import { highestUpgradeLevel } from "./upgrade-estimate.ts";

function validLevel(choice: OrderChoice, level: number): boolean {
  const max = highestUpgradeLevel(choice);
  return (
    Number.isSafeInteger(level) && level >= 0 && level <= max && !(level > 0 && !choice.upgradeable)
  );
}
function validQuantity(quantity: number): boolean {
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 9999;
}
function validCap(cap: unknown): cap is number | undefined {
  return cap === undefined || (typeof cap === "number" && Number.isSafeInteger(cap) && cap > 0);
}
function levelFields(line: Record<string, unknown>, level: number): Partial<OrderLine> {
  const fields: Partial<OrderLine> = {};
  if (level) fields.level = level;
  if (typeof line.goldCap === "number") fields.goldCap = line.goldCap;
  if (line.acknowledgeUnavailable === true) fields.acknowledgeUnavailable = true;
  return fields;
}

function normalizeLine(
  raw: unknown,
  choices: OrderChoice[],
  allowLevel: boolean,
): OrderLine | null {
  const line = requestObject(raw),
    quantity = Number(line.quantity);
  const choice = choices.find((entry) => entry.id === line.id);
  if (typeof line.id !== "string" || !choice || !validQuantity(quantity)) return null;
  const level = Number(line.level) || 0;
  if (allowLevel && !validLevel(choice, level)) return null;
  const cap = line.goldCap;
  if (!validCap(cap)) return null;
  return {
    id: line.id,
    quantity,
    ...(allowLevel ? levelFields(line, level) : {}),
  };
}

export function normalizeOrderLines(
  lines: unknown,
  choices: OrderChoice[],
  allowLevel: boolean,
): OrderLine[] | null {
  if (!Array.isArray(lines) || lines.length > 100) return null;
  const result: OrderLine[] = [];
  for (const raw of lines) {
    const line = normalizeLine(raw, choices, allowLevel);
    if (!line) return null;
    result.push(line);
  }
  return result;
}
