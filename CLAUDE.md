# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Namaz Reminder

Posts Slack prayer reminders a few minutes before each prayer time, driven by a
**team-edited Slack Canvas** and run free on GitHub Actions. Times are fully manual
(set to the team's break schedule, changed by editing the Canvas) — there is no
prayer-time API, by design. Node 20+.

## Commands

```bash
npm install
cp .env.example .env       # local only, never committed
npm test                   # vitest — the core is thoroughly unit-tested
npm run typecheck
DRY_RUN=true npm run tick  # one tick against the live Canvas, posts nothing
npm run local -- --all --dry   # preview every prayer for today; see "Local testing" below
npm run tick:local         # tsx --env-file=.env scripts/tick.ts (uses REAL target + state/ — prefer `local`)
npm run dev                # optional status dashboard on :3000
npx vitest run src/core/window.test.ts   # a single test file
```

## Architecture

Built as a Next.js project, but **the Next app is optional** — it is just a status
dashboard. The engine is `scripts/tick.ts` on a 5-minute cron.

All logic lives in `src/core/` as **framework-agnostic TypeScript**, imported by both
the CI script and the dashboard. `src/core/no-framework-imports.test.ts` enforces this:
it fails if anything in `src/core/` imports a framework. Keep new logic there.

One tick:

1. kill switch (`REMINDERS_ENABLED`) ?
2. read the Canvas (`conversations.info` → `files.info` → download)
3. parse strict lines → schedule (`canvas.ts`)
4. skip if `Status: OFF` / weekend / holiday (`calendar.ts`)
5. for each prayer: today's effective time (`schedule.ts` `resolveForDay`), then window +
   per-day dedupe (`window.ts`, `dedupe.ts`)
6. optional verse/hadith from the curated list (`extras.ts`), then post `<!here> …` via `slack.ts`
7. **commit the dedupe marker back to the repo** — this is what makes delivery exactly-once

Step 7 means the repo's own git history is production state. A tick that posts but
fails to commit will re-post on the next run.

## Canvas format rules

Dedupe key is `prayer@HH:MM`, so **changing a time re-arms one fresh reminder**, while
changing only a note or message after the reminder fired will not re-send.

- Times **must** be 24-hour `HH:MM`. A malformed time (`5:12am`) is skipped and the
  owner gets a DM alert — the bot never guesses a prayer time.
- `|` is the field separator, so notes and messages cannot contain it.
- A leading `#` comments out a line. Non-matching lines are ignored.
- The bot reads the first fenced code block if present, otherwise the whole Canvas.

Supported fields: `Status:`, `default_offset =`, `Weekend:`, `Holidays:`, and per prayer
`off=`, `note=` (or bare text), `msg=` (placeholders `{time}`, `{time24}`, `{prayer}`),
`skip=Fri`, `wed=16:45` (weekday time), `2026-12-25=16:30` (date time). Precedence: date override
> `skip=` > weekday override > base time. Directive `Extra: verse|hadith|both|off` (default off).

`Extra:` content is a curated **daily-life guidance** list — verses in Arabic + Urdu (Kanzul Iman), hadith in Urdu
only — short entries only (~110–120 chars) — in generated `src/core/extras-data.ts`. Never hand-edit it: change the refs in
`scripts/build-extras.ts` and run `npm run build:extras` (fetches verbatim from alquran.cloud and the
fawazahmed0 hadith CDN). `extras.ts` `pickExtra` rotates deterministically by date + prayer slot; no
network at reminder time. Random live picks were tried and dropped: out of context they read badly.

## Scheduling — why there are two triggers

GitHub's built-in `schedule:` cron is best-effort and heavily throttled (a `2-59/5` cron
was observed firing only every ~1–4 hours), which is useless for prayer windows. The real
clock is an **external cron-job.org POST to the `workflow_dispatch` endpoint** every 5
minutes; the `schedule:` block stays only as a free backup. Don't "simplify" by deleting
one of them.

The repo is public so Actions minutes are free; tokens live in encrypted Secrets.
The scheduled workflow runs on the **default branch only**.

## Local testing

`npm run local` (`scripts/local.ts`) forces target + alerts to `LOCAL_TARGET` (refuses `C…`/`G…`
ids), state to gitignored `.local-state/`, and optionally `LOCAL_CANVAS_ID`. Flags: `--at`
(simulated local time, via `zonedDate` in `time.ts`), `--all` (send every prayer for the day,
ignoring window/dedupe), `--dry`, `--reset`.

## Testing before going live

`DRY_RUN=true` logs what it would post. Point `SLACK_TARGET` at a DM id (`D…`) for smoke
testing — `@here` is a harmless no-op in a DM — then switch to the channel id (`C…`) to go
live. Kill switch: variable `REMINDERS_ENABLED=false`, or `Status: OFF` in the Canvas.

## Known constraint

Slack has **no official Canvas-read API** — the bot downloads the Canvas as an HTML file
and parses it. The documented fallback if Slack changes this is a pinned code-block
message, which the same parser already handles.
