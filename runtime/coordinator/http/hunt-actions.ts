import {createHuntSettingsRoute} from "./hunt-settings.ts";
import { createHuntModeRoute } from "./hunt-mode.ts";
import type { Catalog } from "../../../dashboard/lib/farming-zones.ts";
import { createHuntControlRoutes, createHuntBlacklistRoute } from "./hunt-control.ts";
import { createEncounterModeRoute } from "./encounter-mode.ts";

type HuntState = Parameters<typeof createHuntModeRoute>[0] &
  Parameters<typeof createHuntControlRoutes>[0] &
  Parameters<typeof createHuntBlacklistRoute>[0] &
  Parameters<typeof createEncounterModeRoute>[0] & { monsterChoices?: Catalog | null };
type ModePorts = Parameters<typeof createHuntModeRoute>[1];
type HuntPorts = Omit<ModePorts, "fighting" | "cancelled" | "validLocation"> &
  Omit<Parameters<typeof createHuntControlRoutes>[1], "cancelled"> & {
    now: () => number;
    fighting: (state: HuntState, names: string[]) => boolean;
    intent: (name: string) => { cancelled: boolean };
    validLocation: (
      catalog: Catalog,
      ...args: Parameters<ModePorts["validLocation"]>
    ) => ReturnType<ModePorts["validLocation"]>;
  };

/** Hunt controls consult the same current navigation intents, combat party and destination catalog. */
export function createCoordinatorHuntActions(state: HuntState, ports: HuntPorts) {
  const shared = { ...ports, cancelled: (name: string) => ports.intent(name).cancelled };
  const mode = createHuntModeRoute(state, {
    ...shared,
    fighting: () => ports.fighting(state, ports.participants()),
    validLocation: (focus, location) =>
      ports.validLocation(state.monsterChoices || [], focus, location),
  });
  const blacklist = createHuntBlacklistRoute(state, shared);
  const controls = createHuntControlRoutes(state, shared);
  const settings = createHuntSettingsRoute(state, shared);
  const encounterMode = createEncounterModeRoute(state, shared);
  return { mode, blacklist, controls, settings, encounterMode };
}
