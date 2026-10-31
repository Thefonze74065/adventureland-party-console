import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";

export interface MailInbox {
  snapshot(): unknown;
  refresh(): Promise<unknown>;
  collect(id: string): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  configure?(input:unknown):Promise<unknown>;
  seen?():unknown;
  removeSent?(id:string):unknown;
  sent?(id:string,mail:unknown):void;
  complete(id: string, success: boolean, error: unknown): void;
}
export function createMailInboxRoutes(inbox: MailInbox) {
  function snapshot(_req: HttpRequest, res: HttpResponse): unknown {
    return res.json(inbox.snapshot());
  }
  async function perform(name: string, body: unknown, id: string): Promise<unknown> {
    if (name === 'settings') return inbox.configure?.(body);
    if (name === 'seen') return inbox.seen?.();
    if (name === 'outbox-delete') return inbox.removeSent?.(id);
    if (name === 'refresh') return inbox.refresh();
    if (name === 'collect') return inbox.collect(id);
    return inbox.remove(id);
  }
  function action(name: "refresh" | "collect" | "delete" | "settings" | "seen" | "outbox-delete") {
    return async function handle(req: HttpRequest, res: HttpResponse): Promise<unknown> {
      try {
        const id = requestText(requestObject(req.body).id || "");
        const result = await perform(name, req.body, id);
        return res.json(result);
      } catch (error) {
        return res.status(409).json({ error: requestObject(error).message });
      }
    };
  }
  return { snapshot, action };
}
