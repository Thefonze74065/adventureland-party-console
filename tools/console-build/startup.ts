import type {ConsoleBuildStore} from './store.ts';
import type {ConsoleBuildController} from './controller.ts';

/** Freeze the completed selection at launch; builds finishing later stay staged. */
export async function startupCandidate(store: ConsoleBuildStore) {
  const refs = await store.references();
  const active = refs.active ? await store.verify(refs.active) : undefined;
  if (!refs.latest || refs.latest === refs.active) return active;
  const latest = await store.verify(refs.latest);
  return !active || latest.manifest.createdAt >= active.manifest.createdAt ? latest : active;
}

/** Reuse normal deployment acknowledgements and rollback after startup recovery. */
export async function deployStartupCandidate(controller: ConsoleBuildController, id?: string): Promise<void> {
  if (!id || (await controller.store.references()).active === id) return;
  console.log('Deploying completed console candidate at startup: ' + id);
  const accepted = await controller.deploy(id);
  while (true) {
    const operation = await controller.store.journal();
    if (!operation || operation.id !== accepted.id) throw Error('Startup console deployment was replaced');
    if (operation.phase === 'complete') return;
    if (operation.phase === 'failed') throw Error('Startup console deployment failed: ' + operation.error);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}
