interface EventFormation {
  leader?: string | null;
  merchantCharacter?: string | null;
  followers?: Record<string, boolean>;
  eventsByCharacter?: Record<string, boolean>;
  eventSelectionsByCharacter?: Record<string, string[]>;
}

export const supportedEvents = ["anniversary", "abtesting", "goobrawl", "crabxx", "franky", "icegolem", "snowman", "halloween"];

export function selectedEvents(party: EventFormation, name: string): string[] {
  const source = eventPolicy(party, name).source;
  const saved = party.eventSelectionsByCharacter?.[source];
  const selections = saved ?? ["anniversary", ...(party.eventsByCharacter?.[source] ? supportedEvents.filter(id => id !== "anniversary") : [])];
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
