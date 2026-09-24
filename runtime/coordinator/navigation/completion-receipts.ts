/** One latest receipt per owned character; replay never mutates navigation. */
export interface CompletionReceipts { convoyCompletionReceipts?: Record<string, string> }

export function completionKey(body: Record<string, unknown>): string {
  return JSON.stringify([body.convoyId, Number(body.epoch), Number(body.commandId),
    body.runtimeId, Number(body.navigationRevision), Number(body.routeVersion)]);
}

export function rememberCompletion(state: CompletionReceipts, name: string, body: Record<string, unknown>): void {
  (state.convoyCompletionReceipts ||= {})[name] = completionKey(body);
}
