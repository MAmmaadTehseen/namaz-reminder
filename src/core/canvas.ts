/**
 * Parse the team-edited Slack Canvas into a typed schedule.
 *
 * Slack has no first-class Canvas-read API; the content arrives as HTML from the
 * url_private download (see slack.ts). So this parser:
 *   1. normalises HTML -> plain text (if it looks like HTML),
 *   2. prefers the first fenced ``` code block (the machine-readable region), else the whole text,
 *   3. parses strict, forgiving line grammar.
 *
 * Grammar (one item per line, inside the fenced block):
 *   Status: ON | OFF
 *   default_offset = 10
 *   Weekend: Sat, Sun
 *   Holidays: 2026-07-06, 2026-08-14
 *   zuhr = 14:05
 *   asr = 17:00 | off=5        (per-prayer lead-time override)
 *   # isha = 21:15             (leading # disables the line)
 *
 * A prayer time that is not strict 24h HH:MM is a HARD error (never guess a prayer time):
 * the caller alerts the owner and falls back to last-known-good for that prayer.
 */
import type { ParsedSchedule, PrayerSlot, Weekday } from "./types";
import { parseHHMM } from "./time";
import { parseWeekdays, parseHolidays } from "./calendar";

export interface ParseOptions {
  /** Lead time used when the Canvas omits `default_offset`. */
  fallbackOffset: number;
  /** Weekend days used when the Canvas omits `Weekend:`. */
  defaultWeekend: Weekday[];
}

const DIRECTIVE_KEYS = new Set(["status", "default_offset", "weekend", "holidays"]);

export function parseCanvas(raw: string, opts: ParseOptions): ParsedSchedule {
  const text = looksLikeHtml(raw) ? htmlToText(raw) : raw;
  const region = extractFencedBlock(text) ?? text;

  const schedule: ParsedSchedule = {
    status: "on",
    defaultOffset: opts.fallbackOffset,
    weekendDays: [...opts.defaultWeekend],
    holidays: [],
    prayers: [],
    warnings: [],
    errors: [],
  };

  const seen = new Map<string, number>(); // prayer key -> index in prayers[]
  const explicitOffset = new Set<string>(); // keys whose `off=` was set explicitly

  for (const rawLine of region.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // A leading '#' either disables a prayer line or is a plain comment.
    let disabled = false;
    let body = line;
    if (line.startsWith("#")) {
      body = line.replace(/^#+\s*/, "").trim();
      disabled = true;
    }
    if (!body) continue;

    const directiveKey = matchDirectiveKey(body);
    if (directiveKey) {
      if (disabled) continue; // "# Weekend: ..." — treat as a comment, ignore
      applyDirective(schedule, directiveKey, body);
      continue;
    }

    // Otherwise it can only be a prayer line, which MUST use '=' (the time itself uses ':').
    const eq = body.indexOf("=");
    if (eq === -1) continue; // prose / unrecognised — ignore silently

    const key = body.slice(0, eq).trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]*$/.test(key) || DIRECTIVE_KEYS.has(key)) continue;

    const slot = parsePrayerValue(key, body.slice(eq + 1), schedule.defaultOffset, disabled);
    if ("error" in slot) {
      schedule.errors.push(slot.error);
      continue;
    }
    if (slot.explicitOffset) explicitOffset.add(key);
    else explicitOffset.delete(key);

    if (seen.has(key)) {
      schedule.warnings.push(`Duplicate prayer "${key}" — later line wins.`);
      schedule.prayers[seen.get(key)!] = slot.slot;
    } else {
      seen.set(key, schedule.prayers.length);
      schedule.prayers.push(slot.slot);
    }
  }

  // `default_offset` may appear after prayer lines — re-resolve any offset that wasn't explicit.
  for (const prayer of schedule.prayers) {
    if (!explicitOffset.has(prayer.key)) prayer.offsetMin = schedule.defaultOffset;
  }

  return schedule;
}

function parsePrayerValue(
  key: string,
  value: string,
  defaultOffset: number,
  disabled: boolean,
): { slot: PrayerSlot; explicitOffset: boolean } | { error: string } {
  const parts = value.split("|").map((p) => p.trim());
  const timeStr = parts[0] ?? "";
  const minutes = parseHHMM(timeStr);
  if (minutes === null) {
    return {
      error: `Prayer "${key}" has an invalid time "${timeStr}" — expected 24h HH:MM (e.g. 17:00).`,
    };
  }

  let offsetMin = defaultOffset;
  let explicitOffset = false;
  let note: string | undefined;
  let template: string | undefined;
  let skipDays: Weekday[] | undefined;

  for (const extra of parts.slice(1)) {
    const off = /^off\s*=\s*(\d{1,3})$/i.exec(extra);
    const noteMatch = /^note\s*=(.*)$/i.exec(extra);
    const msgMatch = /^msg\s*=(.*)$/i.exec(extra);
    const skipMatch = /^skip\s*=(.*)$/i.exec(extra);
    if (off) {
      offsetMin = Number(off[1]);
      explicitOffset = true;
    } else if (msgMatch) {
      template = msgMatch[1]!.trim() || undefined;
    } else if (skipMatch) {
      skipDays = parseWeekdays(skipMatch[1] ?? "") ?? undefined;
    } else if (noteMatch) {
      note = noteMatch[1]!.trim() || undefined;
    } else if (/^off\s*=/i.test(extra)) {
      return { error: `Prayer "${key}" has a malformed offset "${extra}" — expected "off=5".` };
    } else if (extra) {
      // Bare free text after "|" is treated as a note, e.g. `asr = 17:00 | on second floor`.
      note = extra;
    }
  }

  return {
    slot: {
      key,
      time: normaliseTime(timeStr),
      minutes,
      offsetMin,
      ...(note ? { note } : {}),
      ...(template ? { template } : {}),
      ...(skipDays ? { skipDays } : {}),
      enabled: !disabled,
    },
    explicitOffset,
  };
}

function matchDirectiveKey(body: string): string | null {
  const sep = body.search(/[:=]/);
  if (sep === -1) return null;
  const key = body.slice(0, sep).trim().toLowerCase();
  return DIRECTIVE_KEYS.has(key) ? key : null;
}

function applyDirective(schedule: ParsedSchedule, key: string, body: string): void {
  const sep = body.search(/[:=]/);
  const value = body.slice(sep + 1).trim();

  switch (key) {
    case "status": {
      schedule.status = /^off\b/i.test(value) ? "off" : "on";
      break;
    }
    case "default_offset": {
      const n = /^(\d{1,3})/.exec(value);
      if (n) schedule.defaultOffset = Number(n[1]);
      else schedule.warnings.push(`Ignored default_offset "${value}".`);
      break;
    }
    case "weekend": {
      const days = parseWeekdays(value);
      if (days) schedule.weekendDays = days;
      else schedule.warnings.push(`Ignored weekend "${value}".`);
      break;
    }
    case "holidays": {
      schedule.holidays = parseHolidays(value);
      break;
    }
  }
}

function normaliseTime(timeStr: string): string {
  const minutes = parseHHMM(timeStr)!;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ---------- HTML handling ----------

export function looksLikeHtml(raw: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(raw);
}

/** Extract the content of the first fenced code block, or null if none. */
export function extractFencedBlock(text: string): string | null {
  const m = /```[^\n]*\n?([\s\S]*?)```/.exec(text);
  return m ? (m[1] ?? "").trim() : null;
}

/** Very small HTML -> text: preserve line breaks from block/`<br>` tags, strip the rest, decode entities. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|ul|ol|tr|h[1-6]|pre|section|blockquote)\s*>/gi, "\n")
    .replace(/<\s*(p|div|li|tr|h[1-6]|pre|section|blockquote)\b[^>]*>/gi, "\n");
  const noTags = withBreaks.replace(/<[^>]+>/g, "");
  return decodeEntities(noTags)
    .split(/\r?\n/)
    .map((l) => l.replace(/ /g, " ").trimEnd())
    .join("\n");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}
