import { installGameRendering, type GameRenderHost } from './game-rendering.ts';
const game = (globalThis as unknown as {parent: GameRenderHost & {caracAL?: unknown}}).parent;
// Headless installation belongs to the game host, before CODE scope creation.
if (game && !game.caracAL) installGameRendering(game);
