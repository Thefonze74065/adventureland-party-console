import { availableCraftStock } from "../craft-reservations.ts";
Object.assign(globalThis, {partyAvailableCraftStock: availableCraftStock});

import { resolveUpgradeOffering } from '../upgrade-offerings.ts';
Object.assign(globalThis, {partyResolveUpgradeOffering: resolveUpgradeOffering});

import { chanceGuard, chanceHold, scrollGradeFor } from '../upgrade-chance-guard.ts';
Object.assign(globalThis, {partyChanceGuard: chanceGuard, partyChanceHold: chanceHold, partyScrollGrade: scrollGradeFor});
