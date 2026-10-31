import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {createManagedConsole} from './hosting.ts';
import {ConsoleBuildStore} from './store.ts';
import {startupCandidate} from './startup.ts';

/** A deliberate launch selects the newest completed host implementation and
 * deploys that same frozen candidate after recovering any interrupted operation. */
export async function loadManagedConsole(...args: Parameters<typeof createManagedConsole>): Promise<Awaited<ReturnType<typeof createManagedConsole>>> {
  const [root] = args;
  const store = new ConsoleBuildStore(root);
  const selected = await startupCandidate(store);
  const implementation: typeof import('./hosting.ts') = selected
    ? await import(pathToFileURL(path.join(selected.directory, 'tools/console-build/hosting.ts')).href)
    : await import('./hosting.ts');
  if (typeof implementation.createManagedConsole !== 'function') throw new Error('Active candidate lacks its managed host implementation');
  return implementation.createManagedConsole(root, args[1], {...args[2], startupCandidateId: selected?.manifest.id});
}
