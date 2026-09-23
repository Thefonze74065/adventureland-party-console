// Generated from TypeScript. Run npm run build:shared -- --publish; do not edit.

"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// dashboard/lib/account-inventory.ts
var account_inventory_exports = {};
__export(account_inventory_exports, {
  inventoryCounts: () => inventoryCounts
});
module.exports = __toCommonJS(account_inventory_exports);
function inventoryCounts(characters = [], bank = null, bankbois = [], byLevel = false) {
  const totals = {};
  const storageNames = new Set(bankbois.map((entry) => entry.name));
  const add = (entry) => {
    if (!entry?.item) return;
    const item = entry.item;
    const key = byLevel ? `${item.name}@${item.level || 0}` : String(item.name);
    totals[key] = (totals[key] || 0) + Math.max(1, Number(item.q) || 1);
  };
  characters.filter((entry) => entry && !storageNames.has(entry.name)).forEach((entry) => (entry.items || []).forEach(add));
  Object.values(bank?.packs || {}).forEach((pack) => (pack || []).forEach(add));
  bankbois.forEach((entry) => (entry.items || []).forEach(add));
  return totals;
}
