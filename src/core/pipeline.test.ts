import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTick, type TickDeps } from "./pipeline";
import { readMarker } from "./dedupe";
import type { Config } from "./config";

let stateDir: string;

beforeEach(async () => {
  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "namaz-pipeline-"));
});
afterEach(async () => {
  await fs.rm(stateDir, { recursive: true, force: true });
});

function makeConfig(over: Partial<Config> = {}): Config {
  return {
    slackToken: "xoxb-test",
    canvasChannelId: "C123",
    target: "C999",
    ownerAlertTarget: "D_OWNER",
    defaultOffsetMin: 10,
    graceMin: 5,
    weekendDays: [0, 6],
    timezone: "Asia/Karachi",
    stateDir,
    footer: "",
    dryRun: false,
    remindersEnabled: true,
    ...over,
  };
}

interface Recorder {
  posts: Array<{ channel: string; text: string }>;
  alerts: string[];
  deps: Partial<TickDeps>;
}

function recorder(raw: string, opts: { throwOnRead?: boolean } = {}): Recorder {
  const posts: Array<{ channel: string; text: string }> = [];
  const alerts: string[] = [];
  return {
    posts,
    alerts,
    deps: {
      readCanvas: async () => {
        if (opts.throwOnRead) throw new Error("network down");
        return { raw, editTimestamp: 1_700_000_000 };
      },
      postMessage: async (_token, channel, text) => {
        posts.push({ channel, text });
      },
      alertOwner: async (_config, text) => {
        alerts.push(text);
      },
    },
  };
}

const canvas = (lines: string[]): string => ["```", ...lines, "```"].join("\n");

// 2026-07-01 09:00Z -> Karachi Wed 14:00. A prayer at 14:05 with offset 10 => window [13:55,14:10].
const WED_1400Z = new Date("2026-07-01T09:00:00Z");
const FRI_1400Z = new Date("2026-07-03T09:00:00Z"); // Friday, a working day (weekend is Sat/Sun)
const SAT_1400Z = new Date("2026-07-04T09:00:00Z");

describe("runTick", () => {
  it("skips when the hard kill switch is off", async () => {
    const r = recorder(canvas(["zuhr = 14:05"]));
    const res = await runTick(makeConfig({ remindersEnabled: false }), WED_1400Z, r.deps);
    expect(res).toMatchObject({ status: "skipped", reason: "disabled" });
    expect(r.posts).toHaveLength(0);
  });

  it("posts a due prayer as an @here message, once (dedupe on re-run)", async () => {
    const r = recorder(canvas(["zuhr = 14:05"]));
    const config = makeConfig();

    const first = await runTick(config, WED_1400Z, r.deps);
    expect(first.status).toBe("posted");
    expect(first.posted).toEqual(["zuhr@14:05"]);
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]!.channel).toBe("C999");
    expect(r.posts[0]!.text).toContain("<!here>");

    // marker persisted -> second run does not repost
    const second = await runTick(config, WED_1400Z, r.deps);
    expect(second.status).toBe("noop");
    expect(second.alreadySent).toEqual(["zuhr@14:05"]);
    expect(r.posts).toHaveLength(1);
  });

  it("re-arms when the time changes (new key), without re-pinging the old time", async () => {
    const config = makeConfig();
    const r1 = recorder(canvas(["zuhr = 14:05"]));
    await runTick(config, WED_1400Z, r1.deps); // posts zuhr@14:05

    // Owner edits the time to 14:08 (still inside the window at 14:00? no — window is [13:58,14:13]).
    const r2 = recorder(canvas(["zuhr = 14:08"]));
    const res = await runTick(config, WED_1400Z, r2.deps);
    expect(res.posted).toEqual(["zuhr@14:08"]); // fresh key re-arms
    expect(r2.posts).toHaveLength(1);
  });

  it("does not post when no prayer is in its window", async () => {
    const r = recorder(canvas(["zuhr = 20:00"]));
    const res = await runTick(makeConfig(), WED_1400Z, r.deps);
    expect(res.status).toBe("noop");
    expect(res.notDue).toEqual(["zuhr@20:00"]);
    expect(r.posts).toHaveLength(0);
  });

  it("DRY_RUN reports would-post but neither posts nor persists a marker", async () => {
    const r = recorder(canvas(["zuhr = 14:05"]));
    const res = await runTick(makeConfig({ dryRun: true }), WED_1400Z, r.deps);
    expect(res.posted).toEqual(["zuhr@14:05"]);
    expect(r.posts).toHaveLength(0);
    expect(await readMarker(stateDir, "2026-07-01")).toEqual({});
  });

  it("skips on the soft (Canvas Status: OFF) switch", async () => {
    const r = recorder(canvas(["Status: OFF", "zuhr = 14:05"]));
    const res = await runTick(makeConfig(), WED_1400Z, r.deps);
    expect(res).toMatchObject({ status: "skipped", reason: "status-off" });
    expect(r.posts).toHaveLength(0);
  });

  it("skips a specific prayer on its skip= day but posts it on other days", async () => {
    const canvasText = canvas(["zuhr = 14:05 | skip=Fri"]);

    // Friday: Zuhr is skipped even though its window is open.
    const rFri = recorder(canvasText);
    const fri = await runTick(makeConfig(), FRI_1400Z, rFri.deps);
    expect(fri.skippedDay).toEqual(["zuhr@14:05"]);
    expect(rFri.posts).toHaveLength(0);

    // Wednesday: same prayer posts normally.
    const rWed = recorder(canvasText);
    const wed = await runTick(makeConfig(), WED_1400Z, rWed.deps);
    expect(wed.posted).toEqual(["zuhr@14:05"]);
    expect(rWed.posts).toHaveLength(1);
  });

  it("appends the footer to the posted message", async () => {
    const r = recorder(canvas(["zuhr = 14:05"]));
    await runTick(makeConfig({ footer: "automated by ammaad" }), WED_1400Z, r.deps);
    expect(r.posts[0]!.text).toContain("_automated by ammaad_");
    expect(r.posts[0]!.text).not.toContain("🕌");
  });

  it("skips on weekends", async () => {
    const r = recorder(canvas(["zuhr = 14:05"]));
    const res = await runTick(makeConfig(), SAT_1400Z, r.deps);
    expect(res).toMatchObject({ status: "skipped", reason: "weekend" });
    expect(r.posts).toHaveLength(0);
  });

  it("skips on a Canvas-listed holiday", async () => {
    const r = recorder(canvas(["Holidays: 2026-07-01", "zuhr = 14:05"]));
    const res = await runTick(makeConfig(), WED_1400Z, r.deps);
    expect(res).toMatchObject({ status: "skipped", reason: "holiday" });
    expect(r.posts).toHaveLength(0);
  });

  it("alerts the owner on a parse error but still posts valid prayers", async () => {
    const r = recorder(canvas(["zuhr = 14:05", "fajr = 5:12am"]));
    const res = await runTick(makeConfig(), WED_1400Z, r.deps);
    expect(res.posted).toEqual(["zuhr@14:05"]);
    expect(r.alerts.length).toBeGreaterThan(0);
    expect(r.alerts[0]).toContain("fajr");
  });

  it("uses a weekday override time for the window, dedupe key and message", async () => {
    // Wed 14:00 local: base 15:00 is not due, but wed=14:05 is.
    const r = recorder(canvas(["zuhr = 15:00 | wed=14:05"]));
    const res = await runTick(makeConfig(), WED_1400Z, r.deps);
    expect(res.posted).toEqual(["zuhr@14:05"]);
    expect(r.posts[0]!.text).toBe("<!here> Zuhr at 02:05 PM");

    // Friday: back to the base time -> not due at 14:00.
    const rFri = recorder(canvas(["zuhr = 15:00 | wed=14:05"]));
    const fri = await runTick(makeConfig(), FRI_1400Z, rFri.deps);
    expect(fri.notDue).toEqual(["zuhr@15:00"]);
    expect(rFri.posts).toHaveLength(0);
  });

  it("a date override un-skips a skip= day", async () => {
    const r = recorder(canvas(["zuhr = 15:00 | skip=Fri | 2026-07-03=14:05"]));
    const res = await runTick(makeConfig(), FRI_1400Z, r.deps);
    expect(res.posted).toEqual(["zuhr@14:05"]);
  });

  it("does not fetch an extra when Extra is off", async () => {
    const r = recorder(canvas(["zuhr = 14:05"]));
    let calls = 0;
    await runTick(makeConfig(), WED_1400Z, { ...r.deps, getExtra: () => (calls++, null) });
    expect(calls).toBe(0);
  });

  it("appends the verse/hadith when Extra is on, only for prayers actually posted", async () => {
    const r = recorder(canvas(["Extra: verse", "zuhr = 14:05", "asr = 17:00"]));
    const calls: Array<[string, string, number]> = [];
    await runTick(makeConfig(), WED_1400Z, {
      ...r.deps,
      getExtra: (kind, dateKey, slot) => (calls.push([kind, dateKey, slot]), { arabic: "ع", urdu: "اردو", ref: "Qur'an 94:5" }),
    });
    expect(calls).toEqual([["verse", "2026-07-01", 0]]); // asr not due -> not picked
    expect(r.posts[0]!.text).toContain("> ع\n> اردو\n> — _Qur'an 94:5_");
  });

  it("uses the real curated list by default (Urdu text under the reminder)", async () => {
    const r = recorder(canvas(["Extra: hadith", "zuhr = 14:05"]));
    await runTick(makeConfig(), WED_1400Z, r.deps);
    expect(r.posts[0]!.text).toMatch(/\n> [\u0600-\u06FF].*\n> — _Sahih /);
  });

  it("still posts the reminder if getExtra throws", async () => {
    const r = recorder(canvas(["Extra: both", "zuhr = 14:05"]));
    const res = await runTick(makeConfig(), WED_1400Z, {
      ...r.deps,
      getExtra: () => {
        throw new Error("boom");
      },
    });
    expect(res.posted).toEqual(["zuhr@14:05"]);
    expect(r.posts[0]!.text).toBe("<!here> Zuhr at 02:05 PM");
  });

  it("DRY_RUN fills previews with the full message text", async () => {
    const r = recorder(canvas(["zuhr = 14:05"]));
    const res = await runTick(makeConfig({ dryRun: true }), WED_1400Z, r.deps);
    expect(res.previews).toEqual(["<!here> Zuhr at 02:05 PM"]);
  });

  it("safe-fails (alert + error, no posting) when the Canvas cannot be read", async () => {
    const r = recorder("", { throwOnRead: true });
    const res = await runTick(makeConfig(), WED_1400Z, r.deps);
    expect(res.status).toBe("error");
    expect(r.posts).toHaveLength(0);
    expect(r.alerts.length).toBeGreaterThan(0);
  });
});
