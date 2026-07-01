/**
 * Load + validate runtime configuration from environment variables.
 * Used identically by the CI script (GitHub Actions secrets -> process.env) and,
 * if hosted, the Next.js dashboard (Vercel env -> process.env).
 */
import { z } from "zod";
import type { Weekday } from "./types";
import { DEFAULT_TZ } from "./time";
import { parseWeekdays } from "./calendar";

export interface Config {
  slackUserToken: string;
  /** Channel that hosts the Canvas (to resolve its file id). */
  canvasChannelId?: string;
  /** OR a direct Canvas file id (Fxxxx), bypassing channel lookup. */
  canvasId?: string;
  /** Where reminders are posted (a channel id, or your DM id while testing). */
  target: string;
  /** Where parse-failure alerts go (defaults to `target`). */
  ownerAlertTarget: string;
  /** Fallback lead time N when the Canvas omits default_offset. */
  defaultOffsetMin: number;
  /** Grace window after a prayer time during which a delayed run may still fire. */
  graceMin: number;
  /** Fallback weekend days when the Canvas omits Weekend:. */
  weekendDays: Weekday[];
  timezone: string;
  stateDir: string;
  dryRun: boolean;
  /** Hard kill switch (also enforced by the workflow `if:` guard). */
  remindersEnabled: boolean;
}

const EnvSchema = z.object({
  SLACK_USER_TOKEN: z.string().min(1, "SLACK_USER_TOKEN is required (a Slack user token, xoxp-...)."),
  SLACK_TARGET: z.string().min(1, "SLACK_TARGET is required (channel id or your DM id)."),
  SLACK_CANVAS_CHANNEL_ID: z.string().optional(),
  SLACK_CANVAS_ID: z.string().optional(),
  OWNER_ALERT_TARGET: z.string().optional(),
  DEFAULT_OFFSET_MIN: z.string().optional(),
  GRACE_MIN: z.string().optional(),
  WEEKEND_DAYS: z.string().optional(),
  TIMEZONE: z.string().optional(),
  STATE_DIR: z.string().optional(),
  DRY_RUN: z.string().optional(),
  REMINDERS_ENABLED: z.string().optional(),
});

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `- ${i.path.join(".") || "(env)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  const e = parsed.data;

  if (!e.SLACK_CANVAS_CHANNEL_ID && !e.SLACK_CANVAS_ID) {
    throw new Error(
      "Invalid configuration:\n- Provide SLACK_CANVAS_CHANNEL_ID (channel hosting the Canvas) or SLACK_CANVAS_ID (a Canvas file id).",
    );
  }

  return {
    slackUserToken: e.SLACK_USER_TOKEN,
    canvasChannelId: e.SLACK_CANVAS_CHANNEL_ID,
    canvasId: e.SLACK_CANVAS_ID,
    target: e.SLACK_TARGET,
    ownerAlertTarget: e.OWNER_ALERT_TARGET || e.SLACK_TARGET,
    defaultOffsetMin: toInt(e.DEFAULT_OFFSET_MIN, 10),
    graceMin: toInt(e.GRACE_MIN, 5),
    weekendDays: parseWeekdays(e.WEEKEND_DAYS ?? "") ?? [0, 6],
    timezone: e.TIMEZONE || DEFAULT_TZ,
    stateDir: e.STATE_DIR || "state",
    dryRun: toBool(e.DRY_RUN, false),
    remindersEnabled: toBool(e.REMINDERS_ENABLED, true),
  };
}

function toInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  return fallback;
}
