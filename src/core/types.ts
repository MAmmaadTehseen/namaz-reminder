/**
 * Domain types for the namaz reminder engine.
 * This module is framework-agnostic — no imports of next/react/server-only.
 */

/** 0 = Sunday ... 6 = Saturday (matches JS Date.getDay + Intl weekday mapping used here). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** A single prayer parsed from the Canvas. */
export interface PrayerSlot {
  /** Lowercased identifier, e.g. "zuhr". Used as the stable dedupe key part. */
  key: string;
  /** Time as written, "HH:MM" 24-hour. */
  time: string;
  /** Minutes since local midnight for `time`. */
  minutes: number;
  /** Resolved lead time N (per-prayer `off=` override, else the schedule default). */
  offsetMin: number;
  /** Optional short note appended to the standard message, e.g. "on second floor". */
  note?: string;
  /** Optional full message template overriding the default; supports {time} {time24} {prayer}. */
  template?: string;
  /** false when the Canvas line was commented out (`# zuhr = ...`). */
  enabled: boolean;
  /** true when this slot was filled from last-known-good because the Canvas line failed to parse. */
  fromLastKnownGood?: boolean;
}

/** The full parsed schedule + any validation notes. */
export interface ParsedSchedule {
  /** Soft kill switch from the Canvas `Status:` line. */
  status: "on" | "off";
  /** Global lead time (from `default_offset`, else the config fallback). */
  defaultOffset: number;
  /** Days to skip (from `Weekend:`, else the config default). */
  weekendDays: Weekday[];
  /** Dates to skip, "YYYY-MM-DD" (from `Holidays:`). */
  holidays: string[];
  /** All recognised prayer lines (enabled + disabled). */
  prayers: PrayerSlot[];
  /** Non-fatal issues (duplicate keys, unknown directives). */
  warnings: string[];
  /** Hard parse failures (malformed time lines) — trigger an owner alert. */
  errors: string[];
}

/** Persisted "last valid time we saw for each prayer", used as a fallback on parse failure. */
export type LastKnownGood = Record<string, { time: string; offsetMin: number }>;

/** Result of a single tick, returned to the CI script (logged) / dashboard. */
export interface TickResult {
  status: "posted" | "skipped" | "noop" | "error";
  reason?: string;
  /** dedupe keys posted this run, e.g. ["asr@17:00"]. */
  posted: string[];
  /** prayers that were due but already sent today. */
  alreadySent: string[];
  /** prayers whose window is not open yet / already passed. */
  notDue: string[];
  /** parse/network problems surfaced this run. */
  problems: string[];
  /** Canvas last-edited unix ts, when available (freshness signal). */
  canvasEditTimestamp: number | null;
  /** true when DRY_RUN suppressed real posting. */
  dryRun: boolean;
}
