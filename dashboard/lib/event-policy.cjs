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

// dashboard/lib/event-policy.ts
var event_policy_exports = {};
__export(event_policy_exports, {
  eventEnabled: () => eventEnabled,
  eventPolicy: () => eventPolicy,
  selectedEvents: () => selectedEvents,
  supportedEvents: () => supportedEvents
});
module.exports = __toCommonJS(event_policy_exports);
var supportedEvents = ["anniversary", "abtesting", "goobrawl", "crabxx", "franky", "icegolem", "snowman"];
function selectedEvents(party, name) {
  const source = eventPolicy(party, name).source;
  const saved = party.eventSelectionsByCharacter?.[source];
  const selections = saved ?? ["anniversary", ...party.eventsByCharacter?.[source] ? supportedEvents.filter((id) => id !== "anniversary") : []];
  return selections.filter((id) => supportedEvents.includes(id));
}
function eventEnabled(party, name, event) {
  return selectedEvents(party, name).includes(event);
}
function eventPolicy(party, name) {
  const inherited = Boolean(
    party.leader && name !== party.leader && name !== party.merchantCharacter && party.followers?.[name]
  );
  const source = inherited ? party.leader : name;
  return {
    inherited,
    source,
    enabled: party.eventSelectionsByCharacter?.[source] ? party.eventSelectionsByCharacter[source].some((id) => id !== "anniversary" && supportedEvents.includes(id)) : Boolean(party.eventsByCharacter?.[source])
  };
}
