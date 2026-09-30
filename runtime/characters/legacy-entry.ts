import type { RoleRunner } from "./roles/types.ts";
import './movement.ts';
import './game-rendering-entry.ts';
import './bank-stacks.ts';
import './upgrade-preview.ts';

const root = globalThis as unknown as {
  parent: { caracAL: { load_scripts(files: string[]): Promise<void> } };
  partyRoleRunner: RoleRunner;
  __partyReady: Promise<void>;
};
// Compatibility entry for upstream caracAL. The upgraded coordinator selects a
// verified class artifact directly, without these intermediate loads.
root.__partyReady = root.parent.caracAL
  .load_scripts([
    "adventure_land/farming-zones.js",
    "adventure_land/shared.js",
    "adventure_land/profiles.js",
    "adventure_land/roles.js",
  ])
  .then(() => root.partyRoleRunner.start());
