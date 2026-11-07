export {
  formatEventDate,
  formatEventDay,
  formatEventTime,
  formatLocale,
  timeLeftUntil,
} from './time';
export type { EventZone, TimeLeft } from './time';
export { instantFromWallTime, timeZoneOptions, wallTimeOf } from './zoned-input';
export type { WallTime, ZonedInstant } from './zoned-input';

/** The backend's own default zone (docs/API.md §6), for pages no event names one for. */
export const DEFAULT_TIME_ZONE = 'Asia/Yerevan';
