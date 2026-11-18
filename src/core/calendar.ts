/**
 * Weekend / holiday skip rules. Days and holidays come from the Canvas (with config fallbacks).
 */
import type { Weekday } from "./types";

export function isWeekend(weekday: Weekday, weekendDays: Weekday[]): boolean {
  return weekendDays.includes(weekday);
}

export function isHoliday(dateKey: string, holidays: string[]): boolean {
  return holidays.includes(dateKey);
}

const NAME_TO_WEEKDAY: Record<string, Weekday> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const FULL_NAMES = new Set([
  "sunday", "monday", "tuesday", "tues", "wednesday", "thursday", "thur", "thurs", "friday", "saturday",
]);

/**
 * Parse ONE weekday token strictly: a 3-letter ("wed") or full ("wednesday") name, any case.
 * Returns null for anything else (so a note like "weekly=..." is never mistaken for a day).
 */
export function parseWeekday(token: string): Weekday | null {
  const t = token.trim().toLowerCase();
  if (t.length !== 3 && !FULL_NAMES.has(t)) return null;
  return NAME_TO_WEEKDAY[t.slice(0, 3)] ?? null;
}

/**
 * Parse a weekend directive value like "Sat, Sun" or "saturday sunday" into Weekday[].
 * Unknown tokens are ignored. Returns null when nothing valid was found (caller keeps default).
 */
export function parseWeekdays(value: string): Weekday[] | null {
  const tokens = value
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase().slice(0, 3))
    .filter(Boolean);
  const days: Weekday[] = [];
  for (const t of tokens) {
    const day = NAME_TO_WEEKDAY[t];
    if (day !== undefined && !days.includes(day)) days.push(day);
  }
  return days.length > 0 ? days : null;
}

/** Extract "YYYY-MM-DD" dates from a holidays directive value (trailing "# label" ignored). */
export function parseHolidays(value: string): string[] {
  const withoutComment = value.split("#")[0] ?? "";
  const matches = withoutComment.match(/\d{4}-\d{2}-\d{2}/g);
  return matches ? [...new Set(matches)] : [];
}
