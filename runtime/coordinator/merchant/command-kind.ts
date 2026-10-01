import type { MerchantWork } from "./work.ts";

const commandTypes: Readonly<Record<string, string>> = {
  "bank unlock": "merchant-bank-unlock",
  "manual bank exchange": "merchant-self-bank",
  "native stand funding": "merchant-self-bank",
  restock: "merchant-self-restock",
  "merchant commerce": "merchant-commerce",
  exchange: "merchant-exchange",
  "merchant donation": "merchant-donate",
  "stand search": "merchant-stand-search",
  "join giveaway": "merchant-join-giveaway",
  "send mail": "merchant-send-mail",
  "collect mail": "merchant-collect-mail",
  "Ponty purchases": "merchant-ponty-buy",
  "ALData marketplace purchases": "merchant-aldata-buy",
  "ALData marketplace sales": "merchant-aldata-sell",
  "ALData authentication": "merchant-aldata-auth",
  "stand purchases": "merchant-stand-buy",
  "stand bid purchases": "merchant-stand-buy",
  "npc sales": "merchant-npc-sale",
  "auto npc sales": "merchant-npc-sale",
  "deconstruction": "merchant-deconstruct",
};

export function ownCommandType(job: MerchantWork): string {
  if (job.reason === "stand maintenance" && job.inPlaceStandSync) return "merchant-stand-sync";
  return commandTypes[job.reason] || "merchant-self-improve";
}

const descriptions: Readonly<Record<string, string>> = {
  "auto upgrade": "Merchant dispatched for automatic upgrades",
  "upgrade preview": "Merchant dispatched to refresh upgrade chances",
  "manual upgrades": "Merchant dispatched for manual upgrades",
  "bank unlock": "Merchant dispatched to unlock bank storage",
  "manual bank exchange": "Merchant dispatched for its own bank exchange",
  restock: "Merchant dispatched to restock its potions",
  "merchant commerce": "Merchant dispatched for shopping and crafting",
  exchange: "Merchant dispatched for item exchanges",
  "Ponty purchases": "Merchant dispatched to buy from Ponty",
  "ALData marketplace purchases": "Merchant dispatched for an ALData marketplace purchase",
  "ALData marketplace sales": "Merchant dispatched to fill an ALData marketplace buy order",
  "ALData authentication": "Merchant dispatched to send the ALData authentication key",
  "stand purchases": "Merchant dispatched to buy from player stands",
  "npc sales": "Merchant dispatched to sell marked items to an NPC",
  "deconstruction": "Merchant dispatched to deconstruct marked items",
};

const dynamicDescriptions: Readonly<Record<string, (job: MerchantWork) => string>> = {
  "merchant donation": (job) =>
    "Merchant dispatched to donate " + Number(job.amount).toLocaleString() + " gold",
  "stand search": (job) => "Merchant searching player stands for " + job.itemId,
  "join giveaway": (job) => "Merchant dispatched to join " + job.seller + "'s giveaway",
  "stand bid purchases": (job) => "Merchant dispatched to fill bid for " + job.bidItemId,
};

export function ownCommandDescription(job: MerchantWork): string {
  if (job.reason === "stand maintenance" && job.inPlaceStandSync)
    return "Merchant synchronizing marked inventory into persistent stand storage";
  return (
    descriptions[job.reason] ||
    dynamicDescriptions[job.reason]?.(job) ||
    "Merchant dispatched for its own upgrades and compounds"
  );
}
