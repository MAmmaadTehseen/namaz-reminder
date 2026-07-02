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

  it("uses the plain '<Prayer> at <time>' style (no 'namaz', no lead hint)", () => {
    expect(formatReminder(slot())).toBe("<!here> Asr at 05:00 PM");
  });

  it("has no mosque icon in the default message", () => {
    expect(formatReminder(slot())).not.toContain("🕌");
  });

  it("appends an italic footer when provided (default and template)", () => {
    expect(formatReminder(slot(), "automated by ammaad")).toContain("\n_automated by ammaad_");
    expect(formatReminder(slot({ template: "Asr {time}" }), "automated by ammaad")).toContain(
      "\n_automated by ammaad_",
    );
  });

  it("omits the footer when empty/whitespace", () => {
    expect(formatReminder(slot(), "")).not.toContain("_");
    expect(formatReminder(slot(), "   ")).not.toContain("_");
  });

  it("appends a per-prayer note to the standard message", () => {
    const text = formatReminder(slot({ note: "on second floor" }));
    expect(text).toBe("<!here> Asr at 05:00 PM — on second floor");
  });

  it("renders a full template with placeholders and guarantees the ping", () => {
    const text = formatReminder(slot({ template: "Asar at {time} on second floor" }));
    expect(text).toBe("<!here> Asar at 05:00 PM on second floor");
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
