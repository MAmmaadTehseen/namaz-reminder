import { describe, it, expect } from "vitest";
import { parseCanvas, htmlToText, extractFencedBlock } from "./canvas";
import type { ParseOptions } from "./canvas";

const OPTS: ParseOptions = { fallbackOffset: 10, defaultWeekend: [0, 6] };

const fence = (lines: string[]): string => ["```", ...lines, "```"].join("\n");

describe("parseCanvas — full schedule", () => {
  const text = [
    "Prayer times — edit the block below:",
    "lunch = 13:00", // outside the fence — must be ignored
    "```",
    "Status: ON",
    "default_offset = 10",
    "Weekend: Sat, Sun",
    "Holidays: 2026-07-06, 2026-08-14",
    "",
    "zuhr = 14:05",
    "asr = 17:00 | off=5",
    "maghrib = 19:45",
    "# isha = 21:15",
    "```",
    "Footer prose the bot ignores.",
  ].join("\n");
  const s = parseCanvas(text, OPTS);

  it("parses directives", () => {
    expect(s.status).toBe("on");
    expect(s.defaultOffset).toBe(10);
    expect(s.weekendDays).toEqual([6, 0]);
    expect(s.holidays).toEqual(["2026-07-06", "2026-08-14"]);
    expect(s.errors).toEqual([]);
  });

  it("parses prayers with per-prayer offset and disabled lines", () => {
    const byKey = Object.fromEntries(s.prayers.map((p) => [p.key, p]));
    expect(Object.keys(byKey).sort()).toEqual(["asr", "isha", "maghrib", "zuhr"]);
    expect(byKey.zuhr).toMatchObject({ time: "14:05", offsetMin: 10, enabled: true });
    expect(byKey.asr).toMatchObject({ time: "17:00", offsetMin: 5, enabled: true });
    expect(byKey.maghrib).toMatchObject({ time: "19:45", offsetMin: 10, enabled: true });
    expect(byKey.isha).toMatchObject({ enabled: false });
  });

  it("ignores prayer-like lines outside the fenced block", () => {
    expect(s.prayers.find((p) => p.key === "lunch")).toBeUndefined();
  });

  it("computes minutes since midnight", () => {
    const zuhr = s.prayers.find((p) => p.key === "zuhr")!;
    expect(zuhr.minutes).toBe(14 * 60 + 5);
  });
});

describe("parseCanvas — HTML input (realistic Slack canvas download)", () => {
  it("strips tags, decodes entities, and parses via whole-text fallback", () => {
    const html =
      "<p>Namaz times</p><pre>Status: ON<br>default_offset = 15<br>zuhr = 14:00<br>asr = 17:30 | off=5</pre>";
    const s = parseCanvas(html, OPTS);
    const byKey = Object.fromEntries(s.prayers.map((p) => [p.key, p]));
    expect(s.status).toBe("on");
    expect(byKey.zuhr).toMatchObject({ time: "14:00", offsetMin: 15 });
    expect(byKey.asr).toMatchObject({ time: "17:30", offsetMin: 5 });
  });

  it("parses the real Slack Canvas HTML shape (quip-canvas-content, <p class=line>)", () => {
    // This mirrors the actual download format observed from files.info -> url_private.
    const html =
      '<div class="quip-canvas-content">' +
      '<h1 id="temp:C:x">Namaz Schedule</h1>' +
      '<p id="temp:C:a" class="line">Status: ON</p>' +
      '<p id="temp:C:b" class="line">default_offset = 10</p>' +
      '<p id="temp:C:c" class="line">Weekend: Sat, Sun</p>' +
      '<p id="temp:C:d" class="line">zuhr = 14:05</p>' +
      '<p id="temp:C:e" class="line">asr = 17:00 | off=5 | on second floor</p>' +
      '<p id="temp:C:f" class="line">maghrib = 19:45</p>' +
      "</div>";
    const s = parseCanvas(html, OPTS);
    const byKey = Object.fromEntries(s.prayers.map((p) => [p.key, p]));
    expect(s.status).toBe("on");
    expect(s.weekendDays).toEqual([6, 0]);
    expect(Object.keys(byKey).sort()).toEqual(["asr", "maghrib", "zuhr"]);
    expect(byKey.asr).toMatchObject({ time: "17:00", offsetMin: 5, note: "on second floor" });
    expect(s.errors).toEqual([]);
  });
});

describe("parseCanvas — validation", () => {
  it("treats a malformed time as a hard error and skips the prayer", () => {
    const s = parseCanvas(fence(["zuhr = 14:05", "fajr = 5:12am"]), OPTS);
    expect(s.prayers.map((p) => p.key)).toEqual(["zuhr"]);
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toContain("fajr");
  });

  it("re-resolves default_offset even when it appears after prayers", () => {
    const s = parseCanvas(fence(["zuhr = 14:05", "default_offset = 20", "asr = 17:00"]), OPTS);
    const byKey = Object.fromEntries(s.prayers.map((p) => [p.key, p]));
    expect(byKey.zuhr!.offsetMin).toBe(20);
    expect(byKey.asr!.offsetMin).toBe(20);
  });

  it("keeps an explicit per-prayer offset regardless of a later default_offset", () => {
    const s = parseCanvas(fence(["asr = 17:00 | off=5", "default_offset = 20"]), OPTS);
    expect(s.prayers[0]!.offsetMin).toBe(5);
  });

  it("last duplicate wins and warns", () => {
    const s = parseCanvas(fence(["zuhr = 14:05", "zuhr = 14:10"]), OPTS);
    expect(s.prayers).toHaveLength(1);
    expect(s.prayers[0]!.time).toBe("14:10");
    expect(s.warnings.length).toBeGreaterThan(0);
  });

  it("reads the soft kill switch", () => {
    expect(parseCanvas(fence(["Status: OFF", "zuhr = 14:05"]), OPTS).status).toBe("off");
  });

  it("parses per-prayer note, msg template, and bare free-text note", () => {
    const s = parseCanvas(
      fence([
        "asr = 17:00 | off=5 | note=on second floor",
        "maghrib = 19:45 | msg=Maghrib at {time} rooftop",
        "zuhr = 14:05 | on ground floor",
      ]),
      OPTS,
    );
    const byKey = Object.fromEntries(s.prayers.map((p) => [p.key, p]));
    expect(byKey.asr).toMatchObject({ offsetMin: 5, note: "on second floor" });
    expect(byKey.maghrib).toMatchObject({ template: "Maghrib at {time} rooftop" });
    expect(byKey.zuhr).toMatchObject({ note: "on ground floor" });
    expect(s.errors).toEqual([]);
  });

  it("uses fallback offset and default weekend when directives are absent", () => {
    const s = parseCanvas(fence(["zuhr = 14:05"]), OPTS);
    expect(s.prayers[0]!.offsetMin).toBe(10);
    expect(s.weekendDays).toEqual([0, 6]);
  });
});

describe("html helpers", () => {
  it("extractFencedBlock returns the first block content or null", () => {
    expect(extractFencedBlock("a\n```\nx = 1\n```\nb")).toBe("x = 1");
    expect(extractFencedBlock("no fences here")).toBeNull();
  });
  it("htmlToText decodes entities and preserves line breaks", () => {
    const out = htmlToText("<p>a &amp; b</p><div>c</div>");
    expect(out).toContain("a & b");
    expect(out).toContain("c");
  });
});
