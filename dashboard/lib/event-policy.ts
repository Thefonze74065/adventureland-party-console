interface EventFormation {
  leader?: string | null;
  merchantCharacter?: string | null;
  followers?: Record<string, boolean>;
  eventsByCharacter?: Record<string, boolean>;
  eventSelectionsByCharacter?: Record<string, string[]>;
}

// Persisted legacy all-events flags cover the catalog available when saved.
// Newly supported fights require an explicit selection, rather than opt-in on upgrade.
const legacyDefaultEvents = ["anniversary", "abtesting", "goobrawl", "crabxx", "franky", "icegolem", "snowman"];
export const supportedEvents = [...legacyDefaultEvents, "slenderman", "mrgreen", "mrpumpkin"];
export const eventDisplayNames: Record<string, string> = {
  anniversary: "Anniversary", abtesting: "A/B Testing", goobrawl: "Goobrawl",
  crabxx: "Crabxx", franky: "Franky", icegolem: "Ice Golem", snowman: "Snowman",
  slenderman: "Slenderman", mrgreen: "Mr. Green", mrpumpkin: "Mr. Pumpkin",
};

export function selectedEvents(party: EventFormation, name: string): string[] {
  const source = eventPolicy(party, name).source;
  const saved = party.eventSelectionsByCharacter?.[source];
  const selections = saved ?? ["anniversary", ...(party.eventsByCharacter?.[source] ? legacyDefaultEvents.filter(id => id !== "anniversary") : [])];
  return selections.filter(id => supportedEvents.includes(id));
}

export function eventEnabled(party: EventFormation, name: string, event: string) {
  return selectedEvents(party, name).includes(event);
}

export function eventPolicy(party: EventFormation, name: string) {
  const inherited = Boolean(
    party.leader &&
    name !== party.leader &&
    name !== party.merchantCharacter &&
    party.followers?.[name],
  );
  const source = inherited ? party.leader! : name;
  return {
    inherited,
    source,
    enabled: party.eventSelectionsByCharacter?.[source]
      ? party.eventSelectionsByCharacter[source].some(id => id !== "anniversary" && supportedEvents.includes(id))
      : Boolean(party.eventsByCharacter?.[source]),
  };
}
