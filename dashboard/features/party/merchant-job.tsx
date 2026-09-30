"use client";

export type MerchantJob = {
  pauseReason?: string;
  retryAt?: number;
  operationStage?: 'retrieving' | 'processing' | 'storing';
  seller?: string;
  expectedItem?: { name?: string; level?: number };
  commandReport?: { state?: string; reason?: string | null };
  realmBlockedReason?: string;
  realmRetryExhausted?: boolean;
  collectionLabel?: string;
  collectionSlots?: number;
  collectionThreshold?: number;
  collectionNearby?: boolean;
  id?: string;
  target: string;
  reason: string;
  routine?: string;
  autoExchangeKeys?: string[];
  manual?: boolean;
  phase?: string;
  priority?: number;
  order?: {
    buys?: { itemId?: string; quantity?: number; desiredLevel?: number }[];
    crafts?: { itemId?: string; quantity?: number }[];
  };
  bidItemId?: string;
  listings?: {
    item?: { name?: string; level?: number };
    buyQuantity?: number;
    quantity?: number;
    serverRegion?: string;
    serverIdentifier?: string;
  }[];
};
