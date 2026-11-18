/**
 * runTick: one poll of the reminder engine. Pure orchestration over the other core modules.
 *
 * Order: kill switch -> read Canvas -> parse+validate -> soft switch / weekend / holiday
 *        -> per-prayer day override/skip -> window+dedupe -> (+ verse/hadith) -> post
 *        -> persist marker + last-known-good.
 *
 * Slack + clock are injected (deps) so this is fully unit-testable without network or real time.
 */
import type { Config } from "./config";
import type { Extra, ExtraKind, PrayerSlot, TickResult } from "./types";
import { getLocalParts } from "./time";
import { parseCanvas } from "./canvas";
import { isWeekend, isHoliday } from "./calendar";
import { isDue } from "./window";
import { resolveForDay } from "./schedule";
import { pickExtra } from "./extras";
import { formatReminder } from "./message";
import {
  readMarker,
  writeMarker,
  makeKey,
  hasSent,
  updateLastKnownGood,
  type Marker,
} from "./dedupe";
import * as slack from "./slack";

export interface TickDeps {
  readCanvas: (config: Config) => Promise<{ raw: string; editTimestamp: number | null }>;
  postMessage: (token: string, channel: string, text: string) => Promise<void>;
  alertOwner: (config: Config, text: string) => Promise<void>;
  /** Verse/hadith for the Canvas `Extra:` setting, for a date + the prayer's slot in the day. */
  getExtra: (kind: ExtraKind, dateKey: string, slot: number) => Extra | null;
}

const defaultDeps: TickDeps = {
  readCanvas: slack.readCanvas,
  postMessage: slack.postMessage,
  alertOwner: slack.alertOwner,
  getExtra: pickExtra,
};

export async function runTick(
  config: Config,
  now: Date,
  deps: Partial<TickDeps> = {},
): Promise<TickResult> {
  const d = { ...defaultDeps, ...deps };
  const result: TickResult = {
    status: "noop",
    posted: [],
    alreadySent: [],
    notDue: [],
    skippedDay: [],
    previews: [],
    problems: [],
    canvasEditTimestamp: null,
    dryRun: config.dryRun,
  };

  // 1. Hard kill switch (also enforced by the workflow `if:` guard).
  if (!config.remindersEnabled) {
    return { ...result, status: "skipped", reason: "disabled" };
  }

  // 2. Read the Canvas. A total read failure is safe-failed (alert + stop) — we cannot know
  //    today's holidays/status without it, so we never post blind.
  let raw: string;
  try {
    const canvas = await d.readCanvas(config);
    raw = canvas.raw;
    result.canvasEditTimestamp = canvas.editTimestamp;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.problems.push(`Canvas read failed: ${msg}`);
    await d.alertOwner(config, `couldn't read the Canvas (${msg}). No reminders sent this run.`);
    return { ...result, status: "error", reason: "canvas-read-failed" };
  }

  // 3. Parse + validate.
  const schedule = parseCanvas(raw, {
    fallbackOffset: config.defaultOffsetMin,
    defaultWeekend: config.weekendDays,
  });
  if (schedule.errors.length > 0) {
    result.problems.push(...schedule.errors);
    await d.alertOwner(
      config,
      `${schedule.errors.length} line(s) in the Canvas couldn't be read and were skipped:\n${schedule.errors.join("\n")}`,
    );
  }

  const enabledPrayers = schedule.prayers.filter((p) => p.enabled);

  // Maintain last-known-good for the dashboard / future fallback (only on a real run).
  if (!config.dryRun && enabledPrayers.length > 0) {
    await updateLastKnownGood(config.stateDir, enabledPrayers);
  }

  // 4. Soft kill switch + calendar skips (all sourced from the Canvas).
  const local = getLocalParts(now, config.timezone);
  if (schedule.status === "off") return { ...result, status: "skipped", reason: "status-off" };
  if (isWeekend(local.weekday, schedule.weekendDays))
    return { ...result, status: "skipped", reason: "weekend" };
  if (isHoliday(local.dateKey, schedule.holidays))
    return { ...result, status: "skipped", reason: "holiday" };

  // 5. Per-prayer window + dedupe.
  const marker: Marker = await readMarker(config.stateDir, local.dateKey);
  for (const [slot, base] of enabledPrayers.entries()) {
    // Today's effective slot: date override > skip= > weekday override > base time.
    const prayer = resolveForDay(base, local.dateKey, local.weekday);
    if (!prayer) {
      result.skippedDay.push(makeKey(base.key, base.time));
      continue;
    }
    const key = makeKey(prayer.key, prayer.time);

    const due = isDue({
      nowMinutes: local.minutesSinceMidnight,
      prayerMinutes: prayer.minutes,
      offsetMin: prayer.offsetMin,
      graceMin: config.graceMin,
    });

    if (!due) {
      result.notDue.push(key);
      continue;
    }
    if (hasSent(marker, key)) {
      result.alreadySent.push(key);
      continue;
    }

    const extra = schedule.extra === "off" ? null : safeExtra(d, schedule.extra, local.dateKey, slot);
    const text = formatReminder(prayer, config.footer, extra);
    result.previews.push(text);

    if (config.dryRun) {
      result.posted.push(key); // "would post"
      continue;
    }

    await d.postMessage(config.slackToken, config.target, text);
    marker[key] = now.toISOString();
    await writeMarker(config.stateDir, local.dateKey, marker); // persist after each send
    result.posted.push(key);
  }

  result.status = result.posted.length > 0 ? "posted" : "noop";
  return result;
}

/** Belt-and-braces: an injected getExtra that throws must still never block a reminder. */
function safeExtra(d: TickDeps, kind: ExtraKind, dateKey: string, slot: number): Extra | null {
  try {
    return d.getExtra(kind, dateKey, slot);
  } catch {
    return null;
  }
}

export type { PrayerSlot };
