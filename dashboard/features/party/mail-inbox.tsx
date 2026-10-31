"use client";
import { ReceivedMail } from "./received-mail";

export type MailInbox = {
  messages: ReceivedMail[];
  newCount?:number;
  settings?:{autoCollect:boolean;autoDelete:boolean};
  outbox?:import("../../../runtime/coordinator/commerce/mailbox").SentMailRecord[];
  count: number;
  updatedAt: number | null;
  error: string | null;
  automationError?: string | null;
};
