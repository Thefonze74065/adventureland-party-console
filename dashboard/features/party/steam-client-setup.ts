/** Carry existing browser-local setup choices to the local launcher on first use. */
export function steamClientSetup(body: unknown, storage?: Pick<Storage, 'getItem'>): unknown {
  if (!body || typeof body !== 'object' || !storage) return body;
  try {
    const setup = JSON.parse(storage.getItem('party-connection-setup') || 'null');
    if (!setup || !['same', 'remote'].includes(setup.placement) ||
        !['windows-steam', 'linux-steam', 'windows-browser', 'linux-browser'].includes(setup.client)) return body;
    return { ...body, clientSetup: { placement: setup.placement, client: setup.client } };
  } catch { return body; }
}
