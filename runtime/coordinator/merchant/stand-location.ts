import type { ICoord } from 'typed-adventureland';
import { requestObject, type HttpRequest, type HttpResponse } from '../http/contracts.ts';

export interface MerchantStandLocation extends ICoord { map: 'main' }
export const legacyStandLocation: MerchantStandLocation = {map:'main',x:-63,y:100};
export function validStandLocation(value: unknown): value is MerchantStandLocation {
  if (!value || typeof value !== 'object') return false;
  const point = value as MerchantStandLocation;
  return point.map === 'main' && Number.isFinite(point.x) && Number.isFinite(point.y);
}
interface State { merchantStandLocation: MerchantStandLocation | null }
type CanStand = (x: number, y: number) => boolean;

export function initializeStandLocation(state: State, firstSetup: boolean, canStand: CanStand): boolean {
  if (state.merchantStandLocation) return false;
  if (!firstSetup) {
    state.merchantStandLocation = {...legacyStandLocation};
    return true;
  }
  // Retry rejected points, then inspect the randomized grid once so setup is
  // bounded even if the native map only has a small valid patch in this area.
  const start = Math.floor(Math.random() * 40401);
  for (let attempt = 0; attempt < 256; attempt++) {
    const x = Math.floor(Math.random()*201)-100, y = Math.floor(Math.random()*201)-100;
    if (canStand(x,y)) { state.merchantStandLocation = {map:'main',x,y}; return true; }
  }
  for (let offset = 0; offset < 40401; offset++) {
    const cell = (start + offset) % 40401;
    const x = cell%201-100, y = Math.floor(cell/201)-100;
    if (canStand(x,y)) { state.merchantStandLocation = {map:'main',x,y}; return true; }
  }
  throw Error('No valid merchant stand location in Main setup area');
}

export function standLocationRoute(state: State, canStand: CanStand, persist: () => void) {
  return (req: HttpRequest, res: HttpResponse) => {
    const point = requestObject(req.body);
    if (!validStandLocation(point) || !canStand(point.x,point.y))
      return res.status(400).json({error:'Choose a valid, clear merchant stand location on Main'});
    state.merchantStandLocation = {map:'main',x:point.x,y:point.y};
    persist();
    return res.json({ok:true,merchantStandLocation:state.merchantStandLocation});
  };
}
