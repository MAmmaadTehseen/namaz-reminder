/**
 * Local test runner — everything goes to YOUR DM, never the team channel.
 *
 * Uses the tokens in .env, but forces:
 *   - target + alerts  -> LOCAL_TARGET (your user id U… or DM id D…), refusing channel ids
 *   - dedupe state     -> .local-state/ (gitignored), so it can never touch the real state/
 *   - Canvas           -> LOCAL_CANVAS_ID if set (a personal test Canvas), else the team Canvas (read-only)
 *
 *   npm run local                         one real tick right now (only prayers in their window post)
 *   npm run local -- --at 16:40           ...as if it were 16:40 today (local timezone)
 *   npm run local -- --at "2026-11-19 16:40"   ...at that date + time (test a wed= override)
 *   npm run local -- --all                send EVERY prayer for the day now (ignores window + dedupe)
 *   npm run local -- --all --at 2026-11-19     ...for that day's times (overrides applied)
 *   npm run local -- --dry                print instead of posting (combine with any of the above)
 *   npm run local -- --reset              clear .local-state/ so reminders can fire again
 */
import { parseArgs } from "node:util";
import { promises as fs } from "node:fs";
import { loadConfig, type Config } from "../src/core/config";
import { runTick } from "../src/core/pipeline";
import { readCanvas, postMessage } from "../src/core/slack";
import { parseCanvas } from "../src/core/canvas";
import { resolveForDay } from "../src/core/schedule";
import { pickExtra } from "../src/core/extras";
import { formatReminder } from "../src/core/message";
import { getLocalParts, zonedDate } from "../src/core/time";
import { isHoliday, isWeekend } from "../src/core/calendar";

const LOCAL_STATE_DIR = ".local-state";

const { values: args } = parseArgs({
  options: {
    at: { type: "string" },
    all: { type: "boolean", default: false },
    dry: { type: "boolean", default: false },
    reset: { type: "boolean", default: false },
    "allow-channel": { type: "boolean", default: false },
  },
});

function fail(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

// A --dry run posts nothing, so it doesn't need a real target.
const target = process.env.LOCAL_TARGET || process.env.OWNER_ALERT_TARGET || (args.dry ? "DRY-RUN" : "");
if (!target) {
  fail(
    "Set LOCAL_TARGET in .env to your Slack user id (U…, bot DMs you) or DM id (D…).\n" +
      "   Find your user id: Slack -> your profile -> ⋮ -> Copy member ID.",
  );
}
if (/^[CG]/.test(target) && !args["allow-channel"]) {
  fail(`LOCAL_TARGET=${target} looks like a channel. Local runs only post to a DM; pass --allow-channel to override.`);
}

const base = loadConfig({
  ...process.env,
  SLACK_TARGET: target,
  // The test Canvas alone is enough locally — no need to configure the team Canvas too.
  ...(process.env.LOCAL_CANVAS_ID ? { SLACK_CANVAS_ID: process.env.LOCAL_CANVAS_ID } : {}),
});
const config: Config = {
  ...base,
  target,
  ownerAlertTarget: target,
  stateDir: LOCAL_STATE_DIR,
  canvasId: process.env.LOCAL_CANVAS_ID || base.canvasId,
  dryRun: args.dry,
  remindersEnabled: true,
};

if (args.reset) {
  await fs.rm(LOCAL_STATE_DIR, { recursive: true, force: true });
  console.log(`🧹 Cleared ${LOCAL_STATE_DIR}/`);
  if (!args.all && !args.at) process.exit(0);
}

const now = resolveNow(args.at, config.timezone);
const local = getLocalParts(now, config.timezone);
console.log(
  `🧪 Local run -> ${target}${config.dryRun ? " [DRY]" : ""} | ${local.dateKey} ` +
    `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")} ${config.timezone}` +
    ` | canvas ${config.canvasId ?? `in channel ${config.canvasChannelId}`}`,
);

if (args.all) {
  await sendWholeDay().catch(explain);
} else {
  const result = await runTick(config, now);
  console.log(JSON.stringify({ ...result, previews: undefined }, null, 2));
  for (const p of result.previews) console.log(`\n--- message ---\n${p}`);
  if (result.status === "noop" && result.posted.length === 0) {
    console.log("\nNothing in its window right now. Try --at HH:MM, or --all to see every prayer.");
  }
  if (result.status === "error") process.exitCode = 1;
}

/** Turn common Slack errors into a next step instead of a stack trace. */
function explain(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  const hints: Record<string, string> = {
    not_visible: `The token can't see Canvas ${config.canvasId}. In Slack: open the Canvas -> Share -> add the bot/app.`,
    file_not_found: `Canvas ${config.canvasId} doesn't exist or isn't visible to this token. Check LOCAL_CANVAS_ID.`,
    channel_not_found: `Can't post to ${target}. A bot can only DM you in its own DM — set LOCAL_TARGET to your member id (U…).`,
    not_in_channel: `The bot isn't in ${target}. Invite it, or set LOCAL_TARGET to your member id (U…).`,
    invalid_auth: "The Slack token in .env is invalid or revoked. Re-copy it from api.slack.com/apps -> OAuth & Permissions.",
    missing_scope: "The token is missing a scope (needs files:read, chat:write, and channels:read/groups:read). Add it, then reinstall the app.",
  };
  const code = Object.keys(hints).find((k) => msg.includes(k));
  fail(code ? `${msg}\n   ${hints[code]}` : msg);
}

/** Post (or print) every enabled prayer for the simulated day, as it would look that day. */
async function sendWholeDay(): Promise<void> {
  const { raw } = await readCanvas(config);
  const schedule = parseCanvas(raw, {
    fallbackOffset: config.defaultOffsetMin,
    defaultWeekend: config.weekendDays,
  });
  for (const e of schedule.errors) console.warn(`⚠️  ${e}`);
  for (const w of schedule.warnings) console.warn(`ℹ️  ${w}`);

  const notes: string[] = [];
  if (schedule.status === "off") notes.push("Canvas Status: OFF");
  if (isWeekend(local.weekday, schedule.weekendDays)) notes.push("weekend");
  if (isHoliday(local.dateKey, schedule.holidays)) notes.push("holiday");
  if (notes.length) console.log(`(For real, nothing would post this day: ${notes.join(", ")}. Previewing anyway.)`);
  console.log(`Extra: ${schedule.extra}`);

  const header = `🧪 *Local preview for ${local.dateKey}* — ${schedule.prayers.filter((p) => p.enabled).length} prayer(s), Extra: ${schedule.extra}`;
  if (!config.dryRun) await postMessage(config.slackToken, target!, header);

  for (const [i, p] of schedule.prayers.filter((x) => x.enabled).entries()) {
    const slot = resolveForDay(p, local.dateKey, local.weekday);
    if (!slot) {
      console.log(`\n--- ${p.key}: skipped today (skip=) ---`);
      continue;
    }
    const changed = slot.time !== p.time ? ` (override; normally ${p.time})` : "";
    const extra = pickExtra(schedule.extra, local.dateKey, i);
    const text = formatReminder(slot, config.footer, extra);
    console.log(`\n--- ${slot.key} @ ${slot.time}${changed} ---\n${text}`);
    if (!config.dryRun) await postMessage(config.slackToken, target!, text);
  }
  if (!config.dryRun) console.log(`\n✅ Sent to ${target}.`);
}

function resolveNow(at: string | undefined, tz: string): Date {
  if (!at) return new Date();
  const today = getLocalParts(new Date(), tz).dateKey;
  const parts = at.trim().split(/[ T]+/);
  // "16:40" | "2026-11-19" | "2026-11-19 16:40"
  const dateKey = parts.find((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)) ?? today;
  const hhmm = parts.find((x) => /^\d{2}:\d{2}$/.test(x)) ?? "12:00";
  const d = zonedDate(dateKey, hhmm, tz);
  if (!d) fail(`Couldn't read --at "${at}". Use HH:MM, YYYY-MM-DD, or "YYYY-MM-DD HH:MM" (24h).`);
  return d;
}
