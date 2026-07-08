# 🕌 Namaz Reminder

Automated Slack prayer (namaz) reminders, driven by a **team-edited Slack Canvas** and run for
free on **GitHub Actions**. A few minutes before each prayer time listed in the Canvas, the bot
posts an `@here` message **as you** — replacing the manual "@here Asar at 5:35 PM" posts.

- **Times are fully manual** (set to your break schedule) and **change any day** — you just edit
  the Canvas. No prayer-time API.
- Built as a **Next.js** project; the engine runs as a small script on a 5-minute cron.
- **Kill switch**, **weekend skip**, **holiday list**, **per-prayer custom messages**, and
  **DM-first testing** are all built in.

## How it works

```
GitHub Actions cron (every 5 min)  ->  npx tsx scripts/tick.ts
  1. kill switch (REMINDERS_ENABLED) ?
  2. read the Slack Canvas  (conversations.info -> files.info -> download)
  3. parse strict lines -> schedule (times, offsets, messages, weekend, holidays, status)
  4. skip if Status: OFF / weekend / holiday
  5. for each prayer due now (window + per-day dedupe): post "<!here> ..." AS you
  6. commit the dedupe marker back to the repo (exactly-once)
```

All logic lives in [`src/core/`](src/core/) as framework-agnostic TypeScript, imported by both the
CI script and the optional dashboard. See [the plan](../.claude/plans/) for the full design and the
research behind each choice.

## The Canvas format

Create a Canvas in your Slack channel and edit the block below. The bot reads the first fenced
` ``` ` code block if present, otherwise the whole Canvas. Lines that don't match are ignored.

````
```
Status: ON
default_offset = 10
Weekend: Sat, Sun
Holidays: 2026-07-06, 2026-08-14

zuhr = 14:05
asr = 17:00 | off=5 | on second floor
maghrib = 19:45 | msg=Maghrib at {time} — rooftop today
# isha = 21:15
```
````

| Line | Meaning |
|---|---|
| `Status: ON` / `OFF` | Soft kill switch — `OFF` pauses all reminders. |
| `default_offset = 10` | Default lead time N (minutes before) for prayers without their own. |
| `Weekend: Sat, Sun` | Days to skip (defaults to Sat + Sun). |
| `Holidays: YYYY-MM-DD, ...` | Extra dates to skip (a trailing `# label` is ignored). |
| `zuhr = 14:05` | A prayer at 24-hour `HH:MM`. Add/remove prayers freely. |
| `... \| off=5` | Per-prayer lead time override (fires 5 min before). |
| `... \| on second floor` | **Note** appended to the standard message (bare text after `\|`). |
| `... \| note=on second floor` | Same as above, explicit. |
| `... \| msg=Asr at {time} on 2F` | **Full custom message.** Placeholders: `{time}`, `{time24}`, `{prayer}`. `<!here>` is added automatically. |
| `... \| skip=Fri` | **Don't remind this prayer** on those weekday(s), comma-separated (e.g. `skip=Fri,Sun`). Great for Zuhr on Jummah. |
| `# zuhr = 14:05` | A leading `#` disables (comments out) the line. |

Every reminder also gets a small italic footer (default `automated by ammaad`), set via the
`MESSAGE_FOOTER` variable/env (blank = no footer).

**Rules & safety**
- Times **must** be 24-hour `HH:MM` (e.g. `17:00`). A malformed time (`5:12am`) is **skipped**
  and you get a DM alert — the bot never guesses a prayer time.
- Notes/messages can't contain a `|` (that's the field separator).
- Changing a **time** re-arms one fresh reminder (dedupe key is `prayer@HH:MM`). Changing only a
  note/message after the reminder already fired won't re-send.

## One-time setup

### 1. Slack app + token

One token reads the Canvas **and** posts. Pick **bot** (recommended — posts as an app, survives you
leaving) or **user** (posts as you).

**Bot token (recommended):**
1. Create an app "from scratch" at <https://api.slack.com/apps> in your workspace.
2. **OAuth & Permissions → Bot Token Scopes**, add: `chat:write`, `files:read`, `channels:read`
   (add `groups:read` if the Canvas/target channel is private).
3. **App Home** → set the bot's display name/icon (that's what teammates will see).
4. **Install App** → copy the **Bot User OAuth Token** (`xoxb-...`) → store as `SLACK_BOT_TOKEN`.
5. **Invite the bot** to the Canvas channel *and* the target channel: type `/invite @YourBot` in each.
   (Bots must be members to read a channel's Canvas and to post.)

**User token (alternative — posts as you):** same steps but under **User Token Scopes**, copy the
`xoxp-...` token into `SLACK_USER_TOKEN`. You must be a member of the channels.

Then get the channel id (`C…`) and, for DM testing, your DM id (`D…`).

### 2. GitHub repo (public → free 5-min cron)
The repo is **public** so GitHub Actions minutes are free and unlimited. Your token stays in
encrypted Secrets — never in the repo.

```bash
# from the project folder, using the gh CLI (already signed in as MAmmaadTehseen):
gh repo create namaz-reminder --public --source=. --remote=origin --push

gh secret set SLACK_BOT_TOKEN           # xoxb-...  (or SLACK_USER_TOKEN for xoxp-...)
gh secret set SLACK_CANVAS_CHANNEL_ID   # C... (channel with the Canvas)
gh secret set SLACK_TARGET              # D... your DM id for TESTING (switch to C... to go live)
gh secret set OWNER_ALERT_TARGET        # D... where parse alerts go

gh variable set REMINDERS_ENABLED --body true   # the hard kill switch
# optional overrides (else defaults are used):
# gh variable set DEFAULT_OFFSET_MIN --body 10
# gh variable set WEEKEND_DAYS --body "Sat,Sun"
# gh variable set DRY_RUN --body true
```

The scheduled workflow runs on the **default branch** only; the first push above sets that up.

## Testing → going live

1. **Dry run:** set variable `DRY_RUN=true`, then Actions → **namaz-reminder** → *Run workflow*.
   The run logs what it *would* post without posting.
2. **DM smoke test:** point `SLACK_TARGET` at your **DM id**, put a prayer a couple of minutes ahead
   in the Canvas, and *Run workflow*. A message appears **as you** in your DM. (`@here` is a harmless
   no-op in a DM.)
3. **Go live:** set `SLACK_TARGET` to the real **channel id** and `DRY_RUN=false`. Done — reminders
   post one `@here` per prayer, a few minutes before, on working days.

**Kill switch:** set variable `REMINDERS_ENABLED=false` (or `Status: OFF` in the Canvas) to pause.

## Reliable 5-minute scheduling (external trigger)

GitHub's built-in `schedule:` cron is **best-effort and heavily throttled** — under load it silently
drops most runs (observed: a `2-59/5` cron actually firing only every ~1–4 hours). That's too
unreliable for prayer windows, so drive the workflow from an external clock via
`workflow_dispatch` (the `schedule:` stays as a free backup).

**1. Create a fine-grained GitHub token** (<https://github.com/settings/personal-access-tokens>):

- Resource owner: `MAmmaadTehseen`; Repository access: **Only select repositories → `namaz-reminder`**
- Permissions: **Actions → Read and write** (nothing else needed)
- Copy the token (`github_pat_...`).

**2. Create a cron job at <https://cron-job.org>** (free) with:

- URL: `https://api.github.com/repos/MAmmaadTehseen/namaz-reminder/actions/workflows/remind.yml/dispatches`
- Method: **POST**
- Schedule: **every 5 minutes**
- Headers:
  - `Authorization: Bearer github_pat_...`
  - `Accept: application/vnd.github+json`
  - `X-GitHub-Api-Version: 2022-11-28`
  - `User-Agent: namaz-reminder-cron`
- Request body: `{"ref":"main"}`

**3. Test it** (expect HTTP `204 No Content`):

```bash
curl -i -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer github_pat_YOUR_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/MAmmaadTehseen/namaz-reminder/actions/workflows/remind.yml/dispatches \
  -d '{"ref":"main"}'
```

Then check `gh run list --workflow=remind.yml` — you should see a fresh `workflow_dispatch` run.
Each dispatch is a normal run (deduped + serialized), and free on a public repo.

## Local development

```bash
npm install
cp .env.example .env      # fill in your values (local only, never committed)
npm test                  # unit tests
npm run typecheck
DRY_RUN=true npm run tick # one tick against the live Canvas, no posting
npm run dev               # optional status dashboard at http://localhost:3000
```

## Caveats (by design)

- **Slack has no official Canvas-read API** — the bot downloads the Canvas as a file (HTML) and
  parses it. It's resilient (strict format + validation + alerts) but if Slack ever changes this,
  the fallback is a pinned code-block message (same parser). See the plan.
- **GitHub Actions cron is best-effort** — runs can be a few minutes late or occasionally dropped,
  so treat timing as "a few minutes before", not to-the-second. The offset cron + grace window +
  dedupe keep it reliable and duplicate-free.
- **The `xoxp` user token acts as you** — keep it only in GitHub Secrets.
