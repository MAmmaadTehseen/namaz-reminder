import { describe, it, expect } from "vitest";
import { formatReminder, prayerLabel } from "./message";
import type { PrayerSlot } from "./types";

const slot = (over: Partial<PrayerSlot> = {}): PrayerSlot => ({
  key: "asr",
  time: "17:00",
  minutes: 17 * 60,
  offsetMin: 10,
  enabled: true,
  ...over,
});

describe("formatReminder", () => {
  it("uses the literal <!here> broadcast token (NOT plain @here)", () => {
    const text = formatReminder(slot());
    expect(text).toContain("<!here>");
    expect(text).not.toMatch(/(^|[^!])@here/); // no bare @here
  });

  it("includes a title-cased label and 12-hour time", () => {
    const text = formatReminder(slot());
    expect(text).toContain("*Asr*");
    expect(text).toContain("*5:00 PM*");
    expect(text).toContain("in ~10 min");
  });

  it("omits the lead-time hint when offset is 0", () => {
    expect(formatReminder(slot({ offsetMin: 0 }))).not.toContain("in ~");
  });

  it("appends a per-prayer note to the standard message", () => {
    const text = formatReminder(slot({ note: "on second floor" }));
    expect(text).toContain("*5:00 PM*");
    expect(text).toContain("on second floor");
    expect(text).toContain("<!here>");
  });

  it("renders a full template with placeholders and guarantees the ping", () => {
    const text = formatReminder(slot({ template: "Asar at {time} on second floor" }));
    expect(text).toBe("<!here> Asar at 5:00 PM on second floor");
  });

  it("does not double-add <!here> when the template already has it", () => {
    const text = formatReminder(slot({ template: "<!here> Asar {time24}" }));
    expect(text).toBe("<!here> Asar 17:00");
    expect(text.match(/<!here>/g)).toHaveLength(1);
  });
});

describe("prayerLabel", () => {
  it("title-cases the key", () => {
    expect(prayerLabel("zuhr")).toBe("Zuhr");
    expect(prayerLabel("maghrib")).toBe("Maghrib");
  });
});
