/**
 * Timezone-correct local time helpers.
 *
 * GitHub Actions runs cron in UTC, so we NEVER trust the process clock's local zone.
 * We compute the wall-clock in a fixed IANA zone (default Asia/Karachi, UTC+5, no DST)
 * via Intl.DateTimeFormat — deterministic and DST-safe.
 */
import type { Weekday } from "./types";

export const DEFAULT_TZ = "Asia/Karachi";

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  weekday: Weekday; // 0=Sun..6=Sat
  dateKey: string; // "YYYY-MM-DD"
  minutesSinceMidnight: number;
}

const WEEKDAY_INDEX: Record<string, Weekday> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Extract local wall-clock parts for `now` in the given IANA timezone. */
export function getLocalParts(now: Date, timeZone: string = DEFAULT_TZ): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const weekday = WEEKDAY_INDEX[get("weekday")] ?? 0;
  const dateKey = `${pad4(year)}-${pad2(month)}-${pad2(day)}`;

  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday,
    dateKey,
    minutesSinceMidnight: hour * 60 + minute,
  };
}

/** Parse "HH:MM" (24-hour) to minutes since midnight, or null if malformed. */
export function parseHHMM(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Format "HH:MM" (24h) as a friendly 12-hour string, e.g. "14:05" -> "2:05 PM". */
export function to12Hour(value: string): string {
  const minutes = parseHHMM(value);
  if (minutes === null) return value;
  const h24 = Math.floor(minutes / 60);
  const min = minutes % 60;
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad2(min)} ${period}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function pad4(n: number): string {
  return String(n).padStart(4, "0");
}
