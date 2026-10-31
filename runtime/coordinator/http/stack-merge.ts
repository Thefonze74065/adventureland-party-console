import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { Item } from "../contracts/item.ts";

interface Merge {
  from: unknown;
  to: unknown;
  source: Item;
  target: Item;
  quantity?: number;
}
interface StackMergeState {
  merchantCharacter: string | null;
  statuses: Record<string, { seenAt?: number } | undefined>;
}
interface StackMergePorts {
  now(): number;
  anniversary(): { reserved?: unknown; busy?: unknown };
  bankboiBusy(): boolean;
  plan(boundary?: {jobId?: unknown; commandId?: unknown; command?: unknown}): Merge | null | false;
  identity(item: unknown): unknown;
}
export function createStackMergeRoute(state: StackMergeState, ports: StackMergePorts) {
  function permitted(body: Record<string, unknown>): boolean {
    const merchant = state.merchantCharacter,
      status = state.statuses[String(merchant)],
      anniversary = ports.anniversary();
    return (
      body.character === merchant &&
      Number(status?.seenAt) >= ports.now() - 10000 &&
      !anniversary.reserved &&
      !anniversary.busy &&
      !ports.bankboiBusy()
    );
  }
  function matches(planned: Merge, proposed: Record<string, unknown>): boolean {
    if (planned.from !== proposed.from || planned.to !== proposed.to || planned.quantity !== proposed.quantity) return false;
    return (["source", "target"] as const).every(
      (key) =>
        ports.identity(planned[key]) === ports.identity(proposed[key]) &&
        Number(planned[key].q) === Number(requestObject(proposed[key]).q),
    );
  }
  return function merge(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      planned = permitted(body) && ports.plan(body);
    return res.json({
      allowed: !!(planned && body.merge && matches(planned, requestObject(body.merge))),
      ...(body.next ? {merge: planned || null} : {}),
    });
  };
}
