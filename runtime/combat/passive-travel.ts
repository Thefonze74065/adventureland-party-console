import type {PassiveSettings} from '../coordinator/navigation/passive-settings.ts';
export type PassiveTravelSettings = Pick<PassiveSettings, 'rules'>;
/** An explicit enabled stop rule wins over Hunt's moving-attack exception. */
export function passiveStopRequired(settings: PassiveTravelSettings | undefined, mtype: string): boolean {
  const rule=settings?.rules[mtype];
  return !!rule?.enabled && rule.keepMoving===false;
}
