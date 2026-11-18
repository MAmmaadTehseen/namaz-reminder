/**
 * Resolve a prayer's effective slot for one local day.
 *
 * Precedence (most specific wins):
 *   1. a one-off date override   `2026-12-25=13:00`  — also beats `skip=` (it's an explicit ask)
 *   2. `skip=Fri`                                    — no reminder that weekday
 *   3. a weekday override        `wed=16:45`
 *   4. the base time             `asr = 17:00`
 *
 * The returned slot carries the effective `time`/`minutes`, so the dedupe key (`asr@16:45`),
 * the window check and the message text all use the time that actually applies today.
 * Weekend/holiday skips are global and are handled before this (see pipeline.ts).
 */
import type { PrayerSlot, Weekday } from "./types";
import { parseHHMM } from "./time";

export function resolveForDay(
  prayer: PrayerSlot,
  dateKey: string,
  weekday: Weekday,
): PrayerSlot | null {
  const dateTime = prayer.dateTimes?.[dateKey];
  if (dateTime) return withTime(prayer, dateTime);

  if (prayer.skipDays?.includes(weekday)) return null;

  const weekdayTime = prayer.weekdayTimes?.[weekday];
  if (weekdayTime) return withTime(prayer, weekdayTime);

  return prayer;
}

function withTime(prayer: PrayerSlot, time: string): PrayerSlot {
  const minutes = parseHHMM(time);
  // Overrides are validated at parse time; this guard only protects hand-built slots.
  if (minutes === null) return prayer;
  return { ...prayer, time, minutes };
}
